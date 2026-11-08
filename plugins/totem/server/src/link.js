import fs from "node:fs";
import path from "node:path";
import { TOTEM_DIR, PROFILE, ensureDirs } from "./paths.js";
import { handle, TOOLS, keep } from "./mcp.js";
import { loadProfile, addReceipt } from "./store.js";
import { newCopyKey, copyKeys } from "./seal.js";
import { MODES, loadModes, loadCloudState, saveCloudState, dropCloudState, planSync, syncMessages, openAll, fromOutbox } from "./cloud.js";

// `totem link`: keep one outbound connection from this computer to the totem relay, so that
// claude.ai, ChatGPT and other cloud agents can ask this computer's totem. Each question comes in,
// is answered here from ~/.totem, and only that answer goes back.
//
// If the person turns on the cloud copy (`totem cloud on`), the same connection also keeps a sealed
// copy of their S1 and S2 items on the relay in step, so a linked AI can still ask while this
// computer is off; whatever an AI remembered in the meantime comes back here when it is on again.

export const RELAY = (process.env.TOTEM_RELAY || "https://mcp.ipolab.ai").replace(/\/$/, "");
const LINK = path.join(TOTEM_DIR, "link.json");
const LOCK = path.join(TOTEM_DIR, "link.lock");
const VERSION = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const PING_MS = 30000;
const CHECK_MS = 5 * 60000;
const WATCH_MS = 3000;

export function loadLink() { try { return JSON.parse(fs.readFileSync(LINK, "utf8")); } catch { return null; } }
function saveLink(l) { ensureDirs(); fs.writeFileSync(LINK, JSON.stringify(l, null, 2), { mode: 0o600 }); }

async function register() {
  const r = await fetch(RELAY + "/device/register", { method: "POST" });
  if (!r.ok) throw new Error(`the relay said ${r.status}`);
  const { deviceId, secret } = await r.json();
  const l = { relay: RELAY, deviceId, secret, copyKey: newCopyKey(), created: new Date().toISOString() };
  saveLink(l);
  return l;
}

// This computer's id on the relay, made on first use. The copy key never changes for an id.
export async function ensureLink() {
  let l = loadLink();
  if (!l || l.relay !== RELAY) l = await register();
  if (!l.copyKey) { l.copyKey = newCopyKey(); saveLink(l); }
  return l;
}

async function call(l, what, method = "GET") {
  const r = await fetch(`${l.relay}/device/${l.deviceId}/${what}`, { method, headers: { authorization: "Bearer " + l.secret } });
  if (r.status === 401) throw Object.assign(new Error("This computer is no longer linked."), { code: "unlinked" });
  if (!r.ok) throw new Error(`the relay said ${r.status}`);
  return r.json();
}
export const requestCode = (l) => call(l, "pair", "POST");
export const relayStatus = (l) => call(l, "status");

export async function unlink() {
  const l = loadLink();
  if (!l) return false;
  try { await call(l, "forget", "POST"); } catch { /* offline: still forget locally */ }
  fs.rmSync(LINK, { force: true });
  dropCloudState();
  return true;
}

// One `totem link` connection per computer: the background service, or one in a terminal.
export function linkRunning() {
  let pid = 0;
  try { pid = +fs.readFileSync(LOCK, "utf8"); } catch { return 0; }
  if (!pid || pid === process.pid) return 0;
  try { process.kill(pid, 0); return pid; } catch (e) { return e.code === "EPERM" ? pid : 0; }
}
function takeLock() { ensureDirs(); fs.writeFileSync(LOCK, String(process.pid), { mode: 0o600 }); }
function dropLock() { try { if (+fs.readFileSync(LOCK, "utf8") === process.pid) fs.rmSync(LOCK); } catch { /* gone */ } }

// Answer one MCP request from the relay with the local MCP handler.
export function answer(rpc, client) {
  const state = { client: String(client || "web").slice(0, 40) };
  try { return { result: handle(rpc, state) }; } catch (e) { return { error: { code: e.code || -32603, message: e.message } }; }
}

const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

