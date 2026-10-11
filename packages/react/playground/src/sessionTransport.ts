import type { SessionTransport, SessionSnapshot } from '@codexview/adapters';
let token: Promise<string> | undefined;
async function headers() {
  token ??= fetch('/api/session/bootstrap').then(r => r.json()).then(r => r.token as string);
  return { 'content-type': 'application/json', 'x-codexview-token': await token };
}
export async function sessionRequest(path: string, body?: unknown) {
  const response = await fetch(`/api/session${path}`, {
    headers: await headers(),
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  if (response.status === 403) token = undefined;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
export const sessionTransport: SessionTransport = {
  models: () => sessionRequest('/models'),
  send: (id, text, options) => sessionRequest(`/threads/${id}/send`, { text, ...options }),
  steer: (id, text, expectedTurnId) => sessionRequest(`/threads/${id}/steer`, { text, expectedTurnId }),
  interrupt: (id, turnId) => sessionRequest(`/threads/${id}/interrupt`, { turnId }),
  reply: (id, requestId, result, epoch) => sessionRequest(`/threads/${id}/reply`, { requestId, result, epoch }),
  subscribe(id, listener, connection) {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout>;
    let snapshot: SessionSnapshot | undefined;
    async function connect() {
      connection?.('connecting');
      try {
        const response = await fetch(`/api/session/threads/${id}/events`, { headers: await headers(), signal: controller.signal });
        if (response.status === 403) token = undefined;
        if (!response.ok || !response.body) throw new Error('Session stream unavailable');
        connection?.('connected');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (frame.startsWith('data: ')) {
              const update = JSON.parse(frame.slice(6));
              if (update.kind === 'snapshot') snapshot = update.snapshot;
              else if (update.kind === 'patch' && snapshot && snapshot.epoch === update.state.epoch) {
                snapshot = { ...update.state, events: [...snapshot.events.slice(0, update.prefix), ...update.events] };
              }
              if (snapshot) listener(snapshot);
            }
          }
        }
      } catch { /* Connection state is separate from the last execution state. */ }
      if (!controller.signal.aborted) {
        connection?.('disconnected');
        retry = setTimeout(() => { void connect(); }, 1500);
      }
    }
    void connect();
    return () => { controller.abort(); clearTimeout(retry); };
  },
};
