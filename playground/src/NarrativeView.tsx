// Claude Desktop-inspired narrative rendering: compact verb summaries for
// consecutive tool actions, no message bubbles, dark theme. Lives in playground/
// only (not part of the published library) — demonstrates an alternative
// presentation built on the same useCodexTranscript hook + view model.

import { useState, type ReactNode } from 'react';
import { useCodexTranscript } from '../../src/hooks/useCodexTranscript.js';
import type { ChatStreamEvent } from '../../src/types/events.js';
import type { ItemView, TurnView } from '../../src/types/model.js';
import { safeStringify } from '../../src/components/_shared.js';
import { Markdown } from '../../src/components/Markdown.js';

interface Props {
  events: ChatStreamEvent[];
}

export function NarrativeView({ events }: Props): JSX.Element {
  const { model, status } = useCodexTranscript(events);

  return (
    <div style={s.shell}>
      <header style={s.statusBar} data-cv-narrative-status={status}>
        <span style={s.statusDot} data-cv-narrative-status={status} />
        <span>{LABELS[status]}</span>
      </header>
      <div style={s.transcript}>
        {model.turns.flatMap((t, ti) => renderTurn(t, ti))}
        {model.turns.length === 0 && <div style={s.empty}>暂无对话</div>}
      </div>
    </div>
  );
}

const LABELS: Record<string, string> = {
  idle: '空闲',
  working: '正在工作',
  completed: '已完成',
  stopped: '已停止',
  failed: '出错',
};

function renderTurn(turn: TurnView, turnIndex: number): JSX.Element[] {
  const groups = groupItems(turn.items);
  return groups.map((g, i) => {
    const key = `${turn.turnId}-${i}`;
    if (g.kind === 'message') return <MessageRow key={key} item={g.item} />;
    if (g.kind === 'reasoning') return <ReasoningRow key={key} item={g.item} />;
    if (g.kind === 'todo_list') return <TodoRow key={key} item={g.item} />;
    if (g.kind === 'error') return <ErrorRow key={key} item={g.item} />;
    if (g.kind === 'tools') return <ToolGroupRow key={key} items={g.items} />;
    return null as never;
  });
}

type Group =
  | { kind: 'message'; item: Extract<ItemView, { kind: 'user_message' | 'assistant_text' }> }
  | { kind: 'reasoning'; item: Extract<ItemView, { kind: 'reasoning' }> }
  | { kind: 'todo_list'; item: Extract<ItemView, { kind: 'todo_list' }> }
  | { kind: 'error'; item: Extract<ItemView, { kind: 'error' }> }
  | { kind: 'tools'; items: ItemView[] };

function groupItems(items: ItemView[]): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    if (item.kind === 'user_message' || item.kind === 'assistant_text') {
      groups.push({ kind: 'message', item });
      continue;
    }
    if (item.kind === 'reasoning') {
      groups.push({ kind: 'reasoning', item });
      continue;
    }
    if (item.kind === 'todo_list') {
      groups.push({ kind: 'todo_list', item });
      continue;
    }
    if (item.kind === 'error') {
      groups.push({ kind: 'error', item });
      continue;
    }
    // tool-ish: collapse consecutive into one group
    const last = groups[groups.length - 1];
    if (last && last.kind === 'tools') last.items.push(item);
    else groups.push({ kind: 'tools', items: [item] });
  }
  return groups;
}

function MessageRow({ item }: { item: Extract<ItemView, { kind: 'user_message' | 'assistant_text' }> }): JSX.Element {
  const isUser = item.kind === 'user_message';
  return (
    <div style={isUser ? s.userBlock : s.assistantBlock}>
      {isUser && <div style={s.userTag}>用户</div>}
      <div style={s.textBody}>
        {/* User input is plain text — render as-is. Assistant output is Markdown. */}
        <Markdown asPlain={isUser}>{item.text}</Markdown>
      </div>
    </div>
  );
}

