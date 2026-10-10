# Embedded Codex sessions

CodexView retains all historical log adapters and the Markdown CLI, and adds a
Node app-server runtime plus composable React session controls.

## Package boundaries

`@codexview/adapters` owns `ChatStreamEvent`, the `SessionSnapshot`/
`SessionTransport` contract, and `AppServerTranscriptStore`. It has no runtime
dependencies. React reexports the canonical event types. The store routes by
thread/turn/item, accumulates deltas, treats live item completion as authoritative,
and merges history without duplicate items. Unchanged materialized events retain
identity so React can replay only the changed turn.

`@codexview/runtime` owns the persistent Node child, JSONL request correlation,
server-initiated requests, history reads and session lifecycle. `@codexview/react`
owns presentation and interactions. The host owns authentication, thread ownership,
durable IDs, transport and sandbox policy.

## Run the example

```sh
pnpm install
pnpm build
pnpm playground
# http://127.0.0.1:5181
```

Use New session, choose a model if needed, then send a message. During execution,
the composer sends additional instructions with `expectedTurnId`; Stop requests
interruption. Approvals and questions require explicit answers. Refreshing the
page leaves backend work running. Continue session enables input after a read-only
history view; Reconnect session starts a lost process and resumes the saved ID.
Browse saved history reads 20 turns per page without resuming the model.

The example persists its own thread IDs in `~/.codexview/playground/threads.json`
and uses the adjacent `workspace` directory. Set `CODEXVIEW_PLAYGROUND_DIR` before
starting Vite to isolate these files elsewhere. It lists only its own sessions.
The separate Log viewer retains the previous multi-format log browser.

Middleware lives in `packages/react/playground/session-api.mjs`; the browser
transport in `src/sessionTransport.ts`. SSE uses fetch so an in-memory local
capability can be sent in a header, with loopback Host checks, same-origin checks
and an explicit operation allowlist. It sends materialized snapshots on reconnect and changed event suffixes during
a connection, retaining earlier browser event references. Missed deltas therefore
do not require replaying prompts. This local capability
is unrelated to Codex credentials. A production host must replace this development
boundary with its own user authentication and thread authorization.

## Embed React

```tsx
import { CodexSession } from '@codexview/react';
import type { SessionTransport } from '@codexview/adapters';
import '@codexview/react/styles.css';

export function AgentPanel({ threadId, transport }: {
  threadId: string; transport: SessionTransport;
}) {
  return <CodexSession threadId={threadId} transport={transport} />;
}
```

Implement `SessionTransport` in your host client: subscribe, models, send, steer,
interrupt and reply. Return materialized snapshots with monotonic revision within
a process epoch. `useCodexSession`, `SessionComposer` and `SessionRequests` are
exported for custom layouts. `CodexTranscript` remains a display component.

The legacy events hook accepts append/replacement on the same array when React
rerenders; in-place edits to event objects are not an event update API. Replace
changed event objects or use the session store. The adapter bounds completed
turns, the hook retains a single checkpoint before the current turn, and the
example replaces historical pages rather than retaining all pages in browser
memory. An active turn and unusually large tool output still need host budgets.

## Protocol contract and limits

Verified CLI: **codex-cli 0.162.1**. Bindings were regenerated with
`codex app-server generate-ts --out <temporary-directory>` without `--experimental`.
Runtime uses a narrow structural subset of these types; no generated dependency
or official SDK is needed. The documented TypeScript SDK thread-run interface does
not supply the full server-request lifecycle needed by this UI, so this integration
uses bidirectional app-server directly.

Initialization sends `initialize`, waits for success, then sends `initialized`.
`turn/start` is an acceptance receipt. Only `turn/completed` establishes completed,
failed or interrupted. Connection state remains independent; loss can leave an
uncertain outcome. Concurrent sends are rejected and steer requires an expected
turn ID. Server requests retain numeric or string IDs, are resolved once, and
expire on completion/disconnection. Unsupported server request methods fail
explicitly. No approval is automatically accepted.

Stable generated pagination exists in 0.162.1, but it becomes usable only after a
thread's first message is materialized. The runtime handles the exact pre-message
error. Before the first message, read/resume of a newly created loaded thread
uses current-process metadata; if that process exits before persistence, create
a new thread. The runtime reports unsupported API errors rather than selecting another execution
backend. The integration does not opt into experimentalApi. WebSocket app-server
transport and experimental methods are outside this implementation.

Codex manages context compaction; the UI displays its lifecycle. Persistent
history is distinct from model context: context is limited and compaction is not
promised to be lossless. Model catalogs do not prove account access.

Official references: [app-server](https://learn.chatgpt.com/docs/app-server) and
[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk).

## Release

Run each affected package's `release.sh minor` for install, typecheck, tests,
build and tarball checks. Dry runs work on feature branches and leave versions
unchanged. `--publish` still requires clean main matching origin/main, then tags
and waits for OIDC publication. Runtime has its own `runtime-v*` workflow; its
npm trusted-publisher association must be configured before its first publication.
Publish adapters before packages that depend on its new API. React publication
uses pnpm so workspace dependency versions are rewritten in the package. This feature branch
does not merge main or deploy consumers.

## Validation record (2026-10-11)

- Codex 0.162.1 stdio initialize/initialized and model catalog verified against
  the installed CLI; fresh schema generated without experimental flags.
- Four short GPT-6.1 Sol medium turns in isolated test workspaces: one marker
  setup, recall after a browser refresh during execution, recall after terminating
  and reconnecting the app-server process, and one newly created session.
- Browser checks cover read-only history, explicit Continue, model/effort selection,
  live status, refresh while running, disconnection preserving terminal state,
  reconnect, and deduplicated saved history.
- Protocol fixtures cover approval resolution/duplicates/stale turns, unsupported
  requests, failure/interruption, initialization/loss/timeout, completion races,
  epoch reset, history/live merge, memory pruning and compaction continuation.
- Host HTTP tests check origin/Host/token/ownership restrictions and SSE suffix
  patches, reconnect snapshots and unsubscribe cleanup.
- All four package release dry runs, full typecheck/tests/build, tarball installation
  and package imports checked. React import/render was checked with a browser DOM;
  bare Node SSR currently hits a bundled markdown dependency's `document` usage
  and is not a supported validation target for this client component.

Real model-triggered approvals, user questions, interruption during tool execution
and long-context automatic compaction were not forced. Their state/response paths
are fixture-tested. No private histories were copied or changed. No npm publish,
main merge or downstream consumer deployment was performed.
