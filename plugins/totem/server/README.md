# totem (try-it version)

Your own context center. totem reads what you typed to Claude Code and Codex on this computer, hides secrets, and organizes it into short items about you. Then pick any app or agent and see exactly what totem would hand it: only what that task needs, what is still missing, and a first message the app can start from.

Everything stays in `~/.totem/` on your computer. Nothing is uploaded by totem itself. The only thing that leaves is the sample of messages sent to the model you choose, after secrets are hidden, and totem asks before it sends. If you set a `TYPESAFE_API_KEY`, each switch is also double-checked by Jev (below), which reads the app's task and your everyday items. If you turn on the cloud copy (below; it is off until you do), a sealed copy of your S1 and S2 items is kept on the totem relay.

## Run

```sh
npx -y @ipolab/totem          # scan, then open http://localhost:7310
```

Not on npm yet. From this folder: `node bin/totem.js`.

| Command | What it does |
|---|---|
| `totem` | Scan if needed, then open the switcher |
| `totem scan --model claude-code` | Read history again. Models: `claude-code`, `codex`, `gemini`, `anthropic`, `openai`, `ollama`, `none` |
| `totem scan --import chatgpt-export.zip` | Add a ChatGPT or Claude.ai export |
| `totem show airbnb` | Print what Airbnb would get |
| `totem add "Passport expires 2031" --tag passport --level S4` | Add something yourself |
| `totem mcp` | Run as an MCP server |
| `totem link` | Let cloud AIs ask this computer (see below) |
| `totem cloud on` / `off` | Keep a sealed S1/S2 copy for when the computer is off, or delete it |
| `totem modes` | How linked AIs reach your totem right now |
| `totem forget` | Delete `~/.totem`, and anything kept on the relay |

With no flag, totem uses the first model it finds: a `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, then the Claude Code or Codex already installed (no key needed), then Ollama. `--model ollama` keeps everything on the computer.

## Use it from your agent

```sh
npx -y @ipolab/totem connect      # adds totem to Claude Code, Claude Desktop, Codex, Cursor, Windsurf, VS Code, Antigravity
```

Then say "@totem ..." or just ask about yourself in any of them. Tools: `totem_search` (something you said before), `totem_context` (the slice for one app or task), `totem_remember`, `totem_apps`. Agents see S1 and S2; `totem allow claude-code S3` lets one of them see private items too. Every call leaves a receipt with the client's name in `~/.totem/receipts.jsonl`. The Claude Code plugin and the Claude Desktop extension are in `../totem-agents`.

## A second opinion on each switch (optional)

The rules decide first and show at once. With your own `TYPESAFE_API_KEY` set, the page then asks Jev, TypeSafe's decision model, one fact at a time: would this app use it for this task, and would you mind it seeing it. The answers can only make sharing stricter: an unrelated item is held back, a sensitive one waits for your yes, and a strong match the rules missed is only suggested. What goes to TypeSafe: the app's name and task, and your S1 and S2 items in English. S3 and S4 items never go. `TOTEM_JEV_MODEL` picks the version (default `jev-1.14.0`).

On try.ipolab.ai the same check runs on Cloudflare Workers AI (Clef, which takes the same requests), so it needs no key.

## Use it from claude.ai, ChatGPT and other cloud AIs

```sh
npx -y @ipolab/totem link         # shows a pairing code; add https://mcp.ipolab.ai/mcp as a custom connector
```

`totem link` keeps one outbound connection to the totem relay, in the background (a LaunchAgent on macOS, a systemd user service on Linux; `--foreground` runs it in the window instead). A question from a linked AI is answered here from `~/.totem` and only the answer goes back. `totem link --off` unlinks and stops it.

Ways a linked AI can reach your totem, tried in this order (`totem modes` shows yours):

| | Where | Holds | Status |
|---|---|---|---|
| A | This computer, through the relay | everything; agents see S1, S2 (S3 with `totem allow`) | in use |
| B | Your own cloud account | up to S3 if you choose | planned |
| C | totem's cloud copy (`totem cloud on`) | S1 and S2 only, sealed | off unless you turn it on |

With C on, the computer seals each S1/S2 item before it leaves (AES-256-GCM, names hidden with HMAC). The key stays in `~/.totem/link.json` and, for each linked AI, inside that AI's OAuth grant, which is encrypted with the AI's own token; so the relay's storage alone opens nothing, and the relay opens the copy in memory only while a linked AI is asking. The computer is asked first; the copy answers only when the computer is off or silent for 3 seconds, and its answers say so. Something an AI remembers meanwhile waits on the relay, sealed, and moves into `profile.json` when the computer is back (private notes are refused until then). Edits, deletions and level changes reach the copy within seconds. `totem cloud off`, `totem link --off` and `totem forget` delete it on the relay.

## What it reads

- Claude Code: `~/.claude/projects/**/*.jsonl` (your messages only, not tool output), `~/.claude/CLAUDE.md`, the `CLAUDE.md` of projects you worked in, Claude Code memory notes.
- Codex: `~/.codex/sessions/**/*.jsonl`, `~/.codex/history.jsonl`, `AGENTS.md`.
- Optional: ChatGPT or Claude.ai export (`conversations.json`), pasted text.

## How items are labelled

Each item has a kind (identity, preferences, work, now, people, rules), a level (S1 public, S2 everyday, S3 private, S4 documents, as in the whitepaper), whether you said it or it was inferred, and where it came from with a short quote. Apps get items up to their level by default. Private ones wait for your yes. Document-level things (passport, income) are never guessed from chat: they show up as gaps until you add them.

App profiles live in `data/apps.json`: what each app needs for one task, its default level, and for how long. Concept demo: app names belong to their owners.

## Develop

```sh
npm test
node test/make-fixture.js /tmp/fx            # a fictional person's history
TOTEM_SCAN_HOME=/tmp/fx TOTEM_HOME=/tmp/tt node bin/totem.js scan --model claude-code --yes
TOTEM_HOME=/tmp/tt node bin/totem.js open
```

No dependencies. Node 18.17 or newer; `totem link` and `totem cloud` need Node 22 (built-in WebSocket).
