import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { loadProfile, saveProfile, addReceipt, loadReceipts } from "./store.js";
import { CATALOG, findApp, adHocApp, viewFor, templatePrompt } from "./view.js";
import { pickProvider, listProviders } from "./llm.js";
import { KINDS, LEVELS, TAGS, defaultLevel } from "./vocab.js";
import { liveFirst } from "./core/live.js";
import { liveJudge, directJudge, fakeJudge } from "./core/jev.js";
import { scanLive, loadExcerpts } from "./scan.js";
import { SCAN_HOME, walk } from "./paths.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
// What the page may load: the UI, the pure core modules it runs in the browser, and the catalog data.
// TOTEM_UI_DIR lets a designer serve another copy of the page (ui-a/, ui-b/) against the same API.
const STATIC = { "/": process.env.TOTEM_UI_DIR ? path.resolve(process.env.TOTEM_UI_DIR) : path.join(ROOT, "ui"), "/core/": path.join(here, "core"), "/data/": path.join(ROOT, "data") };
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

function staticFile(pathname) {
  for (const [prefix, dir] of Object.entries(STATIC).sort((a, b) => b[0].length - a[0].length)) {
    if (!pathname.startsWith(prefix)) continue;
    let rel;
    try { rel = decodeURIComponent(pathname.slice(prefix.length)) || "index.html"; } catch { return null; }
    const file = path.resolve(dir, rel);
    if (!file.startsWith(path.resolve(dir) + path.sep)) return null;
    try { if (fs.statSync(file).isFile()) return file; } catch {}
    if (prefix === "/") return null;
  }
  return null;
}

// How much history is on this computer, without reading it all (the page shows it before the scan).
function found() {
  const count = (dir) => walk(path.join(SCAN_HOME, dir), (p) => p.endsWith(".jsonl")).length;
  return { "claude-code": count(".claude/projects"), codex: count(".codex/sessions") };
}

async function readBody(req, limit = 2e6) {
  let body = "";
  for await (const c of req) { body += c; if (body.length > limit) throw new Error("too large"); }
  return body ? JSON.parse(body) : {};
}

