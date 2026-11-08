import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { cleanUserText } from "./clean.js";

// ChatGPT and Claude.ai "export your data" packages. Both contain conversations.json.
// Accepts the .zip, the unzipped folder, or the conversations.json itself.
export function readExport(input) {
  let file = input;
  if (input.endsWith(".zip")) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "totem-export-"));
    execFileSync("unzip", ["-q", "-o", input, "conversations.json", "-d", dir]);
    file = path.join(dir, "conversations.json");
  } else if (fs.statSync(input).isDirectory()) file = path.join(input, "conversations.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data)) throw new Error("conversations.json is not a list");
  const utterances = [];
  let kind = null;
  for (const conv of data) {
    if (conv.mapping) { // ChatGPT
      kind = "chatgpt";
      for (const node of Object.values(conv.mapping)) {
        const m = node && node.message;
        if (!m || !m.author || m.author.role !== "user") continue;
        const parts = (m.content && m.content.parts) || [];
        const text = cleanUserText(parts.filter((x) => typeof x === "string").join("\n"));
        if (text) utterances.push({ source: "chatgpt", session: conv.title || conv.id, project: null, at: m.create_time ? new Date(m.create_time * 1000).toISOString() : null, text });
      }
    } else if (conv.chat_messages) { // Claude.ai
      kind = "claude-ai";
      for (const m of conv.chat_messages) {
        if (m.sender !== "human") continue;
        const raw = m.text || (Array.isArray(m.content) ? m.content.map((c) => c.text || "").join("\n") : "");
        const text = cleanUserText(raw);
        if (text) utterances.push({ source: "claude-ai", session: conv.name || conv.uuid, project: null, at: m.created_at, text });
      }
    }
  }
  return { name: kind === "chatgpt" ? "ChatGPT" : "Claude.ai", utterances, filesTouched: [], commands: [], docs: [], sessions: data.length, projects: new Map() };
}

export function readPaste(text) {
  const t = String(text || "").trim();
  return { name: "Pasted text", utterances: t ? [{ source: "paste", session: "paste", project: null, at: new Date().toISOString(), text: t.slice(0, 20000) }] : [], filesTouched: [], commands: [], docs: [], sessions: t ? 1 : 0, projects: new Map() };
}
