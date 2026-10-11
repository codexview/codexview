import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { SessionPlayground } from './SessionPlayground.js';
import '../../src/styles/tokens.css';

function Playground() {
  const [mode, setMode] = useState('sessions');
  return <><nav style={{padding: 12, display: 'flex', gap: 12}}><button onClick={() => setMode('sessions')}>Live sessions</button><button onClick={() => setMode('history')}>Log viewer</button></nav>{mode === 'sessions' ? <SessionPlayground /> : <App />}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
