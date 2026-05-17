import type { ChatStreamEvent, TokenUsage } from '../types.js';

/**
 * Structural input types modeled on AgentWeb's transcript shape. They are
 * intentionally lightweight — adapters has no AgentWeb dependency — but the
 * field names match AgentWeb's `ChatMessage` / `StreamingState` so an
 * AgentWeb caller can pass its objects through with minimal mapping.
 */

export interface AgentWebTokenUsage {
  input?: number;
  cachedInput?: number;
  output?: number;
}

export type AgentWebMessageRole = 'user' | 'assistant';

export interface AgentWebToolCall {
  /** Stable id used as `callId`. */
  callId: string;
  /** Tool name. `run_command` maps to `exec_command_*`; anything else maps to `function_call*`. */
  name: string;
  /** Tool arguments. For `run_command`, prefer `{ command: string }`. */
  args?: unknown;
  /** Output for completed non-shell tools. */
  output?: unknown;
  /** Error message for failed tools. */
  error?: string;
  /** Defaults to true for persisted entries, false for in-flight streaming entries. */
  completed?: boolean;
  /** Exit code for `run_command`. Defaults to `error ? 1 : 0`. */
  exit?: number;
  /** stdout for `run_command`. Falls back to `String(output)` when omitted. */
  stdout?: string;
  /** stderr for `run_command`. */
  stderr?: string;
  /** Duration in ms for `run_command`. */
  durationMs?: number;
  /** Optional per-call timestamp override. */
  at?: number;
}

export interface AgentWebMessage {
  /** Stable message id; emitted as `itemId`. */
  id: string;
  /** AgentWeb turn id — groups all rows of one user/assistant exchange. */
  turnId: string;
  role: AgentWebMessageRole;
  /** Plain text content. Optional for tool-only rows. */
  text?: string;
  /** Tool calls attached to this message, in execution order. */
  toolCalls?: AgentWebToolCall[];
  /** Token usage — typically only on the final assistant row of a turn. */
  usage?: AgentWebTokenUsage;
  /** Wall-clock timestamp in ms epoch. */
  at?: number;
}

export type AgentWebStreamStatus =
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'disconnected'
  | 'gaveUp';

export interface AgentWebStreamingState {
  /** Turn id of the in-flight turn, if any. */
  turnId?: string;
  /** Partial assistant text streamed so far. */
  partialText?: string;
  /** Stable id for the partial-text item; defaults to `${turnId}-live`. */
  partialItemId?: string;
  /** Tool calls (in-flight or completed) attached to the live turn. */
  toolCalls?: AgentWebToolCall[];
  /** Lifecycle status of the live turn. */
  status?: AgentWebStreamStatus;
  /** Error / abort message for `failed` / `gaveUp` / `disconnected`. */
  error?: string;
  /** Wall-clock timestamp for synthesized events. */
  at?: number;
  /** Token usage if reported mid/post-stream (rare). */
  usage?: AgentWebTokenUsage;
}

/** Duplicated from `@codexview/react`'s `TranscriptStatus` to keep adapters dep-free. */
export type TranscriptStatus =
  | 'idle'
  | 'working'
  | 'completed'
  | 'stopped'
  | 'failed';

export interface AdaptAgentWebTranscriptInput {
  sessionId: string;
  messages?: AgentWebMessage[];
  streaming?: AgentWebStreamingState | null;
  /** Override clock for synthesized lifecycle events. Defaults to `Date.now()`. */
  now?: number;
}

export interface AdaptAgentWebTranscriptResult {
  events: ChatStreamEvent[];
  status: TranscriptStatus;
  error?: { message: string };
}

const mapUsage = (u: AgentWebTokenUsage | undefined): TokenUsage | undefined => {
  if (!u) return undefined;
  return {
    inputTokens: u.input ?? 0,
    outputTokens: u.output ?? 0,
    ...(u.cachedInput != null ? { cachedInputTokens: u.cachedInput } : {}),
  };
};

