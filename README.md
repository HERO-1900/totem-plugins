# totem plugins

[中文](#中文) · [English](#english)

## 中文

totem 把关于你的小事记在你自己的电脑上，比如你是谁、喜欢什么、最近在忙什么。你用的 AI 做事需要时，先来问它。这个仓库放的是 totem 的插件，用 Apache-2.0 开源。

第一次用，先在电脑上跑一次：

```sh
npx -y @ipolab/totem
```

它读你电脑上 Claude Code 和 Codex 的历史，整理好放在 `~/.totem`，再打开 http://localhost:7310 给你看。不上传任何东西。

### 装到你用的 AI 里

| 在哪里用 | 怎么装 |
|---|---|
| Claude Code | `/plugin marketplace add HERO-1900/totem-plugins`，再 `/plugin install totem@ipolab` |
| Claude Desktop | 下载 [desktop/totem.mcpb](desktop/totem.mcpb)，双击安装 |
| Codex、Cursor、Windsurf、VS Code、Antigravity、Gemini CLI | `npx -y @ipolab/totem connect` |
| claude.ai、ChatGPT | 电脑上跑 `npx -y @ipolab/totem link`，在 AI 的设置里加自定义连接器 `https://mcp.ipolab.ai/mcp`，再输入电脑上显示的 8 位配对码 |

装好以后，说「@totem 我上次想住东京哪一片来着」或者「记一下，我的护照 2031 年到期」就行。

### 它能给 AI 看什么

- 默认只给公开和日常两级（S1、S2）。
- 私密（S3）要你自己在电脑上放行：`totem allow <客户端> S3`。
- 证件级（S4）永远不给。
- 每次被读都在 `~/.totem/receipts.jsonl` 留一条收据：谁、什么时候、拿走了哪几条。

需要 Node 20 或更新的版本；`totem link` 需要 Node 22。

## English

totem keeps short facts about you on your own computer: who you are, what you like, what you're working on. When the AI you use needs them for a task, it asks totem first. This repository holds totem's plugins, open source under Apache-2.0.

First, run this once on your computer:

```sh
npx -y @ipolab/totem
```

It reads your local Claude Code and Codex history, organizes it into `~/.totem`, and opens http://localhost:7310 to show you. Nothing is uploaded.

### Add it to the AI you use

| Where | How |
|---|---|
| Claude Code | `/plugin marketplace add HERO-1900/totem-plugins`, then `/plugin install totem@ipolab` |
| Claude Desktop | download [desktop/totem.mcpb](desktop/totem.mcpb) and double-click it |
| Codex, Cursor, Windsurf, VS Code, Antigravity, Gemini CLI | `npx -y @ipolab/totem connect` |
| claude.ai, ChatGPT | run `npx -y @ipolab/totem link` on your computer, add the custom connector `https://mcp.ipolab.ai/mcp` in the AI's settings, and type the 8-character code your computer shows |

Then say "@totem which part of Tokyo did I want to stay in?" or "remember that my passport expires in 2031".

### What an AI gets to see

- By default, only the public and everyday levels (S1, S2).
- Private items (S3) only after you allow it on your computer: `totem allow <client> S3`.
- ID-grade items (S4) never.
- Every read leaves a receipt in `~/.totem/receipts.jsonl`: who, when, and which items.

Needs Node 20 or newer; `totem link` needs Node 22.

---

totem 由 ipo Lab 制作 · totem is made by ipo Lab · [try.ipolab.ai](https://try.ipolab.ai)
