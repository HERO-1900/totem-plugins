import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { TOTEM_DIR, ensureDirs } from "./paths.js";
import { loadProfile, saveProfile, addReceipt } from "./store.js";
import { CATALOG } from "./view.js";
import { rpc, TOOLS, queryTerms, search } from "./answer.js";

// totem as an MCP server over stdio (JSON-RPC 2.0, one message per line).
// Any agent that speaks MCP (Claude Code, Claude Desktop, Codex, Cursor, ...) can ask
// "what does totem know that matters for this?" and gets only that slice.
// The answers are worked out in answer.js, which the relay also runs for the cloud copy;
// this file only reads and writes ~/.totem. Every call leaves a receipt in ~/.totem/receipts.jsonl.

export { TOOLS, queryTerms, search };

const VERSION = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// What an agent may read without asking: S1 and S2. The user can raise one app to S3 with
// `totem allow <client> S3`; that lives in ~/.totem/grants.json as {"claude-code": "S3"}.
// S4 (documents) is never handed over here.
const GRANTS = path.join(TOTEM_DIR, "grants.json");
export function loadGrants() { try { return JSON.parse(fs.readFileSync(GRANTS, "utf8")); } catch { return {}; } }
export function saveGrants(g) { ensureDirs(); fs.writeFileSync(GRANTS, JSON.stringify(g, null, 2), { mode: 0o600 }); }
export const maxFor = (client) => loadGrants()[client] || "S2";

// Put one item an agent asked to keep at the top of the profile. The same note twice is kept once.
export function keep(item) {
  const prof = loadProfile() || { version: 1, items: [], sources: [] };
  if (prof.items.some((i) => i.id === item.id || (!i.hidden && i.text === item.text))) return false;
  prof.items.unshift(item);
  prof.updated = new Date().toISOString();
  saveProfile(prof);
  return true;
}

export const io = {
  version: VERSION,
  catalog: CATALOG,
  items: () => loadProfile()?.items || null,
  maxFor,
  save: keep,
  receipt: addReceipt,
};

export const handle = (m, state) => rpc(m, state, io);

export function serveMcp() {
  const state = { client: "agent" };
  const out = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return out({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
    if (m.id === undefined || m.id === null) return; // notifications
    try {
      out({ jsonrpc: "2.0", id: m.id, result: handle(m, state) });
    } catch (e) {
      out({ jsonrpc: "2.0", id: m.id, error: { code: e.code || -32603, message: e.message } });
    }
  });
}