// role "main": the long-lived connection that answers and keeps the copy in step.
// role "ctl": one job and done (task "sync" or "off"), for when no main connection is running.
export async function link({ lang = "en", role = "main", task = null, wantCode = false, once = false, onCode, onStatus = () => {} } = {}) {
  if (typeof WebSocket === "undefined") throw new Error(lang === "zh" ? "totem link 需要 Node 22 或更新版本。" : "totem link needs Node 22 or newer.");
  const l = await ensureLink();
  const keys = await copyKeys(l.copyKey);
  if (role === "main") takeLock();

  let stopped = false, ws = null, delay = 1000;
  let remote = null; // what the relay holds: { on, ver, count }
  let syncing = null; // the sync or switch-off waiting for the relay's reply
  let dirty = false, forceFull = false;
  let seen = { p: mtime(PROFILE), m: mtime(MODES) };
  let result = null;
  let finish = () => {};
  const send = (m) => { try { ws.send(JSON.stringify(m)); return true; } catch { return false; } };

  async function sync() {
    if (!remote) return; // not welcomed yet
    if (syncing) { dirty = true; return; }
    const modes = loadModes();
    if (!modes.cloud.on) {
      if (remote.on) { syncing = { off: true }; send({ type: "cloud", on: false }); }
      else { dropCloudState(); if (task) finish({ on: false }); }
      return;
    }
    syncing = { planning: true };
    let plan;
    try { plan = await planSync(loadProfile()?.items || [], keys, { levels: modes.cloud.levels, state: loadCloudState(), remote, force: forceFull }); }
    catch (e) { syncing = null; onStatus("sync-failed", e.message); return; }
    if (!plan.full && !plan.put.length && !plan.del.length) {
      syncing = null;
      if (dirty) { dirty = false; return sync(); }
      if (task) finish({ on: true, count: remote.count });
      return;
    }
    const ver = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    syncing = { ver, names: plan.names, levels: modes.cloud.levels };
    for (const m of syncMessages(plan, ver)) if (!send(m)) { syncing = null; return; }
    onStatus("syncing", plan.put.length, plan.del.length);
  }

  async function settle() {
    syncing = null;
    if (dirty) { dirty = false; await sync(); }
  }

  async function onMessage(msg) {
    if (msg.type === "pair" && msg.code) onCode?.(msg.code, msg.expires);
    else if (msg.type === "req") {
      const out = answer(msg.rpc, msg.client);
      send({ type: "res", id: msg.id, ...out });
      onStatus("answered", msg.client, msg.rpc?.params?.name || msg.rpc?.method);
    } else if (msg.type === "key") send({ type: "key", id: msg.id, key: l.copyKey });
    else if (msg.type === "welcome") {
      remote = msg.cloud || { on: false };
      if (msg.pending?.outbox || msg.pending?.receipts) send({ type: "drain" });
      else await sync();
    } else if (msg.type === "drain") {
      // What AIs remembered, and what they were told, while this computer was off.
      let added = 0;
      for (const { value } of await openAll(keys, msg.outbox)) {
        const item = fromOutbox(value);
        if (item && keep(item)) added++;
      }
      for (const { value } of await openAll(keys, msg.receipts)) if (value && typeof value === "object") addReceipt({ ...value, via: "cloud" });
      if ((msg.outbox || []).length) forceFull = true; // the relay put those into the copy itself
      send({ type: "ack", outbox: (msg.outbox || []).map((r) => r.name), receipts: (msg.receipts || []).map((r) => r.name) });
      if (added) onStatus("merged", added);
      if (msg.more) send({ type: "drain" });
      else await sync();
    } else if (msg.type === "synced") {
      if (msg.ok && syncing?.ver && msg.ver === syncing.ver) {
        saveCloudState({ ver: msg.ver, levels: syncing.levels, names: syncing.names, at: new Date().toISOString() });
        remote = { on: true, ver: msg.ver, count: msg.count };
        forceFull = false;
        onStatus("synced", msg.count);
        if (task && !dirty) finish({ on: true, count: msg.count });
      } else if (!msg.ok) {
        dropCloudState();
        remote = { on: false };
        onStatus("sync-failed", msg.reason);
        if (task) finish({ on: false, error: msg.reason });
      }
      await settle();
    } else if (msg.type === "cloud" && msg.on === false) {
      remote = { on: false };
      dropCloudState();
      addReceipt({ app: "cloud copy deleted", items: [], via: "cloud", client: "you", write: true });
      onStatus("cloud-off");
      if (task && !dirty) finish({ on: false });
      await settle();
    }
  }

  // Changes on this computer (a scan, an edit on the totem page, `totem cloud on`) reach the copy
  // within a few seconds. A long gap between ticks means the computer slept: ask what waited.
  let lastTick = Date.now();
  const watch = setInterval(() => {
    const now = Date.now();
    if (now - lastTick > PING_MS * 3 && ws?.readyState === 1) send({ type: "check" });
    lastTick = now;
    const p = mtime(PROFILE), m = mtime(MODES);
    if (p !== seen.p || m !== seen.m) { seen = { p, m }; sync(); }
  }, WATCH_MS);

  const openOnce = () => new Promise((resolve) => {
    remote = null;
    syncing = null;
    const url = `${l.relay.replace(/^http/, "ws")}/device/${l.deviceId}/connect?role=${role}`;
    ws = new WebSocket(url, { headers: { authorization: "Bearer " + l.secret } });
    let ping, check;
    ws.addEventListener("open", () => {
      delay = 1000;
      onStatus("online");
      send({ type: "hello", tools: TOOLS, version: 2, app: VERSION });
      if (wantCode) { wantCode = false; send({ type: "pair" }); }
      ping = setInterval(() => send({ type: "ping" }), PING_MS);
      check = setInterval(() => send({ type: "check" }), CHECK_MS);
    });
    let chain = Promise.resolve();
    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.type === "pong") return;
      chain = chain.then(() => onMessage(msg)).catch((e) => onStatus("error", e.message));
    });
    ws.addEventListener("close", (ev) => { clearInterval(ping); clearInterval(check); onStatus("offline", ev.code); resolve(ev.code); });
    ws.addEventListener("error", () => { /* close follows */ });
  });

  const run = (async () => {
    while (!stopped) {
      const code = await openOnce();
      if (stopped || code === 4001 || once) break; // stopped, unlinked from the relay, or one job
      if (code === 4000) { onStatus("replaced"); if (role !== "main" || !process.env.TOTEM_SERVICE) break; } // another `totem link` took over
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 60000);
    }
    clearInterval(watch);
    if (role === "main") dropLock();
  })();

  const stop = () => { stopped = true; try { ws?.close(1000, "bye"); } catch { /* */ } };
  const finished = new Promise((resolve) => { finish = (r) => { result = r; stop(); resolve(r); }; run.then(() => resolve(result)); });
  return { stop, deviceId: l.deviceId, finished, done: run };
}
