# @codexview/adapters

Stateless adapters that convert AI coding agent transcript logs into the [`@codexview/react`](https://www.npmjs.com/package/@codexview/react) `ChatStreamEvent` schema.

Zero runtime dependencies, ESM only, Node ≥ 20.

## Install

```bash
pnpm add @codexview/adapters
```

## Use

### Auto-detect (umbrella entry)

```ts
import { readFileSync } from 'node:fs';
import { adapt, parseJsonl } from '@codexview/adapters';

const lines = parseJsonl(readFileSync('rollout-xyz.jsonl', 'utf8'));
const { format, events } = adapt(lines);
// format: 'codex-exec' | 'rollout' | 'codex-team' | 'claude-code'
//       | 'opencode' | 'github-copilot' | 'unknown'
```

### Per-source (tree-shakeable)

```ts
import { adaptClaudeCode } from '@codexview/adapters/claude-code';
import { adaptCodexExec }  from '@codexview/adapters/codex-exec';
import { adaptRollout }    from '@codexview/adapters/rollout';
import { adaptCodexTeam }  from '@codexview/adapters/codex-team';

const events = adaptClaudeCode(lines);
```

## Supported formats

| Format        | Detection                                      | Typical file location                                              |
|---------------|------------------------------------------------|--------------------------------------------------------------------|
| `codex-exec`  | documented dotted events such as `thread.started` | output of `codex exec --json ...`                               |
| `rollout`     | `session_meta` / `event_msg` / `response_item` | `~/.codex/sessions/.../rollout-*.jsonl`                            |
| `claude-code` | first line has `sessionId`                     | `~/.claude/projects/<repo>/<sessionId>.jsonl`                      |
| `codex-team`  | first line has `event` + `at`                  | `~/Projects/agentweb/.codex-team/runs/*/events.jsonl`              |

`codex-exec` is the stable machine-readable stream documented by Codex. A
saved `rollout` is the richer session-persistence format and remains a
separate compatibility adapter. The exec stream does not include the original
prompt or timestamps; `adaptCodexExec` therefore synthesizes turn ids and
monotonic line-index event times starting at zero. Pass `{ startAt }` when a
different base timestamp is useful to the host.

The normalized `exec_command_end` contract currently requires a numeric exit
code. A Codex command that is declined or otherwise ends without an exit code
is represented with exit code `1`; this intentionally preserves failure
semantics but cannot distinguish a decline from a process failure.

## Live-host adapter: AgentWeb transcript

Apps that store chat history in a database and stream new turns live (rather
than reading a JSONL log) need to merge two sources into one `ChatStreamEvent`
stream. `adaptAgentWebTranscript` does that bridge for hosts shaped like
[AgentWeb](https://github.com/codexview/codexview/issues/1) — persisted
`ChatMessage[]` plus an in-flight `StreamingState`.

```ts
import { adaptAgentWebTranscript } from '@codexview/adapters/agentweb-transcript';
import { CodexTranscript } from '@codexview/react';

const { events, status, error } = adaptAgentWebTranscript({
  sessionId,           // → thread_started.threadId
  messages,            // ChatMessage[] from your DB
  streaming,           // StreamingState atom (or null)
  // now,              // optional clock override for tests
});

<CodexTranscript events={events} status={status} />
```

Input shapes (`AgentWebMessage`, `AgentWebStreamingState`, `AgentWebToolCall`)
are structural — adapters has no AgentWeb dependency. The adapter:

- emits `thread_started` for `sessionId` and synthesizes `turn_started` /
  `turn_completed` boundaries around each `turnId` group;
- preserves the same `turnId` across user message → live partial assistant
  text → final persisted assistant row so they render in one turn;
- maps `run_command` tool calls to `exec_command_begin` + `exec_command_end`,
  and everything else to `function_call` + `function_call_output`;
- maps AgentWeb `{ input, cachedInput, output }` to CodexView `TokenUsage`;
- surfaces `streaming.status = 'failed' | 'disconnected' | 'gaveUp'` as
  `turn_failed` / `turn_aborted` events plus a `TranscriptStatus` (`working`,
  `failed`, `stopped`, `completed`, `idle`) on the result.

In-flight tool calls (`completed: false`) get their `_begin` event but no
`_end` — the open call renders with a running indicator until the next adapter
call sees the completed shape. Approval / reconnect / gave-up UI stays
host-owned and renders next to `<CodexTranscript>`.

## adapt() options

```ts
adapt(lines, {
  format?: 'codex-exec' | 'rollout' | 'codex-team' | 'claude-code' | 'opencode' | 'github-copilot',
  startAt?: number,                                   // Codex exec JSONL only
  patchMode?: 'function_call' | 'patch_apply_end',    // Claude Code only
  subagents?: SubagentInput[],                        // Claude Code only
  closeOpenTurn?: boolean,                            // Codex rollout only
});
```

- **`format`** — skip `detectFormat()` and use the given format directly.
- **`startAt`** — base timestamp for a Codex exec JSONL stream, whose wire
  events have no timestamps. Defaults to `0` for deterministic output.
- **`patchMode`** — controls how Claude Code's `Edit` / `Write` / `MultiEdit` tool calls are rendered.
  - `'function_call'` (default) — emit as opaque `function_call` entries. Matches the cli's compact output.
  - `'patch_apply_end'` — defer until the matching `tool_result`, then emit a `patch_apply_end` with a synthesized `PatchFile[]` containing diff text. Use when downstream rendering (e.g. `<PatchBlock>`) needs the diff.
- **`subagents`** — list of Claude Code subagent transcripts associated with this session. When supplied, each `Agent` tool's `tool_result` is rewritten to embed a Markdown summary of the matching subagent (description, agent type, tool counts, token totals, final reply). Pairing strategy: primary by `toolUseResult.agentId` on the parent's user-type `tool_result` line; FIFO fallback over unconsumed entries.
- **`closeOpenTurn`** — controls Codex rollout EOF behavior. Defaults to `true` for static files, preserving the historical behavior of synthesizing `turn_completed` if the log ends mid-turn. Set to `false` when tailing a currently-written rollout so the final turn remains `working` until a real `task_complete` / abort event appears.

```ts
interface SubagentInput {
  agentId: string;
  meta?: { agentType?: string; description?: string } | null;
  lines: unknown[];   // raw JSONL rows from agent-<agentId>.jsonl
}
```

## Versioning

Independent semver from `@codexview/react`. The two packages share no runtime dependencies; the `ChatStreamEvent` types are duplicated and kept in sync by a CI guard (planned).

## License

MIT.
