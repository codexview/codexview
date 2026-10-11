import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionConnection, SessionModel, SessionSnapshot, SessionTransport, SessionTurnOptions } from '@codexview/adapters';

export interface UseCodexSessionOptions { threadId: string; transport: SessionTransport }
export const sessionRequestKey = (id: string | number): string => `${typeof id}:${id}`;
const initialSnapshot = (threadId: string): SessionSnapshot => ({ threadId, revision: 0, connection: 'connecting', execution: 'unknown', events: [], requests: [] });

/** A composable authenticated session boundary. Connection loss never ends a turn. */
export function useCodexSession({ threadId, transport }: UseCodexSessionOptions) {
  const [state, setState] = useState(() => initialSnapshot(threadId));
  const [models, setModels] = useState<SessionModel[]>([]);
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [resolvedRequestIds, setResolved] = useState<Set<string>>(new Set());
  const [pendingRequestIds, setPending] = useState<Set<string>>(new Set());
  const requestsInFlight = useRef(new Set<string>());
  const resolved = useRef(new Set<string>());
  const context = useRef({ threadId, transport });
  if (context.current.threadId !== threadId || context.current.transport !== transport) context.current = { threadId, transport };
  const actionCount = useRef(0);
  const snapshot = state.threadId === threadId ? state : initialSnapshot(threadId);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    let active = true;
    setState(initialSnapshot(threadId));
    setModels([]); setActionError(undefined); setBusy(false); actionCount.current = 0;
    requestsInFlight.current = new Set(); resolved.current = new Set();
    setPending(new Set()); setResolved(new Set());
    const onConnection = (connection: SessionConnection) => {
      if (active) setState(previous => ({ ...previous, connection }));
    };
    let latestRevision = -1;
    let latestEpoch: string | undefined;
    const retiredEpochs = new Set<string>();
    const unsubscribe = transport.subscribe(threadId, next => {
      if (!active || next.threadId !== threadId) return;
      if (next.epoch && retiredEpochs.has(next.epoch)) return;
      const newEpoch = next.epoch !== latestEpoch;
      if (!newEpoch && next.revision < latestRevision) return;
      if (newEpoch) {
        if (latestEpoch) retiredEpochs.add(latestEpoch);
        latestEpoch = next.epoch;
        // Abandon completions from the old process, including reused RPC IDs.
        context.current = { threadId, transport };
        requestsInFlight.current = new Set(); resolved.current = new Set();
        setPending(new Set()); setResolved(new Set());
        setActionError(undefined); actionCount.current = 0; setBusy(false);
      }
      latestRevision = next.revision;
      snapshotRef.current = next;
      setState({ ...next });
    }, onConnection);
    void transport.models().then(next => { if (active) setModels(next); }).catch(error => { if (active) setActionError(String(error)); });
    return () => { active = false; unsubscribe(); };
  }, [threadId, transport]);

  const act = useCallback(async (operation: () => Promise<unknown>) => {
    if (snapshotRef.current.connection !== 'connected') throw new Error('Session is disconnected');
    const owner = context.current;
    setActionError(undefined); actionCount.current++; setBusy(true);
    try { return await operation(); }
    catch (error) { if (owner === context.current) setActionError(error instanceof Error ? error.message : String(error)); throw error; }
    finally { if (owner === context.current) { actionCount.current--; setBusy(actionCount.current > 0); } }
  }, []);
  // Capture identity once per session, rather than once per render.
  const send = useCallback((text: string, options?: SessionTurnOptions) => act(() => transport.send(threadId, text, options)), [act, threadId, transport]);
  const steer = useCallback((text: string, expectedTurnId: string) => act(() => transport.steer(threadId, text, expectedTurnId)), [act, threadId, transport]);
  const interrupt = useCallback(() => {
    const turnId = snapshotRef.current.activeTurnId;
    if (!turnId) return Promise.reject(new Error('No active turn'));
    return act(() => transport.interrupt(threadId, turnId));
  }, [act, threadId, transport]);
  const reply = useCallback(async (requestId: string | number, result: unknown) => {
    const epoch = snapshot.epoch;
    if (snapshotRef.current.epoch !== epoch || snapshotRef.current.threadId !== threadId || context.current.transport !== transport) throw new Error('Request belongs to an expired session');
    const key = sessionRequestKey(requestId);
    if (requestsInFlight.current.has(key) || resolved.current.has(key)) return;
    if (!snapshotRef.current.requests.some(request => request.id === requestId)) throw new Error('Request is no longer pending');
    requestsInFlight.current.add(key); setPending(new Set(requestsInFlight.current));
    const owner = context.current;
    try {
      await act(() => transport.reply(threadId, requestId, result, epoch));
      if (context.current === owner) {
        resolved.current.add(key); setResolved(new Set(resolved.current));
      }
    } finally {
      if (context.current === owner) {
        requestsInFlight.current.delete(key); setPending(new Set(requestsInFlight.current));
      }
    }
  }, [act, threadId, transport, snapshot.epoch]);
  return { snapshot, models, actionError, busy, resolvedRequestIds, pendingRequestIds, send, steer, interrupt, reply };
}
export type CodexSessionController = ReturnType<typeof useCodexSession>;
