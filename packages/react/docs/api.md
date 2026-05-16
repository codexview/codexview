# API Reference

All exports from `codexview`. Import via `import { ... } from 'codexview'`.

## Components

### `<CodexTranscript>`

Top-level transcript renderer.

```tsx
<CodexTranscript
  events={events}
  status?={status}
  error?={{ message, details? }}
  className?={string}
  maxItems?={number}
  emptyState?={ReactNode}
  onItemClick?={(id) => void}
  components?={Partial<CodexTranscriptComponents>}
  disableSmoothStream?={boolean}
  onInternalError?={(err, event?) => void}
/>
```

| Prop | Default | Notes |
|------|---------|-------|
| `events` | required | Append-only is most efficient; full replace also works. Reference equality skips re-reduce. |
| `status` | inferred | When provided, fully replaces `inferStatus(model)`. |
| `error` | undefined | Shown inside `StatusBar` when status is `failed` or `stopped`. |
| `className` | undefined | Appended to `.codexview-root` class list. |
| `maxItems` | unlimited | Trims oldest items, shows "已省略最早的 X 条" hint at the top. |
| `emptyState` | `'暂无对话'` | Rendered when `events` is empty. |
| `onItemClick` | undefined | Receives `item.id` of the clicked item. |
| `components` | builtin | Replace any subcomponent (e.g. `{ ToolCallBlock: MyTool }`). |
| `disableSmoothStream` | `false` | Disables the typewriter effect for `assistant_text` and `reasoning`. |
| `onInternalError` | undefined | Called when reducer or item render throws; component falls back without crashing. |

#### Minimal example

```tsx
const events = useAtomValue(streamingAtomFamily(sessionId));
return <CodexTranscript events={events.list} />;
```

### `<StatusBar>`

```tsx
<StatusBar status={status} label?={string} error?={{ message, details? }} />
```

Returns `null` when `status === 'idle'`.

### `<TurnContainer>`

```tsx
<TurnContainer turn={turn}>{children}</TurnContainer>
```

### `<MessageBubble>`

```tsx
<MessageBubble item={userOrAssistantItem} smoothStream?={boolean} />
```

### `<ReasoningBlock>`

```tsx
<ReasoningBlock item={reasoningItem} defaultOpen?={boolean} smoothStream?={boolean} />
```

### `<ToolCallBlock>`

```tsx
<ToolCallBlock item={toolCallItem} />
```

Renders args inline; result inline if small, collapsed in `<details>` if long (`>500` chars, `>4` lines, or `>3` JSON depth).

### `<ExecBlock>`

```tsx
<ExecBlock item={execItem} />
```

Shimmer bar shown while `status === 'running'`. stdout/stderr collapsed beyond size threshold.

### `<SearchBlock>`

```tsx
<SearchBlock item={searchItem} initialVisible?={number} />
```

Shows first 3 results by default; "展开剩余 N 条" reveals the rest.

### `<PatchBlock>`

```tsx
<PatchBlock item={patchItem} />
```

Each file is collapsed; expanding shows diff with git-style coloring.

### `<RawEventBlock>`

```tsx
<RawEventBlock item={rawItem} />
```

Used as fallback for unknown event types.

### `<ItemErrorBoundary>`

```tsx
<ItemErrorBoundary fallback?={ReactNode} onError?={(err, info) => void}>
  {children}
</ItemErrorBoundary>
```

## Hooks

### `useCodexTranscript(events, options?)`

```ts
const { model, status } = useCodexTranscript(events, { status?, onInternalError? });
```

Internally caches the last reduced model and uses prefix detection for incremental reduction.

### `useSmoothStream(text, options?)`

```ts
const display = useSmoothStream(fullText, { enabled?, charsPerFrame?, minDelayMs? });
```

Returns the substring revealed so far. Resets when input shrinks. Returns full text immediately if `enabled === false` or `prefers-reduced-motion: reduce`.

## Pure functions

### `reduceTranscript(prev, event) => next`

Pure reducer. Use directly to drive your own state container.

### `inferStatus(model) => TranscriptStatus`

Returns `'idle' | 'working' | 'completed' | 'stopped' | 'failed'`.

### `EMPTY_MODEL`

Frozen initial `TranscriptModel`. Always safe to start reducing from this.

## Types

`ChatStreamEvent`, `ChatStreamEventType`, `TokenUsage`, `SearchResult`, `PatchFile`, `TranscriptModel`, `TurnView`, `ItemView`, `ItemKind`, `ItemStatus`, `TranscriptStatus`, `CodexTranscriptComponents`, `UseCodexTranscriptOptions`, `UseSmoothStreamOptions`, plus per-component prop types (`StatusBarProps`, etc.).

See [docs/events.md](events.md) for the full `ChatStreamEvent` shape.
