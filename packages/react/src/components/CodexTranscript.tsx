import { Fragment, useCallback, type ComponentType, type ReactNode } from 'react';
import type { ChatStreamEvent } from '../types/events.js';
import type { ItemView, TranscriptStatus, TurnView } from '../types/model.js';
import { useCodexTranscript } from '../hooks/useCodexTranscript.js';
import { ItemErrorBoundary } from './ItemErrorBoundary.js';
import { TurnContainer } from './TurnContainer.js';
import { MessageBubble, type MessageBubbleProps } from './MessageBubble.js';
import { ReasoningBlock, type ReasoningBlockProps } from './ReasoningBlock.js';
import { ToolCallBlock, type ToolCallBlockProps } from './ToolCallBlock.js';
import { ExecBlock, type ExecBlockProps } from './ExecBlock.js';
import { SearchBlock, type SearchBlockProps } from './SearchBlock.js';
import { PatchBlock, type PatchBlockProps } from './PatchBlock.js';
import { TodoListBlock, type TodoListBlockProps } from './TodoListBlock.js';
import { ErrorBlock, type ErrorBlockProps } from './ErrorBlock.js';
import { RawEventBlock, type RawEventBlockProps } from './RawEventBlock.js';
import { StatusBar, type StatusBarProps } from './StatusBar.js';
import { ToolGroup, type ToolGroupProps, partitionForGrouping } from './ToolGroup.js';
import resetStyles from '../styles/reset.module.css';
import styles from './CodexTranscript.module.css';

export interface CodexTranscriptComponents {
  StatusBar: ComponentType<StatusBarProps>;
  MessageBubble: ComponentType<MessageBubbleProps>;
  ReasoningBlock: ComponentType<ReasoningBlockProps>;
  ToolCallBlock: ComponentType<ToolCallBlockProps>;
  ExecBlock: ComponentType<ExecBlockProps>;
  SearchBlock: ComponentType<SearchBlockProps>;
  PatchBlock: ComponentType<PatchBlockProps>;
  TodoListBlock: ComponentType<TodoListBlockProps>;
  ErrorBlock: ComponentType<ErrorBlockProps>;
  RawEventBlock: ComponentType<RawEventBlockProps>;
  ToolGroup: ComponentType<ToolGroupProps>;
}

export interface CodexTranscriptProps {
  events: ChatStreamEvent[];
  status?: TranscriptStatus;
  error?: { message: string; details?: string };
  className?: string;
  maxItems?: number;
  emptyState?: ReactNode;
  onItemClick?: (itemId: string) => void;
  components?: Partial<CodexTranscriptComponents>;
  disableSmoothStream?: boolean;
  onInternalError?: (err: unknown, event?: ChatStreamEvent) => void;
}

const DEFAULTS: CodexTranscriptComponents = {
  StatusBar,
  MessageBubble,
  ReasoningBlock,
  ToolCallBlock,
  ExecBlock,
  SearchBlock,
  PatchBlock,
  TodoListBlock,
  ErrorBlock,
  RawEventBlock,
  ToolGroup,
};

function flatItems(turns: TurnView[]): { turn: TurnView; item: ItemView }[] {
  const out: { turn: TurnView; item: ItemView }[] = [];
  for (const t of turns) for (const i of t.items) out.push({ turn: t, item: i });
  return out;
}

