# Changelog

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
