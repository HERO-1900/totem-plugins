#!/usr/bin/env node
import fs from "node:fs";
import { scan } from "../src/scan.js";
import { loadProfile, saveProfile } from "../src/store.js";
import { CATALOG, findApp, adHocApp, viewFor, firstPrompt } from "../src/view.js";
import { pickProvider } from "../src/llm.js";
import { TOTEM_DIR } from "../src/paths.js";
import { defaultLevel, TAGS } from "../src/vocab.js";

const argv = process.argv.slice(2);
const flags = {}, rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=");
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--") && ["model", "import", "port", "tag", "level", "lang", "only", "levels"].includes(k)) flags[k] = argv[++i];
    else flags[k] = true;
  } else rest.push(a);
}
const cmd = rest.shift() || "start";
const lang = flags.lang || (/^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale) ? "zh" : "en");

const HELP = `totem: your own context center. Everything stays in ${TOTEM_DIR}.

  totem                 open totem at http://localhost:7310 (the first scan runs there)
  totem scan            read Claude Code / Codex history again
      --model <name>    claude-code | codex | gemini | anthropic | openai | ollama | none
      --import <file>   add a ChatGPT or Claude.ai export (.zip or conversations.json)
      --yes             do not ask before sending messages to the model
  totem open            open the switcher without scanning
  totem show <app>      print what an app gets, e.g. totem show airbnb
  totem apps            list the apps
  totem add "<text>" --tag passport --level S4   add something yourself
  totem mcp             run as an MCP server for Claude Code, Codex, Cursor
  totem allow <app> S3  let one agent app read private items too (S2 by default; S4 never)
  totem link            let claude.ai, ChatGPT and other cloud AIs ask this computer's totem
                        (runs in the background from then on; shows a pairing code)
      --foreground      run in this window instead
      --off             unlink this computer and stop the background link
  totem cloud on        keep a sealed copy of public and everyday items (S1, S2) on the relay,
                        so linked AIs can ask while this computer is off
      --levels S1       only public items     --yes   don't ask first
  totem cloud off       delete that copy
  totem modes           how linked AIs reach your totem right now
  totem connect         add totem to the agent apps on this computer
      --remove          take it out again
      --only <ids>      claude-code,claude-desktop,codex,cursor,windsurf,vscode,antigravity,gemini-cli
  totem forget          delete everything totem saved
`;

