import path from "node:path";
import { HOME, SCAN_HOME, walk, readLines, readText } from "../paths.js";
import { cleanUserText, textOf } from "./clean.js";
import { bump } from "./claude.js";

const ROOT = path.join(SCAN_HOME, ".codex");

// Reads ~/.codex/sessions/**/*.jsonl (Codex CLI "rollout" files) and history.jsonl.
// Handles the newer {type, payload} rows and the older flat rows.
export function readCodex({ root = ROOT } = {}) {
  const files = walk(path.join(root, "sessions"), (p) => p.endsWith(".jsonl"));
  const utterances = [], filesTouched = [], commands = [], docs = [];
  const projects = new Map(), seen = new Set();
  let sessions = 0;
  for (const f of files) {
    const rows = readLines(f);
    if (!rows.length) continue;
    sessions++;
    let cwd = null;
    const session = path.basename(f, ".jsonl");
    for (const r of rows) {
      const p = r.payload || r;
      const at = r.timestamp || p.timestamp;
      if (r.type === "session_meta" || (p.cwd && !cwd)) cwd = p.cwd || cwd;
      let text = "";
      if (p.type === "message" && p.role === "user") text = textOf(p.content);
      else if (p.type === "user_message") text = p.message || "";
      else if ((p.type === "function_call" || p.type === "local_shell_call") && (p.arguments || p.action)) {
        try {
          const a = typeof p.arguments === "string" ? JSON.parse(p.arguments) : (p.arguments || p.action);
          const cmd = Array.isArray(a.command) ? a.command.join(" ") : a.command;
          if (cmd) commands.push(String(cmd).slice(0, 200));
          const m = String(cmd || "").match(/\*\*\* (?:Update|Add) File: (\S+)/g);
          if (m) for (const x of m) filesTouched.push(x.split(": ")[1]);
        } catch {}
        continue;
      }
      text = cleanUserText(text);
      if (!text) continue;
      const key = session + "|" + text.slice(0, 200);
      if (seen.has(key)) continue;
      seen.add(key);
      if (cwd) bump(projects, cwd, at);
      utterances.push({ source: "codex", session, project: cwd ? path.basename(cwd) : null, at, text });
    }
  }
  // history.jsonl has prompts typed into Codex, sometimes from sessions whose files are gone.
  for (const r of readLines(path.join(root, "history.jsonl"))) {
    const text = cleanUserText(r.text);
    if (!text) continue;
    const key = (r.session_id || "") + "|" + text.slice(0, 200);
    if ([...seen].some((k) => k.endsWith("|" + text.slice(0, 200)))) continue;
    seen.add(key);
    utterances.push({ source: "codex", session: r.session_id || "history", project: null, at: r.ts ? new Date(r.ts * 1000).toISOString() : null, text });
  }
  const mdFiles = [path.join(root, "AGENTS.md"), path.join(root, "instructions.md")];
  for (const c of projects.keys()) mdFiles.push(path.join(c, "AGENTS.md"));
  for (const p of new Set(mdFiles)) {
    const t = readText(p, 8000);
    if (t && t.trim()) docs.push({ source: "codex", file: p.replace(HOME, "~"), text: t });
  }
  return { name: "Codex", utterances, filesTouched, commands, docs, sessions, projects };
}
