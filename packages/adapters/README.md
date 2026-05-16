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
// format: 'rollout' | 'codex-team' | 'claude-code' | 'unknown'
```

### Per-source (tree-shakeable)

```ts
import { adaptClaudeCode } from '@codexview/adapters/claude-code';
import { adaptRollout }    from '@codexview/adapters/rollout';
import { adaptCodexTeam }  from '@codexview/adapters/codex-team';

const events = adaptClaudeCode(lines);
```

## Supported formats

| Format        | Detection                                      | Typical file location                                              |
|---------------|------------------------------------------------|--------------------------------------------------------------------|
| `claude-code` | first line has `sessionId`                     | `~/.claude/projects/<repo>/<sessionId>.jsonl`                      |
| `rollout`     | first line has `type: 'thread_started'`        | `~/.codex/sessions/.../rollout-*.jsonl`                            |
| `codex-team`  | first line has `event` + `at`                  | `~/Projects/agentweb/.codex-team/runs/*/events.jsonl`              |

## adapt() options

```ts
adapt(lines, {
  format?: 'rollout' | 'codex-team' | 'claude-code',  // skip detection
  patchMode?: 'function_call' | 'patch_apply_end',    // Claude Code only
  subagents?: SubagentInput[],                        // Claude Code only
});
```

- **`format`** — skip `detectFormat()` and use the given format directly.
- **`patchMode`** — controls how Claude Code's `Edit` / `Write` / `MultiEdit` tool calls are rendered.
  - `'function_call'` (default) — emit as opaque `function_call` entries. Matches the cli's compact output.
  - `'patch_apply_end'` — defer until the matching `tool_result`, then emit a `patch_apply_end` with a synthesized `PatchFile[]` containing diff text. Use when downstream rendering (e.g. `<PatchBlock>`) needs the diff.
- **`subagents`** — list of Claude Code subagent transcripts associated with this session. When supplied, each `Agent` tool's `tool_result` is rewritten to embed a Markdown summary of the matching subagent (description, agent type, tool counts, token totals, final reply). Pairing strategy: primary by `toolUseResult.agentId` on the parent's user-type `tool_result` line; FIFO fallback over unconsumed entries.

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
