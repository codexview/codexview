import type { Readable, Writable } from 'node:stream';
import type { EventEmitter } from 'node:events';
export type RpcId = string | number;
export type ThreadSourceKind = 'cli' | 'vscode' | 'exec' | 'appServer' | 'subAgent' | 'subAgentReview' | 'subAgentCompact' | 'subAgentThreadSpawn' | 'subAgentOther' | 'unknown';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface ThreadOptions {
  cwd?: string; model?: string; modelProvider?: string;
  approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  config?: Record<string, JsonValue>; baseInstructions?: string; developerInstructions?: string;
}
export interface ThreadStartOptions extends ThreadOptions { ephemeral?: boolean }
export interface ThreadListOptions {
  cursor?: string | null; limit?: number; sortKey?: 'created_at' | 'updated_at';
  sortDirection?: 'asc' | 'desc'; sourceKinds?: ThreadSourceKind[];
  modelProviders?: string[]; archived?: boolean; cwd?: string | string[]; searchTerm?: string;
}
export interface PageOptions { cursor?: string | null; limit?: number; sortDirection?: 'asc' | 'desc' }
export interface CodexTurn { id: string; status: 'inProgress' | 'completed' | 'interrupted' | 'failed'; items: Array<{ id: string; type: string; [key: string]: unknown }>; error?: { message: string; [key: string]: unknown } | null; [key: string]: unknown }
export interface CodexThread { id: string; turns: CodexTurn[]; status?: { type: 'notLoaded' | 'idle' | 'systemError' | 'active'; activeFlags?: ('waitingOnApproval' | 'waitingOnUserInput')[] }; [key: string]: unknown }
export interface ThreadResponse { thread: CodexThread; [key: string]: unknown }
export interface Page<T> { data: T[]; nextCursor: string | null }
/** Injectable process boundary, useful for hosts and deterministic protocol tests. */
export interface RuntimeProcess extends EventEmitter { stdin: Writable; stdout: Readable; stderr?: Readable; kill(signal?: NodeJS.Signals): boolean }
export interface RuntimeOptions {
  /** Opt in only when using experimental protocol fields such as collaborationMode. */
  experimentalApi?: boolean;
  executable?: string; args?: string[]; cwd?: string; env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number; maxTurns?: number; snapshotIntervalMs?: number;
  clientInfo?: { name: string; title?: string; version: string };
  spawn?: () => RuntimeProcess;
}
