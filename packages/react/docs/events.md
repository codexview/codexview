# Event contract

CodexView consumes a discriminated union `ChatStreamEvent`. The host (e.g. agentweb backend) is expected to emit events that match these shapes. Unknown event types are not errors — they fall through to `kind: 'raw'` and render via `RawEventBlock`.

All events carry `at: number` (epoch ms).

## Lifecycle

| Type | Required fields | Reducer effect |
|------|-----------------|----------------|
| `thread_started` | `threadId` | sets `model.threadId` |
| `turn_started` | `turnId` | appends new `TurnView { status: 'running' }` |
| `turn_completed` | `turnId`, optional `usage` | turn → `completed`; flips unfinished items → `completed` |
| `turn_failed` | `turnId`, `error: { message, code? }` | turn → `failed`; flips unfinished items → `failed` |
| `turn_aborted` | `turnId`, optional `reason` | turn → `aborted`; flips unfinished items → `stopped` |

## Messages

| Type | Required fields | ItemView produced |
|------|-----------------|-------------------|
| `user_message` | `turnId`, `itemId`, `text` | `kind: 'user_message'`, status `completed` |
| `agent_message` | `turnId`, `itemId`, `text`, `partial`, optional `phase` | `kind: 'assistant_text'`; same `itemId` updates in place; `partial: false` flips to `completed`; Codex `commentary` / `final_answer` phase is preserved |
| `reasoning` | same as `agent_message` | `kind: 'reasoning'`; **never merged** with assistant_text |

## Tool calls (paired by `callId`)

| Type | Required fields | Reducer effect |
|------|-----------------|----------------|
| `function_call` | `turnId`, `callId`, `name`, `args` | appends `tool_call`, status `pending` |
| `function_call_output` | `turnId`, `callId`, optional `output` or `error` | finds matching `tool_call`, sets `result` or `error`, flips status |
| `mcp_tool_call` | `turnId`, `callId`, `server`, `name`, `args` | same as `function_call` plus `server` |
| `mcp_tool_call_output` | `turnId`, `callId`, optional `output` or `error` | same as `function_call_output` |

## Shell exec

| Type | Required fields | Reducer effect |
|------|-----------------|----------------|
| `exec_command_begin` | `turnId`, `callId`, `command` | appends `exec`, status `running` |
| `exec_command_end` | `turnId`, `callId`, `exit`, `stdout`, `stderr`, `durationMs` | finds matching `exec`, fills outputs, status `completed` if `exit === 0` else `failed` |

## Web search

| Type | Required fields | Reducer effect |
|------|-----------------|----------------|
| `web_search_call` | `turnId`, `callId`, `query` | appends `search`, status `pending` |
| `web_search_end` | `turnId`, `callId`, `results: SearchResult[]` | finds matching `search`, fills results, status `completed` |

## Patch apply

| Type | Required fields | Reducer effect |
|------|-----------------|----------------|
| `patch_apply_end` | `turnId`, `callId`, `files: PatchFile[]`, `ok: boolean` | appends `patch`, status `completed` if `ok` else `failed` |

## Fallback

| Type | Required fields | Reducer effect |
|------|-----------------|----------------|
| `raw` | optional `turnId`, `payload: unknown` | if `turnId` present, appends `raw` ItemView; else only updates `lastEventAt` |

## Invariants

1. Reducer never throws on any input.
2. Bulk `events.reduce(reduceTranscript, EMPTY_MODEL)` equals incremental reduce of the same series.
3. Reducer is a pure function — no global state, no I/O.
4. Unknown payload `type` is preserved verbatim in the produced `raw` ItemView.
