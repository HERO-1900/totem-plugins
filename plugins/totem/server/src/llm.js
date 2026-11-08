import fs from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { WORK_DIR, ensureDirs } from "./paths.js";
import { anthropicProvider, openaiProvider, geminiProvider, ollamaProvider, fakeProvider } from "./core/stream.js";

// One small interface over the models a person may already have.
//   stream({system, prompt, json, fast, maxTokens, signal, onDelta}) -> full text, calling onDelta as text arrives
//   ask(...) is the same without the deltas.
const has = (bin) => { try { execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" }); return true; } catch { return false; } };
const env = process.env;

export const PROVIDERS = {
  "claude-code": { label: "Claude Code on this computer", to: "Anthropic", available: () => has("claude"), make: claudeCodeProvider },
  codex: { label: "Codex on this computer", to: "OpenAI", available: () => has("codex"), make: codexProvider },
  gemini: { label: "Gemini (your GEMINI_API_KEY)", to: "Google", available: () => !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY),
    make: () => geminiProvider({ key: env.GEMINI_API_KEY || env.GOOGLE_API_KEY, model: env.TOTEM_GEMINI_MODEL }) },
  anthropic: { label: "Claude API (your ANTHROPIC_API_KEY)", to: "Anthropic", available: () => !!env.ANTHROPIC_API_KEY,
    make: () => anthropicProvider({ key: env.ANTHROPIC_API_KEY, model: env.TOTEM_ANTHROPIC_MODEL }) },
  openai: { label: "OpenAI API (your OPENAI_API_KEY)", to: "OpenAI", available: () => !!env.OPENAI_API_KEY,
    make: () => openaiProvider({ key: env.OPENAI_API_KEY, model: env.TOTEM_OPENAI_MODEL, baseURL: env.OPENAI_BASE_URL || undefined }) },
  ollama: { label: "Ollama (stays on this computer)", to: "nobody, it runs locally", available: () => has("ollama"),
    make: () => ollamaProvider({ host: env.OLLAMA_HOST || undefined, model: env.TOTEM_OLLAMA_MODEL }) },
  // A scripted model for tests: TOTEM_FAKE_REPLY points at a file with the answer to stream.
  fake: { label: "Scripted model (tests)", to: "nobody", available: () => !!env.TOTEM_FAKE_REPLY,
    make: () => fakeProvider({ reply: fs.readFileSync(env.TOTEM_FAKE_REPLY, "utf8"), first: env.TOTEM_FAKE_FIRST || undefined, delayMs: +(env.TOTEM_FAKE_DELAY ?? 8) }) },
  none: { label: "No model, rules only", to: "nobody", available: () => true, make: () => null },
};

export function listProviders() {
  return Object.entries(PROVIDERS).filter(([n]) => n !== "fake" || PROVIDERS.fake.available()).map(([name, p]) => ({ name, label: p.label, to: p.to, available: p.available() }));
}

export function pickProvider(name) {
  if (name) {
    const p = PROVIDERS[name];
    if (!p) throw new Error(`Unknown model "${name}". Use one of: ${Object.keys(PROVIDERS).join(", ")}`);
    return wrap(name, p);
  }
  for (const n of ["fake", "gemini", "anthropic", "openai", "claude-code", "codex", "ollama"]) if (PROVIDERS[n].available()) return wrap(n, PROVIDERS[n]);
  return wrap("none", PROVIDERS.none);
}

function wrap(name, p) {
  const impl = p.make();
  if (!impl) return { name, label: p.label, to: p.to, ask: null, stream: null };
  return { ...impl, name, label: p.label, to: p.to, ask: (o) => impl.stream({ ...o, onDelta: undefined }), stream: (o) => impl.stream(o) };
}

function spawnRun(bin, args, input, { signal, timeoutMs = 240000, onStdout } = {}) {
  ensureDirs();
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: WORK_DIR, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
    let out = "", err = "";
    const stop = () => p.kill();
    const t = setTimeout(() => { stop(); reject(new Error(bin + " timed out")); }, timeoutMs);
    signal?.addEventListener?.("abort", stop, { once: true });
    p.stdout.on("data", (d) => { out += d; onStdout?.(d.toString()); });
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", (code) => {
      clearTimeout(t);
      signal?.removeEventListener?.("abort", stop);
      if (signal?.aborted) return reject(new Error("stopped"));
      code === 0 ? resolve(out) : reject(new Error(`${bin} exited ${code}: ${err.slice(0, 400)}`));
    });
    p.stdin.end(input);
  });
}

// Claude Code in headless mode, with no tools, no MCP and no saved session.
// stream-json + partial messages gives us the text as the model writes it.
function claudeCodeProvider() {
  const model = (fast) => env.TOTEM_CLAUDE_MODEL || (fast ? "haiku" : "sonnet");
  const base = (system, fast) => ["-p", "--no-session-persistence", "--tools", "", "--strict-mcp-config", "--system-prompt", system, "--model", model(fast)];
  return {
    name: "claude-code", model: model(false),
    async stream({ system, prompt, fast, signal, onDelta }) {
      let full = "", buf = "", result = null;
      const onStdout = (s) => {
        buf += s;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          let j;
          try { j = JSON.parse(line); } catch { continue; }
          if (j.type === "stream_event" && j.event?.type === "content_block_delta" && j.event.delta?.type === "text_delta") { full += j.event.delta.text; onDelta?.(j.event.delta.text); }
          else if (j.type === "result") result = j;
        }
      };
      try {
        await spawnRun("claude", [...base(system, fast), "--output-format", "stream-json", "--include-partial-messages", "--verbose"], prompt, { signal, onStdout });
      } catch (e) {
        // Older Claude Code without partial messages: fall back to plain text.
        if (signal?.aborted || !/unknown option|include-partial/i.test(e.message)) throw e;
        const text = await spawnRun("claude", [...base(system, fast), "--output-format", "text"], prompt, { signal });
        onDelta?.(text);
        return text;
      }
      if (result?.is_error) throw new Error("Claude Code: " + String(result.result || "error").slice(0, 300));
      if (!full && result?.result) { full = result.result; onDelta?.(full); }
      return full;
    },
  };
}

function codexProvider() {
  return {
    name: "codex", model: "codex",
    async stream({ system, prompt, signal, onDelta }) {
      const text = await spawnRun("codex", ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "-"], system + "\n\n" + prompt, { signal });
      onDelta?.(text);
      return text;
    },
  };
}

export function parseJSON(s) {
  const t = String(s).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("Model did not return JSON");
}
