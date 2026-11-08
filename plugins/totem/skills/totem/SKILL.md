---
name: totem
description: Look things up in the user's own totem (their personal context center on this computer). Use when the user writes @totem, "ask totem", 「问问 totem」「查一下 totem」, or asks about themselves or something they said before and forgot (a name, a date, a plan, a place, a preference); also before a task that needs to know about them, and when they say "remember this" / 「记一下」.
---

# totem

totem keeps short items about the user (who they are, what they like, plans, people, rules) on their computer. The `totem` MCP server gives you three tools.

1. **They forgot something or ask about themselves** ("@totem what was that hotel area I wanted", 「我家猫叫什么来着」): call `totem_search` with their own words. Answer from what comes back, and mention when and where they said it if it helps them remember.
2. **A task for them** (book, buy, write, plan, apply): call `totem_context` with the app or the task first, then do the task. Do not ask them things totem already has.
3. **"Remember this"** / 「记一下」: call `totem_remember` with one sentence about them.

Rules:
- Items marked inferred are guesses. Say so.
- Private items (S3, S4) are never returned. When totem says some private items match, tell the user they can share them from the totem page at http://localhost:7310 or tell you directly. Do not guess them.
- If totem says it is not set up, tell the user to run `npx -y @ipolab/totem` once.
- Reply in the user's language.