export function CodexTranscript(props: CodexTranscriptProps): JSX.Element {
  const opts: { status?: TranscriptStatus; onInternalError?: (err: unknown, event?: ChatStreamEvent) => void } = {};
  if (props.status !== undefined) opts.status = props.status;
  if (props.onInternalError) opts.onInternalError = props.onInternalError;
  const { model, status } = useCodexTranscript(props.events, opts);
  const components = { ...DEFAULTS, ...props.components };
  const handleClick = useCallback(
    (id: string) => () => props.onItemClick?.(id),
    [props.onItemClick],
  );

  const flat = flatItems(model.turns);
  const truncated = props.maxItems != null && flat.length > props.maxItems
    ? { kept: flat.slice(flat.length - props.maxItems), omitted: flat.length - props.maxItems }
    : { kept: flat, omitted: 0 };

  if (model.turns.length === 0) {
    return (
      <div className={[resetStyles.root, styles.root, 'codexview-root', props.className].filter(Boolean).join(' ')}>
        <components.StatusBar status={status} {...(props.error ? { error: props.error } : {})} />
        <div className={styles.empty}>{props.emptyState ?? '暂无对话'}</div>
      </div>
    );
  }

  // Group kept items by turn (for TurnContainer continuity).
  const byTurn = new Map<string, ItemView[]>();
  for (const { turn, item } of truncated.kept) {
    const arr = byTurn.get(turn.turnId) ?? [];
    arr.push(item);
    byTurn.set(turn.turnId, arr);
  }
  const turnsToRender = model.turns.filter((t) => byTurn.has(t.turnId));

  return (
    <div className={[resetStyles.root, styles.root, 'codexview-root', props.className].filter(Boolean).join(' ')}>
      <components.StatusBar status={status} {...(props.error ? { error: props.error } : {})} />
      {truncated.omitted > 0 && (
        <div className={styles.omitted}>已省略最早的 {truncated.omitted} 条</div>
      )}
      <ol className={styles.list} role="log" aria-live="polite" aria-relevant="additions text">
        {turnsToRender.map((turn) => (
          <li key={turn.turnId}>
            <TurnContainer turn={turn}>
              {partitionForGrouping(byTurn.get(turn.turnId) ?? []).map((slice, idx) => {
                if (slice.kind === 'single') {
                  const item = slice.item;
                  return (
                    <Fragment key={item.id}>
                      <ItemErrorBoundary fallback={<components.RawEventBlock item={{ id: item.id, kind: 'raw', status: item.status, startedAt: item.startedAt, updatedAt: item.updatedAt, payload: item }} />}>
                        <div onClick={handleClick(item.id)}>
                          {renderItem(item, components, props.disableSmoothStream)}
                        </div>
                      </ItemErrorBoundary>
                    </Fragment>
                  );
                }
                return (
                  <components.ToolGroup key={`group-${idx}-${slice.items[0]?.id ?? ''}`} items={slice.items}>
                    {slice.items.map((item) => (
                      <Fragment key={item.id}>
                        <ItemErrorBoundary fallback={<components.RawEventBlock item={{ id: item.id, kind: 'raw', status: item.status, startedAt: item.startedAt, updatedAt: item.updatedAt, payload: item }} />}>
                          <div onClick={handleClick(item.id)}>
                            {renderItem(item, components, props.disableSmoothStream)}
                          </div>
                        </ItemErrorBoundary>
                      </Fragment>
                    ))}
                  </components.ToolGroup>
                );
              })}
            </TurnContainer>
          </li>
        ))}
      </ol>
      {status === 'working' && (
        <div className={styles.tailPrompt} aria-live="polite">
          <span className={styles.tailPulse} aria-hidden />
          <span>正在工作…</span>
        </div>
      )}
    </div>
  );
}

function renderItem(item: ItemView, c: CodexTranscriptComponents, disableSmoothStream?: boolean): JSX.Element {
  const smoothStream = !disableSmoothStream;
  switch (item.kind) {
    case 'user_message':
    case 'assistant_text':
      return <c.MessageBubble item={item} smoothStream={smoothStream} />;
    case 'reasoning':
      return <c.ReasoningBlock item={item} smoothStream={smoothStream} />;
    case 'tool_call':
      return <c.ToolCallBlock item={item} />;
    case 'exec':
      return <c.ExecBlock item={item} />;
    case 'search':
      return <c.SearchBlock item={item} />;
    case 'patch':
      return <c.PatchBlock item={item} />;
    case 'todo_list':
      return <c.TodoListBlock item={item} />;
    case 'error':
      return <c.ErrorBlock item={item} />;
    case 'raw':
      return <c.RawEventBlock item={item} />;
  }
}
