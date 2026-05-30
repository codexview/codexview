# Changelog

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.2] — 2026-05-30

### Added

- `<CodexTranscript>` now renders a lightweight tail prompt while the
  transcript status is `working`, so live viewers see the active marker at
  the end of the log as well as in the top status bar.

### Playground

- Codex rollout sessions that are still being written are detected as live,
  polled automatically, and shown with `live: yes`.
- The Narrative playground view mirrors the same tail prompt.

## [0.3.1] — 2026-05-18

### Documentation

- `docs/styling.md` token defaults updated to match the new warm-paper light palette (`#faf6ef` / `#3a342c` / `#e8c5b3` / `#2c2620`).
- `docs/api.md` adds the `<ToolGroup>` reference and the new public exports (`partitionForGrouping`, `summarizeToolGroup`, `isGroupableKind`, `ToolGroupProps`, `ToolGroupSlice`).
- README highlights the turn-level tool aggregation behavior introduced in 0.3.0.

### Notes

- No code changes; doc-only release synchronized with the 0.3.0 binary.

## [0.3.0] — 2026-05-18

### Added

- New `<ToolGroup>` component aggregates consecutive tool-like items inside a turn (`tool_call`, `exec`, `search`, `patch`, `todo_list`, `raw`) into a single collapsible block. Title is computed from the item-kind counts in Chinese (e.g. `更新待办、执行 9 个命令、调用 4 个工具`).
- Items that act as natural break points — `user_message`, `assistant_text`, `reasoning`, `error` — remain rendered standalone. Errors stay prominent.
- Each item inside a group keeps its own `<details>`, so a reader can drill into one call without expanding the whole turn. Groups auto-expand while any contained item is `pending` / `running`.
- Exports: `ToolGroup`, `ToolGroupProps`, `ToolGroupSlice`, `partitionForGrouping`, `summarizeToolGroup`, `isGroupableKind`.
- `ToolGroup` added to `CodexTranscriptComponents` — consumers can replace it.

### Changed

- `CodexTranscript` now partitions each turn's items via `partitionForGrouping()` before rendering. Single (non-tool) items render exactly as before; consecutive tool items render inside a `<ToolGroup>`.

## [0.2.3] — 2026-05-18

### Changed

- Collapsed `<ExecBlock>` and `<ToolCallBlock>` header rows now constrain their command / title text to one line with `text-overflow: ellipsis`. Long absolute paths in shell commands and long mcp-style tool names no longer let "collapsed" rows wrap into two or three lines. Opening the block restores wrap so the full text is visible.

## [0.2.2] — 2026-05-18

### Changed

- Softer user bubble: `--cv-bg-user-bubble` lightened from terracotta `#b8694a` to peach `#e8c5b3`, with `MessageBubble` switching user-bubble text to `--cv-text` (deep ink brown) for an "ink on warm paper" look. Contrast remains ≥ 7.5:1 (AAA).
- Collapsed-state visuals for `<ToolCallBlock>`, `<ExecBlock>`, `<TodoListBlock>`, `<RawEventBlock>` are now transparent — only a status-colored left-border and title row are visible. Expanding restores the filled panel (border + raised background). Consecutive tool calls now read as a clean outline rather than stacked color blocks.

## [0.2.1] — 2026-05-18

### Changed

- New default light palette ("warm paper"): ivory page background, deep ink-brown text, terracotta user-bubble accent, sage / vermillion status colors, warm-ink (not cold-black) code blocks. All defaults driven via existing `--cv-*` tokens — no component changes, no new token names. Consumers who relied on the exact previous defaults (`#ffffff` / `#1f2328` / `#2f6feb` / `#0d1117`) can pin them back with a `<style>` block.

## [0.2.0] — 2026-05-17

### Changed

- Repo restructured as a pnpm workspace monorepo (`packages/react`, `packages/cli`, `packages/adapters`). No `@codexview/react` API change — source under `packages/react/src/` is bit-for-bit identical to 0.1.4. Re-published to keep semver in step with the parallel cli + adapters releases.

### Notes

