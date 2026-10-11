import { useEffect, useState } from 'react';
import { adaptAppServerThread, type ChatStreamEvent } from '@codexview/adapters';
import { CodexSession, CodexTranscript } from '../../src/index.js';
import { sessionRequest, sessionTransport } from './sessionTransport.js';

export function SessionPlayground() {
  const [threads, setThreads] = useState<{id: string; name: string}[]>([]);
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem('codexview-session'));
  const [editable, setEditable] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{events: ChatStreamEvent[]; cursor: string | null} | null>(null);
  useEffect(() => { sessionRequest('/threads').then(setThreads).catch(e => setError(String(e))); }, []);
  useEffect(() => {
    setHistory(null);
    if (!selected) return;
    localStorage.setItem('codexview-session', selected);
    let cancelled = false;
    sessionRequest(`/threads/${selected}/read`).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [selected]);
  async function create() {
    setBusy(true); setError('');
    try {
      const { threadId } = await sessionRequest('/threads', {});
      setThreads(await sessionRequest('/threads'));
      setSelected(threadId);
      setEditable(true);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function resume() {
    setBusy(true); setError('');
    try { await sessionRequest(`/threads/${selected}/resume`, {}); setEditable(true); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function loadHistory(cursor?: string | null) {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const page = await sessionRequest(`/threads/${selected}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      setHistory({ events: adaptAppServerThread({ id: selected, turns: [...page.data].reverse() }), cursor: page.nextCursor });
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <div style={{maxWidth: 1100, margin: '0 auto', padding: 24}}>
    <h1>Codex sessions</h1>
    <p>Persistent local app-server · browser reconnects leave backend work running.</p>
    <p>Sessions use an isolated playground workspace. History opens read-only; Continue enables input.</p>
    <div style={{display:'flex', gap:12, marginBottom:20}}>
      <button onClick={() => void create()} disabled={busy}>New session</button>
      <select disabled={busy} aria-label="Session" value={selected ?? ''} onChange={e => { setEditable(false); setError(''); setSelected(e.target.value || null); }}>
        <option value="">Choose session</option>
        {threads.map(thread => <option key={thread.id} value={thread.id}>{thread.name}</option>)}
      </select>
      {selected && <button onClick={() => void resume()} disabled={busy}>{editable ? 'Reconnect session' : 'Continue session'}</button>}
    </div>
    {selected && <div><button disabled={busy} onClick={() => void loadHistory()}>Browse saved history</button>{history && <button onClick={() => setHistory(null)}>Return to live session</button>}</div>}
    {history && <section aria-label="Saved history"><p>Read-only history page (up to 20 turns).</p><CodexTranscript events={history.events} />{history.cursor && <button disabled={busy} onClick={() => void loadHistory(history.cursor)}>Older turns</button>}</section>}
    {error && <p role="alert">{error}</p>}
    {selected && !history && <CodexSession key={selected} threadId={selected} transport={sessionTransport} readOnly={!editable} />}
  </div>;
}
