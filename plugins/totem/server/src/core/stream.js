// Streaming model calls over fetch, the same in Node 18+, browsers and Cloudflare Workers.
// Every provider has one call: stream({system, prompt, json, fast, maxTokens, signal, onDelta}) -> full text.
import { thinkFilter } from "./extract.js";

// Read a Server-Sent Events body and call onEvent({event, data}) for each event.
export async function readSSE(body, onEvent) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "", event = "message", data = [];
  const flush = () => { if (data.length) onEvent({ event, data: data.join("\n") }); event = "message"; data = []; };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line === "") { flush(); continue; }
      if (line.startsWith(":")) continue;
      const k = line.indexOf(":");
      const field = k < 0 ? line : line.slice(0, k);
      const val = k < 0 ? "" : line.slice(k + 1).replace(/^ /, "");
      if (field === "event") event = val;
      else if (field === "data") data.push(val);
    }
  }
  if (buf.trim()) { const k = buf.indexOf(":"); if (buf.slice(0, k) === "data") data.push(buf.slice(k + 1).trim()); }
  flush();
}

// Newline-delimited JSON bodies (Ollama).
export async function readNDJSON(body, onObject) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) { try { onObject(JSON.parse(line)); } catch {} }
    }
  }
  if (buf.trim()) { try { onObject(JSON.parse(buf)); } catch {} }
}

async function fail(r, who) {
  let msg = r.status + "";
  try { const t = await r.text(); const j = JSON.parse(t); msg = j.error?.message || j.errors?.[0]?.message || j.error || t.slice(0, 300); } catch {}
  throw new Error(`${who}: ${msg}`);
}

// Wrap onDelta so every provider drops <think> blocks and collects the full text.
function collector(onDelta) {
  let full = "";
  const emit = thinkFilter((t) => { full += t; onDelta?.(t); });
  return { push: (s) => s && emit(s), text: () => full };
}

export function anthropicProvider({ key, model, fastModel, baseURL = "https://api.anthropic.com" } = {}) {
  return {
    name: "anthropic", label: "Claude API", to: "Anthropic", model: model || "claude-sonnet-5-5",
    async stream({ system, prompt, fast, maxTokens = 8000, signal, onDelta }) {
      const r = await fetch(baseURL + "/v1/messages", {
        method: "POST", signal,
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: fast ? fastModel || "claude-haiku-5-5" : model || "claude-sonnet-5-5", max_tokens: maxTokens, stream: true, system, messages: [{ role: "user", content: prompt }] }),
      });
      if (!r.ok) await fail(r, "Claude API");
      const c = collector(onDelta);
      await readSSE(r.body, ({ data }) => {
        let j;
        try { j = JSON.parse(data); } catch { return; }
        if (j.type === "content_block_delta" && j.delta?.type === "text_delta") c.push(j.delta.text);
        else if (j.type === "error") throw new Error("Claude API: " + (j.error?.message || "stream error"));
      });
      return c.text();
    },
  };
}

// OpenAI and any OpenAI-compatible endpoint (DeepSeek, Workers AI's /v1, OpenRouter, vLLM…).
export function openaiProvider({ key, model, fastModel, baseURL = "https://api.openai.com/v1", name = "openai", label = "OpenAI API", to = "OpenAI" } = {}) {
  return {
    name, label, to, model: model || "gpt-4.1-mini",
    async stream({ system, prompt, json, fast, maxTokens = 8000, signal, onDelta }) {
      const r = await fetch(baseURL + "/chat/completions", {
        method: "POST", signal,
        headers: { "content-type": "application/json", ...(key ? { authorization: "Bearer " + key } : {}) },
        body: JSON.stringify({ model: fast ? fastModel || model || "gpt-4.1-mini" : model || "gpt-4.1-mini", stream: true, max_tokens: maxTokens,
          messages: [{ role: "system", content: system }, { role: "user", content: prompt }], ...(json ? { response_format: { type: "json_object" } } : {}) }),
      });
      if (!r.ok) await fail(r, label);
      const c = collector(onDelta);
      await readSSE(r.body, ({ data }) => {
        if (data === "[DONE]") return;
        try { const j = JSON.parse(data); c.push(j.choices?.[0]?.delta?.content || ""); } catch {}
      });
      return c.text();
    },
  };
}

export function geminiProvider({ key, model, fastModel } = {}) {
  return {
    name: "gemini", label: "Gemini API", to: "Google", model: model || "gemini-2.5-flash",
    async stream({ system, prompt, json, fast, signal, onDelta }) {
      const m = fast ? fastModel || "gemini-2.5-flash-lite" : model || "gemini-2.5-flash";
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse`, {
        method: "POST", signal, headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, ...(json ? { responseMimeType: "application/json" } : {}) } }),
      });
      if (!r.ok) await fail(r, "Gemini");
      const c = collector(onDelta);
      await readSSE(r.body, ({ data }) => {
        try { const j = JSON.parse(data); for (const p of j.candidates?.[0]?.content?.parts || []) if (!p.thought) c.push(p.text || ""); } catch {}
      });
      return c.text();
    },
  };
}

export function ollamaProvider({ host = "http://127.0.0.1:11434", model } = {}) {
  return {
    name: "ollama", label: "Ollama", to: "nobody, it runs locally", model: model || "qwen2.5:7b",
    async stream({ system, prompt, json, signal, onDelta }) {
      const r = await fetch(host + "/api/chat", {
        method: "POST", signal, headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: model || "qwen2.5:7b", stream: true, ...(json ? { format: "json" } : {}), messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
      });
      if (!r.ok) await fail(r, "Ollama");
      const c = collector(onDelta);
      await readNDJSON(r.body, (j) => c.push(j.message?.content || ""));
      return c.text();
    },
  };
}

// Cloudflare Workers AI through the AI binding (the web trial). Handles both stream shapes:
// {"response":"…"} for most models and OpenAI-style chunks for the newer ones.
export function workersAIProvider({ ai, model, fastModel, label } = {}) {
  return {
    name: "workers-ai", label: label || "Cloudflare Workers AI", to: "Cloudflare", model,
    async stream({ system, prompt, fast, maxTokens = 4096, onDelta }) {
      const m = fast ? fastModel || model : model;
      const out = await ai.run(m, { messages: [{ role: "system", content: system }, { role: "user", content: prompt }], stream: true, max_tokens: maxTokens, temperature: 0.2 });
      const c = collector(onDelta);
      if (out && typeof out.getReader === "function") {
        await readSSE(out, ({ data }) => {
          if (data === "[DONE]") return;
          try {
            const j = JSON.parse(data);
            const d = j.response ?? j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.text ?? "";
            if (typeof d === "string") c.push(d);
          } catch {}
        });
      } else {
        // Some models ignore stream:true and answer at once.
        const t = out?.response ?? out?.choices?.[0]?.message?.content ?? out?.output_text ?? "";
        c.push(typeof t === "string" ? t : JSON.stringify(t));
      }
      return c.text();
    },
  };
}

// A scripted model for tests and offline demos: streams a fixed answer in small pieces.
export function fakeProvider({ reply, first, chunk = 12, delayMs = 8 } = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    name: "fake", label: "Scripted model (test)", to: "nobody", model: "fake",
    async stream({ system, prompt, onDelta }) {
      const text = system?.startsWith("You write the first message") ? first || "我想先说明一下情况。" : typeof reply === "function" ? reply({ system, prompt }) : reply || "";
      for (let i = 0; i < text.length; i += chunk) { onDelta?.(text.slice(i, i + chunk)); if (delayMs) await sleep(delayMs); }
      return text;
    },
  };
}
