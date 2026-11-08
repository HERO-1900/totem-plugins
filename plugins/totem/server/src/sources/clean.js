// Shared cleanup for what a person typed into an agent.
const NOISE_START = [
  "<command-", "<local-command", "<system-reminder", "<environment_context", "<user_instructions",
  "<user-prompt-submit-hook", "<session-context", "<wake", "<coordinator-relay", "<task-notification",
  "Caveat: The messages below", "[Request interrupted", "This session is being continued from a previous conversation",
];

export function cleanUserText(t) {
  if (typeof t !== "string") return "";
  let s = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  if (!s) return "";
  if (NOISE_START.some((p) => s.startsWith(p))) return "";
  // Long pastes (logs, stack traces, whole files) say little about the person. Keep the head.
  if (s.length > 1600) s = s.slice(0, 1600) + " …";
  return s;
}

export function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c && (c.type === "text" || c.type === "input_text"))
    .map((c) => c.text || "")
    .join("\n");
}