async function main() {
  if (cmd === "help" || flags.help) return console.log(HELP);
  if (cmd === "scan") return void (await scan({ model: flags.model, imports: flags.import ? [flags.import] : [], yes: !!flags.yes }));
  if (cmd === "mcp") return (await import("../src/mcp.js")).serveMcp({ model: flags.model });
  if (cmd === "allow") {
    const { loadGrants, saveGrants } = await import("../src/mcp.js");
    const g = loadGrants();
    const [client, level] = rest;
    if (!client) { console.log(Object.keys(g).length ? Object.entries(g).map(([c, l]) => `  ${c.padEnd(16)} up to ${l}`).join("\n") : "Every agent app sees S1 and S2 only."); return; }
    if (!["S1", "S2", "S3"].includes(level)) return console.log("totem allow claude-code S3   (S1, S2 or S3; S4 documents are never shared this way)");
    if (level === "S2") delete g[client]; else g[client] = level;
    saveGrants(g);
    return console.log(`${client} can now read up to ${level}.`);
  }
  if (cmd === "link") return linkCommand();
  if (cmd === "cloud") return cloudCommand(rest[0]);
  if (cmd === "modes") return modesCommand();
  if (cmd === "connect") {
    const { connect } = await import("../src/connect.js");
    const done = connect({ remove: !!flags.remove, only: typeof flags.only === "string" ? flags.only : null });
    if (!done.length) return console.log("No agent apps found (Claude Code, Claude Desktop, Codex, Cursor, Windsurf, VS Code, Antigravity, Gemini CLI).");
    for (const [name, status] of done) console.log(`  ${name.padEnd(16)} ${status}`);
    if (!flags.remove) console.log(lang === "zh" ? "\n在这些 app 里说「@totem ……」或直接问关于你自己的事就行。" : "\nIn any of them, say \"@totem ...\" or just ask about yourself.");
    return;
  }
  if (cmd === "apps") { for (const a of CATALOG.apps) console.log(`${a.id.padEnd(14)} ${a.name.padEnd(20)} ${lang === "zh" ? a.task_zh : a.task_en}`); return; }
  if (cmd === "forget") {
    // Unlinking first also deletes anything kept on the relay (the cloud copy, waiting notes).
    (await import("../src/service.js")).removeService();
    await (await import("../src/link.js")).unlink();
    fs.rmSync(TOTEM_DIR, { recursive: true, force: true });
    return console.log("Deleted " + TOTEM_DIR);
  }
  if (cmd === "add") {
    const text = rest.join(" ").trim();
    if (!text) return console.log('totem add "My passport expires in 2031" --tag passport --level S4');
    const tags = String(flags.tag || "interests").split(",").filter((t) => TAGS[t]);
    const p = loadProfile() || { version: 1, items: [], sources: [] };
    p.items.unshift({ id: "u" + Date.now().toString(36), kind: "identity", text, text_en: text, tags, level: flags.level || defaultLevel(tags), sure: "said", evidence: [{ source: "you", at: new Date().toISOString(), quote: "added by hand" }], by: "user" });
    saveProfile(p);
    return console.log("Added.");
  }
  if (cmd === "show") {
    const p = loadProfile();
    if (!p) return console.log("Run `totem scan` first.");
    const q = rest.join(" ");
    const app = findApp(q) || adHocApp(q);
    const v = viewFor(app, p.items);
    console.log(`\n${app.name} · ${lang === "zh" ? app.task_zh : app.task_en} · ${lang === "zh" ? app.dur_zh : app.dur_en}\n`);
    for (const i of v.give) console.log(`  ${i.level}  ${i.sure === "inferred" ? "~" : " "} ${lang === "zh" ? i.text : i.text_en}`);
    if (v.ask.length) { console.log(lang === "zh" ? "\n  要你同意才给：" : "\n  Only if you allow:"); for (const i of v.ask) console.log(`  ${i.level}    ${lang === "zh" ? i.text : i.text_en}`); }
    if (v.gaps.length) console.log((lang === "zh" ? "\n  还缺：" : "\n  Missing: ") + v.gaps.map((g) => (lang === "zh" ? g.zh : g.en)).join(lang === "zh" ? "、" : ", "));
    const fp = await firstPrompt(pickProvider(flags.model || p.model), v, lang);
    console.log((lang === "zh" ? "\n  第一句：\n  " : "\n  First message:\n  ") + fp.text.replace(/\n/g, "\n  ") + "\n");
    return;
  }
  if (cmd === "start" || cmd === "open") {
    // The first scan happens on the page, where the person sees what is read and says yes there.
    return (await import("../src/server.js")).serve({ port: +(flags.port || 7310), model: flags.model, open: !flags["no-open"] });
  }
  console.log(HELP);
}

// ---------- reaching this computer from cloud AIs: totem link, totem cloud, totem modes ----------

