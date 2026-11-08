// A second opinion on every switch from a decision model: TypeSafe's Jev, or Cloudflare's Clef,
// which answers the same requests. The rules in select.js decide first and render at once; the
// judge then scores the facts and code applies the scores. It can only make sharing stricter:
// a "give" it finds unrelated is held back, one it finds risky waits for a yes. It never turns an
// ask or a skip into a give (a strong match the rules missed only becomes a suggestion the person
// may take), never sees S3 or S4 items or hidden ones, and never touches form fields.
// Pure code: the caller passes a judge {name, model, label, run(request) -> response}.
//
// Events, in order (emit(type, data)):
//   judge_start {engine, model, label, questions, chunks, facts}
//   judge       {chunk, ms, tokens, scores: {id: {rel, risk?}}}     as each request lands
//   judge_done  {engine, model, changes:[{id, from, to, why, rel, risk}], suggest:[{id, rel}],
//                scores, questions, tokens, ms}
//   judge_error {message}                                            the rules result stands
import { viewFor } from "./select.js";

export const JUDGE_VERSION = "rel-1";
export const CHUNK = 50;          // Clef takes up to 64 questions per request; Jev publishes no cap
export const MAX_FACTS = 150;     // three requests at most per switch
export const THRESHOLDS = { drop: 0.25, risk: 0.5, suggest: 0.85 };

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").replace(/"/g, "'").trim().slice(0, n);
const num = (x) => (typeof x === "number" && isFinite(x) ? Math.max(0, Math.min(1, x)) : null);

// Only everyday and public facts leave for the judge. Private ones wait for a yes anyway.
export const sendable = (items) => (items || []).filter((i) => i && !i.hidden && (i.level === "S1" || i.level === "S2"));

export function judgeState(app) {
  return {
    app: clip(app.name, 60),
    category: clip(app.cat_en, 40),
    task: clip(app.task_en || app.task_zh, 200),
    app_needs: (app.needs || []).map((n) => clip(n.en || n.zh, 80)).filter(Boolean).slice(0, 8),
    rule: "A fact counts only if this app would actually use it to choose, filter or prepare this task.",
  };
}

const RISK = [
  "Expected: the app plainly needs it for this task",
  "Harmless: not needed, but most people would not mind",
  "Ask first: most people would want to be asked before this app sees it",
  "Harmful: could embarrass or expose the person or someone close to them",
];

// The questions for one switch. Each question carries one fact; the state holds only the task,
// which keeps it small (a decision model reads every question against the whole state).
//   relevance (noul)  every sendable fact, given ones first: would this app use it for this task?
//   risk (score)      the rules' give list only: how would the person feel if this app saw it?
// Returns [{state, questions, ids: {questionId: itemId}}], CHUNK questions per request.
export function judgeRequests(app, view, items) {
  const order = new Map((view?.trace || []).map((t, k) => [t.id, k]));
  const facts = sendable(items).sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9)).slice(0, MAX_FACTS);
  const give = new Set((view?.give || []).map((i) => i.id));
  const name = clip(app.name, 60) || "this app";
  const task = clip(app.task_en || app.task_zh, 160).replace(/^./, (c) => c.toLowerCase()) || "do this task";
  const qs = [];
  facts.forEach((it, k) => {
    const fact = clip(it.text_en || it.text, 300);
    qs.push([`r${k}`, it.id, { type: "noul", instructions: `Fact about the person: "${fact}". Would ${name} use this fact to ${task}?`, criteria: { true: "The app would use it for this task", false: "Unrelated to this task, or only a vague hint" } }]);
    if (give.has(it.id)) qs.push([`k${k}`, it.id, { type: "score", instructions: `Fact about the person: "${fact}". If ${name} received this fact for this task, how would the person feel?`, criteria: RISK }]);
  });
  const state = judgeState(app);
  const out = [];
  for (let i = 0; i < qs.length; i += CHUNK) {
    const part = qs.slice(i, i + CHUNK);
    out.push({ state, questions: Object.fromEntries(part.map(([q, , body]) => [q, body])), ids: Object.fromEntries(part.map(([q, id]) => [q, id])) });
  }
  return out;
}

