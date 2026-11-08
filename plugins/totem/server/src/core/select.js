// What one app gets from a person's totem, decided by plain rules.
// Pure code: the same file runs in Node (CLI, MCP), in the browser (the switcher computes
// every switch on the spot) and in the web trial's Worker. No I/O here.
import { LEVEL_RANK, TAGS } from "./vocab.js";

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

// Tags that fit almost any app. An item that only matches through one of these is weak.
export const GENERIC = new Set(["name", "languages", "communication", "tone", "timezone", "schedule", "writing_style"]);

// What an item is about: its first tag. Later tags are detail: a Disneyland trip that mentions
// the kids and the budget is still a trip, so a grocery app that wants kids and budget does not
// get it, and "Works from home on Fridays" (schedule, employer) is no employer fact.
// A line that opens with the person's name ("Maya Chen, a product designer in Seattle") is an
// identity line, and everything in it counts.
export const primaryTags = (tags = []) => (tags[0] === "name" ? tags : tags.slice(0, 1));
// Does this app want what the item is about? An identity line needs the name wanted, or two of its
// facts: a food app that only wants the city doesn't get the person's job along with it.
const about = (tags, want) => (tags[0] === "name" ? want.has("name") || tags.filter((t) => want.has(t)).length >= 2 : want.has(tags[0]));

const CJK = /[\u3400-\u9fff]/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Latin words match from the start of a word ("cat" is not in "application"); Chinese matches anywhere.
const startsWord = (text, w) => (CJK.test(w) ? text.includes(w) : new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}`, "u").test(text));
const hasWord = (text, w) => (CJK.test(w) ? text.includes(w) : new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}($|[^\\p{L}\\p{N}])`, "u").test(text));

export function findApp(catalog, q) {
  const apps = catalog?.apps || [];
  const s = String(q || "").toLowerCase().trim();
  if (!s) return null;
  const names = (a) => [a.name, a.name_en, a.name_zh].filter(Boolean).map((n) => n.toLowerCase());
  const tasks = (a) => [a.task_zh, a.task_en].filter(Boolean).map((n) => n.toLowerCase());
  return apps.find((a) => a.id === s || names(a).includes(s)) ||
    apps.find((a) => a.id.startsWith(s) || names(a).some((n) => startsWord(n, s))) ||
    apps.find((a) => names(a).some((n) => n.length > 1 && hasWord(s, n))) ||
    apps.find((a) => tasks(a).some((t) => startsWord(t, s)));
}

// A loose profile for a task that is not in the catalog, built from keywords.
// English words match from a word start, so "eat" does not fire on "create" or "rent" on "parent".
export const HINTS = [
  [/\b(trips?|travel|flights?|hotels?|vacation|holiday)|旅行|旅游|机票|酒店|住宿|出差/i, ["upcoming_trip", "travel_style", "lodging_pref", "budget", "partner"]],
  [/\b(train|rail|bus|metro|subway|taxi|ride|commute)|火车|高铁|地铁|打车|通勤/i, ["transport", "upcoming_trip", "schedule", "budget", "home_city"]],
  [/\b(food|eat|dinner|lunch|breakfast|restaurant|grocer|cook|recipe|meal)|吃|饭|餐|菜|外卖/i, ["diet", "allergy", "food_taste", "budget"]],
  [/\b(code|coding|bug|repo|deploy|program)|代码|部署|仓库|编程/i, ["tech_stack", "coding_style", "tools", "projects", "communication"]],
  [/\b(job|resume|cv|interview|career|hiring)|工作|简历|面试|求职|招聘/i, ["occupation", "employer", "tech_stack", "projects", "career_goal", "education", "work_history", "skills"]],
  [/\b(gift|present|birthday)|礼物|生日/i, ["partner", "family", "friends", "interests", "budget"]],
  [/\b(girlfriend|boyfriend|wife|husband|partner|kids?|children|family|mom|dad|parents?)\b|女朋友|男朋友|老婆|老公|孩子|家人|父母|妈妈|爸爸/i, ["partner", "family", "kids"]],
  [/\b(write|writing|email|post|letter|essay)|写|邮件|文章|信/i, ["writing_style", "tone", "languages", "occupation"]],
  [/\b(health|doctor|run|running|gym|workout|sleep)|医生|健康|跑步|健身|睡/i, ["fitness", "sleep", "schedule", "health"]],
  [/\b(visa|passport)|签证|护照/i, ["nationality", "upcoming_trip", "travel_history", "occupation", "employer"]],
  [/\b(book|books|read|reading|novel|library)|书|读|小说/i, ["interests", "media", "learning", "languages", "values"]],
  [/\b(roommate|flatmate|flat|rent|apartment|lease|landlord)|合租|租房|室友|公寓|房东/i, ["housing", "home_city", "schedule", "sleep", "pets", "budget", "values", "interests"]],
  [/\b(habit|habits|tracker|routine|daily|schedule|planner)|打卡|习惯|作息|日程|计划/i, ["schedule", "sleep", "fitness", "values", "learning"]],
  [/\b(phone|sim|carrier|mobile plan|data plan)|手机卡|套餐|运营商|话费|流量/i, ["devices", "budget", "home_city", "family", "communication"]],
  [/\b(learn|course|class|study|lesson)|学|课程|上课/i, ["learning", "languages", "schedule", "career_goal", "education"]],
  [/\b(date|dating|match)\b|约会|相亲|交友/i, ["interests", "values", "home_city", "food_taste", "media"]],
];

