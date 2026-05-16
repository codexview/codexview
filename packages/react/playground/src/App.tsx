import { useEffect, useMemo, useState } from 'react';
import { CodexTranscript } from '../../src/components/CodexTranscript.js';
import type { ChatStreamEvent } from '../../src/types/events.js';
import { NarrativeView } from './NarrativeView.js';

interface FileEntry {
  id: string;
  path: string;
  source: 'codex-cli' | 'agentweb-team' | 'claude-code' | 'synthetic';
  name: string;
  mtime: number;
  sizeKB: number;
}

interface EventsResponse {
  file: string;
  format: 'rollout' | 'codex-team' | 'claude-code' | 'synthetic' | 'unknown';
  count: number;
  events: ChatStreamEvent[];
}

type Tab = 'rendered' | 'events' | 'raw';
type RenderStyle = 'default' | 'narrative';

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function App(): JSX.Element {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [data, setData] = useState<EventsResponse | null>(null);
  const [rawData, setRawData] = useState<unknown[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('rendered');
  const [renderStyle, setRenderStyle] = useState<RenderStyle>('narrative');
  const [filter, setFilter] = useState<'all' | 'codex-cli' | 'agentweb-team' | 'claude-code'>('all');
  const [search, setSearch] = useState('');

  // Initial file list
  useEffect(() => {
    let cancelled = false;
    fetch('/api/logs')
      .then((r) => r.json())
      .then((j: { files: FileEntry[] }) => {
        if (!cancelled) {
          setFiles(j.files || []);
          setFilesError(null);
          if (j.files && j.files.length > 0 && !selectedId) {
            setSelectedId(j.files[0]!.id);
          }
        }
      })
      .catch((e) => { if (!cancelled) setFilesError(String(e)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load events for selection
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setRawData(null);
    Promise.all([
      fetch(`/api/logs/${selectedId}/events`).then((r) => r.json()),
      fetch(`/api/logs/${selectedId}/raw`).then((r) => r.json()),
    ])
      .then(([events, raw]) => {
        if (cancelled) return;
        if (events.error) { setError(events.error); return; }
        setData(events as EventsResponse);
        setRawData((raw as { lines: unknown[] }).lines || []);
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const visibleFiles = useMemo(() => {
    return files
      .filter((f) => filter === 'all' || f.source === filter)
      .filter((f) => !search || f.name.toLowerCase().includes(search.toLowerCase()));
  }, [files, filter, search]);

  const summary = useMemo(() => {
    if (!data) return null;
    const counts = new Map<string, number>();
    for (const e of data.events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [data]);

  return (
    <div style={styles.shell}>
      <aside style={styles.sidebar}>
        <header style={styles.sidebarHeader}>
          <strong style={{ fontSize: 16 }}>CodexView Playground</strong>
          <p style={styles.muted}>本机 Codex 日志 → 适配 → 渲染</p>
        </header>
        <div style={styles.controls}>
          <input
            type="search"
            placeholder="搜索文件名…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.input}
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            style={styles.select}
          >
            <option value="all">全部来源 ({files.length})</option>
            <option value="codex-cli">Codex CLI rollout ({files.filter((f) => f.source === 'codex-cli').length})</option>
            <option value="agentweb-team">AgentWeb codex-team ({files.filter((f) => f.source === 'agentweb-team').length})</option>
            <option value="claude-code">Claude Code ({files.filter((f) => f.source === 'claude-code').length})</option>
          </select>
        </div>
        {filesError && <div style={styles.error}>无法加载文件列表: {filesError}</div>}
        <ul style={styles.fileList}>
          {visibleFiles.map((f) => {
            const active = f.id === selectedId;
            return (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(f.id)}
                  style={{ ...styles.fileItem, ...(active ? styles.fileItemActive : {}) }}
                  title={f.path}
                >
                  <div style={styles.fileTitle}>{f.name}</div>
                  <div style={styles.fileMeta}>
                    <span
                      style={{
                        ...styles.badge,
                        ...(f.source === 'codex-cli' ? styles.badgeCli
                          : f.source === 'agentweb-team' ? styles.badgeTeam
                          : f.source === 'claude-code' ? styles.badgeClaude
                          : styles.badgeDemo),
                      }}
                      data-source={f.source}
                    >
                      {f.source === 'codex-cli' ? 'CLI'
                        : f.source === 'agentweb-team' ? 'Team'
                        : f.source === 'claude-code' ? 'Claude'
                        : 'Demo'}
                    </span>
                    <span>{f.sizeKB} KB</span>
                    <span>{formatTime(f.mtime)}</span>
                  </div>
                </button>
              </li>
            );
          })}
          {visibleFiles.length === 0 && <li style={styles.muted}>无匹配文件</li>}
        </ul>
        <footer style={styles.sidebarFooter}>
          <a href="https://github.com" style={styles.muted} onClick={(e) => { e.preventDefault(); window.location.reload(); }}>
            ↻ 刷新文件列表
          </a>
        </footer>
      </aside>

      <main style={styles.main}>
        <header style={styles.mainHeader}>
          <div style={styles.tabBar}>
            {(['rendered', 'events', 'raw'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{ ...styles.tabButton, ...(tab === t ? styles.tabButtonActive : {}) }}
              >
                {t === 'rendered' ? '渲染' : t === 'events' ? `适配后 (${data?.count ?? 0})` : `原始 (${rawData?.length ?? 0})`}
              </button>
            ))}
            {tab === 'rendered' && (
              <div style={styles.styleSwitcher}>
                <button
                  onClick={() => setRenderStyle('narrative')}
                  style={{ ...styles.tabButton, ...(renderStyle === 'narrative' ? styles.tabButtonActive : {}) }}
                  title="Claude Desktop 风格：暗色 + 工具调用单行折叠"
                >
                  Narrative
                </button>
                <button
                  onClick={() => setRenderStyle('default')}
                  style={{ ...styles.tabButton, ...(renderStyle === 'default' ? styles.tabButtonActive : {}) }}
                  title="完整 CodexTranscript 组件"
                >
                  Default
                </button>
              </div>
            )}
          </div>
          {data && (
            <div style={styles.metaRow}>
              <span style={styles.metaItem}>format: <code>{data.format}</code></span>
              <span style={styles.metaItem}>file: <code style={styles.codeMono}>{data.file.replace(/^.*\//, '')}</code></span>
            </div>
          )}
        </header>

        {loading && <div style={styles.empty}>加载中…</div>}
        {error && <div style={styles.error}>{error}</div>}

        {!loading && !error && data && (
          <div style={styles.contentBox}>
            {tab === 'rendered' && renderStyle === 'narrative' && (
              <NarrativeView events={data.events} />
            )}
            {tab === 'rendered' && renderStyle === 'default' && (
              <CodexTranscript events={data.events} disableSmoothStream maxItems={400} />
            )}
            {tab === 'events' && (
              <div style={styles.jsonPane}>
                {summary && (
                  <details open style={{ marginBottom: 12 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 500 }}>事件类型分布</summary>
                    <table style={styles.summaryTable}>
                      <tbody>
                        {summary.map(([k, v]) => (
                          <tr key={k}><td style={styles.summaryCount}>{v}</td><td><code>{k}</code></td></tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
                <pre style={styles.pre}>{JSON.stringify(data.events, null, 2)}</pre>
              </div>
            )}
            {tab === 'raw' && rawData && (
              <div style={styles.jsonPane}>
                <pre style={styles.pre}>{JSON.stringify(rawData, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: 'grid',
    gridTemplateColumns: '320px 1fr',
    height: '100%',
    background: '#f6f8fa',
  },
  sidebar: {
    background: '#fff',
    borderRight: '1px solid #d0d7de',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  sidebarHeader: {
    padding: '14px 16px',
    borderBottom: '1px solid #d0d7de',
  },
  controls: {
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    borderBottom: '1px solid #d0d7de',
  },
  input: {
    padding: '6px 10px',
    border: '1px solid #d0d7de',
    borderRadius: 6,
    fontSize: 13,
    fontFamily: 'inherit',
  },
  select: {
    padding: '6px 10px',
    border: '1px solid #d0d7de',
    borderRadius: 6,
    fontSize: 13,
    background: '#fff',
  },
  fileList: {
    flex: 1,
    overflowY: 'auto',
    margin: 0,
    padding: 8,
    listStyle: 'none',
    minHeight: 0,
  },
  fileItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '6px 10px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: 6,
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: 'inherit',
    color: '#1f2328',
    marginBottom: 2,
  },
  fileItemActive: {
    background: '#ddf4ff',
    borderColor: '#54aeff',
  },
  fileTitle: {
    fontSize: 12,
    fontFamily: 'ui-monospace, Menlo, monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileMeta: {
    display: 'flex',
    gap: 8,
    marginTop: 2,
    fontSize: 11,
    color: '#6e7781',
    alignItems: 'center',
  },
  badge: {
    padding: '1px 6px',
    borderRadius: 3,
    fontSize: 10,
    background: '#eef2f5',
  },
  badgeClaude: { background: '#f4e3ff', color: '#6b21a8' },
  badgeCli: { background: '#e0f2fe', color: '#075985' },
  badgeTeam: { background: '#fef3c7', color: '#92400e' },
  badgeDemo: { background: '#f3f4f6', color: '#4b5563' },
  sidebarFooter: {
    padding: '8px 12px',
    borderTop: '1px solid #d0d7de',
    fontSize: 12,
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    minWidth: 0,
  },
  mainHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '10px 16px',
    borderBottom: '1px solid #d0d7de',
    background: '#fff',
  },
  tabBar: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
  },
  styleSwitcher: {
    display: 'flex',
    gap: 4,
    marginLeft: 'auto',
    paddingLeft: 16,
    borderLeft: '1px solid #d0d7de',
  },
  tabButton: {
    padding: '6px 12px',
    background: 'transparent',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    color: '#6e7781',
  },
  tabButtonActive: {
    background: '#f6f8fa',
    borderColor: '#d0d7de',
    color: '#1f2328',
    fontWeight: 500,
  },
  metaRow: {
    display: 'flex',
    gap: 14,
    fontSize: 12,
    color: '#6e7781',
  },
  metaItem: {},
  codeMono: { fontFamily: 'ui-monospace, Menlo, monospace' },
  contentBox: {
    flex: 1,
    overflow: 'auto',
    background: '#fff',
    margin: 12,
    borderRadius: 12,
    border: '1px solid #d0d7de',
    minHeight: 0,
  },
  jsonPane: {
    padding: 16,
  },
  pre: {
    background: '#0d1117',
    color: '#e6edf3',
    padding: 12,
    borderRadius: 6,
    overflow: 'auto',
    fontSize: 12,
    margin: 0,
    fontFamily: 'ui-monospace, Menlo, monospace',
  },
  summaryTable: {
    marginTop: 8,
    borderCollapse: 'collapse',
    fontSize: 12,
  },
  summaryCount: {
    color: '#6e7781',
    paddingRight: 8,
    textAlign: 'right',
    fontFamily: 'ui-monospace, Menlo, monospace',
  },
  empty: {
    padding: 32,
    textAlign: 'center',
    color: '#6e7781',
  },
  error: {
    margin: 16,
    padding: 12,
    background: '#ffebe9',
    color: '#cf222e',
    borderRadius: 6,
    fontSize: 13,
  },
  muted: {
    color: '#6e7781',
    fontSize: 12,
    margin: 0,
  },
};
