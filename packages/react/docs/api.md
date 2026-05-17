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

### `<ToolGroup>` _(since 0.3.0)_

```tsx
<ToolGroup items={consecutiveToolItems} defaultOpen?={boolean}>
  {/* pre-rendered children, one per item, in order */}
</ToolGroup>
```

`<CodexTranscript>` wires this in automatically: each turn's items are partitioned via [`partitionForGrouping`](#partitionforgroupingitems--slice) and consecutive `tool_call` / `exec` / `search` / `patch` / `todo_list` / `raw` items are wrapped in one `<ToolGroup>`. Messages, reasoning, and errors act as break points (errors stay prominent).

| Prop | Default | Notes |
|------|---------|-------|
| `items` | required | The grouped items, used to compute the summary title. |
| `children` | required | Pre-rendered child blocks, one per `items[i]`, in order. |
| `defaultOpen` | `false` | Group starts collapsed. Always opens while any contained item is `pending` / `running`, regardless of this prop. |

Title is auto-generated from the item-kind counts, e.g. `更新待办、执行 9 个命令、调用 4 个工具`. Override by passing your own component via `<CodexTranscript components={{ ToolGroup: MyGroup }} />`.

### `<ToolCallBlock>`

```tsx
<ToolCallBlock item={toolCallItem} defaultOpen?={boolean} />
```

Renders args inline; result inline if small, collapsed in `<details>` if long (`>500` chars, `>4` lines, or `>3` JSON depth). Defaults to collapsed; auto-opens while `pending` / `running`. Header is single-line ellipsized when closed (since 0.2.3).

### `<ExecBlock>`

```tsx
<ExecBlock item={execItem} defaultOpen?={boolean} />
```

Shimmer bar shown while `status === 'running'`. stdout/stderr collapsed beyond size threshold. Closed header is single-line ellipsized — long absolute paths in `$ ...` commands no longer wrap; opening restores wrap (since 0.2.3).

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

### `partitionForGrouping(items) => Slice[]` _(since 0.3.0)_

Splits a flat `ItemView[]` into slices for `<ToolGroup>` rendering.

```ts
type Slice =
  | { kind: 'single'; item: ItemView }       // render as before
  | { kind: 'group';  items: ItemView[] };    // wrap children in <ToolGroup>
```

Consecutive groupable kinds (`tool_call`, `exec`, `search`, `patch`, `todo_list`, `raw`) collapse into one `group` slice; non-groupable kinds (`user_message`, `assistant_text`, `reasoning`, `error`) become `single` slices and act as break points.

### `summarizeToolGroup(items) => string` _(since 0.3.0)_

Returns the human-readable Chinese summary used as a `<ToolGroup>` title — e.g. `更新待办、执行 2 个命令、修改 1 个文件`. Each kind appears once with its count; order is fixed for stable phrasing.

### `isGroupableKind(kind) => boolean` _(since 0.3.0)_

Returns `true` for the six kinds that get aggregated into a `<ToolGroup>`.

### `EMPTY_MODEL`

Frozen initial `TranscriptModel`. Always safe to start reducing from this.

## Types

`ChatStreamEvent`, `ChatStreamEventType`, `TokenUsage`, `SearchResult`, `PatchFile`, `TranscriptModel`, `TurnView`, `ItemView`, `ItemKind`, `ItemStatus`, `TranscriptStatus`, `CodexTranscriptComponents`, `UseCodexTranscriptOptions`, `UseSmoothStreamOptions`, `ToolGroupProps`, `ToolGroupSlice`, plus per-component prop types (`StatusBarProps`, etc.).

See [docs/events.md](events.md) for the full `ChatStreamEvent` shape.
