# @codexview/runtime

Node 20+ host for persistent local Codex app-server sessions. Requires an installed,
authenticated Codex CLI. Tested against **0.162.1** using stdio and the stable API;
`experimentalApi` defaults to false. Opt in explicitly for Plan collaboration mode. Authentication stays in the Codex process.

Install the published package in your Node.js host:

```sh
npm install @codexview/runtime
```

```ts
import { CodexRuntime } from '@codexview/runtime';

const runtime = new CodexRuntime({ maxTurns: 40 });
await runtime.start();
const { thread } = await runtime.createThread({
  cwd: '/absolute/project',
  sandbox: 'workspace-write',
  approvalPolicy: 'on-request',
});
// Persist thread.id in your host database, with its owner.
const unsubscribe = runtime.subscribe(thread.id, snapshot => {
  // Deliver to this user's authenticated connection.
  console.log(snapshot.execution);
});
await runtime.send(thread.id, 'Summarize this project'); // acceptance, not completion
// Completion is reported by a snapshot with completed / failed / interrupted.
// User decisions must be sent to the original request ID:
// await runtime.reply(thread.id, request.id, { decision: 'accept' }, snapshot.epoch);
// await runtime.steer(thread.id, 'Focus on tests', snapshot.activeTurnId!);
// await runtime.interrupt(thread.id, snapshot.activeTurnId!);
unsubscribe(); // does not stop the backend task
// At host shutdown: await runtime.close();
```

## Host API

The default initialization metadata reports the installed package version.
Hosts can provide their own `clientInfo` through `RuntimeOptions`.

- `start`, `close`, `restart`: own one child process. Restart resumes previously
  created/resumed threads, without replaying prompts. Save thread IDs separately
  to recover after a host restart using `resumeThread`.
- `createThread`, `resumeThread`: enable execution for the thread.
- `readThread`: inspect bounded history without resuming or enabling input.
- `listThreads`: cursor pagination; default sourceKinds explicitly includes
  `cli`, `vscode`, `exec`, `appServer`. Supply filters to narrow further.
- `listTurns`, `listItems`: explicit cursor-based history reads.
- `listModels` / `models`: model and reasoning catalog, not an entitlement check.
- `send`: rejects concurrent or active/uncertain turns. `steer` requires the
  expected active turn ID. `interrupt` sends a cancellation request; wait for the real completion notification to establish the outcome.
- `reply`: answers a pending command/file approval or user-input request. Expired,
  already answered, cross-thread IDs and missing/stale epochs are rejected. Unknown request methods
  receive JSON-RPC method-not-found rather than implicit approval.
- `releaseSession`: evict an inactive, unsubscribed cache while retaining the host
  database ID; returns false for active work or pending requests.
- `getSnapshot`, `subscribe`: thread-scoped materialized events, execution,
  connection, pending requests, revision and process epoch. Updates coalesce at
  20 ms by default. Disconnection does not mean interruption.

A timeout or connection loss can leave the outcome unknown. Do not automatically
retry mutations. Reconnect/resume and inspect persisted state before new work.
Pending approvals expire across process loss. An epoch identifies the process so
clients can accept restarted revision counters and request IDs safely.

History hydration pages up to `maxTurns` (default 100) and retains bounded completed
turns; active turn content stays available. `truncated` means older history is
available through explicit pagination. Large individual outputs and an active
turn can still consume memory; display `maxItems` is not a memory limit. Hosts
should set appropriate process/session budgets and release inactive sessions.

On CLI 0.162.1 a thread without its first message is not materialized: turn
pagination returns a specific error, treated as empty history. Unsupported
pagination in other versions is surfaced as an error, with no exec fallback.

## Security boundary

Keep runtime in Node, never in the browser. Authenticate host requests, authorize
thread ownership, constrain cwd/sandbox policy and expose only needed operations.
Do not proxy arbitrary RPC, Codex configuration, environment or credentials to
clients. A browser disconnect should only unsubscribe, not close the runtime.
The playground is a loopback-only development example, not a multiuser service.

See [integration guide](https://github.com/codexview/codexview/blob/main/docs/app-server.md), including protocol and validation
limits. The Codex app-server protocol continues to evolve; validate new CLI
versions before deployment.
