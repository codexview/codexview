import type { ChatStreamEvent } from './types.js';

/** Host-facing state. Transport connectivity never implies a turn outcome. */
export type SessionConnection = 'connecting' | 'connected' | 'disconnected';
export type SessionExecution = 'idle' | 'running' | 'waitingApproval' | 'waitingInput' | 'compacting' | 'completed' | 'failed' | 'interrupted' | 'unknown';
export interface SessionRequest {
  id: string | number;
  method: string;
  threadId: string;
  turnId?: string;
  params: Record<string, unknown>;
}
export interface SessionSnapshot {
  threadId: string;
  revision: number;
  /** Runtime process identity; request IDs/revisions may restart in a new epoch. */
  epoch?: string;
  connection: SessionConnection;
  execution: SessionExecution;
  activeTurnId?: string;
  events: ChatStreamEvent[];
  requests: SessionRequest[];
  error?: string;
  /** Completed older turns were evicted; load history explicitly. */
  truncated?: boolean;
}
export interface SessionModel {
  id: string;
  model: string;
  displayName: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
}
export interface SessionTurnOptions { model?: string; effort?: string }
/** Implement this small authenticated host boundary; never expose arbitrary RPC. */
export interface SessionTransport {
  subscribe(threadId: string, listener: (snapshot: SessionSnapshot) => void, onConnection?: (state: SessionConnection) => void): () => void;
  send(threadId: string, text: string, options?: SessionTurnOptions): Promise<unknown>;
  steer(threadId: string, text: string, expectedTurnId: string): Promise<unknown>;
  interrupt(threadId: string, turnId: string): Promise<unknown>;
  reply(threadId: string, requestId: string | number, result: unknown): Promise<unknown>;
  models(): Promise<SessionModel[]>;
}
