import path from "node:path";
import { HOME, SCAN_HOME, TOTEM_DIR, walk, readLines, readText } from "../paths.js";
import { cleanUserText, textOf } from "./clean.js";

const ROOT = path.join(SCAN_HOME, ".claude");

// Reads ~/.claude/projects/**/*.jsonl (one file per Claude Code session),
// plus CLAUDE.md files and Claude Code's own memory notes.
export function readClaudeCode({ root = ROOT } = {}) {
  const files = walk(path.join(root, "projects"), (p) => p.endsWith(".jsonl"));
  const utterances = [], filesTouched = [], commands = [], docs = [];
  const sessions = new Set(), projects = new Map();
  for (const f of files) {
    const rows = readLines(f);
    for (const r of rows) {
      if (!r || r.isSidechain) continue;
      const cwd = r.cwd;
      // Skip the runs totem itself makes when it uses Claude Code as its model.
      if (cwd && cwd.startsWith(TOTEM_DIR)) break;
      const at = r.timestamp;
      if (r.type === "user" && r.message && !r.isMeta) {
        const text = cleanUserText(textOf(r.message.content));
        if (!text) continue;
        sessions.add(r.sessionId || f);
        if (cwd) bump(projects, cwd, at);
        utterances.push({ source: "claude-code", session: r.sessionId || path.basename(f, ".jsonl"), project: cwd ? path.basename(cwd) : null, at, text });
      } else if (r.type === "assistant" && r.message && Array.isArray(r.message.content)) {
        for (const c of r.message.content) {
          if (c.type !== "tool_use" || !c.input) continue;
          if (c.input.file_path) filesTouched.push(c.input.file_path);
          if (typeof c.input.command === "string") commands.push(c.input.command.slice(0, 200));
        }
      }
    }
  }
  const mdFiles = [path.join(root, "CLAUDE.md"), ...walk(path.join(root, "projects"), (p) => /\/memory\/[^/]+\.md$/.test(p))];
  for (const cwd of projects.keys()) mdFiles.push(path.join(cwd, "CLAUDE.md"));
  for (const p of new Set(mdFiles)) {
    const t = readText(p, 8000);
    if (t && t.trim()) docs.push({ source: "claude-code", file: p.replace(HOME, "~"), text: t });
  }
  return { name: "Claude Code", utterances, filesTouched, commands, docs, sessions: sessions.size, projects };
}

export function bump(map, cwd, at) {
  const p = map.get(cwd) || { cwd, count: 0, first: at, last: at };
  p.count++;
  if (at && (!p.first || at < p.first)) p.first = at;
  if (at && (!p.last || at > p.last)) p.last = at;
  map.set(cwd, p);
}
