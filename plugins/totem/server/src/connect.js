import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// `totem connect`: add totem to every agent app found on this computer, so the user
// never has to edit a config file. `totem connect --remove` takes it out again.

const HOME = os.homedir();
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "totem.js");

// How another program should start totem (an agent app, or the background `totem link`).
// From an npx cache the path changes, so use npx; otherwise point at this copy. Absolute paths,
// because desktop apps and services often lack the shell PATH.
export function launchCommand(sub = ["mcp"]) {
  if (/[\\/]_npx[\\/]/.test(BIN)) {
    const npx = path.join(path.dirname(process.execPath), process.platform === "win32" ? "npx.cmd" : "npx");
    return { command: fs.existsSync(npx) ? npx : "npx", args: ["-y", "@ipolab/totem", ...sub] };
  }
  return { command: process.execPath, args: [BIN, ...sub] };
}

function claudeDesktopConfig() {
  if (process.platform === "darwin") return path.join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return path.join(HOME, ".config", "Claude", "claude_desktop_config.json");
}

// JSON apps that keep servers under "mcpServers".
const JSON_APPS = [
  { id: "claude-desktop", name: "Claude Desktop", file: claudeDesktopConfig, dir: (f) => path.dirname(f) },
  { id: "cursor", name: "Cursor", file: () => path.join(HOME, ".cursor", "mcp.json"), dir: () => path.join(HOME, ".cursor") },
  { id: "windsurf", name: "Windsurf", file: () => path.join(HOME, ".codeium", "windsurf", "mcp_config.json"), dir: () => path.join(HOME, ".codeium", "windsurf") },
  { id: "gemini-cli", name: "Gemini CLI", file: () => path.join(HOME, ".gemini", "settings.json"), dir: () => path.join(HOME, ".gemini") },
  { id: "antigravity", name: "Antigravity", file: () => path.join(HOME, ".gemini", "config", "mcp_config.json"), dir: () => path.join(HOME, ".gemini", "config") },
  { id: "vscode", name: "VS Code", key: "servers", file: vscodeConfig, dir: (f) => path.dirname(f) },
];

function vscodeConfig() {
  if (process.platform === "darwin") return path.join(HOME, "Library", "Application Support", "Code", "User", "mcp.json");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "Code", "User", "mcp.json");
  return path.join(HOME, ".config", "Code", "User", "mcp.json");
}

function has(cmd) {
  try { execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" }); return true; } catch { return false; }
}

function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { if (e.code === "ENOENT") return {}; throw new Error(`${f} is not valid JSON, left it alone`); }
}

function writeJson(f, obj) {
  if (fs.existsSync(f)) fs.copyFileSync(f, f + ".before-totem");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(obj, null, 2) + "\n");
}

function tomlString(s) { return JSON.stringify(s); }

// Drop the [mcp_servers.totem] table (and its sub-tables) from a config.toml text.
export function dropTomlTable(s) {
  const out = [];
  let skip = false;
  for (const line of s.split("\n")) {
    const header = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/);
    if (header) skip = header[1] === "mcp_servers.totem" || header[1].startsWith("mcp_servers.totem.");
    if (!skip) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function connect({ remove = false, only = null } = {}) {
  const run = launchCommand();
  const done = [];
  const want = (id) => !only || only.split(",").includes(id);

  // Claude Code: its own CLI keeps the config right.
  if (want("claude-code") && has("claude")) {
    try {
      try { execFileSync("claude", ["mcp", "remove", "-s", "user", "totem"], { stdio: "ignore" }); } catch { /* not there yet */ }
      if (!remove) execFileSync("claude", ["mcp", "add", "-s", "user", "totem", "--", run.command, ...run.args], { stdio: "ignore" });
      done.push(["Claude Code", "ok"]);
    } catch (e) { done.push(["Claude Code", "failed: " + e.message.split("\n")[0]]); }
  }

  // Codex: ~/.codex/config.toml
  const codexDir = path.join(HOME, ".codex");
  if (want("codex") && (fs.existsSync(codexDir) || has("codex"))) {
    const f = path.join(codexDir, "config.toml");
    let s = ""; try { s = fs.readFileSync(f, "utf8"); } catch { /* new file */ }
    const before = s;
    s = dropTomlTable(s);
    if (!remove) s = s.replace(/\s*$/, "\n") + `\n[mcp_servers.totem]\ncommand = ${tomlString(run.command)}\nargs = [${run.args.map(tomlString).join(", ")}]\n`;
    if (s !== before) {
      if (before) fs.copyFileSync(f, f + ".before-totem");
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(f, s.replace(/^\n+/, ""));
    }
    done.push(["Codex", "ok"]);
  }

  for (const app of JSON_APPS) {
    if (!want(app.id)) continue;
    const f = app.file();
    if (!fs.existsSync(app.dir(f))) continue; // app not installed
    try {
      const cfg = readJson(f);
      const key = app.key || "mcpServers";
      cfg[key] = cfg[key] || {};
      if (remove) delete cfg[key].totem;
      else cfg[key].totem = app.key === "servers" ? { type: "stdio", command: run.command, args: run.args } : { command: run.command, args: run.args };
      writeJson(f, cfg);
      done.push([app.name, app.id === "claude-desktop" ? "ok, restart Claude Desktop" : "ok"]);
    } catch (e) { done.push([app.name, "failed: " + e.message]); }
  }
  return done;
}
