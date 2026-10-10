import type { ChatStreamEvent, PatchFile, SearchResult } from '../types.js';

/** Structural subset of Codex app-server v2 thread/read and thread/resume. */
export interface AppServerTurn {
  id: string;
  items: Array<{ id: string; type: string; [key: string]: unknown }>;
  status: string;
  error?: { message: string; [key: string]: unknown } | null;
  startedAt?: number | null;
  completedAt?: number | null;
}
export interface AppServerThread { id: string; turns: AppServerTurn[]; createdAt?: number }
export interface AppServerTranscriptOptions { maxTurns?: number }
type Item = { data: Record<string, unknown>; final: boolean; live: boolean; at: number; events?: ChatStreamEvent[] };
type Turn = { id: string; items: Map<string, Item>; status: string; error?: Record<string, unknown>; liveStatus: boolean; at: number; endAt: number; startEvent?: ChatStreamEvent; endEvent?: ChatStreamEvent };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const str = (value: unknown): string => typeof value === 'string' ? value : '';
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const seconds = (value: unknown): number => typeof value === 'number' ? value * 1000 : 0;
const terminal = (status: string): boolean => ['completed', 'failed', 'interrupted'].includes(status);

/** Stateful, thread-scoped reducer. Snapshots contain cumulative, deduplicated items. */
export class AppServerTranscriptStore {
  private turns = new Map<string, Turn>();
  private readonly maxTurns: number;
  private at = 0;
  private events?: ChatStreamEvent[];
  private threadEvent?: ChatStreamEvent;
  truncated = false;

  constructor(readonly threadId: string, options: AppServerTranscriptOptions = {}) {
    this.maxTurns = Math.max(0, Math.floor(options.maxTurns ?? 100));
    if (!Number.isFinite(this.maxTurns)) throw new Error('maxTurns must be finite');
  }

  /** Release prior-process precedence before reconciling durable history after reconnect. */
  beginEpoch(): void {
    for (const turn of this.turns.values()) {
      turn.liveStatus = false;
      for (const item of turn.items.values()) item.live = false;
    }
  }

  private turn(id: string): Turn {
    let turn = this.turns.get(id);
    if (!turn) {
      turn = { id, items: new Map(), status: 'inProgress', liveStatus: false, at: 0, endAt: 0 };
      this.turns.set(id, turn);
    }
    return turn;
  }

  private prune(): void {
    const completed = [...this.turns.values()].filter(turn => terminal(turn.status));
    for (const turn of completed.slice(0, Math.max(0, completed.length - this.maxTurns))) {
      this.turns.delete(turn.id);
      this.truncated = true;
    }
  }

  mergeHistory(thread: AppServerThread): void {
    if (thread.id !== this.threadId) return;
    this.events = undefined;
    this.at = seconds(thread.createdAt);
    const ordered = new Map<string, Turn>();
    for (const source of thread.turns) {
      const turn = this.turn(source.id);
      if (!turn.liveStatus) {
        turn.endEvent = undefined;
        turn.status = source.status;
        turn.error = source.error ?? undefined;
        turn.endAt = seconds(source.completedAt);
      }
      turn.at = seconds(source.startedAt) || turn.at;
      const items = new Map<string, Item>();
      for (const data of source.items) {
        const existing = turn.items.get(data.id);
        items.set(data.id, existing?.live ? existing : {
          data: { ...data }, final: terminal(source.status) || ['completed', 'failed', 'declined'].includes(str(data.status)), live: false, at: turn.at,
        });
      }
      for (const [id, item] of turn.items) if (!items.has(id)) items.set(id, item);
      turn.items = items;
      ordered.set(turn.id, turn);
    }
    for (const [id, turn] of this.turns) if (!ordered.has(id)) ordered.set(id, turn);
    this.turns = ordered;
    this.prune();
  }

