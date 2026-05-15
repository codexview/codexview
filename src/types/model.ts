import type { PatchFile, SearchResult, TokenUsage } from './events.js';

/** Item-level lifecycle status (5 states per spec §5.1). */
export type ItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped';

/** Discriminated kind of a rendered item. */
export type ItemKind =
  | 'user_message'
  | 'reasoning'
  | 'assistant_text'
  | 'tool_call'
  | 'exec'
  | 'search'
  | 'patch'
  | 'raw';

interface ItemViewBase {
  id: string;
  kind: ItemKind;
  status: ItemStatus;
  startedAt: number;
  updatedAt: number;
}

export type ItemView =
  | (ItemViewBase & { kind: 'user_message'; text: string })
  | (ItemViewBase & { kind: 'reasoning'; text: string })
  | (ItemViewBase & { kind: 'assistant_text'; text: string })
  | (ItemViewBase & { kind: 'tool_call'; name: string; server?: string; args: unknown; result?: unknown; error?: string })
  | (ItemViewBase & { kind: 'exec'; command: string; exit?: number; stdout?: string; stderr?: string; durationMs?: number })
  | (ItemViewBase & { kind: 'search'; query: string; results?: SearchResult[] })
  | (ItemViewBase & { kind: 'patch'; files: PatchFile[]; ok?: boolean })
  | (ItemViewBase & { kind: 'raw'; payload: unknown });

export interface TurnView {
  turnId: string;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  items: ItemView[];
  usage?: TokenUsage;
  error?: { message: string; code?: string };
}

export interface TranscriptModel {
  threadId?: string;
  turns: TurnView[];
  lastEventAt: number;
}

/** Empty initial model. Always safe to start reducing from here. */
export const EMPTY_MODEL: TranscriptModel = Object.freeze({
  turns: [],
  lastEventAt: 0,
}) as TranscriptModel;

/** Session-level status (5 states per spec §5.3). */
export type TranscriptStatus = 'idle' | 'working' | 'completed' | 'stopped' | 'failed';
