import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SCAN_HOME, HOME } from "./paths.js";

// Facts we can read straight off the logs, without any model. Fast and free.
const EXT = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", py: "Python", rs: "Rust",
  go: "Go", swift: "Swift", kt: "Kotlin", java: "Java", rb: "Ruby", php: "PHP", cs: "C#", cpp: "C++", c: "C",
  vue: "Vue", svelte: "Svelte", sql: "SQL", dart: "Dart", ex: "Elixir", scala: "Scala", lua: "Lua", r: "R", ipynb: "Jupyter",
};
const TOOLS = [
  ["pnpm", /\bpnpm\b/], ["npm", /\bnpm (?:i|install|run)\b/], ["yarn", /\byarn\b/], ["bun", /\bbun\b/],
  ["uv", /\buv (?:run|pip|add|sync)\b/], ["pip", /\bpip3? install\b/], ["poetry", /\bpoetry\b/], ["cargo", /\bcargo\b/],
  ["Docker", /\bdocker\b/], ["Wrangler (Cloudflare)", /\bwrangler\b/], ["Vercel", /\bvercel\b/], ["Xcode", /\bxcodebuild\b/],
  ["git", /\bgit (?:commit|push|rebase)\b/], ["Playwright", /playwright/], ["pytest", /\bpytest\b/], ["Vitest", /\bvitest\b/],
];

let n = 0;
const mk = (kind, text, tags, level, evidence, sure = "said", text_en) =>
  ({ id: "h" + (++n), kind, text, text_en: text_en || text, tags, level, sure, evidence, by: "rules" });

export function heuristicItems(sources) {
  n = 0;
  const items = [];
  const all = sources.flatMap((s) => s.utterances);

  // Name and email from git config: what the person told their own computer.
  for (const [key, tag, level] of [["user.name", "name", "S2"], ["user.email", "email", "S2"]]) {
    try {
      // When scanning another folder (tests, demos), read that folder's git config, not this computer's.
      const args = SCAN_HOME === HOME ? ["config", "--global", key] : ["config", "--file", path.join(SCAN_HOME, ".gitconfig"), key];
      const v = execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (v) items.push(mk("identity", (tag === "name" ? "名字：" : "邮箱：") + v, [tag], level, [{ source: "git", quote: `git config ${key}` }], "said", (tag === "name" ? "Name: " : "Email: ") + v));
    } catch {}
  }

  // Languages the person writes in.
  const sample = all.map((u) => u.text).join("\n").slice(0, 400000);
  const han = (sample.match(/[一-鿿]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]{2,}/g) || []).length;
  if (han + latin > 200) {
    const zh = han / (han + latin * 2);
    const langs = zh > 0.6 ? ["中文"] : zh > 0.15 ? ["中文", "English"] : ["English"];
    items.push(mk("identity", "常用语言：" + langs.join("、"), ["languages"], "S1", [{ source: "count", quote: `${all.length} 条消息里的文字` }], "inferred", "Writes in: " + langs.map((l) => (l === "中文" ? "Chinese" : l)).join(", ")));
  }

  // Time zone and working hours.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz) items.push(mk("identity", "时区：" + tz, ["timezone"], "S1", [{ source: "system", quote: "本机时区设置" }], "said", "Time zone: " + tz));
  const hours = new Array(24).fill(0);
  for (const u of all) if (u.at) { const d = new Date(u.at); if (!isNaN(d)) hours[d.getHours()]++; }
  const total = hours.reduce((a, b) => a + b, 0);
  if (total > 40) {
    const late = [22, 23, 0, 1, 2, 3].reduce((a, h) => a + hours[h], 0) / total;
    const early = [5, 6, 7, 8].reduce((a, h) => a + hours[h], 0) / total;
    const peak = hours.indexOf(Math.max(...hours));
    const zh = late > 0.3 ? "夜里干活多，晚上 10 点以后的消息占 " + Math.round(late * 100) + "%" : early > 0.25 ? "早起型，早上 5–9 点很活跃" : `最常在 ${peak}:00 前后干活`;
    const en = late > 0.3 ? `Night owl: ${Math.round(late * 100)}% of messages after 10 pm` : early > 0.25 ? "Early riser: busy 5–9 am" : `Busiest around ${peak}:00`;
    items.push(mk("preference", zh, ["schedule"], "S2", [{ source: "count", quote: `${total} 条带时间的消息` }], "inferred", en));
  }

  // Projects by how often they come up.
  const projects = new Map();
  for (const s of sources) for (const [cwd, p] of s.projects) {
    const cur = projects.get(cwd) || { ...p, count: 0, via: new Set() };
    cur.count += p.count; cur.via.add(s.name);
    if (p.last > (cur.last || "")) cur.last = p.last;
    projects.set(cwd, cur);
  }
  const top = [...projects.values()].filter((p) => path.basename(p.cwd) && p.cwd !== os.homedir()).sort((a, b) => b.count - a.count).slice(0, 8);
  for (const p of top) {
    const name = path.basename(p.cwd);
    const last = p.last ? p.last.slice(0, 10) : "";
    items.push(mk("work", `项目「${name}」，${p.count} 条消息，最近一次 ${last}`, ["projects"], "S2", [{ source: [...p.via].join(" + "), quote: p.cwd.replace(os.homedir(), "~") }], "said", `Project "${name}": ${p.count} messages, last on ${last}`));
  }

  // Languages and tools from the files the agents edited and the commands they ran.
  const langCount = {};
  for (const f of sources.flatMap((s) => s.filesTouched)) {
    const e = String(f).split(".").pop().toLowerCase();
    if (EXT[e]) langCount[EXT[e]] = (langCount[EXT[e]] || 0) + 1;
  }
  const langs = Object.entries(langCount).sort((a, b) => b[1] - a[1]).filter(([, c]) => c >= 3).slice(0, 5);
  if (langs.length) items.push(mk("work", "常写：" + langs.map(([l, c]) => `${l}（${c} 个文件）`).join("、"), ["tech_stack"], "S1", [{ source: "count", quote: "agent 改过的文件后缀" }], "said", "Writes mostly: " + langs.map(([l, c]) => `${l} (${c} files)`).join(", ")));
  const cmds = sources.flatMap((s) => s.commands).join("\n");
  const tools = TOOLS.filter(([, re]) => (cmds.match(new RegExp(re.source, "g")) || []).length >= 3).map(([t]) => t);
  if (tools.length) items.push(mk("work", "常用工具：" + tools.join("、"), ["tools"], "S1", [{ source: "count", quote: "agent 跑过的命令" }], "said", "Tools: " + tools.join(", ")));

  return items;
}
