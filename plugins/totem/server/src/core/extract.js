// Turning what a person typed into short items, one at a time, while the model is still writing.
// Pure code shared by the CLI and the web trial.
import { redact } from "./redact.js";
import { TAGS, KINDS, defaultLevel } from "./vocab.js";

// Small, stable, synchronous hash (FNV-1a, 52 bits) for item ids. Same answer in Node, browsers and Workers.
export function hash(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return ((h2 & 0xfffff) * 0x100000000 + h1).toString(36).padStart(10, "0").slice(-10);
}

const PERSONAL = /\b(?:I|I'm|I've|my|me|mine|we|our|wife|husband|girlfriend|boyfriend|kid|son|daughter|mom|dad|birthday|trip|travel|visa|passport|allergic|vegetarian|vegan|budget|apartment|rent|move|interview|resume|job|salary|hate|love|prefer|always|never)\b|我|我的|我们|喜欢|讨厌|不要|别|习惯|家|住|老婆|老公|女朋友|男朋友|孩子|儿子|女儿|妈|爸|生日|旅行|旅游|签证|护照|过敏|吃素|预算|租房|搬家|面试|简历|工作|公司|工资|一定|永远|千万/gi;

// Pick what is worth a model's time: notes the person wrote for their agents first,
// then the messages that talk most about themselves, newest first on ties.
export function sample(sources, budget = 90000) {
  const docs = sources.flatMap((s) => s.docs || []).map((d) => ({ ...d, kind: "doc" }));
  const utts = sources.flatMap((s) => s.utterances || []).map((u) => ({ ...u, score: (u.text.match(PERSONAL) || []).length / Math.sqrt(u.text.length / 80 + 1) }));
  utts.sort((a, b) => b.score - a.score || String(b.at).localeCompare(String(a.at)));
  const picked = [];
  let used = 0;
  for (const d of docs) { const t = d.text.slice(0, 4000); if (used + t.length > budget * 0.25) break; picked.push({ ...d, text: t }); used += t.length; }
  const seen = new Set();
  for (const u of utts) {
    const k = u.text.slice(0, 120);
    if (seen.has(k)) continue;
    seen.add(k);
    if (used + u.text.length > budget) continue;
    picked.push(u); used += u.text.length;
  }
  return picked;
}

export const SYSTEM = `You read what one person typed to their AI agents and write down what those messages tell us about the PERSON, so other apps can serve them without asking again.

Rules:
- Only facts about the person: who they are, what they like and refuse, how they work, what they are planning, who matters to them, their rules for agents. Ignore facts about code, bugs and one-off tasks unless they show a lasting habit or skill.
- "said": the person stated it. "inferred": you are concluding it from patterns. Be strict; when in doubt use inferred.
- Never copy passwords, keys, ID, passport, card or account numbers into an item. If such a thing clearly exists, write that it exists ("has a passport", "has a US visa") and nothing more.
- Nothing about secrets, keys or logging rules for them; that is not about the person.
- Write items as plain statements without pronouns ("不接陌生电话", not "他不接陌生电话").
- Do not invent. Fewer, solid items beat many weak ones. Merge duplicates. At most 45 items.
- Write each item as one short plain line, in Chinese (text_zh) and in natural English (text_en). Use the person's own names for things.
- tags: 1–3 from this list only, the FIRST tag being what the item is mainly about (it sets the privacy level): ${Object.keys(TAGS).join(", ")}.
- kind: one of ${Object.keys(KINDS).join(", ")}.
- quote: up to 80 characters of the person's own words that support the item, copied exactly from one message. ref: the [number] of that message.
- A message labelled "About them" or 「旁人」 was written by someone else about the person: items from it are "inferred". 「演绎」 or "Retold" marks the person's own words retold in plain language.

Output format: JSON Lines. One item per line, nothing else: no array, no wrapper object, no code fences, no commentary. Start with the most telling item. Each line:
{"kind":"","text_zh":"","text_en":"","tags":[],"sure":"said|inferred","quote":"","ref":0}`;

