# Changelog

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.6.0] — 2026-05-28

### Added

- **Diagnostics primitives** for detecting silent data loss when adapting
  real-world (corrupted, truncated, or concatenated) logs:
  - `parseJsonlWithStats(text)` returns `{ lines, stats }` where
    `stats: ParseStats` reports `total` / `parsed` / `malformed` line
    counts. `parseJsonl` is now a thin wrapper over it (unchanged
    signature and behaviour).
  - `classifyLine(line)` exposes the per-line format guess that
    `detectFormat` already used internally; `formatHistogram(lines)`
    returns per-format line counts (including `unknown`).
  - `diagnose({ parseStats, lines, format, events })` returns a
    `Diagnostic[]` describing malformed-line skips, mixed-format inputs
    (where only the first-detected format was rendered and the rest
    dropped), and recognized-but-empty results. Returns `[]` for a clean
    single-format session.
  - New exported types: `ParseStats`, `Diagnostic`, `DiagnosticCode`,
    `DiagnoseInput`.

### Notes

- Purely additive — no existing export changed shape, and adapter output
  is byte-for-byte identical.

## [0.5.0] — 2026-05-18

### Added

- **AgentWeb transcript adapter** (`adaptAgentWebTranscript`) for live
  hosts that merge persisted `ChatMessage[]` with an in-flight
  `StreamingState` (resolves [#1](https://github.com/codexview/codexview/issues/1)).
  Unlike the JSONL adapters, this one takes a structural options object
  (`{ sessionId, messages, streaming, now? }`) and returns
  `{ events, status, error? }` — the extra `status` and `error` feed
  directly into `<CodexTranscript status=…>`. Available as subpath
  import `@codexview/adapters/agentweb-transcript`. Not auto-detected
  by `adapt()` (it consumes live host state, not a log file).
- Input types `AgentWebMessage`, `AgentWebToolCall`,
  `AgentWebStreamingState`, `AgentWebTokenUsage`,
  `AgentWebStreamStatus`, plus a duplicated `TranscriptStatus` so
  adapters stays free of `@codexview/react`.

### Notes

- Tool mapping: `run_command` → `exec_command_begin` +
  `exec_command_end`; everything else → `function_call` +
  `function_call_output`. In-flight tools (`completed: false`) get
  the begin event but not the end event, so the open call renders
  with a running indicator until the next adapter call.
- Token usage mapping: AgentWeb `{ input, cachedInput, output }` →
  CodexView `{ inputTokens, cachedInputTokens, outputTokens }`. Usage
  is aggregated across multiple assistant rows in one turn.
- Stream lifecycle: `streaming.status` of `failed` → `turn_failed` +
  `status: 'failed'` + `error.message`; `disconnected` / `gaveUp` →
  `turn_aborted` + `status: 'stopped'`; `completed` → `turn_completed`;
  `streaming` leaves the turn open and yields `status: 'working'`.

## [0.4.0] — 2026-05-17

### Added

- **GitHub Copilot adapter** (`adaptGithubCopilot`). Reads VS Code
  Copilot Chat session JSON files (`~/Library/Application
  Support/Code/User/workspaceStorage/<hash>/chatSessions/<uuid>.json`)
  and converts to `ChatStreamEvent[]`. Auto-detected via the
  umbrella `adapt()`; available as subpath import
  `@codexview/adapters/github-copilot`.
- `DetectedFormat` union gains `'github-copilot'`.
- `AdaptGithubCopilotOptions { patchMode }` mirrors the same option
  on the Claude Code and OpenCode adapters.

### Notes

- Tool mapping: `run_in_terminal` → `exec_command_*`; edit/write tools
  (`insert_edit_into_file`, `apply_patch`, `create_file`,
  `replace_string_in_file`) → `patch_apply_end` when
  `patchMode='patch_apply_end'`, else generic `function_call`;
  MCP-sourced tools → `mcp_tool_*`; everything else → generic
  `function_call`. Per file-tool-first-class-decision (2026-05-17),
  file-read tools stay generic.
- Image attachments in `variableData.variables[]` are dropped (same
  policy as Claude Code).
- No subagent model in Copilot agent mode — no `subagents` option.

## [0.3.0] — 2026-05-17

### Added

- **OpenCode subagent embedding** via new `subagents` option on
  `adaptOpenCode`. New exported type `OpenCodeSubagentInput`
  (`{ sessionId, lines }`). When a parent's `task` tool call's
  `state.metadata.sessionId` matches a provided child, the call's
  output is rewritten to a Markdown summary (description,
  agent_type, tools used, tokens, final reply). Pairing is
  deterministic 1:1 — no fallback queue (the parent task's
  `metadata.sessionId` is always equal to the child's `info.id`
  by construction, per OpenCode's session schema).
- Mirrors Claude Code's existing `subagents` option but with a
  cleaner pairing rule (no `agentId` / mtime FIFO fallback needed).

### Changed

- Umbrella `AdaptOptions` no longer extends both adapter option
  interfaces (Claude Code's `SubagentInput` and OpenCode's
  `OpenCodeSubagentInput` have incompatible required fields).
  It now declares `subagents?: SubagentInput[] | OpenCodeSubagentInput[]`
  and `patchMode?` directly. Each adapter ignores the wrong shape at
  lookup time, so passing either is safe. **Source compatibility
  unchanged for normal callers.**

### Backwards compatibility

- `adaptOpenCode` option default is `undefined`, producing byte-identical
  output to 0.2.0 (regression-locked by existing tests).

## [0.2.0] — 2026-05-17

### Added

- New source format: **OpenCode** (sst/opencode session exports).
  - `DetectedFormat` union gains `'opencode'`.
  - `detectFormat` recognizes the `{ info: { id: 'ses_…' }, messages: [...] }`
    top-level shape produced by `opencode export <sessionID>`.
  - `adaptOpenCode(lines, options?)` and umbrella subpath import
    `@codexview/adapters/opencode`. Wraps the single-JSON document
    in a one-element `RawLine[]` for API parity.
  - `AdaptOpenCodeOptions.patchMode` ('function_call' default | 'patch_apply_end')
    mirrors the Claude Code adapter — cli stays compact, playground
    can opt into diff rendering.
  - Part mapping:
    - `text` → `user_message` / `agent_message`
    - `reasoning` → `reasoning` event
    - `step-start` / `step-finish` → dropped (boundary markers)
    - `tool` discriminated by `tool` field:
      - `bash` → `exec_command_begin` + `exec_command_end` (atomic;
        OpenCode bundles input + output in the same part)
      - `edit` / `write` → fallback or `patch_apply_end` per option
      - any other (`read` / `glob` / `grep` / …) → opaque
        `function_call` + `function_call_output`

### Notes

- New types exported: `AdaptOpenCodeOptions`, `adaptOpenCode`.
- The `AdaptOptions` umbrella type extends both
  `AdaptClaudeCodeOptions` and `AdaptOpenCodeOptions` so the same
  `patchMode` flag controls both adapters.
- Anonymized fixture: `fixtures/opencode/session-short.json`.
- Tests: 12 new in `opencode.test.ts`; adapters suite 46 / 46.
- Recommended consumer prerequisite (playground / cli): the
  `opencode` binary on `$PATH` and at least one session exported.

### Path α justification

We picked the CLI-based path over direct SQLite reads — see
docs/superpowers/specs/2026-05-17-opencode-adapter-design.md for
the full table. Briefly: zero runtime deps, decoupled from
sst/opencode's schema migrations, built-in `--sanitize` for fixture
generation, and an OpenCode user definitionally has the CLI
installed already.

## [0.1.1] — 2026-05-17

### Added

- Claude Code `WebSearch` tool is now parsed structurally:
  - `tool_use` → `web_search_call` event with the query and callId.
  - `tool_result` → `Links: [...]` JSON array is extracted and emitted
    as a `web_search_end` event with a typed `SearchResult[]` (title +
    url). The free-form summary paragraph that follows `Links:` is
    dropped — the structured list is what consumer UIs use.

### Notes

- Failure-safe: if `Links:` parse fails, the line is missing, or
  `is_error: true`, the adapter falls through to the existing
  `function_call_output` path — no regression for sessions without
  WebSearch.
- No API change. Sessions that don't use WebSearch produce
  bit-for-bit identical output to 0.1.0.
- cli's `"@codexview/adapters": "^0.1.0"` dependency range picks this
  patch up automatically on next install; no cli/react bump needed.

## [0.1.0] — 2026-05-17

### Added

- First real release. Replaces the npm placeholder `0.0.1`.
- `adapt(lines, options?)` umbrella entry with auto format detection.
- Per-source subpath imports: `@codexview/adapters/{claude-code,rollout,codex-team}`.
- `adaptClaudeCode` supports two opt-in options:
  - `patchMode: 'function_call' | 'patch_apply_end'` — choose between
    cli-style compact output (default) or playground-style diff rendering.
  - `subagents` — when supplied, each `Agent` tool call's `tool_result`
    is rewritten to embed a Markdown summary (description, agent type,
    tool counts, token totals, final reply). Pairing primary key is
    `toolUseResult.agentId`; FIFO fallback handles missing/mismatched ids.
- `parseJsonl(text)` helper that tolerates blank lines and malformed rows.
- TypeScript types: `ChatStreamEvent`, `DetectedFormat`, `RawLine`,
  `TokenUsage`, `SearchResult`, `PatchFile`, `TodoEntry`,
  `AdaptOptions`, `AdaptClaudeCodeOptions`, `SubagentInput`.

### Notes

- Zero runtime dependencies. ESM only. Node ≥ 20.
- Adapter implementations are extracted from the previously private
  `playground/adapter.mjs` (in `@codexview/react`) and from the cli's
  internal `cli/src/adapter/` (now removed in cli 0.2.0). Behavior is
  preserved bit-for-bit when called with default options.
- Published via GitHub Actions OIDC trusted publishing with provenance
  attestation.
