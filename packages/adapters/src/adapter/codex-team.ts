import type { ChatStreamEvent, RawLine } from '../types.js';

const epoch = (iso: unknown): number => {
  if (typeof iso === 'number') return iso;
  if (typeof iso !== 'string') return Date.now();
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Date.now() : ms;
};

export function adaptCodexTeam(lines: RawLine[]): ChatStreamEvent[] {
  const out: ChatStreamEvent[] = [];
  if (lines.length === 0) return out;
  const first = lines[0];
  const at0 = epoch(first.at);
  const turnId = 'codex-team-run';
  out.push({ type: 'thread_started', threadId: 'codex-team', at: at0 });
  out.push({ type: 'turn_started', turnId, at: at0 });

  let synth = 0;
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    const at = epoch(line.at);
    const event = String(line.event || 'updated');
    const status = String(line.status || '');
    const payload = (line.payload as Record<string, unknown> | undefined) || {};
    const summary = String(payload.summary || payload.next || event);
    out.push({
      type: 'agent_message',
      turnId,
      itemId: `cte-${++synth}`,
      text: `[${event}/${status}] ${summary}`,
      partial: false,
      at,
    });
  }
  const last = lines[lines.length - 1];
  const lastStatus = String(last.status || '').toLowerCase();
  const atFinal = epoch(last.at);
  if (lastStatus === 'failed' || lastStatus === 'needs human') {
    out.push({
      type: 'turn_failed',
      turnId,
      at: atFinal,
      error: { message: lastStatus },
    });
  } else {
    out.push({ type: 'turn_completed', turnId, at: atFinal });
  }
  return out;
}
