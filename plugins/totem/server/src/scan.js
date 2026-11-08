import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { readClaudeCode } from "./sources/claude.js";
import { readCodex } from "./sources/codex.js";
import { readExport, readPaste } from "./sources/exports.js";
import { heuristicItems } from "./heuristics.js";
import { sample } from "./extract.js";
import { mergeWithMap } from "./core/extract.js";
import { liveExtract } from "./core/live.js";
import { pickProvider } from "./llm.js";
import { loadProfile, saveProfile } from "./store.js";
import { redact } from "./redact.js";
import { PROFILE, TOTEM_DIR, SCAN_HOME, HOME, ensureDirs } from "./paths.js";

export const EXCERPTS = path.join(TOTEM_DIR, "excerpts.json");

export function readSources({ imports = [], paste } = {}) {
  const sources = [readClaudeCode(), readCodex()];
  for (const f of imports) sources.push(readExport(f));
  if (paste) sources.push(readPaste(paste));
  // Show note paths from the home folder (~/.claude/CLAUDE.md), never the full path.
  const tilde = (f) => String(f || "").replace(SCAN_HOME, "~").replace(HOME, "~");
  for (const s of sources) for (const d of s.docs || []) d.file = tilde(d.file);
  return sources.filter((s) => s.utterances.length || s.docs.length);
}

export const summarize = (sources) => sources.map((s) => ({ name: s.name, sessions: s.sessions, messages: s.utterances.length, notes: s.docs.length }));

// Keep what the person did by hand (added items, hidden flags, level edits) across scans.
function finish(sources, ruleItems, modelItems, providerName) {
  const prev = loadProfile();
  const kept = (prev?.items || []).filter((i) => i.by === "user");
  const hiddenIds = new Set((prev?.items || []).filter((i) => i.hidden).map((i) => i.id));
  const levelEdits = new Map((prev?.items || []).filter((i) => i.levelEdited).map((i) => [i.id, i.level]));
  const { items: merged, into } = mergeWithMap([...ruleItems, ...modelItems]);
  const items = merged.map((i) => ({ ...i, hidden: hiddenIds.has(i.id) || undefined, level: levelEdits.get(i.id) || i.level, levelEdited: levelEdits.has(i.id) || undefined }));
  const profile = {
    version: 2, updated: new Date().toISOString(), model: providerName,
    sources: summarize(sources), total: sources.reduce((a, s) => a + s.utterances.length, 0),
    items: [...kept, ...items],
  };
  saveProfile(profile);
  return { profile, into };
}

function saveExcerpts(docs) {
  if (!docs?.length) return;
  ensureDirs();
  fs.writeFileSync(EXCERPTS, JSON.stringify({ updated: new Date().toISOString(), docs }), { mode: 0o600 });
}
export function loadExcerpts() { try { return JSON.parse(fs.readFileSync(EXCERPTS, "utf8")); } catch { return null; } }

// The page's scan: every step goes out as an event (see core/live.js), then `done` with the saved items.
export async function scanLive({ model, imports = [], paste, emit = () => {}, signal } = {}) {
  const t0 = Date.now();
  const sources = readSources({ imports, paste });
  emit("sources", { list: summarize(sources), total: sources.reduce((a, s) => a + s.utterances.length, 0) });
  const rules = heuristicItems(sources);
  for (const item of rules) emit("rule", { item });
  const provider = pickProvider(model);
  let modelItems = [], docs = [], warn = [];
  if (provider.stream) {
    const picked = sample(sources);
    if (picked.length) {
      const r = await liveExtract({ picked, provider, emit, signal });
      modelItems = r.items; docs = r.docs; warn = r.errors;
    }
  }
  const { profile, into } = finish(sources, rules, modelItems, provider.name);
  saveExcerpts(docs);
  emit("done", { items: profile.items, into, profile: { updated: profile.updated, model: profile.model, sources: profile.sources, total: profile.total }, ms: Date.now() - t0, warn });
  return profile;
}

// The terminal's scan: asks once before anything goes to a model.
export async function scan({ model, imports, paste, yes, log = console.error } = {}) {
  const sources = readSources({ imports, paste });
  if (!sources.length) {
    log("没有找到 Claude Code 或 Codex 的记录（~/.claude/projects、~/.codex/sessions）。");
    log("No Claude Code or Codex history found. You can import a ChatGPT or Claude.ai export: totem scan --import conversations.zip");
  }
  for (const s of sources) log(`  ${s.name}: ${s.sessions} sessions, ${s.utterances.length} messages from you${s.docs.length ? `, ${s.docs.length} notes` : ""}`);

  const provider = pickProvider(model);
  const picked = provider.stream ? sample(sources) : [];
  let modelItems = [], docs = [];
  if (provider.stream && picked.length) {
    const chars = picked.reduce((a, p) => a + p.text.length, 0);
    const hidden = picked.reduce((a, p) => a + redact(p.text).hits, 0);
    log(`\ntotem will send ${picked.length} of your messages (${Math.round(chars / 1000)}k characters, ${hidden} secrets already hidden) to ${provider.label}, which sends them to ${provider.to}.`);
    log(`totem 会把其中 ${picked.length} 条消息（已抹掉 ${hidden} 处密钥）交给 ${provider.label} 整理，内容会经过 ${provider.to}。整理结果只存在你电脑的 ${PROFILE}。`);
    let ok = yes;
    if (!ok && process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      ok = /^y/i.test(await rl.question("Continue? 继续？ [y/N] "));
      rl.close();
    }
    if (ok) {
      log("整理中 · organizing…");
      let n = 0, total = 0;
      const r = await liveExtract({ picked, provider, emit: (type, d) => {
        if (type === "plan") total = d.batches;
        if (type === "item") n++;
        if (type === "batch" && d.state === "done") log(`  ${d.batch + 1}/${total} · ${n} items`);
        if (type === "warn") log("  failed: " + d.message);
      } });
      modelItems = r.items; docs = r.docs;
    } else log("Skipped the model. Only rule-based facts this time. 这次只用规则整理。");
  }
  const { profile } = finish(sources, heuristicItems(sources), modelItems, provider.name);
  saveExcerpts(docs);
  log(`\n${profile.items.length} items saved to ${PROFILE}`);
  return profile;
}
