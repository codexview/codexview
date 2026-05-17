# Integrating CodexView into AgentWeb

This guide shows how to replace AgentWeb's hand-rolled chat transcript UI
(`MessageBubble.tsx`, `StreamingBubble.tsx`, `ToolUseBlock.tsx`) with
[`@codexview/react`](https://www.npmjs.com/package/@codexview/react)'s
`<CodexTranscript>`. It targets `@codexview/react@0.2.x` and the current
AgentWeb data model.

## What you'll wire up

CodexView consumes a `ChatStreamEvent[]` (one normalized event stream).
AgentWeb stores chat history in two places:

- **persisted** — `ChatMessage[]` rows in your database, holding committed
  user / assistant messages, tool calls, and token usage.
- **live** — `streamingAtomFamily(sessionId)`, holding partial assistant
  text, in-flight tool calls, stream errors, and disconnected / gave-up
  flags.

Neither source is `ChatStreamEvent[]` on its own. You need a bridge that
merges them and synthesizes lifecycle events (`thread_started`,
`turn_started`, `turn_completed`, `turn_failed`, `turn_aborted`).

`@codexview/adapters` ships that bridge as `adaptAgentWebTranscript()` —
described in [Step 3](#step-3--bridge-history--live-stream) below.

## Step 1 — install

From the AgentWeb repo root:

```bash
pnpm --filter frontend add @codexview/react @codexview/adapters lucide-react
```

`lucide-react` is a peer of `@codexview/react`. Both `@codexview/*`
packages are ESM-only and require Node ≥ 20 for builds and tests.

## Step 2 — load styles + bridge tokens

In `frontend/src/main.tsx` (or another global entry):

```ts
import '@codexview/react/styles.css';
```

In `frontend/src/codex/styles/tokens.css` (append), map AgentWeb's design
tokens onto CodexView's CSS variables so the transcript inherits the
host theme:

```css
.aw-codex-transcript {
  --cv-bg-user-bubble: var(--aw-bg-bubble-user);
  --cv-bg-assistant-bubble: var(--aw-bg-bubble-bot);
  --cv-text: var(--aw-text-primary);
  --cv-axis-color: var(--aw-border-subtle);
  --cv-bg-raised: var(--aw-bg-raised);
}
```

The full variable list is in [`docs/styling.md`](./styling.md).

## Step 3 — bridge history + live stream

Use `adaptAgentWebTranscript` to fold both sources into `ChatStreamEvent[]`
plus a `TranscriptStatus`:

```tsx
// frontend/src/codex/components/ChatThread.tsx
import { useAtomValue } from 'jotai';
import { CodexTranscript } from '@codexview/react';
import { adaptAgentWebTranscript } from '@codexview/adapters/agentweb-transcript';
import { useChatMessages } from '../hooks/useChatMessages';
import { streamingAtomFamily } from '../atoms/streaming';

export function ChatThread({ sessionId }: { sessionId: string }) {
  const messages = useChatMessages(sessionId);             // ChatMessage[]
  const streaming = useAtomValue(streamingAtomFamily(sessionId));

  const { events, status, error } = adaptAgentWebTranscript({
    sessionId,
    messages,
    streaming,
  });

  return (
    <>
      <CodexTranscript
        events={events}
        status={status}
        className="aw-codex-transcript"
      />
      {error && <StreamErrorOverlay message={error.message} />}
    </>
  );
}
```

### Input shape

`adaptAgentWebTranscript` is dependency-free — it accepts structural
input types so AgentWeb doesn't need to expose internal types upstream.
Map your row / state shapes onto these fields:

```ts
interface AgentWebMessage {
  id: string;
  turnId: string;                    // groups user/assistant rows of one exchange
  role: 'user' | 'assistant';
  text?: string;
  toolCalls?: AgentWebToolCall[];
  usage?: { input?: number; cachedInput?: number; output?: number };
  at?: number;                       // ms epoch
}

interface AgentWebToolCall {
  callId: string;
  name: string;                      // `run_command` → exec_command_*
  args?: unknown;                    // for run_command: { command: string }
  output?: unknown;
  error?: string;
  completed?: boolean;               // false for in-flight live calls
  // run_command extras
  exit?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
}

interface AgentWebStreamingState {
  turnId?: string;
  partialText?: string;
  partialItemId?: string;            // stable React key for the live row
  toolCalls?: AgentWebToolCall[];
  status?: 'streaming' | 'completed' | 'failed' | 'disconnected' | 'gaveUp';
  error?: string;
  usage?: { input?: number; cachedInput?: number; output?: number };
  at?: number;
}
```

If your `streamingAtomFamily` exposes different field names (e.g.
`connectionState` instead of `status`), normalize inline at the call
site — the adapter is intentionally narrow.

### What the adapter handles

- emits `thread_started` for `sessionId` and synthesizes `turn_started`
  / `turn_completed` boundaries around each `turnId` group;
- preserves `turnId` across persisted user message → live partial
  assistant text → final persisted assistant row, so all three render
  in one turn;
- maps `run_command` calls to `exec_command_begin` + `exec_command_end`,
  everything else to `function_call` + `function_call_output`;
- maps `{ input, cachedInput, output }` to CodexView's `TokenUsage`,
  aggregating across multiple assistant rows in one turn;
- converts stream lifecycle into events + status:
  - `streaming` → no terminal event, `status: 'working'`
  - `completed` → `turn_completed`, `status: 'completed'`
  - `failed` → `turn_failed` + `status: 'failed'` + `error.message`
  - `disconnected` / `gaveUp` → `turn_aborted` + `status: 'stopped'`
- leaves in-flight tool calls (`completed: false`) open — only the
  `_begin` half is emitted, so the call renders with a running
  indicator until the next adapter call sees `completed: true`.

## Step 4 — replace transcript rendering, keep host overlays

CodexView v0.2 deliberately does **not** ship approval, reconnect, or
gave-up bubbles — those stay AgentWeb-owned and render next to
`<CodexTranscript>`, not inside it.

Replace **transcript rendering** by removing the imports / renders of:

- `MessageBubble.tsx`
- `StreamingBubble.tsx`
- `ToolUseBlock.tsx`

…wherever they sit inside the chat transcript. Do **not** delete the
files unconditionally — if `StreamingBubble.tsx` also rendered the
approval prompt or "you've been disconnected" banner, extract that
portion into a sibling component (e.g. `ApprovalOverlay.tsx`,
`StreamErrorOverlay.tsx`) and render it next to `<CodexTranscript>`.

The status returned by the adapter is the contract for those overlays:

| `status`     | What to render                                                       |
| ------------ | -------------------------------------------------------------------- |
| `working`    | (nothing — `<CodexTranscript>` shows a running turn)                 |
| `completed`  | (nothing)                                                            |
| `stopped`    | "Disconnected" / "Gave up" banner with a retry / new-turn affordance |
| `failed`     | Error overlay using `error.message`                                  |
| `idle`       | (nothing — empty thread)                                             |

## Step 5 — verify

```bash
pnpm --filter frontend test
pnpm --filter frontend dev
```

In the browser:

1. Start a Codex session — confirm the user message + streamed assistant
   reply render under one `TurnContainer`.
2. Confirm partial assistant text appears with a smooth typewriter
   effect and re-flows when the final persisted row arrives (the
   adapter dedupes by `itemId` if you pass a stable `partialItemId`).
3. Trigger a tool call — confirm the collapsible result.
4. Trigger a `run_command` — confirm the shimmer while running.
5. Disconnect the network — confirm the `<StatusBar>` shows "已停止"
   and your `StreamErrorOverlay` renders.

## Step 6 — adapter contract test (optional but recommended)

Instead of the old compile-time `_AssertEqual` between AgentWeb and
CodexView types, test the adapter directly. This catches drift in
either repo without forcing the two type definitions to match
character-for-character:

```ts
// frontend/src/codex/adapters/codexview.test.ts
import { describe, it, expect } from 'vitest';
import { adaptAgentWebTranscript } from '@codexview/adapters/agentweb-transcript';

describe('AgentWeb → CodexView adapter contract', () => {
  it('renders a two-message turn into a single turn boundary', () => {
    const { events, status } = adaptAgentWebTranscript({
      sessionId: 's1',
      messages: [
        { id: 'u1', turnId: 't1', role: 'user', text: 'hi' },
        { id: 'a1', turnId: 't1', role: 'assistant', text: 'hello' },
      ],
      now: 1_700_000_000_000,
    });

    expect(events.map((e) => e.type)).toEqual([
      'thread_started',
      'turn_started',
      'user_message',
      'agent_message',
      'turn_completed',
    ]);
    expect(status).toBe('completed');
  });

  it('surfaces a disconnected stream as stopped + turn_aborted', () => {
    const { events, status } = adaptAgentWebTranscript({
      sessionId: 's1',
      messages: [{ id: 'u1', turnId: 't1', role: 'user', text: 'hi' }],
      streaming: { turnId: 't1', status: 'disconnected' },
    });

    expect(status).toBe('stopped');
    expect(events.some((e) => e.type === 'turn_aborted')).toBe(true);
  });
});
```

## Rollback

```bash
git revert <integration-commit-sha>
```

Backend SSE endpoints don't change — revert is purely frontend.
