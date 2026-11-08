// The live runs behind the switcher. Each one reports what it is doing as events, so a page
// can show the real work as it happens: emit(type, data).
//
// Extraction events, in order:
//   plan   {batches, messages, chars, hidden, provider, model}
//   doc    {id, ref, label, source, at, text}        one per message the model reads (already redacted)
//   batch  {batch, state:"start"|"done", items?, ms?}
//   tok    {batch, s}                                every piece of model output, as it arrives
//   item   {item, batch}                             a finished item; item.evidence[0].span = [start,end] in its doc
//   warn   {message}                                 a batch failed; the others go on
// First-message events:
//   first_start {provider, model}, first {s}, first_done {text, ms, by}
import { batches, buildPrompt, objectStream, normalize, locate, SYSTEM } from "./extract.js";
import { firstPromptInput } from "./select.js";

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

export async function liveExtract({ picked, provider, emit = () => {}, maxBatches = 4, concurrency = 2, signal }) {
  const t0 = now();
  const built = batches(picked).slice(0, maxBatches).map((g, gi) => buildPrompt(g, gi));
  const chars = built.reduce((a, b) => a + b.docs.reduce((x, d) => x + d.text.length, 0), 0);
  const hidden = built.reduce((a, b) => a + b.hidden, 0);
  emit("plan", { batches: built.length, messages: built.reduce((a, b) => a + b.docs.length, 0), chars, hidden, provider: provider.name, model: provider.model || provider.name });
  for (const b of built) for (const d of b.docs) emit("doc", d);

  const items = [];
  const errors = [];
  let outChars = 0;
  const run = async (b, gi) => {
    const tb = now();
    let n = 0;
    const parser = objectStream((obj) => {
      const ref = parseInt(String(obj.ref ?? "").replace(/\D/g, ""), 10);
      const it = normalize(obj, b.docs[ref] || null);
      // The model may cite the wrong message number; look for the quote in the whole batch.
      if (!it.evidence[0].span && it.evidence[0].quote) {
        for (const d of b.docs) {
          const span = locate(d.text, it.evidence[0].quote);
          if (span) { it.evidence[0] = { ...it.evidence[0], doc: d.id, span, source: d.source, at: d.at, session: d.session }; if (d.about) it.sure = "inferred"; break; }
        }
      }
      items.push(it); n++;
      emit("item", { item: it, batch: gi });
    });
    emit("batch", { batch: gi, state: "start", docs: b.docs.length });
    await provider.stream({ system: SYSTEM, prompt: b.prompt, signal, onDelta: (s) => { outChars += s.length; emit("tok", { batch: gi, s }); parser.push(s); } });
    parser.end();
    emit("batch", { batch: gi, state: "done", items: n, ms: Math.round(now() - tb) });
  };
  const queue = built.map((b, gi) => () => run(b, gi));
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const f = queue.shift();
      try { await f(); } catch (e) { if (signal?.aborted) throw e; errors.push(e.message); emit("warn", { message: e.message }); }
    }
  }));
  if (!items.length && errors.length) throw new Error(errors[0]);
  return { items, ms: Math.round(now() - t0), outChars, errors, docs: built.flatMap((b) => b.docs) };
}

export async function liveFirst({ view, lang = "zh", provider, emit = () => {}, signal }) {
  const t0 = now();
  const { system, prompt } = firstPromptInput(view, lang);
  emit("first_start", { provider: provider.name, model: provider.model || provider.name });
  const text = (await provider.stream({ system, prompt, fast: true, maxTokens: 700, signal, onDelta: (s) => emit("first", { s }) })).trim();
  const ms = Math.round(now() - t0);
  emit("first_done", { text, ms, by: provider.name });
  return { text, ms, by: provider.name };
}
