# Changelog

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — unreleased

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
