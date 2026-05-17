# Changelog

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
