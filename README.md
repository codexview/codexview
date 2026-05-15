# codexview

React components for rendering OpenAI Codex CLI chat streams. Designed for agentweb but framework-agnostic for any host that produces compatible `ChatStreamEvent` sequences.

## Install

```bash
pnpm add codexview lucide-react react react-dom
```

Import the stylesheet once in your app entrypoint:

```ts
import 'codexview/styles.css';
```

## 60-second quick start

```tsx
import { CodexTranscript, type ChatStreamEvent } from 'codexview';
import 'codexview/styles.css';

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

## License

MIT.
