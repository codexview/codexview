# Integrating CodexView into agentweb

This is a drop-in replacement for `frontend/src/codex/components/MessageBubble.tsx`, `StreamingBubble.tsx`, and `ToolUseBlock.tsx`. The agentweb backend (`backend/src/codex/eventMap.ts`) produces a normalized event stream that is conceptually equivalent to `ChatStreamEvent`, but uses different field names.

## Adapter required

The agentweb backend's `NormalizedEvent` and CodexView's `ChatStreamEvent` are conceptually equivalent but use different field names (e.g., agentweb uses `kind: 'text_delta'`, CodexView uses `type: 'agent_message'`). A small adapter function in agentweb (`frontend/src/codex/adapters/codexview.ts`) is needed to map between them. The Step 3 code example below is illustrative — replace `adapter(stream)` with the adapter-produced array and `stream.connected` with whatever connection-state field your `streamingAtomFamily` actually exposes.

## Step 1 — install (development)

From the agentweb repo root:

```bash
pnpm --filter frontend add file:../CodexView
pnpm --filter frontend add lucide-react
```

(Once `codexview` is published to a registry, replace `file:../CodexView` with the version range.)

## Step 2 — load styles + bridge tokens

In `frontend/src/main.tsx` (or another global entry):

```ts
import 'codexview/styles.css';
```

In `frontend/src/codex/styles/tokens.css` (append):

```css
.aw-codex-transcript {
  --cv-bg-user-bubble: var(--aw-bg-bubble-user);
  --cv-bg-assistant-bubble: var(--aw-bg-bubble-bot);
  --cv-text: var(--aw-text-primary);
  --cv-axis-color: var(--aw-border-subtle);
  --cv-bg-raised: var(--aw-bg-raised);
}
```

(Match the variable list in `docs/styling.md` against agentweb's tokens.)

## Step 3 — replace ChatThread internals

`frontend/src/codex/components/ChatThread.tsx`:

```tsx
import { useAtomValue } from 'jotai';
import { CodexTranscript } from 'codexview';
import { streamingAtomFamily } from '../atoms/streaming';
import { adaptStreamEvents } from '../adapters/codexview'; // adapter required — see "Adapter required" section above

export function ChatThread({ sessionId }: { sessionId: string }) {
  const stream = useAtomValue(streamingAtomFamily(sessionId));
  return (
    <CodexTranscript
      events={adaptStreamEvents(stream)} // replace with adapter-produced ChatStreamEvent[]
      status={stream.connected ? undefined : 'stopped'} // replace stream.connected with actual field name
      className="aw-codex-transcript"
    />
  );
}
```

The adapter maps agentweb's `NormalizedEvent` (with `kind` field) to CodexView's `ChatStreamEvent` (with `type` field). Adjust all property names to match the actual `streamingAtomFamily` shape.

## Step 4 — clean up + handle approval

Delete from `frontend/src/codex/components/`:

- `MessageBubble.tsx`
- `StreamingBubble.tsx`
- `ToolUseBlock.tsx`

**Keep** approval logic. CodexView v0.1 deliberately does **not** ship an approval-bubble component (see spec §11). If `StreamingBubble.tsx` carried that responsibility, extract the approval portion into a standalone `ApprovalBubble.tsx` component within agentweb and render it next to `<CodexTranscript>` (e.g. as a sibling overlay), feeding it the same approval events.

## Verify

```bash
pnpm --filter frontend test
pnpm --filter frontend dev
```

In the browser:

1. Start a Codex session.
2. Confirm streaming text appears with smooth typewriter effect.
3. Trigger a tool call — confirm collapsible result.
4. Trigger an exec — confirm shimmer while running.
5. Disconnect the network — confirm StatusBar shows "已停止" once you set `status="stopped"`.

## Rollback

```bash
git revert <integration-commit-sha>
```

Backend `ChatStreamEvent` shape and SSE endpoints do not change, so revert is purely frontend.

## Type-safety guard

Add to `frontend/src/codex/types/eventCheck.ts`:

```ts
import type { ChatStreamEvent as CV } from 'codexview';
import type { ChatStreamEvent as AW } from '../../../../backend/src/codex/eventMap';

// Will fail to compile if shapes drift.
type _AssertEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : never;
type _Check = _AssertEqual<CV, AW>;
```

When the agentweb backend adds an event type, this assertion fails until codexview is updated.
