// Node side of the per-app view: the catalog from disk and a cache for first messages.
// The rules themselves are in core/select.js, which the switcher page also runs.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as core from "./core/select.js";
import { CACHE_DIR, ensureDirs } from "./paths.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CATALOG = JSON.parse(fs.readFileSync(path.join(here, "..", "data", "apps.json"), "utf8"));
export const { adHocApp, viewFor, fieldsFor, templatePrompt, firstPromptInput, GENERIC, FP_SYSTEM } = core;
export const findApp = (q) => core.findApp(CATALOG, q);

const cacheKey = (view, lang) => crypto.createHash("sha1").update(JSON.stringify([view.app.id, view.app.task_en, lang, view.give.map((i) => i.id + i.level + (i.text || "")), view.gaps.map((g) => g.tag)])).digest("hex").slice(0, 16);

export function cachedFirst(view, lang) {
  try { return fs.readFileSync(path.join(CACHE_DIR, `fp-${cacheKey(view, lang)}.txt`), "utf8"); } catch { return null; }
}
export function saveFirst(view, lang, text) {
  ensureDirs();
  fs.writeFileSync(path.join(CACHE_DIR, `fp-${cacheKey(view, lang)}.txt`), text, { mode: 0o600 });
}

export async function firstPrompt(provider, view, lang = "zh") {
  if (!provider?.ask || !view.give.length) return { text: core.templatePrompt(view, lang), by: "template" };
  const hit = cachedFirst(view, lang);
  if (hit) return { text: hit, by: "cache" };
  const { system, prompt } = core.firstPromptInput(view, lang);
  const text = (await provider.ask({ system, prompt, fast: true })).trim();
  saveFirst(view, lang, text);
  return { text, by: provider.name };
}