export function adHocApp(task) {
  const wants = new Set(["name", "languages", "communication"]);
  for (const [re, tags] of HINTS) if (re.test(task)) tags.forEach((t) => wants.add(t));
  const t = String(task || "").slice(0, 80);
  return { id: "task", name: t.slice(0, 40), cat: "ai", cat_zh: "其他", cat_en: "Other", task_zh: t, task_en: t, wants: [...wants], needs: [], max: "S2", dur_zh: "只这一次", dur_en: "This time only", optional: [], adhoc: true };
}

// The decision for every item, in the order a UI can play it back:
//   give  goes to the app now
//   ask   only after the person says yes (above the app's level, optional for it, or a document)
//   skip  not about this task (why says which rule)
// why codes: unrelated, side_tag, per_tag_cap, generic_cap, limit, hidden, document, level, optional, match
export function viewFor(app, items, { limit = 10 } = {}) {
  const t0 = now();
  // Wants first, then needs, optional tags and form tags: a need not listed in wants still ranks right after them.
  const rank = [...new Set([...(app.wants || []), ...(app.needs || []).map((n) => n.tag), ...(app.optional || []), ...(app.fields || []).flatMap((f) => f.tags)])];
  const want = new Set(rank);
  const max = LEVEL_RANK[app.max] || 2;
  const trace = new Map();
  const scored = [];
  for (const it of items) {
    if (it.hidden) { trace.set(it.id, { id: it.id, decision: "skip", why: "hidden", score: 0 }); continue; }
    const tags = it.tags || [];
    const hit = tags.filter((t) => want.has(t));
    if (!hit.length) { trace.set(it.id, { id: it.id, decision: "skip", why: "unrelated", score: 0 }); continue; }
    // The app must want what the item is about. Side tags alone (a trip that mentions the kids and the budget) are not enough.
    if (!about(tags, want)) { trace.set(it.id, { id: it.id, decision: "skip", why: "side_tag", score: 0, tags: hit }); continue; }
    const specific = hit.filter((t) => !GENERIC.has(t));
    const pos = Math.min(20, ...hit.map((t) => rank.indexOf(t)));
    const score = specific.length * 3 + hit.length + (it.sure === "said" ? 1 : 0) + (it.by === "user" ? 1 : 0) + ((it.evidence || []).length > 1 ? 0.5 : 0) - pos * 0.1 - (tags.length - hit.length) * 0.5;
    scored.push({ it, score: Math.round(score * 10) / 10, generic: !specific.length, tag: specific[0] || hit[0], hit });
  }
  scored.sort((a, b) => b.score - a.score);
  const give = [], ask = [];
  const perTag = {};
  let generic = 0;
  for (const { it, score, generic: g, tag, hit } of scored) {
    const base = { id: it.id, score, tags: hit };
    if ((perTag[tag] = (perTag[tag] || 0) + 1) > (GENERIC.has(tag) ? 1 : 3)) { trace.set(it.id, { ...base, decision: "skip", why: "per_tag_cap" }); continue; }
    if (g && ++generic > 2) { trace.set(it.id, { ...base, decision: "skip", why: "generic_cap" }); continue; }
    const lvl = LEVEL_RANK[it.level] || 2;
    const optional = (app.optional || []).some((o) => (it.tags || []).includes(o));
    if (lvl <= max && !optional && it.level !== "S4") {
      if (give.length < limit) { give.push(it); trace.set(it.id, { ...base, decision: "give", why: "match" }); }
      else trace.set(it.id, { ...base, decision: "skip", why: "limit" });
    } else if (it.level !== "S4" || app.max === "S4" || it.by === "user") {
      if (ask.length < 5) { ask.push(it); trace.set(it.id, { ...base, decision: "ask", why: it.level === "S4" ? "document" : optional ? "optional" : "level" }); }
      else trace.set(it.id, { ...base, decision: "skip", why: "limit" });
    } else trace.set(it.id, { ...base, decision: "skip", why: "document" });
  }
  // Document-level needs (passport, income...) are only met by something the person added by hand.
  const meets = (tag) => (i) => !i.hidden && (i.tags || []).includes(tag) && (TAGS[tag] !== "S4" || i.by === "user");
  const gaps = (app.needs || []).filter((n) => !items.some(meets(n.tag)));
  const fields = app.fields ? fieldsFor(app, items) : null;
  const ms = Math.round((now() - t0) * 100) / 100;
  // Play order: what was given first, then asks, then the rest.
  const order = { give: 0, ask: 1, skip: 2 };
  const steps = items.map((i) => trace.get(i.id) || { id: i.id, decision: "skip", why: "unrelated", score: 0 })
    .sort((a, b) => order[a.decision] - order[b.decision] || b.score - a.score);
  return { app, give, ask, gaps, fields, trace: steps, considered: items.length, ms };
}

