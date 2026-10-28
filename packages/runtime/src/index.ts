import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { AppServerTranscriptStore, type SessionSnapshot, type SessionModel, type SessionRequest, type SessionTurnOptions } from '@codexview/adapters';
import type { RuntimeOptions, RuntimeProcess, RpcId, ThreadStartOptions, ThreadOptions, ThreadListOptions, ThreadResponse, Page, CodexThread, CodexTurn, PageOptions } from './types.js';
export type * from './types.js';
export type { SessionSnapshot, SessionModel, SessionRequest, SessionTurnOptions } from '@codexview/adapters';

export class CodexRpcError extends Error { constructor(message: string, readonly code?: number) { super(message); this.name = 'CodexRpcError'; } }
export class UncertainOutcomeError extends Error { constructor(message: string) { super(message); this.name = 'UncertainOutcomeError'; } }
interface Pending { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
interface Session {
  store: AppServerTranscriptStore; snapshot: SessionSnapshot;
  listeners: Set<(snapshot: SessionSnapshot) => void>; timer?: ReturnType<typeof setTimeout>;
  sending: boolean; liveRevision: number; terminalTurns: Set<string>; resumed: boolean; resumeOptions?: ThreadOptions; owned: boolean; freshThread?: ThreadResponse;
}
const supportedRequests = new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput']);
const activeStates = new Set(['running', 'waitingApproval', 'waitingInput', 'compacting', 'unknown']);
const input = (text: string) => [{ type: 'text', text, text_elements: [] }];
const VERSION: string = createRequire(import.meta.url)('../package.json').version;

/** Own one local Codex process. Hosts own authorization and durable thread IDs. */
export class CodexRuntime {
  private process?: RuntimeProcess;
  private ready = false;
  private starting?: Promise<void>;
  private sequence = 0;
  private generation = 0;
  private epoch = randomUUID();
  private pending = new Map<RpcId, Pending>();
  private sessions = new Map<string, Session>();
  private requests = new Map<RpcId, SessionRequest>();
  private resolvedRequests = new Set<RpcId>();
  constructor(private readonly options: RuntimeOptions = {}) {}