function TodoRow({ item }: { item: Extract<ItemView, { kind: 'todo_list' }> }): JSX.Element {
  const [open, setOpen] = useState(true);
  const total = item.items.length;
  const done = item.items.filter((e) => e.completed).length;
  return (
    <div style={s.todoBlock}>
      <button type="button" onClick={() => setOpen(!open)} style={s.disclosureRow}>
        <span style={s.disclosureChevron}>{open ? '▾' : '›'}</span>
        <span style={s.summary}>📋 计划 ({done}/{total})</span>
      </button>
      {open && (
        <ul style={s.todoList}>
          {item.items.map((entry, i) => (
            <li key={i} style={{ ...s.todoEntry, ...(entry.completed ? s.todoDone : null) }}>
              <span style={s.todoCheck} aria-hidden>{entry.completed ? '☑' : '☐'}</span>
              <span>{entry.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ErrorRow({ item }: { item: Extract<ItemView, { kind: 'error' }> }): JSX.Element {
  return (
    <div style={s.errorRow} role="alert">
      <span aria-hidden>⚠</span>
      <span>{item.message}</span>
    </div>
  );
}

function ReasoningRow({ item }: { item: Extract<ItemView, { kind: 'reasoning' }> }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div style={s.reasoningBlock}>
      <button type="button" onClick={() => setOpen(!open)} style={s.disclosureRow}>
        <span style={s.disclosureChevron}>{open ? '▾' : '›'}</span>
        <span style={s.muted}>思考</span>
      </button>
      {open && <div style={s.reasoningBody}><Markdown>{item.text}</Markdown></div>}
    </div>
  );
}

function ToolGroupRow({ items }: { items: ItemView[] }): JSX.Element {
  const [open, setOpen] = useState(false);
  const summary = summarize(items);
  return (
    <div style={s.toolGroup}>
      <button type="button" onClick={() => setOpen(!open)} style={s.disclosureRow}>
        <span style={s.disclosureChevron}>{open ? '▾' : '›'}</span>
        <span style={s.summary}>{summary}</span>
      </button>
      {open && <div style={s.toolDetails}>{items.map((it, i) => renderDetail(it, `${i}`))}</div>}
    </div>
  );
}

function summarize(items: ItemView[]): string {
  // Bucket items by phrase verb. Order of bucket = order of first occurrence.
  const order: string[] = [];
  const counts = new Map<string, number>();
  const examples = new Map<string, string>(); // first concrete name (for tool_call)
  for (const it of items) {
    const verb = verbBucket(it);
    if (!counts.has(verb)) {
      order.push(verb);
      counts.set(verb, 0);
      const ex = exampleLabel(it);
      if (ex) examples.set(verb, ex);
    }
    counts.set(verb, (counts.get(verb) ?? 0) + 1);
  }
  const phrases: string[] = [];
  for (const verb of order) {
    const n = counts.get(verb) ?? 0;
    const ex = examples.get(verb);
    phrases.push(formatPhrase(verb, n, ex));
  }
  return joinChinese(phrases);
}

function verbBucket(it: ItemView): string {
  switch (it.kind) {
    case 'exec': return 'exec';
    case 'tool_call': return `tool:${it.name}`;
    case 'search': return 'search';
    case 'patch': return 'patch';
    case 'raw': return 'raw';
    default: return 'misc';
  }
}

function exampleLabel(it: ItemView): string | undefined {
  if (it.kind === 'exec') {
    // first word of command, truncated
    const first = it.command.trim().split(/\s+/)[0] ?? '';
    return first.length > 0 ? first.slice(0, 32) : undefined;
  }
  if (it.kind === 'tool_call') return it.name;
  if (it.kind === 'search') return undefined;
  if (it.kind === 'patch') return undefined;
  return undefined;
}

function formatPhrase(verb: string, count: number, example?: string): string {
  if (verb === 'exec') {
    return count === 1 ? `执行了命令` : `执行了 ${count} 个命令`;
  }
  if (verb.startsWith('tool:')) {
    const name = verb.slice('tool:'.length);
    return count === 1 ? `调用了 ${name}` : `调用了 ${name} ${count} 次`;
  }
  if (verb === 'search') {
    return count === 1 ? `做了一次网页搜索` : `做了 ${count} 次网页搜索`;
  }
  if (verb === 'patch') {
    return count === 1 ? `应用了一次代码修改` : `应用了 ${count} 次代码修改`;
  }
  if (verb === 'raw') {
    return count === 1 ? `1 个未识别事件` : `${count} 个未识别事件`;
  }
  return verb;
}

function joinChinese(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} 和 ${parts[1]}`;
  return parts.slice(0, -1).join('、') + ' 和 ' + parts[parts.length - 1];
}

function renderDetail(it: ItemView, key: string): JSX.Element {
  switch (it.kind) {
    case 'exec':
      return (
        <div key={key} style={s.detail}>
          <div style={s.detailHead}>
            <span style={s.dotStatus} data-cv-narrative-status={it.status} />
            <code style={s.codeInline}>$ {it.command}</code>
            {it.exit != null && <span style={s.detailMuted}>(exit {it.exit}, {it.durationMs ?? '?'}ms)</span>}
          </div>
          {it.stdout && <pre style={s.codeBlock}>{truncate(it.stdout, 4000)}</pre>}
          {it.stderr && <pre style={{ ...s.codeBlock, color: '#ff7b72' }}>{truncate(it.stderr, 4000)}</pre>}
        </div>
      );
    case 'tool_call':
      return (
        <div key={key} style={s.detail}>
          <div style={s.detailHead}>
            <span style={s.dotStatus} data-cv-narrative-status={it.status} />
            <code style={s.codeInline}>{it.server ? `${it.server}.` : ''}{it.name}</code>
            <span style={s.detailMuted}>{it.status}</span>
          </div>
          <pre style={s.codeBlock}>{safeStringify(it.args)}</pre>
          {it.error && <div style={s.errorText}>{it.error}</div>}
          {it.result !== undefined && (
            typeof it.result === 'string'
              ? <div style={s.markdownPane}><Markdown>{truncate(it.result, 4000)}</Markdown></div>
              : <pre style={s.codeBlock}>{truncate(safeStringify(it.result), 4000)}</pre>
          )}
        </div>
      );
    case 'search':
      return (
        <div key={key} style={s.detail}>
          <div style={s.detailHead}>
            <span style={s.dotStatus} data-cv-narrative-status={it.status} />
            <span>🔍 {it.query}</span>
          </div>
          {it.results && it.results.length > 0 && (
            <ol style={s.searchResults}>
              {it.results.slice(0, 6).map((r, ri) => (
                <li key={ri}><a href={r.url} target="_blank" rel="noreferrer" style={s.link}>{r.title}</a></li>
              ))}
            </ol>
          )}
        </div>
      );
    case 'patch':
      return (
        <div key={key} style={s.detail}>
          <div style={s.detailHead}>
            <span style={s.dotStatus} data-cv-narrative-status={it.status} />
            <span>{it.files.length} 文件 ({it.ok ? '成功' : '失败'})</span>
          </div>
          <ul style={s.patchList}>
            {it.files.map((f, fi) => (
              <li key={fi}><code style={s.codeInline}>{f.path}</code> <span style={s.detailMuted}>{f.status}</span></li>
            ))}
          </ul>
        </div>
      );
    case 'raw':
      return (
        <div key={key} style={s.detail}>
          <div style={s.detailHead}>
            <span style={s.dotStatus} data-cv-narrative-status={it.status} />
            <span style={s.detailMuted}>未识别 payload</span>
          </div>
          <pre style={s.codeBlock}>{truncate(safeStringify(it.payload), 2000)}</pre>
        </div>
      );
    default:
      return <div key={key} />;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n…（截断 ${text.length - max} 字）`;
}

const s: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#1a1a1a',
    color: '#e6e6e6',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    fontSize: 14,
    lineHeight: 1.55,
    minHeight: 0,
    // Override CodexView's tokens so the embedded Markdown component picks up
    // dark-theme appropriate colors when rendered inside this view.
    ['--cv-text' as never]: '#e6e6e6',
    ['--cv-text-muted' as never]: '#a8a8a8',
    ['--cv-bg' as never]: '#1a1a1a',
    ['--cv-bg-raised' as never]: '#262626',
    ['--cv-bg-code' as never]: '#0d0d0d',
    ['--cv-fg-code' as never]: '#cdd9e5',
    ['--cv-border' as never]: '#2c2c2c',
    ['--cv-status-running' as never]: '#79c0ff',
  } as React.CSSProperties,
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    borderBottom: '1px solid #2c2c2c',
    background: '#1f1f1f',
    fontSize: 12,
    color: '#a8a8a8',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#888',
  },
  transcript: {
    flex: 1,
    overflow: 'auto',
    padding: '20px 28px 60px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    minHeight: 0,
    maxWidth: 920,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
  },
  empty: { textAlign: 'center', color: '#666', padding: 40 },
  userBlock: {
    background: '#262626',
    border: '1px solid #2f2f2f',
    borderRadius: 10,
    padding: '10px 14px',
    marginTop: 6,
  },
  userTag: { fontSize: 11, color: '#888', marginBottom: 4 },
  assistantBlock: { padding: '4px 0' },
  textBody: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#e6e6e6' },
  reasoningBlock: { padding: '2px 0' },
  toolGroup: { padding: '2px 0' },
  disclosureRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'transparent',
    border: 'none',
    color: '#a8a8a8',
    cursor: 'pointer',
    padding: '4px 0',
    fontFamily: 'inherit',
    fontSize: 13,
  },
  disclosureChevron: {
    display: 'inline-block',
    width: 12,
    color: '#6a6a6a',
  },
  summary: { color: '#a8a8a8' },
  muted: { color: '#888' },
  reasoningBody: {
    marginLeft: 18,
    marginTop: 4,
    padding: '8px 12px',
    background: '#1f1f1f',
    borderRadius: 6,
    color: '#a8a8a8',
    fontStyle: 'italic',
    whiteSpace: 'pre-wrap',
    fontSize: 13,
  },
  toolDetails: {
    marginLeft: 18,
    marginTop: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  detail: {
    background: '#1f1f1f',
    border: '1px solid #2c2c2c',
    borderRadius: 6,
    padding: 8,
  },
  detailHead: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 },
  detailMuted: { color: '#888', fontSize: 12 },
  dotStatus: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#888',
  },
  codeInline: {
    fontFamily: 'ui-monospace, Menlo, monospace',
    color: '#e6e6e6',
  },
  codeBlock: {
    margin: '6px 0 0',
    padding: 8,
    background: '#0d0d0d',
    color: '#cdd9e5',
    borderRadius: 4,
    fontSize: 12,
    fontFamily: 'ui-monospace, Menlo, monospace',
    whiteSpace: 'pre-wrap',
    overflow: 'auto',
    maxHeight: 360,
  },
  searchResults: { paddingLeft: 18, margin: '6px 0 0', color: '#cdd9e5' },
  patchList: { listStyle: 'none', padding: 0, margin: '6px 0 0' },
  link: { color: '#79c0ff', textDecoration: 'underline' },
  errorText: { color: '#ff7b72', fontSize: 12, marginTop: 4 },
  errorRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: '#3a1818',
    color: '#ff7b72',
    borderRadius: 6,
    border: '1px solid #5b1f1f',
    fontSize: 13,
  },
  todoBlock: {
    background: '#1f1f1f',
    border: '1px solid #2c2c2c',
    borderRadius: 8,
    padding: '8px 12px',
  },
  todoList: {
    listStyle: 'none',
    padding: 0,
    margin: '6px 0 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  todoEntry: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
    fontSize: 13,
    color: '#e6e6e6',
  },
  todoDone: { color: '#888', textDecoration: 'line-through' },
  todoCheck: { fontFamily: 'ui-monospace, Menlo, monospace', color: '#888' },
  markdownPane: {
    marginTop: 6,
    padding: 8,
    background: '#0d0d0d',
    color: '#cdd9e5',
    borderRadius: 4,
    fontSize: 13,
  },
};

// Scoped status dot styles. Use a unique data attribute name + a unique class
// container so this never bleeds into surrounding playground UI (status bar
// chips, etc).
const STYLE_ID = 'cv-narrative-status-styles';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = `
    span[data-cv-narrative-status='pending']   { background: #6e7681; }
    span[data-cv-narrative-status='running']   { background: #58a6ff; }
    span[data-cv-narrative-status='completed'] { background: #2ea043; }
    span[data-cv-narrative-status='failed']    { background: #f85149; }
    span[data-cv-narrative-status='stopped']   { background: #6e7681; }
    span[data-cv-narrative-status='working']   { background: #58a6ff; animation: cv-narrative-pulse 1.4s ease-in-out infinite; }
    span[data-cv-narrative-status='idle']      { background: transparent; }
    @keyframes cv-narrative-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  `;
  document.head.appendChild(styleEl);
}
