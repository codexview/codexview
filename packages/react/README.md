# @codexview/react

React components for rendering AI coding agent transcripts. The library consumes a normalized `ChatStreamEvent` stream and is host-agnostic — any source that produces compatible events renders identically.

For raw-log → `ChatStreamEvent[]` conversion, install the companion [`@codexview/adapters`](https://www.npmjs.com/package/@codexview/adapters) package or write your own adapter.

## Install

```bash
pnpm add @codexview/react lucide-react react react-dom
```

Import the stylesheet once in your app entrypoint:

```ts
import '@codexview/react/styles.css';
```

## 60-second quick start

```tsx
import { CodexTranscript, type ChatStreamEvent } from '@codexview/react';
import '@codexview/react/styles.css';

const events: ChatStreamEvent[] = [
  { type: 'thread_started', threadId: 'T', at: Date.now() },
  { type: 'turn_started', turnId: 'A', at: Date.now() },
  { type: 'user_message', turnId: 'A', itemId: 'u1', text: 'Hello!', at: Date.now() },
  { type: 'agent_message', turnId: 'A', itemId: 'a1', text: 'Hi.', partial: false, at: Date.now() },
  { type: 'turn_completed', turnId: 'A', at: Date.now() },
];

export function App() {
  return <CodexTranscript events={events} />;
}
```

`events` is a plain array. Append new events as they arrive (typically via SSE) and pass the same array reference back; CodexView reduces incrementally.

## Supported source formats

CodexView itself only renders `ChatStreamEvent[]`. Hosts convert their raw logs to that shape — either inline or with [`@codexview/adapters`](https://www.npmjs.com/package/@codexview/adapters):

- ✅ **OpenAI Codex CLI** rollouts (`~/.codex/sessions/.../rollout-*.jsonl`)
- ✅ **AgentWeb codex-team** status logs (`~/Projects/agentweb/.codex-team/runs/*/events.jsonl`)
- ✅ **Claude Code** main sessions (`~/.claude/projects/<repo>/<sessionId>.jsonl`) — Bash / TodoWrite / Edit / Write / MultiEdit / `mcp__*` / `Agent` tools; subagent transcripts can be embedded under each `Agent` tool call (pass `subagents` to `adapt()`).
- 🔲 **OpenCode** — planned

## Status

Session-level status (`idle | working | completed | stopped | failed`) is inferred automatically. Override via the `status` prop (e.g. when SSE drops, set `status="stopped"`).

## Reading layout

Consecutive tool-like items inside a turn (`tool_call`, `exec`, `search`, `patch`, `todo_list`) are wrapped automatically in a single collapsible `<ToolGroup>` titled by aggregated counts — e.g. `更新待办、执行 9 个命令、调用 4 个工具`. The transcript reads as narrative: text, a one-line summary of operations in between, more text. Messages, reasoning, and errors stay rendered standalone. See [docs/api.md#toolgroup](docs/api.md) for the API.

The default light palette is a "warm paper" look (ivory page, deep ink-brown text, peach user bubble, warm-ink code blocks). To restore the previous cool palette, drop in the override snippet in [docs/styling.md](docs/styling.md#restoring-the-pre-021-cool-palette).

## Customizing

- Swap any block via `components` prop: `<CodexTranscript components={{ ToolCallBlock: MyToolUI, ToolGroup: MyGroupUI }} />`
- Theme via CSS variables — see [docs/styling.md](docs/styling.md) for the full list.

## More docs

- [docs/api.md](docs/api.md) — every public API
- [docs/events.md](docs/events.md) — `ChatStreamEvent` contract
- [docs/styling.md](docs/styling.md) — CSS variables
- [docs/integration-agentweb.md](docs/integration-agentweb.md) — drop-in for agentweb
- [docs/changelog.md](docs/changelog.md) — version history

## License

MIT.