export function batches(picked, size = 30000) {
  const out = [];
  let cur = [], len = 0;
  for (const p of picked) {
    if (len + p.text.length > size && cur.length) { out.push(cur); cur = []; len = 0; }
    cur.push(p); len += p.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function labelOf(p) {
  if (p.kind === "doc") return `note ${p.file}`;
  return [p.source, String(p.at || "").slice(0, 10), p.project].filter(Boolean).join(" · ");
}

// The prompt for one batch, and the exact (redacted) text of each message as the model sees it,
// so evidence quotes can be found again and shown in place.
export function buildPrompt(group, g = 0) {
  let hidden = 0;
  const docs = group.map((p, i) => {
    const r = redact(p.text);
    hidden += r.hits;
    return { id: `g${g}-${i}`, ref: i, label: labelOf(p), source: p.kind === "doc" ? p.file : p.source, at: p.at || null, session: p.session || null, text: r.text, ...(p.about ? { about: true } : {}) };
  });
  const prompt = docs.map((d) => `[${d.ref}] (${d.label})\n${d.text}`).join("\n\n");
  return { prompt, docs, hidden };
}

// Pull complete JSON objects out of a stream of text, as soon as each one closes.
// Works for JSON Lines, a bare array, or {"items":[...]}, with or without code fences.
export function objectStream(onObject) {
  let buf = "";
  let pos = 0;           // next char to scan
  let depth = 0;
  let inStr = false, esc = false;
  const starts = [];     // start index of each open object
  function scan() {
    for (; pos < buf.length; pos++) {
      const c = buf[pos];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (depth === 0) {
        // Outside any object only an opening brace matters (fences and chatter are skipped).
        if (c === "{") { starts.push(pos); depth++; }
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === "{") { starts.push(pos); depth++; continue; }
      if (c === "}" && depth > 0) {
        const start = starts.pop();
        depth--;
        const raw = buf.slice(start, pos + 1);
        let obj = null;
        try { obj = JSON.parse(raw); } catch {}
        if (obj && typeof obj === "object" && !Array.isArray(obj.items) && (obj.text_zh || obj.text_en || obj.text)) onObject(obj);
        if (depth === 0) { buf = buf.slice(pos + 1); pos = -1; }
      }
    }
  }
  return {
    push(s) { buf += s; scan(); },
    end() { scan(); buf = ""; pos = 0; depth = 0; starts.length = 0; },
  };
}

// Reasoning models may think out loud inside <think>…</think>. Keep only the answer.
export function thinkFilter(onText) {
  let inThink = false, carry = "";
  return (s) => {
    let t = carry + s;
    carry = "";
    let out = "";
    while (t) {
      if (inThink) {
        const e = t.indexOf("</think>");
        if (e < 0) { carry = t.slice(-8); t = ""; break; }
        t = t.slice(e + 8); inThink = false;
      } else {
        const b = t.indexOf("<think>");
        if (b < 0) {
          // Hold back a possible partial "<think" at the end.
          const k = t.lastIndexOf("<");
          if (k >= 0 && t.length - k < 7 && "<think>".startsWith(t.slice(k))) { out += t.slice(0, k); carry = t.slice(k); }
          else out += t;
          t = "";
          break;
        }
        out += t.slice(0, b); t = t.slice(b + 7); inThink = true;
      }
    }
    if (out) onText(out);
  };
}

// Where a quote sits in a message: exact, then ignoring case and spacing, then its longest piece.
export function locate(text, quote) {
  const q = String(quote || "").trim().replace(/^[「"“'…\.]+|[」"”'…\.]+$/g, "");
  if (!q || !text) return null;
  let i = text.indexOf(q);
  if (i >= 0) return [i, i + q.length];
  i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i >= 0) return [i, i + q.length];
  // Collapse whitespace on both sides, keeping a map back to the original offsets.
  const map = [];
  let flat = "";
  for (let k = 0; k < text.length; k++) {
    if (/\s/.test(text[k])) { if (flat && flat[flat.length - 1] !== " ") { flat += " "; map.push(k); } continue; }
    flat += text[k].toLowerCase(); map.push(k);
  }
  const fq = q.toLowerCase().replace(/\s+/g, " ");
  i = flat.indexOf(fq);
  if (i >= 0) return [map[i], map[i + fq.length - 1] + 1];
  const pieces = q.split(/[，。,.;；!！?？、…\n]+/).map((p) => p.trim()).filter((p) => p.length >= 4).sort((a, b) => b.length - a.length);
  for (const p of pieces) {
    const j = text.toLowerCase().indexOf(p.toLowerCase());
    if (j >= 0) return [j, j + p.length];
  }
  return null;
}

export function normalize(it, doc) {
  const tags = (Array.isArray(it.tags) ? it.tags : [it.tags]).filter((t) => TAGS[t]).slice(0, 3);
  const kind = KINDS[it.kind] ? it.kind : "preference";
  const text = String(it.text_zh || it.text || it.text_en || "").trim().slice(0, 300);
  const quote = redact(String(it.quote || "")).text.slice(0, 120);
  const span = doc ? locate(doc.text, quote) : null;
  const ftags = tags.length ? tags : ["interests"];
  return {
    id: "m" + hash(text + ftags.join()),
    kind, text, text_en: String(it.text_en || text).trim().slice(0, 300), tags: ftags,
    // Something another person wrote about them is never their own word.
    level: defaultLevel(ftags), sure: it.sure === "said" && !doc?.about ? "said" : "inferred",
    evidence: [{ source: doc?.source || null, at: doc?.at || null, session: doc?.session || null, quote, doc: doc?.id || null, span }],
    by: "model",
  };
}

// Merge rule items and model items; same main tag and near-same words become one item with more evidence.
export function mergeKey(i) {
  return i.tags[0] + "|" + String(i.text).replace(/[\s，。,.、:：;；!！?？「」"']/g, "").toLowerCase().slice(0, 40);
}
export function merge(items) {
  return mergeWithMap(items).items;
}
// Same, and also which id each merged-away item went into (a page animates them joining).
export function mergeWithMap(items) {
  const out = new Map();
  const into = {};
  for (const i of items) {
    const k = mergeKey(i);
    const cur = out.get(k);
    if (cur) { cur.evidence.push(...(i.evidence || [])); if (i.sure === "said") cur.sure = "said"; if (i.id !== cur.id) into[i.id] = cur.id; }
    else out.set(k, { ...i, evidence: [...(i.evidence || [])] });
  }
  return { items: [...out.values()], into };
}

// Split pasted text into message-sized pieces, so the reader and the evidence work the same way.
export function splitPaste(text, { source = "paste", max = 1600 } = {}) {
  const parts = String(text || "").replace(/\r/g, "").split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    for (let k = 0; k < p.length; k += max) out.push({ text: p.slice(k, k + max), source, at: null });
  }
  return out;
}