function sse(res) {
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
  res.write(": totem\n\n");
  return (type, data) => { if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
}

// Jev double-checks each switch only when the person set their own TypeSafe key. What it reads:
// the app's task and the person's S1/S2 items in English; S3 and S4 never leave.
function localJudge() {
  if (process.env.TOTEM_FAKE_JUDGE) return fakeJudge({ rel: (f) => (/cilantro|Tokyo|quiet/i.test(f) ? 0.93 : 0.1) });
  const key = process.env.TYPESAFE_API_KEY;
  return key ? directJudge({ key, model: process.env.TOTEM_JEV_MODEL || "jev-1.14.0", label: "Jev (your TYPESAFE_API_KEY)" }) : null;
}

export function serve({ port = 7310, model, open = true } = {}) {
  const provider = () => pickProvider(model || loadProfile()?.model || undefined);
  const server = http.createServer(async (req, res) => {
    // Only this computer may talk to it, and only through localhost names (blocks DNS rebinding).
    const host = String(req.headers.host || "");
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) { res.writeHead(403); return res.end(); }
    const url = new URL(req.url, "http://localhost");
    const send = (code, body, type = "application/json") => {
      res.writeHead(code, { "content-type": type + "; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(type === "application/json" ? JSON.stringify(body) : body);
    };
    try {
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        const file = staticFile(url.pathname === "/" ? "/index.html" : url.pathname);
        if (!file) return send(404, { error: "not found" });
        res.writeHead(200, { "content-type": (TYPES[path.extname(file)] || "application/octet-stream") + "; charset=utf-8", "cache-control": "no-store", "content-security-policy": CSP, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
        return fs.createReadStream(file).pipe(res);
      }
      const p = loadProfile() || { items: [], sources: [] };
      if (req.method === "GET" && url.pathname === "/api/config") {
        const pr = provider();
        const j = localJudge();
        return send(200, { mode: "local", version: VERSION, provider: { name: pr.name, label: pr.label, to: pr.to, model: pr.model || null }, providers: listProviders(), judge: j ? { name: j.name, model: j.model, label: j.label, to: j.to } : null, hasProfile: !!loadProfile(), found: found() });
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        return send(200, { profile: { updated: p.updated, model: p.model, sources: p.sources, total: p.total }, items: p.items, kinds: KINDS, levels: LEVELS, tags: Object.keys(TAGS), catalog: CATALOG, receipts: loadReceipts(20), provider: provider().label });
      }
      if (req.method === "GET" && url.pathname === "/api/excerpts") return send(200, loadExcerpts() || { docs: [] });
      if (req.method === "GET" && url.pathname === "/api/view") {
        // For scripts: the same decision the page computes itself.
        const app = url.searchParams.get("app") ? findApp(url.searchParams.get("app")) : adHocApp(url.searchParams.get("task") || "");
        if (!app) return send(404, { error: "no such app" });
        return send(200, viewFor(app, p.items));
      }
      if (req.method !== "POST") return send(404, { error: "not found" });
      if (req.headers["x-totem"] !== "1") { res.writeHead(403); return res.end(); }
      const b = await readBody(req);
      if (url.pathname === "/api/scan") {
        const ac = new AbortController();
        res.on("close", () => { if (!res.writableFinished) ac.abort(); });
        const emit = sse(res);
        try { await scanLive({ model: b.model || model, emit, signal: ac.signal }); }
        catch (e) { emit("error", { message: e.message }); }
        return res.end();
      }
      if (url.pathname === "/api/first") {
        // The page says which app and which items (after the person's own allow/drop);
        // the text comes from this computer's profile, never from the request.
        const app = b.app?.id && b.app.id !== "task" ? findApp(b.app.id) : adHocApp(String(b.app?.task || b.app?.task_zh || ""));
        if (!app) return send(404, { error: "no such app" });
        const ids = new Set((b.ids || []).map(String));
        const give = p.items.filter((i) => ids.has(i.id) && !i.hidden && i.level !== "S4");
        const view = { app, give, gaps: viewFor(app, p.items).gaps };
        const lang = b.lang === "en" ? "en" : "zh";
        const ac = new AbortController();
        res.on("close", () => { if (!res.writableFinished) ac.abort(); });
        const emit = sse(res);
        const pr = provider();
        try {
          if (!pr.stream || !give.length) {
            const text = templatePrompt(view, lang);
            emit("first_start", { provider: "template" });
            emit("first", { s: text });
            emit("first_done", { text, ms: 0, by: "template" });
          } else await liveFirst({ view, lang, provider: pr, emit, signal: ac.signal });
        } catch (e) { emit("error", { message: e.message }); }
        return res.end();
      }
      if (url.pathname === "/api/judge") {
        const j = localJudge();
        if (!j) return send(404, { error: "no judge" });
        const app = b.app?.id && b.app.id !== "task" ? findApp(b.app.id) : adHocApp(String(b.app?.task || b.app?.task_zh || ""));
        if (!app) return send(404, { error: "no such app" });
        const ac = new AbortController();
        res.on("close", () => { if (!res.writableFinished) ac.abort(); });
        const emit = sse(res);
        try { await liveJudge({ app, items: p.items, judges: [j], emit, signal: ac.signal }); }
        catch (e) { emit("judge_error", { message: e.message }); }
        return res.end();
      }
      if (url.pathname === "/api/item") {
        const it = p.items.find((i) => i.id === b.id);
        if (!it) return send(404, { error: "no such item" });
        if ("hidden" in b) it.hidden = !!b.hidden || undefined;
        if (b.level && LEVELS[b.level]) { it.level = b.level; it.levelEdited = true; }
        saveProfile(p);
        return send(200, it);
      }
      if (url.pathname === "/api/add") {
        const tags = (Array.isArray(b.tags) ? b.tags : [b.tag]).filter((t) => TAGS[t]).slice(0, 3);
        const text = String(b.text || "").trim().slice(0, 300);
        if (!text) return send(400, { error: "empty" });
        const it = { id: "u" + Date.now().toString(36), kind: b.kind && KINDS[b.kind] ? b.kind : "identity", text, text_en: String(b.text_en || text).slice(0, 300), tags: tags.length ? tags : ["interests"], level: LEVELS[b.level] ? b.level : defaultLevel(tags), sure: "said", evidence: [{ source: "you", at: new Date().toISOString(), quote: "added by hand" }], by: "user" };
        p.items.unshift(it);
        saveProfile(p);
        return send(200, it);
      }
      if (url.pathname === "/api/receipt") {
        addReceipt({ app: String(b.app || "").slice(0, 80), items: (b.items || []).slice(0, 50).map(String), via: String(b.via || "copy").slice(0, 20), duration: String(b.duration || "").slice(0, 40) });
        return send(200, { ok: true });
      }
      send(404, { error: "not found" });
    } catch (e) { if (!res.headersSent) send(500, { error: e.message }); else res.end(); }
  });
  server.listen(port, "127.0.0.1", () => {
    const u = `http://localhost:${server.address().port}`;
    console.error(`totem is open at ${u}  (Ctrl+C to stop)`);
    if (open) {
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
      const args = process.platform === "win32" ? ["/c", "start", u] : [u];
      execFile(cmd, args, () => {});
    }
  });
  return server;
}