// Risk is read from the per-level probabilities (decision models don't interpolate between levels):
// the chance the person would want to be asked first, or would be hurt.
export function riskOf(answer) {
  const p = answer?.probabilities;
  if (p && typeof p === "object") {
    const v = (num(p[2] ?? p["2"]) || 0) + (num(p[3] ?? p["3"]) || 0);
    return Math.round(v * 1000) / 1000;
  }
  const s = num(answer?.score);
  return s == null ? null : s; // score is 0..1 across the four levels
}

// What the scores change. Only stricter: give -> skip (unrelated) or give -> ask (risky).
export function decide(view, scores, t = THRESHOLDS) {
  const changes = [], suggest = [];
  const give = new Set((view?.give || []).map((i) => i.id));
  for (const step of view?.trace || []) {
    const s = scores[step.id];
    if (!s) continue;
    if (give.has(step.id)) {
      if (s.rel != null && s.rel < t.drop) changes.push({ id: step.id, from: "give", to: "skip", why: "judge_unrelated", rel: s.rel, risk: s.risk ?? null });
      else if (s.risk != null && s.risk >= t.risk) changes.push({ id: step.id, from: "give", to: "ask", why: "judge_risk", rel: s.rel ?? null, risk: s.risk });
    } else if (step.decision === "skip" && step.why !== "hidden" && s.rel != null && s.rel >= t.suggest) {
      suggest.push({ id: step.id, rel: s.rel });
    }
  }
  suggest.sort((a, b) => b.rel - a.rel);
  return { changes, suggest: suggest.slice(0, 5) };
}

// The view after the judge: same shape as viewFor's, with the moves applied and the scores attached.
export function applyJudge(view, result) {
  const moved = new Map((result?.changes || []).map((c) => [c.id, c]));
  const suggested = new Map((result?.suggest || []).map((s) => [s.id, s]));
  const give = view.give.filter((i) => moved.get(i.id)?.to !== "skip" && moved.get(i.id)?.to !== "ask");
  const ask = [...view.ask, ...view.give.filter((i) => moved.get(i.id)?.to === "ask")];
  const trace = view.trace.map((t) => {
    const c = moved.get(t.id), s = result?.scores?.[t.id];
    const judge = s ? { rel: s.rel ?? null, risk: s.risk ?? null } : undefined;
    if (c) return { ...t, decision: c.to, why: c.why, was: t.why, judge };
    if (suggested.has(t.id)) return { ...t, suggest: true, judge };
    return judge ? { ...t, judge } : t;
  });
  const order = { give: 0, ask: 1, skip: 2 };
  trace.sort((a, b) => order[a.decision] - order[b.decision] || (b.score || 0) - (a.score || 0));
  return { ...view, give, ask, trace, judged: { engine: result?.engine || null, model: result?.model || null, ms: result?.ms ?? null, questions: result?.questions ?? 0, tokens: result?.tokens ?? 0, changes: (result?.changes || []).length, suggest: (result?.suggest || []).map((s) => s.id) } };
}

function withTimeout(p, ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("judge timed out")), ms);
    const stop = () => { clearTimeout(t); reject(new Error("stopped")); };
    signal?.addEventListener?.("abort", stop, { once: true });
    p.then((v) => { clearTimeout(t); signal?.removeEventListener?.("abort", stop); resolve(v); },
      (e) => { clearTimeout(t); signal?.removeEventListener?.("abort", stop); reject(e); });
  });
}

