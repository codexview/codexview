export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface PatchFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  diff?: string;
}

export interface TodoEntry {
  text: string;
  completed: boolean;
}

export type ChatStreamEvent =
  | { type: 'thread_started'; threadId: string; at: number }
  | { type: 'turn_started'; turnId: string; at: number }
  | { type: 'turn_completed'; turnId: string; at: number; usage?: TokenUsage }
  | { type: 'turn_failed'; turnId: string; at: number; error: { message: string; code?: string } }
  | { type: 'turn_aborted'; turnId: string; at: number; reason?: string }
  | { type: 'user_message'; turnId: string; itemId: string; text: string; at: number }
  | { type: 'agent_message'; turnId: string; itemId: string; text: string; partial: boolean; at: number }
  | { type: 'reasoning'; turnId: string; itemId: string; text: string; partial: boolean; at: number }
  | { type: 'function_call'; turnId: string; callId: string; name: string; args: unknown; at: number }
  | { type: 'function_call_output'; turnId: string; callId: string; output?: unknown; error?: string; at: number }
  | { type: 'exec_command_begin'; turnId: string; callId: string; command: string; at: number }
  | { type: 'exec_command_end'; turnId: string; callId: string; exit: number; stdout: string; stderr: string; durationMs: number; at: number }
  | { type: 'mcp_tool_call'; turnId: string; callId: string; server: string; name: string; args: unknown; at: number }
  | { type: 'mcp_tool_call_output'; turnId: string; callId: string; output?: unknown; error?: string; at: number }
  | { type: 'web_search_call'; turnId: string; callId: string; query: string; at: number }
  | { type: 'web_search_end'; turnId: string; callId: string; results: SearchResult[]; at: number }
  | { type: 'patch_apply_end'; turnId: string; callId: string; files: PatchFile[]; ok: boolean; at: number }
  | { type: 'todo_list'; turnId: string; itemId: string; items: TodoEntry[]; at: number }
  | { type: 'error_item'; turnId: string; itemId: string; message: string; at: number }
  | { type: 'raw'; turnId?: string; itemId?: string; payload: unknown; at: number };

export type ChatStreamEventType = ChatStreamEvent['type'];

export type DetectedFormat = 'rollout' | 'codex-team' | 'claude-code' | 'unknown';

export interface RawLine {
  [key: string]: unknown;
}
