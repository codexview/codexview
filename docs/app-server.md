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
interrupt and reply. Replies carry the snapshot epoch captured when the request was rendered;
the runtime rejects missing or retired epochs before sending a server response.
Return materialized snapshots with monotonic revision within
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
turn ID. Server requests retain numeric or string IDs and process epochs, are resolved once, and
expire on completion/disconnection. Unsupported server request methods fail
explicitly. No approval is automatically accepted.

Managed-network command approvals display the requested host and protocol from
`networkApprovalContext`, including when `command` and `reason` are absent.
The installed stable schema defines no separate port field. This optional shape
is covered by React component regressions for all four installed protocol values,
explicit decisions and original request ID/epoch replies. No live managed-network
approval was exercised; the real command/file approval evidence below is unchanged.

Stable generated pagination exists in 0.162.1, but it becomes usable only after a
thread's first message is materialized. The runtime handles the exact pre-message
error. Before the first message, read/resume of a newly created loaded thread
uses current-process metadata; if that process exits before persistence, create
a new thread. The runtime reports unsupported API errors rather than selecting another execution
backend. The runtime defaults to stable capabilities. `new CodexRuntime({ experimentalApi:
true })` explicitly enables experimental fields. `send` accepts the installed
`collaborationMode` shape (mode `plan` or `default`, settings with `model`,
`reasoning_effort` and `developer_instructions`); using it without opt-in fails
locally. Plan mode enables real `request_user_input` calls on this CLI.
The playground only forwards this field when started with
`CODEXVIEW_PLAYGROUND_ACCEPTANCE=1`; normal session controls remain unchanged.
WebSocket app-server transport is outside this implementation.

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

## Initial validation (2026-10-11)

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

## Real acceptance (2026-10-12)

The installed CLI remains **0.162.1**. Stable and experimental bindings were
regenerated before testing. Stable pagination is present in this installation;
`collaborationMode` is experimental. The installed bindings take precedence over
differences in the online documentation.

Real testing used GPT-6.1 Sol at **medium**, confirmed by thread-start/resume
responses, temporary workspaces and synthetic markers. The automated runner uses
an isolated `CODEX_HOME` with only the existing authentication file linked in;
it does not import personal sessions or configuration. Raw JSONL stays in its
private temporary directory. The checked-in acceptance record contains sanitized
assertions and relevant event fields, without credentials or absolute user paths.

- The model requested command and file approvals. Approve and Decline were
  exercised in the browser; the approved file existed and the declined file did
  not. A declined command has a null exit code and displays **Declined**.
- Plan mode produced `item/tool/requestUserInput`. The browser supplied `Blue`
  and free text `CUSTOM-4821`; the final model response repeated both exactly.
- Independent browser tests covered refresh during execution, read-only Continue,
  live steer, Stop during a running command, interrupted terminal state, a killed
  app-server, reconnect and both markers recalled on the next turn. History did
  not duplicate live messages.
- With `model_auto_compact_token_limit=18000`, synthetic input increased the last
  input token count from 15,520 to 46,559. Automatic compaction occurred on the
  following turn, not immediately on submission of the long input. Two distinct
  `contextCompaction` items each emitted `item/started` and `item/completed`.
  There was no manual compaction RPC. Runtime snapshots exposed `compacting`;
  `CV-COMPACT-7391` and `violet-lantern` were recalled after compaction, in another
  turn and again after process restart. This confirms these markers for this
  run; it does not promise lossless arbitrary context retention.
- Changing the threshold via resume while the thread was already loaded did not
  prevent the next automatic compaction in this CLI. Restart/resume applied the
  higher threshold for the final recovery turn. The evidence counts both calls.

Real testing exposed and fixed old-epoch approval reuse, terminal state overwritten
by a missing start receipt, stale compaction notifications changing current state,
empty HTTP reply responses, fabricated successful exits for declined commands and
unreviewable pending file changes. Focused regressions cover these boundaries.

### Repeat the acceptance

```sh
pnpm build
# Explicit opt-in; never invoked by pnpm test or CI. Requires an existing login.
node scripts/accept-app-server.mjs --run --budget 11
# Browser operates the approval/question cards; no extra model turn is needed.
node scripts/accept-app-server.mjs --run --cases approvals --budget 2 --interactive
# Compaction + recall/restart only, in a fresh synthetic workspace:
node scripts/accept-app-server.mjs --run --cases compaction --budget 7
```

The runner prints its temporary evidence directory and loopback URL (default
5193; override with `CODEXVIEW_TEST_PORT`). `--cases all` includes live steer and
tool interruption. `--resume DIR` continues a saved compaction case using its
explicit thread ID and cumulative counts. Preserve `summary.json`,
`protocol.jsonl` and `snapshots.jsonl` together when diagnosing a failed run.
Budget accounting counts user turn starts plus automatic compaction calls;
individual tool continuations within a turn can make additional model requests.
Model behavior can vary; failures remain explicit and the runner does not retry
prompts automatically. Review the cumulative count before authorizing another run.

No npm publication, main merge or downstream consumer deployment was performed.

Final local checks passed: **323 tests** (125 adapters, 30 runtime, 62 CLI,
106 React), all package typechecks/builds, all four `release.sh minor` dry runs,
and installation of all four tarballs into a separate consumer. The consumer
imported runtime/adapters, rendered a packaged React transcript under a browser
DOM and executed the packaged CLI. The local pnpm store override used for release
checks was an environment setting, with no repository configuration change.
The network approval display follow-up reran the React minor release dry run and
all package typechecks/tests/builds, without additional model turns.

The real acceptance used **14 budget units**: nine worker user turns, two automatic
compactions and three independent browser turns, including the two-turn post-fix
approval/question rerun. All post-fix browser interactions had no error alert.
See [the sanitized acceptance record](validation/app-server-20261012.json).
PR creation and GitHub CI verification follow the final pushed commit; release
publication remains a separate action.