// One switch, judged. Requests go out together; each one's answers are emitted as it lands, so the
// page animates real arrival times. Falls back along `judges` if one fails before any answer.
export async function liveJudge({ app, items, view, judges, emit = () => {}, signal, timeoutMs = 6000, thresholds = THRESHOLDS }) {
  const t0 = now();
  view = view || viewFor(app, items);
  const reqs = judgeRequests(app, view, items);
  const questions = reqs.reduce((a, r) => a + Object.keys(r.questions).length, 0);
  const facts = new Set(reqs.flatMap((r) => Object.values(r.ids))).size;
  const list = (Array.isArray(judges) ? judges : [judges]).filter(Boolean);
  if (!list.length) throw new Error("no judge");
  if (!reqs.length) {
    const r = { engine: list[0].name, model: list[0].model, changes: [], suggest: [], scores: {}, questions: 0, tokens: 0, ms: 0 };
    emit("judge_done", r);
    return r;
  }
  let last;
  for (const judge of list) {
    const scores = {};
    let tokens = 0, landed = 0;
    emit("judge_start", { engine: judge.name, model: judge.model, label: judge.label, questions, chunks: reqs.length, facts });
    try {
      await Promise.all(reqs.map(async (req, ci) => {
        const d = await withTimeout(Promise.resolve().then(() => judge.run({ state: req.state, questions: req.questions }, { signal })), timeoutMs, signal);
        const answers = d?.answers || d?.result?.answers;
        if (!answers || typeof answers !== "object") throw new Error("judge gave no answers");
        const used = d?.usage?.input_tokens || d?.result?.usage?.input_tokens || 0;
        tokens += used;
        const part = {};
        for (const [qid, a] of Object.entries(answers)) {
          const id = req.ids[qid];
          if (!id) continue;
          const s = (scores[id] = scores[id] || {});
          if (qid[0] === "r") s.rel = num(a?.noul);
          else if (qid[0] === "k") s.risk = riskOf(a);
          part[id] = s;
        }
        landed++;
        emit("judge", { chunk: ci, ms: Math.round(now() - t0), tokens: used, scores: part });
      }));
      const { changes, suggest } = decide(view, scores, thresholds);
      const r = { engine: judge.name, model: judge.model, changes, suggest, scores, questions, tokens, ms: Math.round(now() - t0) };
      emit("judge_done", r);
      return r;
    } catch (e) {
      if (signal?.aborted) throw e;
      last = e;
      if (landed) break; // half an answer is worse than the rules: stop here
    }
  }
  throw last || new Error("judge failed");
}

// ---- Judges. Each has run({state, questions}) -> {answers, usage}. ----

// Jev or Clef through a Workers AI binding (env.AI). No TypeSafe account needed; billed by Cloudflare.
// Clef takes a `model` selector inside the input ("clef" or "clef-flash").
export function workersAIJudge({ ai, model = "typesafe/jev", label }) {
  const clef = /clef/i.test(model);
  const name = clef ? "clef" : "jev";
  return {
    name, model, label: label || (clef ? "Clef on Cloudflare Workers AI" : "Jev on Cloudflare Workers AI"), to: "Cloudflare",
    run: (req) => ai.run(model, clef ? { model: model.split("/").pop(), ...req } : req),
  };
}

// Jev straight from TypeSafe, with the person's own key (local) or ours as a Worker secret (web).
export function directJudge({ key, model = "jev-1.14.0", endpoint = "https://api.typesafe.ai/v1/systemone", fetchImpl = globalThis.fetch, label, tries = 3 }) {
  return {
    name: "jev", model, label: label || "Jev (TypeSafe)", to: "TypeSafe",
    async run(req, { signal } = {}) {
      for (let attempt = 1; ; attempt++) {
        const r = await fetchImpl(endpoint, { method: "POST", signal, headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: JSON.stringify({ model, state: req.state, questions: req.questions }) });
        if ((r.status === 429 || r.status === 529) && attempt < tries) {
          const wait = Math.min(2000, 1000 * Number(r.headers.get("retry-after") || 0) || 250 * 2 ** attempt);
          await new Promise((res) => setTimeout(res, wait));
          continue;
        }
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(`Jev ${r.status}: ${JSON.stringify(d).slice(0, 200)}`);
        return d;
      }
    },
  };
}

// A deterministic stand-in for tests and offline dev: relevance from word overlap with the task.
export function fakeJudge({ rel, risk, delayMs = 5, name = "fake", fail = false } = {}) {
  return {
    name, model: name, label: "Scripted judge (tests)", to: "nobody",
    async run(req) {
      if (fail) throw new Error("fake judge down");
      await new Promise((r) => setTimeout(r, delayMs));
      const answers = {};
      for (const [qid, q] of Object.entries(req.questions)) {
        const fact = (q.instructions.match(/"([^"]*)"/) || [, ""])[1];
        if (q.type === "noul") answers[qid] = { type: "noul", noul: rel ? rel(fact, req.state) : 0.7 };
        else {
          const v = risk ? risk(fact, req.state) : 0.05;
          answers[qid] = { type: "score", score: v, confidence: 0.8, probabilities: { 0: 1 - v, 1: 0, 2: v, 3: 0 } };
        }
      }
      return { model: name, answers, usage: { input_tokens: Math.round(JSON.stringify(req).length / 4) + 300, output_tokens: 20 } };
    },
  };
}