- The reference Claude Code adapter that lived under `playground/adapter.mjs` has moved into the new [`@codexview/adapters`](https://www.npmjs.com/package/@codexview/adapters) package and gained two opt-in options (`patchMode`, `subagents`). The playground in this repo now re-exports from that package; external consumers can install it alongside `@codexview/react`.
- No code changes are required to upgrade from 0.1.4 — re-installation only.

## [0.1.4] — 2026-05-17

### Changed

- Reference Claude Code adapter (`playground/adapter.mjs`) now associates `Agent` tool calls with their subagent transcripts (`~/.claude/projects/<repo>/<sessionId>/subagents/agent-*.jsonl`). The subagent's description, agent type, tool-use counts, token totals, and final reply are embedded as Markdown in the parent `Agent` tool's `function_call_output` panel.

### Notes

- No library API or runtime change in `@codexview/react`. The feature lives entirely in the playground reference adapter.
- Pairing strategy: primary key is the parent's `toolUseResult.agentId`; secondary fallback is FIFO over subagent files in mtime order (covers legacy/format-drift cases).

## [0.1.3] — 2026-05-16

### Documentation

- README now reflects multi-source support: the library renders `ChatStreamEvent[]` and reference adapters in `playground/adapter.mjs` cover OpenAI Codex CLI rollouts, AgentWeb codex-team status logs, and Claude Code main sessions (Bash / TodoWrite / Edit / Write / MultiEdit / `mcp__*`).
- Fixed install snippet — package name is `@codexview/react`, not `codexview`.
- Refined `package.json` description to match the new reality.

### Fixed

- `VERSION` export was stuck at `'0.1.1'`; now matches `package.json`.

### Notes

- No library API or runtime behavior changes. The Claude Code adapter ships as a reference implementation under `playground/` and is not yet exported from `@codexview/react`.

## [0.1.2] — 2026-05-15

### Changed

- First release published via GitHub Actions OIDC trusted publishing (no
  long-lived NPM token; provenance attestation included).

## [0.1.1] — 2026-05-15

### Added

- New item kinds aligned with the official [OpenAI Codex SDK](https://github.com/openai/codex/tree/main/sdk/typescript):
  - `todo_list` — plan / TODO list with completion tracking; new `<TodoListBlock>` component
  - `error` — non-fatal item-level error (distinct from `turn_failed`); new `<ErrorBlock>` component
- `<Markdown>` component (powered by `react-markdown` + `remark-gfm`): tables, task lists, autolinks, inline code, fenced code blocks, blockquotes
- Markdown rendering integrated into `MessageBubble`, `ReasoningBlock`, and `ToolCallBlock` (string-typed results auto-detected as Markdown)
- New event types: `todo_list`, `error_item`
- New exported types: `TodoEntry`, `MarkdownProps`, `TodoListBlockProps`, `ErrorBlockProps`

### Changed

- All tool-related blocks (`ToolCallBlock`, `ExecBlock`, `SearchBlock`, `PatchBlock`) are now collapsed by default. They auto-open while their status is `pending` or `running`. New `defaultOpen` prop available on each.
- `MessageBubble` and `ReasoningBlock` accept a `markdown` prop (default `true`) to render text as Markdown. Streaming partial text falls back to plain text until completion to avoid janky partial-Markdown rendering.

### Dependencies

- Added: `react-markdown` `^10.1.0`, `remark-gfm` `^4.0.1`

## [0.1.0] — 2026-05-15

### Added

- `<CodexTranscript>` main component (consumes `ChatStreamEvent[]`)
- Subcomponents: `StatusBar`, `TurnContainer`, `MessageBubble`, `ReasoningBlock`, `ToolCallBlock`, `ExecBlock`, `SearchBlock`, `PatchBlock`, `RawEventBlock`, `ItemErrorBoundary`
- Hooks: `useCodexTranscript`, `useSmoothStream`
- Pure functions: `reduceTranscript`, `inferStatus`, `EMPTY_MODEL`
- 8 supported event item kinds + raw fallback for unknown types
- 5-state item status machine, 4-state turn status machine, 5-state session status
- CSS Modules styling with overridable CSS variables
- `lucide-react` icon system as peerDependency
- `prefers-reduced-motion` honored by all animations
- 6 fixtures + replay integration tests
- Docs: API reference, event contract, styling, agentweb integration guide