const mergeUsage = (
  a: AgentWebTokenUsage | undefined,
  b: AgentWebTokenUsage | undefined,
): AgentWebTokenUsage | undefined => {
  if (!a) return b;
  if (!b) return a;
  return {
    input: (a.input ?? 0) + (b.input ?? 0),
    output: (a.output ?? 0) + (b.output ?? 0),
    cachedInput:
      a.cachedInput == null && b.cachedInput == null
        ? undefined
        : (a.cachedInput ?? 0) + (b.cachedInput ?? 0),
  };
};

const commandOf = (args: unknown): string => {
  if (args == null) return '';
  if (typeof args === 'string') return args;
  if (typeof args === 'object') {
    const cmd = (args as Record<string, unknown>).command;
    if (typeof cmd === 'string') return cmd;
    if (Array.isArray(cmd)) return cmd.map((c) => String(c)).join(' ');
  }
  return '';
};

function emitToolCall(
  tc: AgentWebToolCall,
  turnId: string,
  fallbackAt: number,
  out: ChatStreamEvent[],
): void {
  const at = tc.at ?? fallbackAt;
  const completed = tc.completed ?? true;

  if (tc.name === 'run_command') {
    out.push({
      type: 'exec_command_begin',
      turnId,
      callId: tc.callId,
      command: commandOf(tc.args),
      at,
    });
    if (completed) {
      const stdout =
        tc.stdout ?? (typeof tc.output === 'string' ? tc.output : tc.output == null ? '' : String(tc.output));
      out.push({
        type: 'exec_command_end',
        turnId,
        callId: tc.callId,
        exit: tc.exit ?? (tc.error ? 1 : 0),
        stdout,
        stderr: tc.stderr ?? '',
        durationMs: tc.durationMs ?? 0,
        at,
      });
    }
    return;
  }

  out.push({
    type: 'function_call',
    turnId,
    callId: tc.callId,
    name: tc.name,
    args: tc.args,
    at,
  });
  if (completed) {
    out.push({
      type: 'function_call_output',
      turnId,
      callId: tc.callId,
      ...(tc.output !== undefined ? { output: tc.output } : {}),
      ...(tc.error ? { error: tc.error } : {}),
      at,
    });
  }
}

interface TurnGroup {
  turnId: string;
  messages: AgentWebMessage[];
  firstAt: number;
  lastAt: number;
}

function groupByTurn(messages: AgentWebMessage[], fallbackAt: number): TurnGroup[] {
  const order: string[] = [];
  const byId = new Map<string, TurnGroup>();
  for (const msg of messages) {
    const at = msg.at ?? fallbackAt;
    let g = byId.get(msg.turnId);
    if (!g) {
      g = { turnId: msg.turnId, messages: [], firstAt: at, lastAt: at };
      byId.set(msg.turnId, g);
      order.push(msg.turnId);
    }
    g.messages.push(msg);
    g.lastAt = at;
  }
  return order.map((id) => byId.get(id)!);
}

function emitTurnBody(
  group: TurnGroup,
  out: ChatStreamEvent[],
): { usage: AgentWebTokenUsage | undefined; lastAt: number } {
  let aggUsage: AgentWebTokenUsage | undefined;
  let lastAt = group.firstAt;
  for (const msg of group.messages) {
    const at = msg.at ?? lastAt;
    lastAt = at;
    if (msg.role === 'user' && msg.text) {
      out.push({ type: 'user_message', turnId: msg.turnId, itemId: msg.id, text: msg.text, at });
    }
    if (msg.role === 'assistant' && msg.text) {
      out.push({
        type: 'agent_message',
        turnId: msg.turnId,
        itemId: msg.id,
        text: msg.text,
        partial: false,
        at,
      });
    }
    for (const tc of msg.toolCalls ?? []) {
      emitToolCall(tc, msg.turnId, at, out);
    }
    if (msg.usage) aggUsage = mergeUsage(aggUsage, msg.usage);
  }
  return { usage: aggUsage, lastAt };
}