// For forms (visa, rental, job): each field takes the best item for its tags.
//   fill   from the totem, at or under the app's level
//   ask    the totem has it, but it needs a yes (private, or a document the person added)
//   gap    the totem does not have it; the person types it once
// An item fills a field only if the field asks for what the item is about (its primary tags),
// so the partner's job never lands in "Occupation". Fields on the same subject (arrival date,
// length of stay, address for one trip) keep to the same item; other fields prefer a fresh one.
export function fieldsFor(app, items) {
  const max = LEVEL_RANK[app.max] || 2;
  const used = new Map();
  return app.fields.map((f) => {
    const doc = f.tags.some((t) => TAGS[t] === "S4");
    const cands = items.filter((i) => !i.hidden && primaryTags(i.tags || []).some((t) => f.tags.includes(t)) && (!doc || i.by === "user"))
      .map((i) => {
        const tags = i.tags || [];
        const u = used.get(i.id);
        const s = (f.tags.includes(tags[0]) ? 3 : 0) + (i.sure === "said" ? 1 : 0) + (i.by === "user" ? 2 : 0) + (u === undefined ? 0 : u === f.tags[0] ? 1 : -2);
        return { i, s };
      })
      .sort((a, b) => b.s - a.s);
    const best = cands[0]?.i;
    if (!best) return { key: f.key, zh: f.zh, en: f.en, status: "gap", section: f.section || null };
    if (!used.has(best.id)) used.set(best.id, f.tags[0]);
    const lvl = LEVEL_RANK[best.level] || 2;
    return { key: f.key, zh: f.zh, en: f.en, section: f.section || null, item: best.id, status: lvl <= max && best.level !== "S4" ? "fill" : "ask" };
  });
}

export function templatePrompt(view, lang = "zh") {
  const { app, give, gaps } = view;
  const zh = lang === "zh";
  const lines = give.map((i) => (zh ? i.text : i.text_en || i.text) + (i.sure === "inferred" ? (zh ? "（推断）" : " (inferred)") : ""));
  const head = zh ? `这次要做的事：${app.task_zh}。关于我：` : `Task: ${app.task_en}. About me:`;
  const tail = gaps.length ? (zh ? `\n还没提供：${gaps.map((g) => g.zh).join("、")}。需要时问我。` : `\nNot provided yet: ${gaps.map((g) => g.en).join(", ")}. Ask me when you need them.`) : "";
  return head + "\n" + lines.map((l) => "· " + l).join("\n") + tail;
}

export const FP_SYSTEM = `You write the first message a person's context service hands to an app or agent, so it can start helping without a single question.
Write it as the person, first person, plain and warm, 2–5 short sentences. Use only the facts given. Facts marked inferred are soft: phrase them as leanings, never as fact. Name what is missing and say it will be provided when needed. No greetings, no lists, no markdown. Write in the language requested.`;

// The model input for the first message. `give` and `gaps` may come from a browser,
// so only their text fields are used.
export function firstPromptInput({ app, give = [], gaps = [] }, lang = "zh") {
  const zh = lang === "zh";
  const facts = give.slice(0, 12).map((i) => `- ${String((zh ? i.text : i.text_en || i.text) || "").slice(0, 300)}${i.sure === "inferred" ? " [inferred]" : ""}`).join("\n");
  const missing = gaps.slice(0, 8).map((g) => String((zh ? g.zh : g.en) || "").slice(0, 80)).join("; ") || "nothing";
  const prompt = `App: ${String(app.name || "").slice(0, 60)}\nTask: ${String(app.task_en || app.task_zh || "").slice(0, 200)}\nLanguage: ${zh ? "Simplified Chinese" : "English"}\nFacts:\n${facts || "- (none)"}\nMissing: ${missing}`;
  return { system: FP_SYSTEM, prompt };
}
