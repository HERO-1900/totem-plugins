// The cloud copy (C) on the computer's side: which items go up, what changed since the last sync,
// and taking back what an AI remembered while the computer was off.
//
// ~/.totem/modes.json        what the person turned on: { "cloud": { "on": true, "levels": ["S1", "S2"] } }
// ~/.totem/cloud-state.json  what the relay holds now: { ver, levels, names: { <sealed name>: <hash> } }
//
// Only S1 and S2 can go up, whatever modes.json says. S3 and S4 stay on this computer.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { TOTEM_DIR, ensureDirs } from "./paths.js";
import { nameFor, seal, open } from "./seal.js";

export const MODES = path.join(TOTEM_DIR, "modes.json");
const STATE = path.join(TOTEM_DIR, "cloud-state.json");
export const CLOUD_LEVELS = ["S1", "S2"];
export const CHUNK = 200; // items per sync message; the relay takes up to 256

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const writeJson = (f, v) => {
  ensureDirs();
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
};

export function loadModes() {
  const m = readJson(MODES) || {};
  const levels = (Array.isArray(m.cloud?.levels) ? m.cloud.levels : CLOUD_LEVELS).filter((l) => CLOUD_LEVELS.includes(l));
  return { ...m, cloud: { on: m.cloud?.on === true, levels: levels.length ? [...new Set(levels)].sort() : CLOUD_LEVELS } };
}
export function saveModes(m) { writeJson(MODES, m); }
export function setCloud(on, levels) {
  const m = loadModes();
  m.cloud = { on: !!on, levels: levels || m.cloud.levels };
  saveModes(m);
  return loadModes();
}

export const loadCloudState = () => readJson(STATE);
export const saveCloudState = (s) => writeJson(STATE, s);
export const dropCloudState = () => fs.rmSync(STATE, { force: true });

// What goes into the copy: public and everyday items, with only the fields an answer uses.
export function lensItems(items, levels = CLOUD_LEVELS) {
  const allow = new Set(levels.filter((l) => CLOUD_LEVELS.includes(l)));
  return (items || []).filter((i) => i && i.id && !i.hidden && allow.has(i.level)).map((i) => ({
    id: i.id,
    kind: i.kind,
    text: i.text,
    text_en: i.text_en,
    tags: i.tags,
    level: i.level,
    sure: i.sure,
    by: i.by,
    evidence: (i.evidence || []).slice(0, 2).map((e) => ({ source: e.source, at: e.at, quote: typeof e.quote === "string" ? e.quote.slice(0, 300) : undefined })),
  }));
}

const hashOf = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);

// What to send so the relay holds exactly the lens of `items`.
// state: our last cloud-state.json; remote: what the relay said it holds ({ on, ver }).
// A full sync replaces everything; it runs whenever the two sides might disagree.
export async function planSync(items, keys, { levels = CLOUD_LEVELS, state = null, remote = null, force = false } = {}) {
  const lens = lensItems(items, levels);
  const names = {};
  const byName = new Map();
  for (const it of lens) {
    const n = await nameFor(keys, "ci", it.id);
    names[n] = hashOf(it);
    byName.set(n, it);
  }
  const full = force || !state || !remote?.on || !remote.ver || remote.ver !== state.ver || String(state.levels) !== String(levels);
  const before = full ? {} : state.names || {};
  const put = [];
  for (const [n, h] of Object.entries(names)) if (before[n] !== h) put.push({ n, s: await seal(keys, n, byName.get(n)) });
  const del = full ? [] : Object.keys(before).filter((n) => !(n in names));
  return { full, put, del, names, count: lens.length };
}

// The messages for one sync. The relay counts the copy as unfinished until the one with "done".
export function syncMessages(plan, ver) {
  const parts = [];
  for (let i = 0; i < plan.put.length; i += CHUNK) parts.push({ put: plan.put.slice(i, i + CHUNK) });
  for (let i = 0; i < plan.del.length; i += CHUNK * 4) parts.push({ del: plan.del.slice(i, i + CHUNK * 4) });
  if (!parts.length) parts.push({});
  Object.assign(parts[0], { first: true, full: plan.full });
  parts[parts.length - 1].done = { ver, count: plan.count };
  return parts.map((p) => ({ type: "sync", ...p }));
}

// Open what waited on the relay. A blob that won't open (sealed with an older key) is dropped.
export async function openAll(keys, rows) {
  const out = [];
  for (const r of rows || []) {
    try { out.push({ name: r.name, value: await open(keys, r.name, r.sealed) }); } catch { out.push({ name: r.name, value: null }); }
  }
  return out;
}

// An item that came back from the relay is an agent's note: keep its own fields only.
export function fromOutbox(v) {
  if (!v || typeof v.id !== "string" || typeof v.text !== "string") return null;
  return {
    id: v.id.slice(0, 40),
    kind: v.kind,
    text: v.text.slice(0, 300),
    text_en: String(v.text_en || v.text).slice(0, 300),
    tags: Array.isArray(v.tags) ? v.tags.slice(0, 3) : ["interests"],
    level: CLOUD_LEVELS.includes(v.level) ? v.level : "S2",
    sure: "said",
    evidence: (v.evidence || []).slice(0, 1).map((e) => ({ source: String(e.source || "web"), at: e.at, quote: String(e.quote || v.text).slice(0, 300), via: "cloud" })),
    by: "agent",
  };
}
