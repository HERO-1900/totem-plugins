// What totem says to an agent, as pure code: the tool list, search, and the words of each answer.
// The same file answers on the person's computer (`totem mcp`, `totem link`) and, when the person
// turns on the cloud copy (C), inside the relay. No I/O here: callers pass the items in and keep
// what comes back (a receipt, a remembered item).
import { TAGS, LEVEL_RANK, defaultLevel } from "./core/vocab.js";
import { findApp, adHocApp, viewFor, templatePrompt } from "./core/select.js";

export const CJK = /[㐀-鿿]/;
export const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const INSTRUCTIONS = `totem is the user's own context center: short items about who they are, what they like, their plans, people and rules, kept on their computer.
Use it when the user writes "@totem", "ask totem", "check my totem", 「问问 totem」, 「查一下 totem」, or when they seem to have forgotten something about themselves (a name, a date, a plan, a place, a preference) and it may be in their totem.
- Forgot something / a question about themselves: call totem_search with their words.
- Starting a task for them (booking, shopping, writing, coding): call totem_context with the app or task, before asking them about themselves.
- They tell you something to keep ("remember that...", 「记一下」): call totem_remember.
Items marked (inferred) are guesses; say so. Private items are never returned here; if some match, tell the user they can share them from the totem page.`;

export const TOOLS = [
  {
    name: "totem_context",
    description: "Get the part of the user's personal context that fits one task or app: who they are, preferences, plans and rules that matter for it, plus what is still missing. Call this before asking the user about themselves. Inferred items are marked; treat them as guesses.",
    inputSchema: { type: "object", properties: { for: { type: "string", description: "The app or the task, e.g. 'airbnb', 'book dinner for two', 'refactor this repo'" }, lang: { type: "string", enum: ["zh", "en"] } }, required: ["for"] },
    annotations: { title: "Context for a task", readOnlyHint: true },
  },
  {
    name: "totem_search",
    description: "Look something up in the user's totem when they ask about themselves or have forgotten something they said before, e.g. '@totem what was the hotel area I wanted in Tokyo', 「我家猫叫什么来着」. Works with Chinese or English words. Returns matching everyday and public items (S1, S2) with when and where the user said them.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "The user's question or a few words from it" }, lang: { type: "string", enum: ["zh", "en"] } }, required: ["query"] },
    annotations: { title: "Search my totem", readOnlyHint: true },
  },
  {
    name: "totem_remember",
    description: "Save one short fact the user just told you to keep in their totem, e.g. 'remember my passport expires in 2031'. Only call this when the user asks you to remember something. Write it as one sentence about the user.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "One sentence, in the user's language" },
        tags: { type: "array", items: { type: "string", enum: Object.keys(TAGS) }, description: "1-3 tags that fit" },
      },
      required: ["text"],
    },
    annotations: { title: "Remember this", readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "totem_apps",
    description: "List the app profiles totem knows (what each app needs and for how long).",
    inputSchema: { type: "object", properties: {} },
    annotations: { title: "List apps", readOnlyHint: true },
  },
];

export const PROMPTS = [
  {
    name: "ask",
    description: "Ask totem about yourself, e.g. something you forgot",
    arguments: [{ name: "question", description: "What you want to find", required: true }],
  },
];

export const NOT_SET_UP = {
  en: "The user has not set up totem on this computer yet. They can run `npx -y @ipolab/totem` in a terminal; it takes about a minute.",
  zh: "这台电脑上还没有 totem。在终端里运行 `npx -y @ipolab/totem`，一分钟左右就好。",
};

// What a client may read: S1 and S2, or up to S3 when the person allowed it. S4 never leaves here.
export const topLevel = (max) => ["S1", "S2", "S3"][Math.min(LEVEL_RANK[max] || 2, 3) - 1];
export const openUpTo = (max) => {
  const top = LEVEL_RANK[topLevel(max)];
  return (i) => (LEVEL_RANK[i.level] || 4) <= top;
};
const lower = (a, b) => ((LEVEL_RANK[a] || 2) <= (LEVEL_RANK[b] || 2) ? a : b);

