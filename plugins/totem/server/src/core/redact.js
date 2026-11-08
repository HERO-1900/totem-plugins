// Everything that leaves this module has secrets replaced with [hidden].
// Runs before any model sees the text, and before anything is written to ~/.totem.
const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[hidden private key]"],
  [/\bsk-ant-[A-Za-z0-9_\-]{20,}/g, "[hidden key]"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}/g, "[hidden key]"],
  [/\bAIza[0-9A-Za-z_\-]{30,}/g, "[hidden key]"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, "[hidden token]"],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, "[hidden token]"],
  [/\bxox[abprs]-[A-Za-z0-9\-]{10,}/g, "[hidden token]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[hidden key]"],
  [/\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g, "[hidden token]"],
  [/\b(?:npm|pypi|glpat|hf|rk_live|sk_live|pk_live|whsec)[_-][A-Za-z0-9_\-]{16,}/g, "[hidden key]"],
  // KEY=value and "password": "value" shapes
  [/\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY|AUTH)[A-Z0-9_]*)\s*[=:]\s*["']?(?!\[hidden)[^\s"']{6,}["']?/g, "$1=[hidden]"],
  [/("?(?:password|passwd|secret|token|api[_-]?key|access[_-]?token)"?\s*[:=]\s*)"[^"]{4,}"/gi, '$1"[hidden]"'],
  // URLs with credentials or token-like query params
  [/(https?:\/\/)[^\s/:@]+:[^\s/@]+@/g, "$1[hidden]@"],
  [/([?&](?:token|key|sig|signature|access_token|api_key|code)=)[^&\s]+/gi, "$1[hidden]"],
  // Card-like digit runs (13–19 digits, spaces or dashes allowed)
  [/\b\d(?:[ -]?\d){12,18}\b/g, (m) => (luhn(m.replace(/\D/g, "")) ? "[hidden card]" : m)],
];

function luhn(d) {
  if (d.length < 13 || d.length > 19) return false;
  let s = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    s += n; alt = !alt;
  }
  return s % 10 === 0;
}

export function redact(text) {
  let s = String(text ?? "");
  let hits = 0;
  for (const [re, rep] of RULES) {
    s = s.replace(re, (m, ...g) => {
      const out = typeof rep === "function" ? rep(m) : rep.replace(/\$(\d)/g, (_, i) => (typeof g[i - 1] === "string" ? g[i - 1] : ""));
      if (out !== m) hits++;
      return out;
    });
  }
  return { text: s, hits };
}
