import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export const HOME = os.homedir();
// Where to look for agent history. Change it to scan another folder (used by tests and demos).
export const SCAN_HOME = process.env.TOTEM_SCAN_HOME || HOME;
export const TOTEM_DIR = process.env.TOTEM_HOME || path.join(HOME, ".totem");
export const PROFILE = path.join(TOTEM_DIR, "profile.json");
export const RECEIPTS = path.join(TOTEM_DIR, "receipts.jsonl");
export const CACHE_DIR = path.join(TOTEM_DIR, "cache");
export const WORK_DIR = path.join(TOTEM_DIR, "work");

export function ensureDirs() {
  for (const d of [TOTEM_DIR, CACHE_DIR, WORK_DIR]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
}

// Walk a folder and return files that match `test`. Skips what we cannot read.
export function walk(dir, test, out = [], depth = 0) {
  if (depth > 8) return out;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out, depth + 1);
    else if (e.isFile() && test(p)) out.push(p);
  }
  return out;
}

export function readLines(file) {
  let s;
  try { s = fs.readFileSync(file, "utf8"); } catch { return []; }
  const out = [];
  for (const line of s.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip broken line */ }
  }
  return out;
}

export function readText(file, max = 20000) {
  try { const s = fs.readFileSync(file, "utf8"); return s.length > max ? s.slice(0, max) : s; } catch { return null; }
}
