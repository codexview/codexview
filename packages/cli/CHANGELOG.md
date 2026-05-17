# Changelog

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.1] — 2026-05-17

### Fixed

- `0.2.0` and `0.3.0` were published with the literal `workspace:*`
  string in their `dependencies."@codexview/adapters"`, which made
  `npm install @codexview/cli` fail to resolve the dep. Republished
  via `pnpm publish` so the workspace protocol is replaced with the
  concrete published adapters version (`0.2.0`). Functionality
  unchanged.

## [0.3.0] — 2026-05-17

### Added

- Accepts **OpenCode** session exports (single JSON document, output
  of `opencode export <sessionID>`). Auto-detected; no flag needed.
- New internal `parseInput()` helper: tries whole-text JSON.parse
  first (for OpenCode and other single-document formats), falls
  through to `parseJsonl` for the existing line-delimited sources.

### Changed

- Runtime dep bumped to `@codexview/adapters@^0.2.0` (which adds the
  OpenCode adapter).

### Notes

- Existing Codex CLI / codex-team / Claude Code inputs unchanged.
- Usage example:
  ```bash
  opencode export ses_… | codexview-md - > transcript.md
  # or with a saved file
  codexview-md /path/to/opencode-session.json
  ```

## [0.2.0] — 2026-05-17

### Changed

- Internal: cli's local copy of the adapter implementation
  (`src/adapter/`, `src/types.ts`, `src/parse.ts`) has been removed.
  Adapter logic now sourced from [`@codexview/adapters`](https://www.npmjs.com/package/@codexview/adapters)
  (added as a runtime dependency). Output is bit-for-bit identical to
  0.1.1 because cli still calls `adapt(lines)` with no options
  (defaults `patchMode='function_call'`, no subagent embedding).

### Notes

- The cli no longer ships "zero runtime dependencies" — it now has
  one: `@codexview/adapters` (itself zero-runtime-dep). Installation
  surface goes from one package to two, total tarball stays small.
- No CLI flag or behavior change. Upgrade is a drop-in replacement.

## [0.1.1] — 2026-05-17

### Changed

- First release via GitHub Actions OIDC trusted publishing (no long-lived
  NPM_TOKEN; provenance attestation included).

## [0.1.0] — 2026-05-17

### Added

- Initial `codexview-md` CLI: convert Codex CLI rollouts, AgentWeb
  codex-team status logs, or Claude Code main sessions into compact
  plaintext markdown suitable as compressed context for another LLM.
- Flags: `-o <file>`, `-`/stdin, `--format <name>`, `-v`/`--version`,
  `-h`/`--help`.
- Output rules: tool calls collapsed to 80-char single-line summaries,
  tool outputs dropped, reasoning rendered as blockquotes.
