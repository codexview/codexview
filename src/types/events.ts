/**
 * Token usage emitted by `turn_completed`.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
}

/** Result of a single web search hit. */
export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

/** Single file in a patch_apply result. */
export interface PatchFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  /** Unified git diff text. Optional because some events only carry metadata. */
  diff?: string;
}

/**
 * The discriminated union of events CodexView consumes.
 *
 * Source of truth: agentweb `backend/src/codex/eventMap.ts` `NormalizedEvent`.
 * This file is the contract boundary — it intentionally re-declares the shapes
 * so that consumers don't have to depend on agentweb internals.
 */
export type ChatStreamEvent =
  // Lifecycle
  | { type: 'thread_started'; threadId: string; at: number }
  | { type: 'turn_started'; turnId: string; at: number }
  | { type: 'turn_completed'; turnId: string; at: number; usage?: TokenUsage }
  | { type: 'turn_failed'; turnId: string; at: number; error: { message: string; code?: string } }
  | { type: 'turn_aborted'; turnId: string; at: number; reason?: string }

  // Messages
  | { type: 'user_message'; turnId: string; itemId: string; text: string; at: number }
  | { type: 'agent_message'; turnId: string; itemId: string; text: string; partial: boolean; at: number }
  | { type: 'reasoning'; turnId: string; itemId: string; text: string; partial: boolean; at: number }

  // Tool calls (paired by callId)
  | { type: 'function_call'; turnId: string; callId: string; name: string; args: unknown; at: number }
  | { type: 'function_call_output'; turnId: string; callId: string; output?: unknown; error?: string; at: number }

  // Shell exec
  | { type: 'exec_command_begin'; turnId: string; callId: string; command: string; at: number }
  | { type: 'exec_command_end'; turnId: string; callId: string; exit: number; stdout: string; stderr: string; durationMs: number; at: number }

  // MCP tool calls
  | { type: 'mcp_tool_call'; turnId: string; callId: string; server: string; name: string; args: unknown; at: number }
  | { type: 'mcp_tool_call_output'; turnId: string; callId: string; output?: unknown; error?: string; at: number }

  // Web search
  | { type: 'web_search_call'; turnId: string; callId: string; query: string; at: number }
  | { type: 'web_search_end'; turnId: string; callId: string; results: SearchResult[]; at: number }

  // Patch apply
  | { type: 'patch_apply_end'; turnId: string; callId: string; files: PatchFile[]; ok: boolean; at: number }

  // Fallback
  | { type: 'raw'; turnId?: string; itemId?: string; payload: unknown; at: number };

/** Helpful narrowing alias. */
export type ChatStreamEventType = ChatStreamEvent['type'];