// ---------- search ----------

const STOP_EN = new Set("the a an my me i is was what which who where when how did do does that this to of in on for and or with about again remember forgot totem ask check".split(" "));
// Words a question is made of that say nothing about the answer.
const STOP_ZH = ["什么", "那个", "这个", "上次", "之前", "来着", "一下", "是不是", "有没有", "我的", "我们", "还是", "怎么", "哪个", "哪里", "哪儿", "多少", "时候", "记得", "忘了", "查查", "问问", "帮我", "告诉", "说过", "提过", "totem"];
// Everyday words that point at a tag, so 「我家猫叫什么」 finds the pets item even without the same characters.
const HINT_TAGS = [
  [/猫|狗|宠物|pet|cat|dog/i, ["pets"]],
  [/女朋友|男朋友|老婆|老公|对象|伴侣|partner|girlfriend|boyfriend|wife|husband/i, ["partner"]],
  [/孩子|儿子|女儿|爸|妈|家人|kid|son|daughter|parent|family/i, ["family", "kids"]],
  [/旅行|旅游|出差|去哪|机票|酒店|住|trip|travel|flight|hotel|stay/i, ["upcoming_trip", "travel_style", "lodging_pref"]],
  [/吃|饭|菜|忌口|过敏|eat|food|diet|allerg/i, ["diet", "allergy", "food_taste"]],
  [/工作|公司|职业|跳槽|面试|job|work|career|interview|employer/i, ["occupation", "employer", "career_goal"]],
  [/项目|代码|仓库|部署|project|repo|code|deploy|stack/i, ["projects", "tech_stack", "tools", "coding_style"]],
  [/电脑|手机|设备|mac|laptop|phone|device/i, ["devices"]],
  [/预算|钱|价格|budget|price|money/i, ["budget"]],
  [/住在|城市|哪里人|city|live/i, ["home_city"]],
  [/作息|起床|睡|早上|sleep|wake|morning/i, ["schedule", "sleep"]],
  [/电话|通知|联系|phone|call|notif/i, ["communication", "phone"]],
  [/语言|中文|英文|language|chinese|english/i, ["languages"]],
  [/学|课程|learn|study/i, ["learning"]],
  [/名字|我叫|\bname\b/i, ["name"]],
];

export function queryTerms(q) {
  let s = String(q || "").toLowerCase();
  for (const w of STOP_ZH) s = s.split(w).join(" ");
  const terms = new Set();
  for (const w of s.match(/[a-z0-9][a-z0-9._+-]*/g) || []) if (w.length > 1 && !STOP_EN.has(w)) terms.add(w);
  for (const run of s.match(/[㐀-鿿]+/g) || []) {
    const chars = run.replace(/[我你他她它的了吗呢吧啊是在和跟把被有就都也还]/g, " ").split(/\s+/).filter(Boolean);
    for (const c of chars) {
      if (c.length === 1) terms.add(c);
      for (let i = 0; i + 1 < c.length; i++) terms.add(c.slice(i, i + 2));
    }
  }
  return [...terms];
}

export function search(items, q, { limit = 6, isOpen = openUpTo("S2") } = {}) {
  const terms = queryTerms(q);
  const hintTags = new Set();
  for (const [re, tags] of HINT_TAGS) if (re.test(q)) tags.forEach((t) => hintTags.add(t));
  const scored = [];
  for (const i of items) {
    if (i.hidden) continue;
    const hay = `${i.text || ""} ${i.text_en || ""} ${(i.tags || []).join(" ")}`.toLowerCase();
    let score = 0;
    for (const t of terms) if (hay.includes(t)) score += t.length > 1 ? 2 : 1;
    for (const t of i.tags || []) if (hintTags.has(t)) score += 2;
    if (score > 0) scored.push({ i, score, at: lastSaid(i) });
  }
  scored.sort((a, b) => b.score - a.score || (b.at || "").localeCompare(a.at || ""));
  // Keep the close matches only, so one strong hit is not buried under loose ones.
  const close = (list) => list.filter((s) => s.score >= (list[0]?.score || 0) * 0.6);
  const open = close(scored.filter((s) => isOpen(s.i))).slice(0, limit).map((s) => s.i);
  const closed = close(scored.filter((s) => !isOpen(s.i))).length;
  return { open, closed };
}

