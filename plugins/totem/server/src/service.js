import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { TOTEM_DIR, ensureDirs } from "./paths.js";
import { launchCommand } from "./connect.js";

// `totem link` as a background service, so cloud AIs can reach this computer whenever it is on,
// without a terminal window left open. macOS: a LaunchAgent. Linux: a systemd user service.
// Elsewhere (Windows for now) `totem link` runs in the foreground instead.

export const LABEL = "ai.ipolab.totem.link";
const plistPath = () => path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const unitPath = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "systemd", "user", "totem-link.service");
const quiet = { stdio: "ignore", timeout: 10000 };

function hasSystemdUser() {
  try { execFileSync("systemctl", ["--user", "show-environment"], quiet); return true; } catch { return false; }
}

export function serviceKind() {
  if (process.env.TOTEM_NO_SERVICE) return null;
  if (process.platform === "darwin") return "launchd";
  if (process.platform === "linux" && hasSystemdUser()) return "systemd";
  return null;
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sdQuote = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;

// The file each service manager reads. Pure, so tests can check it on any system.
export function serviceFile(kind, { run = launchCommand(["link", "--run"]), env = serviceEnv(), log = path.join(TOTEM_DIR, "link.log") } = {}) {
  const argv = [run.command, ...run.args];
  if (kind === "launchd") {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>${argv.map((a) => `<string>${xml(a)}</string>`).join("")}</array>
  <key>EnvironmentVariables</key>
  <dict>${Object.entries(env).map(([k, v]) => `<key>${xml(k)}</key><string>${xml(v)}</string>`).join("")}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
  }
  return `[Unit]
Description=totem link (lets the cloud AIs you linked ask this computer's totem)
After=network-online.target

[Service]
ExecStart=${argv.map(sdQuote).join(" ")}
${Object.entries(env).map(([k, v]) => `Environment=${sdQuote(`${k}=${v}`)}`).join("\n")}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
}

// Services start with a bare PATH; node must be on it for npx to work.
function serviceEnv() {
  const env = { TOTEM_HOME: TOTEM_DIR, TOTEM_SERVICE: "1", PATH: [path.dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":") };
  if (process.env.TOTEM_RELAY) env.TOTEM_RELAY = process.env.TOTEM_RELAY;
  return env;
}

export function installService() {
  const kind = serviceKind();
  if (!kind) return null;
  ensureDirs();
  if (kind === "launchd") {
    fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
    fs.writeFileSync(plistPath(), serviceFile(kind));
    const domain = `gui/${process.getuid()}`;
    try { execFileSync("launchctl", ["bootout", `${domain}/${LABEL}`], quiet); } catch { /* wasn't loaded */ }
    execFileSync("launchctl", ["bootstrap", domain, plistPath()], quiet);
    return { kind, file: plistPath() };
  }
  fs.mkdirSync(path.dirname(unitPath()), { recursive: true });
  fs.writeFileSync(unitPath(), serviceFile(kind));
  execFileSync("systemctl", ["--user", "daemon-reload"], quiet);
  execFileSync("systemctl", ["--user", "enable", "totem-link.service"], quiet);
  execFileSync("systemctl", ["--user", "restart", "totem-link.service"], quiet);
  return { kind, file: unitPath() };
}

export function removeService() {
  let removed = false;
  if (fs.existsSync(plistPath())) {
    try { execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], quiet); } catch { /* not loaded */ }
    fs.rmSync(plistPath(), { force: true });
    removed = true;
  }
  if (fs.existsSync(unitPath())) {
    try { execFileSync("systemctl", ["--user", "disable", "--now", "totem-link.service"], quiet); } catch { /* not running */ }
    fs.rmSync(unitPath(), { force: true });
    try { execFileSync("systemctl", ["--user", "daemon-reload"], quiet); } catch { /* */ }
    removed = true;
  }
  return removed;
}

export const serviceInstalled = () => fs.existsSync(plistPath()) || fs.existsSync(unitPath());