  apply(method: string, params: Record<string, unknown>): boolean {
    if (params.threadId !== this.threadId) return false;
    const turnData = record(params.turn);
    const turnId = str(params.turnId) || str(turnData.id);
    if (!turnId) return false;
    if (method === 'thread/compacted') {
      const turn = this.turn(turnId);
      const id = `compaction:${turnId}`;
      if (turn.items.has(id)) return false;
      this.events = undefined;
      turn.items.set(id, { data: { id, type: 'contextCompaction' }, final: true, live: true, at: turn.at });
      return true;
    }
    if (method === 'turn/started' || method === 'turn/completed') {
      const turn = this.turn(turnId);
      if (terminal(turn.status) && (turn.liveStatus || method === 'turn/started')) return false;
      turn.status = method === 'turn/started' ? 'inProgress' : str(turnData.status) || 'completed';
      turn.error = turnData.error ? record(turnData.error) : undefined;
      turn.at = seconds(turnData.startedAt) || turn.at;
      turn.endAt = seconds(turnData.completedAt);
      turn.liveStatus = true;
      turn.endEvent = undefined;
      this.events = undefined;
      this.prune();
      return true;
    }
    const itemData = record(params.item);
    const itemId = str(params.itemId) || str(itemData.id);
    if (!itemId) return false;
    const deltaTypes: Record<string, string> = {
      'item/agentMessage/delta': 'agentMessage',
      'item/reasoning/summaryTextDelta': 'reasoning',
      'item/reasoning/textDelta': 'reasoning',
      'item/commandExecution/outputDelta': 'commandExecution',
      'item/plan/delta': 'plan',
    };
    if (!['item/started', 'item/completed'].includes(method) && !deltaTypes[method]) return false;
    const turn = this.turn(turnId);
    const existing = turn.items.get(itemId);
    if (existing?.final && (existing.live || method !== 'item/completed')) return false;
    if (method === 'item/started' || method === 'item/completed') {
      if (method === 'item/started' && existing?.live) {
        const data = { ...itemData, ...existing.data };
        if (JSON.stringify(data) === JSON.stringify(existing.data)) return false;
        this.events = undefined;
        turn.items.set(itemId, { ...existing, data, events: undefined });
        return true;
      }
      this.events = undefined;
      turn.items.set(itemId, { data: { ...itemData }, final: method === 'item/completed', live: true, at: existing?.at ?? turn.at });
    } else {
      const data = { ...(existing?.data ?? { id: itemId, type: deltaTypes[method] }) };
      const delta = str(params.delta);
      if (method.includes('reasoning')) {
        const field = method.includes('summary') ? 'summary' : 'content';
        const index = Number(params.summaryIndex ?? params.contentIndex ?? 0);
        if (!Number.isInteger(index) || index < 0 || index > 10000) return false;
        const parts = [...list(data[field])];
        parts[index] = str(parts[index]) + delta;
        data[field] = parts;
      } else {
        const field = method.includes('commandExecution') ? 'aggregatedOutput' : 'text';
        data[field] = str(data[field]) + delta;
      }
      this.events = undefined;
      turn.items.set(itemId, { data, final: false, live: true, at: existing?.at ?? turn.at });
    }
    return true;
  }

  getEvents(): ChatStreamEvent[] {
    if (this.events) return this.events;
    if (this.threadEvent?.at !== this.at) this.threadEvent = { type: 'thread_started', threadId: this.threadId, at: this.at };
    const events: ChatStreamEvent[] = [this.threadEvent];
    for (const turn of this.turns.values()) {
      if (turn.startEvent?.at !== turn.at) turn.startEvent = { type: 'turn_started', turnId: turn.id, at: turn.at };
      events.push(turn.startEvent);
      for (const [id, item] of turn.items) {
        item.events ??= itemEvents(turn.id, id, item);
        events.push(...item.events);
      }
      if (turn.endEvent) { events.push(turn.endEvent); continue; }
      const previousLength = events.length;
      if (turn.status === 'completed') events.push({ type: 'turn_completed', turnId: turn.id, at: turn.endAt });
      else if (turn.status === 'failed') events.push({ type: 'turn_failed', turnId: turn.id, at: turn.endAt, error: { message: str(turn.error?.message) || 'Turn failed' } });
      else if (turn.status === 'interrupted') events.push({ type: 'turn_aborted', turnId: turn.id, at: turn.endAt, reason: str(turn.error?.message) || 'Turn interrupted' });
      if (events.length > previousLength) turn.endEvent = events.at(-1);
    }
    this.events = events;
    return events;
  }
}