function lastSaid(i) {
  return (i.evidence || []).map((e) => e.at).filter(Boolean).sort().pop() || null;
}

const SOURCE_NAMES = { "claude-code": "Claude Code", codex: "Codex", chatgpt: "ChatGPT", "claude-ai": "Claude.ai", paste: "pasted text", you: "you", git: "git" };

function sourceName(s) {
  if (!s || s === "count") return null;
  if (SOURCE_NAMES[s]) return SOURCE_NAMES[s];
  if (s.includes("/")) return s.split("/").slice(-2).join("/"); // a file such as .claude/CLAUDE.md
  return s;
}

export function describe(i, lang) {
  const text = lang === "zh" ? i.text || i.text_en : i.text_en || i.text;
  const e = (i.evidence || [])[0] || {};
  const when = lastSaid(i);
  const bits = [];
  if (i.sure === "inferred") bits.push(lang === "zh" ? "推断" : "inferred");
  if (when) bits.push(when.slice(0, 10));
  const src = sourceName(e.source);
  if (src) bits.push(src);
  let line = `- ${text}${bits.length ? ` (${bits.join(", ")})` : ""}`;
  if (e.quote && !["git", "count"].includes(e.source) && e.quote !== "added by hand" && !e.quote.startsWith("/") && e.quote !== text) line += lang === "zh" ? `\n  原话：「${e.quote}」` : `\n  said: "${e.quote}"`;
  return line;
}

export function kindFor(tags) {
  const t = new Set(tags);
  if (["partner", "family", "kids", "friends", "colleagues", "pets"].some((x) => t.has(x))) return "people";
  if (["upcoming_trip", "career_goal", "learning"].some((x) => t.has(x))) return "now";
  if (["tech_stack", "coding_style", "tools", "projects"].some((x) => t.has(x))) return "work";
  if (["diet", "allergy", "food_taste", "travel_style", "lodging_pref", "brands", "media", "interests"].some((x) => t.has(x))) return "preference";
  return "identity";
}

// One fact an agent asked totem to keep. The id carries the time, so two copies of totem never clash.
export function newItem(args, client, now = new Date()) {
  const text = String(args.text || "").trim().slice(0, 300);
  if (!text) throw new Error("text is empty");
  let tags = (Array.isArray(args.tags) ? args.tags : []).filter((t) => TAGS[t]).slice(0, 3);
  if (!tags.length) tags = ["interests"];
  const rand = Math.floor(Math.random() * 36 ** 3).toString(36).padStart(3, "0");
  return {
    id: "a" + now.getTime().toString(36) + rand,
    kind: kindFor(tags),
    text, text_en: text,
    tags,
    level: defaultLevel(tags),
    sure: "said",
    evidence: [{ source: client, at: now.toISOString(), quote: text }],
    by: "agent",
  };
}

// When an answer comes from the cloud copy instead of the computer, say so and say how fresh it is.
function copyNote(copy, lang, now = Date.now()) {
  const mins = copy?.synced ? Math.max(0, Math.round((now - Date.parse(copy.synced)) / 60000)) : null;
  const ago = mins === null ? "" : mins < 1 ? (lang === "zh" ? "刚刚" : "just now") : mins < 120 ? (lang === "zh" ? `${mins} 分钟前` : `${mins} min ago`) : (lang === "zh" ? `${Math.round(mins / 60)} 小时前` : `${Math.round(mins / 60)} h ago`);
  return lang === "zh"
    ? `（用户的电脑现在没开，这次的答案来自 totem 的云端副本${ago ? `，${ago}同步` : ""}。私密内容只在电脑上，这次查不到。）`
    : `(The user's computer is off, so this answer comes from their totem cloud copy${ago ? `, synced ${ago}` : ""}. Private items stay on the computer and can't be checked now.)`;
}