const zh = lang === "zh";
const say = (z, e) => console.log(zh ? z : e);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ago(iso) {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return zh ? "刚刚" : "just now";
  if (m < 120) return zh ? `${m} 分钟前` : `${m} min ago`;
  return zh ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 60)} h ago`;
}

function logLine(s, a, b) {
  const t = new Date().toISOString().slice(0, 19).replace("T", " ");
  if (s === "answered") console.log(`${t}  ${a}  ${b}`);
  else if (s === "offline" && a !== 1000) console.log(`${t}  ${zh ? "连接断了，正在重连" : "connection lost, reconnecting"} (${a})`);
  else if (s === "online") console.log(`${t}  ${zh ? "已连上" : "online"}`);
  else if (s === "synced") console.log(`${t}  ${zh ? `云端副本已同步，${a} 条` : `cloud copy in step, ${a} items`}`);
  else if (s === "merged") console.log(`${t}  ${zh ? `电脑关着时记下的 ${a} 条已并回来` : `${a} item(s) remembered while this computer was off are back`}`);
  else if (s === "cloud-off") console.log(`${t}  ${zh ? "云端副本已删除" : "cloud copy deleted"}`);
  else if (s === "sync-failed" || s === "error") console.log(`${t}  ${s}: ${a}`);
  else if (s === "replaced") console.log(`${t}  ${zh ? "另一个 totem link 接管了连接" : "another totem link took over"}`);
}

function printCode(code, relay, background) {
  say(`\n  配对码：${code}（10 分钟内有效）\n`, `\n  Pairing code: ${code} (valid for 10 minutes)\n`);
  say(`  在 claude.ai 或 ChatGPT 里添加自定义连接器，地址填 ${relay}/mcp\n  弹出的页面里填上面的配对码。之后说「@totem ……」就行。`,
    `  In claude.ai or ChatGPT, add a custom connector with the URL ${relay}/mcp\n  and type the code above when asked. Then say "@totem ...".`);
  if (background) say("\n  totem link 已在后台运行：这台电脑开着，网页里的 AI 就能问到，不用开着这个窗口。\n  电脑关着也想能问：totem cloud on（只放公开和日常两级）。\n",
    "\n  totem link now runs in the background: while this computer is on, cloud AIs can ask it. You can close this window.\n  To ask while it is off too: totem cloud on (public and everyday items only).\n");
  else say("\n  这个窗口开着，网页里的 AI 才能问到这台电脑。按 Ctrl+C 停止。\n", "\n  Keep this window open so cloud AIs can reach this computer. Ctrl+C stops it.\n");
}

async function waitFor(test, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await test(); if (v) return v; } catch { /* relay busy or offline */ }
    await sleep(700);
  }
  return null;
}

async function linkCommand() {
  const L = await import("../src/link.js");
  const S = await import("../src/service.js");
  if (flags.off) {
    S.removeService();
    const was = await L.unlink();
    return was ? say("已解除连接，后台的 totem link 也停了，云端副本已删除。网页里的 totem 连接器不能再用了。", "Unlinked: the background link is stopped and any cloud copy is deleted. The totem connector in your AI won't work any more.")
      : say("这台电脑没有连接。", "This computer isn't linked.");
  }
  if (flags.run) { // the background service itself
    const r = await L.link({ lang, role: "main", onStatus: logLine });
    return r.done;
  }
  const l = await L.ensureLink();
  let background = !!L.linkRunning();
  if (!background && !flags.foreground) {
    try { background = !!S.installService(); } catch (e) { background = false; }
  }
  if (background) {
    // The code works at once; waiting until the service is online lets the copy's key reach the AI.
    await waitFor(async () => (await L.relayStatus(l)).online, 10000);
    const { code } = await L.requestCode(l);
    return printCode(code, l.relay, true);
  }
  const r = await L.link({ lang, role: "main", wantCode: true, onCode: (code) => printCode(code, l.relay, false), onStatus: logLine });
  return r.done;
}

async function cloudCommand(sub) {
  const C = await import("../src/cloud.js");
  const L = await import("../src/link.js");
  if (sub !== "on" && sub !== "off") {
    const m = C.loadModes();
    return say(`云端副本：${m.cloud.on ? `开（${m.cloud.levels.join("、")}）` : "关"}\n  totem cloud on    电脑关着时，你连上的 AI 也能问公开和日常两级\n  totem cloud off   删除云端副本`,
      `Cloud copy: ${m.cloud.on ? `on (${m.cloud.levels.join(", ")})` : "off"}\n  totem cloud on    let linked AIs ask public and everyday items while this computer is off\n  totem cloud off   delete the cloud copy`);
  }
  const on = sub === "on";
  let levels = C.CLOUD_LEVELS;
  if (on && flags.levels) {
    levels = String(flags.levels).toUpperCase().split(",").map((x) => x.trim());
    if (levels.some((x) => !C.CLOUD_LEVELS.includes(x))) return say("云端副本只能放 S1 和 S2。私密（S3）和证件（S4）只在这台电脑上。", "The cloud copy takes S1 and S2 only. Private (S3) and document (S4) items stay on this computer.");
  }
  if (on) {
    const n = C.lensItems(loadProfile()?.items || [], levels).length;
    if (!flags.yes) {
      if (!process.stdin.isTTY) return say("加上 --yes 才会打开。", "Add --yes to turn it on.");
      say(`\n打开以后，你的${levels.length === 2 ? "公开和日常两级" : "公开级"}（现在 ${n} 条）会加密存一份在 totem 的服务器上，电脑关着时，你连上的 AI 也能问到。\n钥匙在这台电脑上，和你连上的每个 AI 的登录凭证里，所以存着的那份我们打不开；AI 来问的那一刻，服务器会在内存里打开它找答案。\n私密（S3）和证件（S4）不会上传。随时可以 totem cloud off 删掉。\n`,
        `\nThis keeps an encrypted copy of your ${levels.length === 2 ? "public and everyday" : "public"} items (${n} now) on totem's server, so the AIs you linked can still ask while this computer is off.\nThe key stays on this computer and inside each linked AI's sign-in, so the stored copy can't be opened on its own; when a linked AI asks, the server opens it in memory to find the answer.\nPrivate (S3) and document (S4) items never go up. totem cloud off deletes it any time.\n`);
      const rl = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stdout });
      const yes = /^y/i.test((await rl.question(zh ? "确定打开吗？[y/N] " : "Turn it on? [y/N] ")).trim());
      rl.close();
      if (!yes) return say("没有打开。", "Left off.");
    }
  }
  C.setCloud(on, on ? levels : undefined);
  const l = await L.ensureLink();
  let res = null;
  if (L.linkRunning()) {
    // The running link sees modes.json change and does it; wait for the relay to show it.
    res = await waitFor(async () => {
      const st = await L.relayStatus(l);
      return st.cloud.on === on && (!on || st.cloud.synced) ? st.cloud : null;
    }, 30000);
  } else {
    const r = await L.link({ lang, role: "ctl", task: "sync", once: true });
    res = await Promise.race([r.finished, sleep(30000).then(() => { r.stop(); return null; })]);
  }
  if (!res) return say(on ? "已在本机打开，但还没连上中转站；电脑下次连上时会同步。" : "已在本机关闭；云端副本会在电脑下次连上时删除。",
    on ? "Turned on here, but the relay can't be reached; it syncs next time this computer connects." : "Turned off here; the cloud copy is deleted next time this computer connects.");
  if (on) return say(`云端副本已打开：${res.count} 条，只有公开和日常两级。`, `Cloud copy on: ${res.count} items, public and everyday only.`);
  return say("云端副本已删除。", "Cloud copy deleted.");
}