function itemEvents(turnId: string, itemId: string, item: Item): ChatStreamEvent[] {
  const data = item.data;
  const at = item.at;
  const callId = itemId;
  switch (data.type) {
    case 'userMessage': return [{ type: 'user_message', turnId, itemId, text: list(data.content).map(value => {
      const part = record(value);
      return part.type === 'text' ? str(part.text) : `[${str(part.type)}: ${str(part.path) || str(part.url) || str(part.name)}]`;
    }).join('\n'), at }];
    case 'agentMessage': return [{ type: 'agent_message', turnId, itemId, text: str(data.text), partial: !item.final, ...(data.phase === 'commentary' || data.phase === 'final_answer' ? { phase: data.phase } : {}), at }];
    case 'reasoning': return [{ type: 'reasoning', turnId, itemId, text: [...list(data.summary), ...list(data.content)].map(str).filter(Boolean).join('\n\n'), partial: !item.final, at }];
    case 'commandExecution': {
      const events: ChatStreamEvent[] = [{ type: 'exec_command_begin', turnId, callId, command: str(data.command), at }];
      if (item.final) events.push({ type: 'exec_command_end', turnId, callId, exit: typeof data.exitCode === 'number' ? data.exitCode : data.status === 'failed' ? 1 : 0, stdout: str(data.aggregatedOutput), stderr: '', durationMs: typeof data.durationMs === 'number' ? data.durationMs : 0, at });
      else if (data.aggregatedOutput) events.push({ type: 'raw', turnId, itemId, payload: { ...data }, at });
      return events;
    }
    case 'mcpToolCall': {
      const events: ChatStreamEvent[] = [{ type: 'mcp_tool_call', turnId, callId, server: str(data.server), name: str(data.tool), args: data.arguments, at }];
      if (item.final) events.push({ type: 'mcp_tool_call_output', turnId, callId, output: data.result, ...(data.error ? { error: str(record(data.error).message) || JSON.stringify(data.error) } : {}), at });
      return events;
    }
    case 'dynamicToolCall':
    case 'collabAgentToolCall': {
      const events: ChatStreamEvent[] = [{ type: 'function_call', turnId, callId, name: str(data.tool), args: data.arguments ?? { prompt: data.prompt, receiverThreadIds: data.receiverThreadIds }, at }];
      if (item.final) events.push({ type: 'function_call_output', turnId, callId, output: data.contentItems ?? data.agentsStates, ...(data.success === false || data.status === 'failed' ? { error: 'Tool call failed' } : {}), at });
      return events;
    }
    case 'functionCallOutput': return [{ type: 'function_call_output', turnId, callId, output: data.output, at }];
    case 'fileChange': if (!item.final) return [{ type: 'raw', turnId, itemId, payload: { ...data }, at }];
      return [{ type: 'patch_apply_end', turnId, callId, files: list(data.changes).map(value => {
      const change = record(value);
      const kind = record(change.kind).type;
      return { path: str(change.path), status: kind === 'add' ? 'added' : kind === 'delete' ? 'deleted' : 'modified', diff: str(change.diff) } as PatchFile;
    }), ok: data.status === 'completed', at }];
    case 'webSearch': {
      const events: ChatStreamEvent[] = [{ type: 'web_search_call', turnId, callId, query: str(data.query), at }];
      if (item.final) events.push({ type: 'web_search_end', turnId, callId, results: list(data.results).map(value => record(value)).filter(value => typeof value.url === 'string').map(value => ({ title: str(value.title), url: str(value.url), ...(value.snippet ? { snippet: str(value.snippet) } : {}) } as SearchResult)), at });
      return events;
    }
    default: return [{ type: 'raw', turnId, itemId, payload: { ...data }, at }];
  }
}

export function adaptAppServerThread(thread: AppServerThread, options: AppServerTranscriptOptions = {}): ChatStreamEvent[] {
  const store = new AppServerTranscriptStore(thread.id, options);
  store.mergeHistory(thread);
  return store.getEvents();
}