// One tool call against a list of items.
// ctx: { items: [...] or null when totem isn't set up, catalog, client, max: "S2" | "S3", copy?: { synced } }
// Returns { text, receipt?, item? }: the caller stores the receipt and the new item.
export function runTool(name, args = {}, ctx) {
  const { items, catalog, client = "agent", copy = null } = ctx;
  const max = topLevel(copy ? "S2" : ctx.max || "S2");
  const isOpen = openUpTo(max);
  const lang0 = args.lang === "zh" || args.lang === "en" ? args.lang : null;

  if (name === "totem_apps") return { text: (catalog?.apps || []).map((a) => `${a.id}: ${a.name_en || a.name} (${a.task_en}; up to ${a.max}; ${a.dur_en})`).join("\n") };

  if (name === "totem_remember") {
    const item = newItem(args, client);
    const zh = lang0 === "zh" || CJK.test(item.text);
    // The cloud copy holds public and everyday items only, so a private fact waits for the computer.
    if (copy && !isOpen(item)) return { text: zh
      ? `用户的电脑现在没开，这条属于${item.level === "S4" ? "证件级" : "私密级"}（${item.level}），云端副本不收。请告诉用户：电脑开机后再说一次就能记下。`
      : `The user's computer is off, and this is a ${item.level === "S4" ? "document-level" : "private"} item (${item.level}), which the cloud copy does not keep. Tell the user to ask again when their computer is on.` };
    const text = copy
      ? (zh ? `已记进 totem 的云端副本（${item.level}），用户的电脑开机后会并进去。用户可以在 totem 页面里改或删。` : `Saved to the user's totem cloud copy (${item.level}); it moves to their computer when it is back on. They can edit or delete it on the totem page.`)
      : (zh ? `已记进 totem（${item.level}）。用户可以在 totem 页面里改或删。` : `Saved to totem (${item.level}). The user can edit or delete it on the totem page.`);
    return { text, item, receipt: { app: "MCP remember", items: [item.id], via: copy ? "cloud" : "mcp", client, write: true } };
  }

  const lang = lang0 || (CJK.test(String(args.query || args.for || "")) ? "zh" : "en");
  if (!items) return { text: NOT_SET_UP[lang] };
  const via = copy ? "cloud" : "mcp";

  if (name === "totem_search") {
    const q = String(args.query || "");
    const { open, closed } = search(items, q, { isOpen });
    const out = [];
    if (open.length) out.push((lang === "zh" ? "totem 里找到：" : "Found in totem:"), ...open.map((i) => describe(i, lang)));
    else out.push(lang === "zh" ? "totem 里没有找到相关的内容。" : "Nothing in totem matches.");
    if (closed && !copy) out.push(lang === "zh"
      ? `\n另有 ${closed} 条私密内容可能相关，不会自动给出。用户可以在 totem 页面（http://localhost:7310）里看，或自己说给你。想让这个 app 以后直接看到私密（S3）内容，可以运行 totem allow ${client} S3。`
      : `\n${closed} more private item(s) may match. They are not shared automatically; the user can look on the totem page (http://localhost:7310) or tell you. To let this app see private (S3) items from now on, they can run: totem allow ${client} S3`);
    if (copy) out.push("\n" + copyNote(copy, lang));
    return { text: out.join("\n"), receipt: { app: "MCP search: " + q.slice(0, 60), items: open.map((i) => i.id), via, client } };
  }

  if (name === "totem_context") {
    const q = String(args.for || "");
    const found = findApp(catalog, q) || adHocApp(q);
    // An app profile may allow more than this client is allowed; the lower of the two wins.
    const app = { ...found, max: lower(found.max || "S2", max) };
    const v = viewFor(app, items);
    const lines = [templatePrompt(v, lang)];
    if (v.ask.length && !copy) lines.push(lang === "zh"
      ? `\n（还有 ${v.ask.length} 条私密内容与此相关，用户愿意的话可以在 totem 页面里给你。）`
      : `\n(${v.ask.length} more private item(s) exist for this; the user can share them from the totem page if they want.)`);
    if (copy) lines.push("\n" + copyNote(copy, lang));
    return { text: lines.join("\n"), receipt: { app: "MCP: " + (app.id === "task" ? q.slice(0, 60) : app.name), items: v.give.map((i) => i.id), via, client } };
  }
  throw new Error("Unknown tool " + name);
}

