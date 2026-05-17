# Changelog

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
