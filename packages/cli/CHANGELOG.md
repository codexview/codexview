# Changelog

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.6.0] — 2026-05-28

### Added

- **Diagnostics on stderr** so silent data loss is no longer silent. The
  CLI now warns (while still exiting `0` and emitting the same markdown to
  stdout) when:
  - malformed/truncated lines were skipped —
    `warning: skipped N of M line(s) that were not valid JSON objects`;
  - the input mixes formats and only the first-detected one was rendered —
    `warning: input mixes 2 formats (claude-code: 12, rollout: 2); only
    "rollout" was rendered, other lines were dropped`;
  - a format was detected but produced no message content —
    `warning: format "claude-code" was detected but produced no message
    content`.

### Changed

- Runtime dep bumped to `@codexview/adapters@^0.6.0` (adds the
  `diagnose` / `parseJsonlWithStats` exports the warnings are built on).

### Notes

- Clean single-format sessions stay completely silent on stderr.
- Exit codes are unchanged; warnings go to stderr so piped stdout output
  is unaffected.

## [0.5.0] — 2026-05-17

### Added

- Accepts **GitHub Copilot Chat** session exports (the
  `chatSessions/<uuid>.json` files VS Code persists under
  `workspaceStorage/<hash>/`). Auto-detected; `--format
  github-copilot` for explicit override.

### Changed

- Runtime dep bumped to `@codexview/adapters@^0.4.0` (adds the
  Copilot adapter).
- `--help` and `USAGE` text list `github-copilot` as a valid
  `--format` value.

### Notes

- Existing Codex CLI / codex-team / Claude Code / OpenCode inputs
  unchanged.
- Image attachments are dropped (large image-laden Copilot sessions
  can be 100+ MB on disk because of inline byte-objects).

## [0.4.0] — 2026-05-17

### Added

- **`--subagent <path>` flag** (repeatable) for OpenCode parent
  sessions. Each path is parsed as a single JSON export; its
  `info.id` becomes the lookup key into the parent's `task`
  `state.metadata.sessionId`. Matched task calls are rendered as
  Markdown summaries (delegated to `@codexview/adapters@0.3.0`).
- Stderr hint when the parent has task calls but no matching
  `--subagent` was given:
  `note: N subagent task call(s) detected. Re-run with --subagent <child-export.json> per child to embed summaries.`
- Renderer now inlines tool outputs for `task` (OpenCode) and
  `Agent` (Claude Code) tool calls when the output begins with
  `### ` (the markdown header used by subagent summaries). Other
  tool outputs are still dropped (compact mode unchanged).
- `task` tool calls now show the task description inline in the
  compact tool line (matches existing `Agent` behavior).

### Changed

- Runtime dep bumped to `@codexview/adapters@^0.3.0` (subagents API).
- `--format` now accepts `opencode` as a value.
- Help (`-h`) text and USAGE block include the `--subagent` flag.

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