export function meText(items, max = "S2", copy = null) {
  if (!items) return NOT_SET_UP.en;
  const isOpen = openUpTo(copy ? "S2" : max);
  const open = items.filter((i) => !i.hidden && isOpen(i));
  const closed = items.filter((i) => !i.hidden && !isOpen(i)).length;
  const lines = [`# My totem (public and everyday items)`, "", ...open.map((i) => describe(i, CJK.test(i.text) ? "zh" : "en")), ""];
  lines.push(copy ? copyNote(copy, "en") : `${closed} private item(s) not shown.`);
  return lines.join("\n");
}

export function normClient(n) {
  const s = String(n || "agent").toLowerCase();
  if (s.includes("claude-code") || s === "claude code") return "claude-code";
  if (s.includes("claude")) return "claude-desktop";
  if (s.includes("codex")) return "codex";
  if (s.includes("cursor")) return "cursor";
  return s.replace(/[^a-z0-9._-]+/g, "-").slice(0, 40) || "agent";
}

// The JSON-RPC side of MCP, with the storage left to the caller.
// io: { version, instructions?, catalog, items() -> items | null, maxFor(client) -> "S2" | "S3", save(item), receipt(r), copy? }
export function rpc(m, state, io) {
  if (m.method === "initialize") {
    state.client = normClient(m.params?.clientInfo?.name);
    const want = m.params?.protocolVersion;
    return {
      protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[1],
      capabilities: { tools: {}, prompts: {}, resources: {} },
      serverInfo: { name: "totem", title: "totem", version: io.version || "0.0.0" },
      instructions: io.instructions || INSTRUCTIONS,
    };
  }
  if (m.method === "ping") return {};
  if (m.method === "tools/list") return { tools: TOOLS };
  if (m.method === "tools/call") {
    try {
      const out = runTool(m.params?.name, m.params?.arguments || {}, { items: io.items(), catalog: io.catalog, client: state.client, max: io.maxFor(state.client), copy: io.copy });
      if (out.item) io.save(out.item);
      if (out.receipt) io.receipt(out.receipt);
      return { content: [{ type: "text", text: out.text }] };
    } catch (e) {
      return { content: [{ type: "text", text: "totem error: " + e.message }], isError: true };
    }
  }
  if (m.method === "prompts/list") return { prompts: PROMPTS };
  if (m.method === "prompts/get") return promptGet(m.params);
  if (m.method === "resources/list") return { resources: [{ uri: "totem://me", name: "me", title: "My totem", description: "Public and everyday items about me", mimeType: "text/markdown" }] };
  if (m.method === "resources/templates/list") return { resourceTemplates: [] };
  if (m.method === "resources/read") {
    if (m.params?.uri !== "totem://me") throw Object.assign(new Error("Unknown resource"), { code: -32002 });
    io.receipt({ app: "MCP resource me", items: [], via: io.copy ? "cloud" : "mcp", client: state.client });
    return { contents: [{ uri: "totem://me", mimeType: "text/markdown", text: meText(io.items(), io.maxFor(state.client), io.copy) }] };
  }
  throw Object.assign(new Error("Method not found"), { code: -32601 });
}

export function promptGet(params) {
  const question = String(params?.arguments?.question || "").trim();
  return {
    description: "Ask totem",
    messages: [{ role: "user", content: { type: "text", text: `@totem ${question}\n\nLook this up in my totem first (totem_search; totem_context if it is a task), then answer from what it returns. Say which parts are inferred.` } }],
  };
}
