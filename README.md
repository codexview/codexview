# codexview

React components for rendering AI coding agent transcripts. The library consumes a normalized `ChatStreamEvent` stream and is host-agnostic — any source that produces compatible events renders identically.

Reference adapters for several real-world agent log formats live in [`playground/adapter.mjs`](playground/adapter.mjs); see [Supported sources](#supported-sources) below.

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

## Supported sources

CodexView itself only renders `ChatStreamEvent[]`. Hosts convert their raw logs to that shape — either inline or by reusing the reference adapters in [`playground/adapter.mjs`](playground/adapter.mjs):

- ✅ **OpenAI Codex CLI** rollouts (`~/.codex/sessions/.../rollout-*.jsonl`)
- ✅ **AgentWeb codex-team** status logs (`~/Projects/agentweb/.codex-team/runs/*/events.jsonl`)
- ✅ **Claude Code** main sessions (`~/.claude/projects/<repo>/<sessionId>.jsonl`) — Bash / TodoWrite / Edit / Write / MultiEdit / `mcp__*` tools, with sensible fallbacks for unknown tools
- 🔲 **OpenCode** — planned
- 🔲 **Claude Code subagents** (`subagents/agent-*.jsonl`) — planned (will link to the parent `Task` tool call)

These adapters are not published as part of `@codexview/react` yet. To try them locally, clone the repo and run `pnpm playground` — it scans your home directory for sessions across all three supported formats.

## Status

Session-level status (`idle | working | completed | stopped | failed`) is inferred automatically. Override via the `status` prop (e.g. when SSE drops, set `status="stopped"`).

## Customizing

- Swap any block via `components` prop: `<CodexTranscript components={{ ToolCallBlock: MyToolUI }} />`
- Theme via CSS variables — see [docs/styling.md](docs/styling.md) for the full list.

## More docs

- [docs/api.md](docs/api.md) — every public API
- [docs/events.md](docs/events.md) — `ChatStreamEvent` contract
- [docs/styling.md](docs/styling.md) — CSS variables
- [docs/integration-agentweb.md](docs/integration-agentweb.md) — drop-in for agentweb
- [docs/changelog.md](docs/changelog.md) — version history

## License

MIT.