async function modesCommand() {
  const L = await import("../src/link.js");
  const S = await import("../src/service.js");
  const C = await import("../src/cloud.js");
  const l = L.loadLink();
  let st = null;
  if (l) { try { st = await L.relayStatus(l); } catch (e) { st = { error: e.message }; } }
  const m = C.loadModes();
  const a = !l ? (zh ? "没连接（运行 totem link）" : "not linked (run totem link)")
    : st?.error ? (zh ? `连不上中转站：${st.error}` : `can't reach the relay: ${st.error}`)
    : `${st.online ? (zh ? "在线" : "online") : (zh ? "不在线" : "offline")}${S.serviceInstalled() ? (zh ? "，后台常驻" : ", runs in the background") : ""}`;
  const c = !m.cloud.on ? (zh ? "关（totem cloud on 打开）" : "off (totem cloud on)")
    : st && !st.error ? (st.cloud.on ? (zh ? `开，${st.cloud.count} 条，${ago(st.cloud.synced)}同步` : `on, ${st.cloud.count} items, synced ${ago(st.cloud.synced)}`) : (zh ? "开，等电脑连上后同步" : "on, syncs when this computer connects"))
    : (zh ? "开" : "on");
  say(`你连上的 AI 这样找到你的 totem：\n  A  这台电脑      ${a}\n  B  你自己的云    计划中\n  C  totem 云端副本 ${c}\n\n先问电脑；电脑没开，再问云端副本。私密和证件级只在电脑上。`,
    `How the AIs you linked reach your totem:\n  A  this computer      ${a}\n  B  your own cloud     planned\n  C  totem cloud copy   ${c}\n\nThe computer is asked first; the cloud copy only when it is off. Private and document items stay on the computer.`);
  if (st?.waiting && (st.waiting.outbox || st.waiting.receipts)) say(`  有 ${st.waiting.outbox} 条记下的内容在等电脑取回。`, `  ${st.waiting.outbox} remembered item(s) are waiting for this computer.`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