function emitStreamingExtras(
  streaming: AgentWebStreamingState,
  turnId: string,
  fallbackAt: number,
  out: ChatStreamEvent[],
): number {
  let at = streaming.at ?? fallbackAt;
  if (streaming.partialText) {
    out.push({
      type: 'agent_message',
      turnId,
      itemId: streaming.partialItemId ?? `${turnId}-live`,
      text: streaming.partialText,
      partial: true,
      at,
    });
  }
  for (const tc of streaming.toolCalls ?? []) {
    emitToolCall(tc, turnId, at, out);
    at = tc.at ?? at;
  }
  return at;
}

function emitStreamingTerminal(
  streaming: AgentWebStreamingState,
  turnId: string,
  at: number,
  out: ChatStreamEvent[],
): void {
  const status = streaming.status;
  if (status === 'failed') {
    out.push({
      type: 'turn_failed',
      turnId,
      at,
      error: { message: streaming.error ?? 'stream failed' },
    });
    return;
  }
  if (status === 'disconnected' || status === 'gaveUp') {
    out.push({
      type: 'turn_aborted',
      turnId,
      at,
      reason: streaming.error ?? status,
    });
    return;
  }
  if (status === 'completed') {
    out.push({
      type: 'turn_completed',
      turnId,
      at,
      ...(streaming.usage ? { usage: mapUsage(streaming.usage)! } : {}),
    });
  }
  // `streaming` → no terminal event yet; consumer will see `working` status.
}

function computeStatus(
  streaming: AgentWebStreamingState | null | undefined,
  hadAnyTurn: boolean,
): TranscriptStatus {
  const s = streaming?.status;
  if (s === 'streaming') return 'working';
  if (s === 'failed') return 'failed';
  if (s === 'disconnected' || s === 'gaveUp') return 'stopped';
  if (s === 'completed') return 'completed';
  return hadAnyTurn ? 'completed' : 'idle';
}

export function adaptAgentWebTranscript(
  input: AdaptAgentWebTranscriptInput,
): AdaptAgentWebTranscriptResult {
  const now = input.now ?? Date.now();
  const messages = input.messages ?? [];
  const streaming = input.streaming ?? null;
  const events: ChatStreamEvent[] = [];

  const threadAt = messages[0]?.at ?? streaming?.at ?? now;
  events.push({ type: 'thread_started', threadId: input.sessionId, at: threadAt });

  const groups = groupByTurn(messages, now);
  const groupIds = new Set(groups.map((g) => g.turnId));
  const streamMatchesExistingTurn =
    streaming?.turnId != null && groupIds.has(streaming.turnId);

  for (const group of groups) {
    events.push({ type: 'turn_started', turnId: group.turnId, at: group.firstAt });
    const { usage, lastAt } = emitTurnBody(group, events);

    const isLiveTurn = streamMatchesExistingTurn && streaming!.turnId === group.turnId;
    if (isLiveTurn) {
      const streamAt = emitStreamingExtras(streaming!, group.turnId, lastAt, events);
      emitStreamingTerminal(streaming!, group.turnId, streamAt, events);
      // If status is `streaming`, no terminal event was emitted — that's
      // exactly what we want (turn stays open).
      continue;
    }

    // Persisted-only turn → emit terminal.
    events.push({
      type: 'turn_completed',
      turnId: group.turnId,
      at: lastAt,
      ...(usage ? { usage: mapUsage(usage)! } : {}),
    });
  }

  // Brand-new live turn that has no persisted rows yet.
  if (streaming && streaming.turnId && !streamMatchesExistingTurn) {
    const streamStartAt = streaming.at ?? now;
    events.push({ type: 'turn_started', turnId: streaming.turnId, at: streamStartAt });
    const at = emitStreamingExtras(streaming, streaming.turnId, streamStartAt, events);
    emitStreamingTerminal(streaming, streaming.turnId, at, events);
  }

  const result: AdaptAgentWebTranscriptResult = {
    events,
    status: computeStatus(streaming, groups.length > 0 || !!streaming?.turnId),
  };
  if (streaming?.error && (streaming.status === 'failed' || streaming.status === 'gaveUp')) {
    result.error = { message: streaming.error };
  }
  return result;
}