  start(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.starting) return this.starting;
    const task = this.initialize();
    this.starting = task;
    void task.finally(() => { if (this.starting === task) this.starting = undefined; }).catch(() => {});
    return task;
  }
  private async initialize(): Promise<void> {
    const generation = ++this.generation;
    this.epoch = randomUUID();
    const child = this.options.spawn?.() ?? spawn(this.options.executable ?? 'codex', ['app-server', ...(this.options.args ?? [])], {
      cwd: this.options.cwd, env: this.options.env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;
    for (const session of this.sessions.values()) { session.snapshot.epoch = this.epoch; session.snapshot.connection = 'connecting'; this.changed(session); }
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => { if (generation === this.generation) this.receive(line); });
    // Drain diagnostic output without leaking prompts, credentials, or configuration.
    child.stderr?.resume();
    child.on('error', () => { if (generation === this.generation) this.lost('Codex app-server process error'); });
    child.on('exit', () => { if (generation === this.generation) this.lost('Codex app-server exited'); });
    child.stdout.on('end', () => { if (generation === this.generation) this.lost('Codex app-server output closed'); });
    child.stdin.on('error', () => { if (generation === this.generation) this.lost('Codex app-server input closed'); });
    try {
      await this.rpc('initialize', { clientInfo: this.options.clientInfo ?? { name: 'codexview', version: VERSION }, capabilities: this.options.experimentalApi ? { experimentalApi: true } : null }, true);
      if (this.process !== child) throw new UncertainOutcomeError('Connection lost during initialization');
      this.write({ method: 'initialized', params: {} });
      this.ready = true;
      for (const session of this.sessions.values()) { session.snapshot.connection = 'connected'; this.changed(session); }
    } catch (error) { this.lost('Codex app-server initialization failed'); child.kill(); throw error; }
  }
  async close(): Promise<void> {
    const child = this.process;
    if (!child) { this.lost('Codex runtime closed'); return; }
    const exited = new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish(); }, 2000);
      const finish = () => { clearTimeout(timer); child.removeListener('exit', finish); resolve(); };
      child.once('exit', finish);
    });
    this.lost('Codex runtime closed');
    await exited;
  }
  async restart(): Promise<void> {
    const resumes = [...this.sessions].filter(([, s]) => s.owned).map(([id, s]) => [id, s.resumeOptions] as const);
    await this.close();
    await this.start();
    for (const [id, options] of resumes) await this.resumeThread(id, options);
  }
  async createThread(options: ThreadStartOptions = {}): Promise<ThreadResponse> {
    const result = await this.rpc('thread/start', options) as ThreadResponse;
    this.hydrate(result.thread, true, options);
    const session = this.session(result.thread.id);
    if (session.liveRevision === 0) session.freshThread = result;
    return result;
  }
  async resumeThread(threadId: string, options: ThreadOptions = {}): Promise<ThreadResponse> {
    const existing = this.session(threadId);
    if (existing.freshThread && existing.resumed && Object.keys(options).length === 0) return existing.freshThread;
    const liveRevision = existing.liveRevision;
    const result = await this.rpc('thread/resume', { ...options, threadId, excludeTurns: true }) as ThreadResponse;
    await this.loadHistory(result.thread);
    this.hydrate(result.thread, true, options, liveRevision);
    return result;
  }
  async readThread(threadId: string): Promise<ThreadResponse> {
    const fresh = this.sessions.get(threadId)?.freshThread;
    if (fresh && this.ready) return fresh;
    const result = await this.rpc('thread/read', { threadId, includeTurns: false }) as ThreadResponse;
    await this.loadHistory(result.thread);
    this.hydrate(result.thread, false);
    return result;
  }
  private async loadHistory(thread: CodexThread): Promise<void> {
    try {
      const page = await this.listTurns(thread.id, { limit: Math.max(1, this.options.maxTurns ?? 100), sortDirection: 'desc' });
      thread.turns = [...page.data].reverse();
      if (page.nextCursor) this.session(thread.id).store.truncated = true;
    } catch (error) {
      if (error instanceof CodexRpcError && error.code === -32600 && error.message === `thread ${thread.id} is not materialized yet; thread/turns/list is unavailable before first user message`) {
        thread.turns = [];
        return;
      }
      throw error;
    }
  }
  listThreads(options: ThreadListOptions = {}): Promise<Page<CodexThread>> {
    return this.rpc('thread/list', { sourceKinds: ['cli', 'vscode', 'exec', 'appServer'], ...options });
  }
  listTurns(threadId: string, options: PageOptions = {}): Promise<Page<CodexTurn>> {
    return this.historyRpc('thread/turns/list', { ...options, threadId, itemsView: 'full' });
  }
  listItems(threadId: string, options: PageOptions & { turnId?: string } = {}): Promise<Page<unknown>> {
    return this.historyRpc('thread/items/list', { ...options, threadId });
  }
  private async historyRpc<T>(method: string, params: unknown): Promise<T> {
    try { return await this.rpc(method, params); }
    catch (error) {
      if (error instanceof CodexRpcError && error.code === -32601) throw new CodexRpcError(
        `${method} is unavailable in this Codex app-server. Upgrade Codex for paginated history; metadata and live snapshots remain available.`, error.code);
      throw error;
    }
  }
  async listModels(): Promise<SessionModel[]> {
    const result: SessionModel[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const page = await this.rpc('model/list', { cursor }) as Page<SessionModel>;
      result.push(...page.data.map(model => ({ id: model.id, model: model.model, displayName: model.displayName,
        defaultReasoningEffort: model.defaultReasoningEffort, supportedReasoningEfforts: model.supportedReasoningEfforts })));
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error('Repeated model pagination cursor');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return result;
  }
  models(): Promise<SessionModel[]> { return this.listModels(); }
  async send(threadId: string, text: string, options: SessionTurnOptions = {}): Promise<{ turn: CodexTurn }> {
    if (options.collaborationMode && !this.options.experimentalApi) throw new Error('collaborationMode requires experimentalApi');
    const session = this.session(threadId);
    if (!session.resumed) throw new Error('Create or resume the thread before sending');
    if (session.sending || activeStates.has(session.snapshot.execution)) throw new Error('Thread has an active or uncertain turn');
    const startingRevision = session.liveRevision;
    session.sending = true;
    try {
      const result = await this.rpc('turn/start', { ...options, threadId, input: input(text) }) as { turn: CodexTurn };
      session.freshThread = undefined;
      // Completion can arrive before the RPC receipt; never overwrite its terminal state.
      if (!session.snapshot.activeTurnId || session.snapshot.activeTurnId !== result.turn.id) {
        session.snapshot.activeTurnId = result.turn.id;
        session.snapshot.execution = result.turn.status === 'inProgress' ? 'running' : result.turn.status;
        this.changed(session);
      }
      return result;
    } catch (error) {
      if (error instanceof UncertainOutcomeError && !(session.liveRevision > startingRevision && ['completed', 'failed', 'interrupted'].includes(session.snapshot.execution))) { session.snapshot.execution = 'unknown'; this.changed(session); }
      throw error;
    } finally { session.sending = false; }
  }
  async steer(threadId: string, text: string, expectedTurnId: string): Promise<unknown> {
    this.checkTurn(threadId, expectedTurnId);
    return this.rpc('turn/steer', { threadId, expectedTurnId, input: input(text) });
  }
  async interrupt(threadId: string, turnId: string): Promise<unknown> {
    this.checkTurn(threadId, turnId);
    return this.rpc('turn/interrupt', { threadId, turnId });
  }
  async reply(threadId: string, requestId: RpcId, result: unknown, epoch: string | undefined): Promise<void> {
    if (!epoch || epoch !== this.epoch) throw new Error('Request belongs to an expired runtime epoch');
    const request = this.requests.get(requestId);
    if (!request || request.threadId !== threadId) throw new Error('Request is expired, already answered, or belongs to another thread');
    if (!this.ready) throw new Error('Codex runtime disconnected');
    this.write({ id: requestId, result });
    this.requests.delete(requestId);
    this.rememberResolved(requestId);
    this.syncRequests(this.session(threadId));
  }
  subscribe(threadId: string, listener: (snapshot: SessionSnapshot) => void, onConnection?: (state: SessionSnapshot['connection']) => void): () => void {
    const session = this.session(threadId);
    const wrapped = (snapshot: SessionSnapshot) => { listener(snapshot); onConnection?.(snapshot.connection); };
    session.listeners.add(wrapped);
    wrapped(this.getSnapshot(threadId));
    return () => { session.listeners.delete(wrapped); };
  }
  /** Release an inactive, unsubscribed cache entry. Hosts retain durable thread IDs. */
  releaseSession(threadId: string): boolean {
    const session = this.sessions.get(threadId);
    if (!session) return true;
    if (session.sending || activeStates.has(session.snapshot.execution) || session.listeners.size || session.snapshot.requests.length) return false;
    if (session.timer) clearTimeout(session.timer);
    this.sessions.delete(threadId);
    return true;
  }
  getSnapshot(threadId: string): SessionSnapshot {
    const session = this.session(threadId);
    return { ...session.snapshot, events: session.store.getEvents(), requests: [...session.snapshot.requests], truncated: session.store.truncated };
  }
  private checkTurn(threadId: string, turnId: string): void {
    const state = this.session(threadId).snapshot;
    if (!turnId || state.activeTurnId !== turnId || !activeStates.has(state.execution) || state.execution === 'unknown') throw new Error('Turn is no longer active');
  }
  private session(threadId: string): Session {
    let session = this.sessions.get(threadId);
    if (!session) {
      session = { store: new AppServerTranscriptStore(threadId, { maxTurns: this.options.maxTurns }),
        snapshot: { threadId, epoch: this.epoch, revision: 0, connection: this.ready ? 'connected' : 'disconnected', execution: 'idle', events: [], requests: [] },
        listeners: new Set(), sending: false, liveRevision: 0, terminalTurns: new Set(), resumed: false, owned: false };
      this.sessions.set(threadId, session);
    }
    return session;
  }
  private hydrate(thread: CodexThread, resumed: boolean, options?: ThreadOptions, expectedLiveRevision = 0): void {
    const session = this.session(thread.id);
    session.store.mergeHistory(thread);
    for (const turn of thread.turns) if (['completed', 'failed', 'interrupted'].includes(turn.status)) this.rememberTerminal(session, turn.id);
    if (resumed) {
      session.resumed = true; session.owned = true;
      session.resumeOptions = { ...session.resumeOptions, ...options,
        ...(session.resumeOptions?.config || options?.config ? { config: { ...session.resumeOptions?.config, ...options?.config } } : {}) };
    }
    // Saved history can establish outcomes, while newer live evidence takes precedence.
    if ((resumed || session.liveRevision === 0) && session.liveRevision === expectedLiveRevision && !(session.snapshot.activeTurnId && activeStates.has(session.snapshot.execution) && session.snapshot.execution !== 'unknown')) {
      const turn = thread.turns?.at(-1);
      session.snapshot.activeTurnId = turn?.id;
      session.snapshot.execution = turn ? (turn.status === 'inProgress' ? (thread.status?.type === 'active' ? 'running' : 'unknown') : turn.status) : 'idle';
      if (thread.status?.type === 'active') {
        const flags = thread.status.activeFlags ?? [];
        session.snapshot.execution = flags.includes('waitingOnUserInput') ? 'waitingInput' : flags.includes('waitingOnApproval') ? 'waitingApproval' : 'running';
      } else if (thread.status?.type === 'systemError') session.snapshot.execution = 'failed';
      session.snapshot.error = undefined;
    }
    this.changed(session);
  }
  private changed(session: Session): void {
    session.snapshot.revision++;
    if (session.timer) return;
    session.timer = setTimeout(() => {
      session.timer = undefined;
      const snapshot = this.getSnapshot(session.snapshot.threadId);
      for (const listener of session.listeners) { try { listener(snapshot); } catch { /* Host callback isolation. */ } }
    }, this.options.snapshotIntervalMs ?? 20);
    session.timer.unref?.();
  }
  private syncRequests(session: Session): void {
    session.liveRevision++;
    session.snapshot.requests = [...this.requests.values()].filter(request => request.threadId === session.snapshot.threadId);
    const requests = session.snapshot.requests;
    if (requests.length) session.snapshot.execution = requests.some(r => r.method === 'item/tool/requestUserInput') ? 'waitingInput' : 'waitingApproval';
    else if (session.snapshot.execution === 'waitingInput' || session.snapshot.execution === 'waitingApproval') session.snapshot.execution = 'running';
    this.changed(session);
  }
  private receive(line: string): void {
    let message: any;
    try { message = JSON.parse(line); } catch { const child = this.process; this.lost('Malformed app-server protocol'); child?.kill(); return; }
    if (!message || typeof message !== 'object') return;
    if (message.method) {
      const params = message.params ?? {};
      if (message.id !== undefined) {
        if (!supportedRequests.has(message.method) || typeof params.threadId !== 'string') {
          this.write({ id: message.id, error: { code: -32601, message: 'Unsupported client request' } });
          return;
        }
        if (this.requests.has(message.id) || this.resolvedRequests.has(message.id)) return;
        const state = this.session(params.threadId).snapshot;
        const turnId = params.turnId;
        if (typeof turnId === 'string' && (this.session(params.threadId).terminalTurns.has(turnId) || (state.activeTurnId && (
          (activeStates.has(state.execution) && state.activeTurnId !== turnId) ||
          (['completed', 'failed', 'interrupted'].includes(state.execution) && state.activeTurnId === turnId)
        )))) {
          this.rememberResolved(message.id);
          this.write({ id: message.id, error: { code: -32000, message: 'Request turn is no longer active' } });
          return;
        }
        if (typeof turnId === 'string' && (!state.activeTurnId || !activeStates.has(state.execution))) state.activeTurnId = turnId;
        const request: SessionRequest = { id: message.id, method: message.method, threadId: params.threadId, turnId: params.turnId, params };
        this.requests.set(message.id, request);
        this.syncRequests(this.session(params.threadId));
        return;
      }
      const threadId = params.threadId ?? params.thread?.id;
      if (typeof threadId !== 'string') return;
      const session = this.session(threadId);
      if (message.method === 'turn/started' && session.snapshot.activeTurnId && session.snapshot.activeTurnId !== params.turn?.id && activeStates.has(session.snapshot.execution)) return;
      const applied = session.store.apply(message.method, params);
      if ((message.method === 'turn/started' || message.method === 'turn/completed') && !applied) return;
      if (message.method === 'serverRequest/resolved') {
        const request = this.requests.get(params.requestId);
        if (!request || request.threadId === threadId) { this.requests.delete(params.requestId); this.rememberResolved(params.requestId); this.syncRequests(session); }
      } else if (message.method === 'turn/started') {
        session.freshThread = undefined;
        session.liveRevision++;
        session.snapshot.activeTurnId = params.turn.id;
        session.snapshot.execution = 'running';
        session.snapshot.error = undefined;
        this.syncRequests(session);
      } else if (message.method === 'turn/completed') {
        if (session.snapshot.activeTurnId && session.snapshot.activeTurnId !== params.turn.id && activeStates.has(session.snapshot.execution)) { this.changed(session); return; }
        session.liveRevision++;
        session.snapshot.activeTurnId = params.turn.id;
        session.snapshot.execution = params.turn.status === 'inProgress' ? 'unknown' : params.turn.status;
        if (['completed', 'failed', 'interrupted'].includes(params.turn.status)) this.rememberTerminal(session, params.turn.id);
        session.snapshot.error = params.turn.error?.message;
        for (const [id, request] of this.requests) if (request.threadId === threadId && (!request.turnId || request.turnId === params.turn.id)) { this.requests.delete(id); this.rememberResolved(id); }
        session.snapshot.requests = [...this.requests.values()].filter(r => r.threadId === threadId);
      } else if (message.method === 'thread/compacted' || (message.method === 'item/completed' && params.item?.type === 'contextCompaction')) {
        if (applied && params.turnId === session.snapshot.activeTurnId && session.snapshot.execution === 'compacting') { session.liveRevision++; session.snapshot.execution = 'running'; }
      } else if (message.method === 'item/started' && params.item?.type === 'contextCompaction' && applied && params.turnId === session.snapshot.activeTurnId && activeStates.has(session.snapshot.execution)) { session.liveRevision++; session.snapshot.execution = 'compacting'; }
      this.changed(session);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      const serverMessage = message.error.message ?? 'Codex app-server RPC error';
      pending.reject(new CodexRpcError(/^no rollout found for thread id /.test(serverMessage)
        ? `${serverMessage}. This thread was not persisted; create a new thread in the current process.`
        : serverMessage, message.error.code));
    }
    else pending.resolve(message.result);
  }
  private write(message: unknown): void {
    if (!this.process) throw new UncertainOutcomeError('Codex app-server disconnected');
    this.process.stdin.write(JSON.stringify(message) + '\n');
  }
  private rpc<T = any>(method: string, params: unknown, initializing = false): Promise<T> {
    if (!this.process || (!initializing && !this.ready)) return Promise.reject(new Error('Start Codex runtime before making requests'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new UncertainOutcomeError(`Timed out waiting for ${method}; outcome is unknown`));
      }, this.options.requestTimeoutMs ?? 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  private rememberTerminal(session: Session, turnId: string): void {
    session.terminalTurns.add(turnId);
    if (session.terminalTurns.size > Math.max(1, this.options.maxTurns ?? 100)) session.terminalTurns.delete(session.terminalTurns.values().next().value!);
  }
  private rememberResolved(id: RpcId): void {
    this.resolvedRequests.add(id);
    if (this.resolvedRequests.size > 4096) this.resolvedRequests.delete(this.resolvedRequests.values().next().value!);
  }
  private lost(reason: string): void {
    const child = this.process;
    this.ready = false;
    this.process = undefined;
    ++this.generation;
    child?.kill();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new UncertainOutcomeError(reason)); }
    this.pending.clear();
    this.requests.clear();
    this.resolvedRequests.clear();
    for (const session of this.sessions.values()) {
      session.store.beginEpoch();
      session.resumed = false;
      session.freshThread = undefined;
      session.snapshot.connection = 'disconnected';
      if (activeStates.has(session.snapshot.execution) || session.sending) session.snapshot.execution = 'unknown';
      session.snapshot.requests = [];
      session.snapshot.error = reason;
      this.changed(session);
    }
  }
}
