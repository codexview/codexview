import { useState } from 'react';
import { CodexTranscript } from '../../src/components/CodexTranscript.js';
import { FIXTURES } from './loadFixturesBrowser.js';

export function App(): JSX.Element {
  const [name, setName] = useState(FIXTURES[0]?.name ?? '');
  const current = FIXTURES.find((f) => f.name === name);
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong>codexview</strong>
        <span style={{ color: '#6e7781' }}>fixture:</span>
        <select value={name} onChange={(e) => setName(e.target.value)}>
          {FIXTURES.map((f) => <option key={f.name}>{f.name}</option>)}
        </select>
      </header>
      <main style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff', borderRadius: 12, border: '1px solid #d0d7de' }}>
        {current && <CodexTranscript events={current.events} />}
      </main>
    </div>
  );
}
