import type { ChatStreamEvent, PatchFile, RawLine, SearchResult } from '../types.js';

const epoch = (iso: unknown): number => {
  if (typeof iso === 'number') return iso;
  if (typeof iso !== 'string') return Date.now();
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Date.now() : ms;
};

export interface SubagentInput {
  agentId: string;
  meta?: { agentType?: string; description?: string } | null;
  lines: unknown[];
}

export interface AdaptClaudeCodeOptions {
  /**
   * How to render Edit / Write / MultiEdit tool calls.
   * - 'function_call' (default): emit them as opaque `function_call`
   *   entries — matches the compact output the cli ships.
   * - 'patch_apply_end': defer emission until the matching tool_result,
   *   then emit a `patch_apply_end` with a synthesized PatchFile[]
   *   containing diff text. Used by the playground to render diffs.
   */
  patchMode?: 'function_call' | 'patch_apply_end';
  /**
   * Optional Claude Code subagent transcripts to associate with this
   * session's `Agent` tool calls. When supplied, each `Agent` tool's
   * tool_result is rewritten to embed a Markdown summary of the matching
   * subagent (primary lookup by `toolUseResult.agentId` on the parent's
   * user-type tool_result line, fallback to FIFO over the supplied list).
   */
  subagents?: SubagentInput[];
}

type PendingEntry =
  | { kind: 'exec' | 'todo' | 'mcp' | 'agent' | 'function' | 'web_search' }
  | { kind: 'patch'; files: PatchFile[] };

const ccPrefixLines = (text: string, prefix: string): string => {
  if (!text) return '';
  return text.split('\n').map((l) => `${prefix}${l}`).join('\n');
};

const ccEditDiff = (oldStr: string, newStr: string): string =>
  `${ccPrefixLines(oldStr, '- ')}\n${ccPrefixLines(newStr, '+ ')}`;

const ccWriteDiff = (content: string): string => ccPrefixLines(content, '+ ');

const ccMultiEditDiff = (edits: Array<Record<string, unknown>>): string =>
  edits
    .map((e) =>
      `${ccPrefixLines(String(e?.old_string ?? ''), '- ')}\n${ccPrefixLines(String(e?.new_string ?? ''), '+ ')}`,
    )
    .join('\n\n');

function formatSubagentSummary(sub: SubagentInput): string {
  const lines: string[] = [];
  const desc = sub.meta?.description ?? '(no description)';
  const type = sub.meta?.agentType ?? 'unknown';
  lines.push(`### ${desc}`);
  lines.push(`*agent_type:* \`${type}\` · *agent_id:* \`${sub.agentId}\``);
  lines.push('');

  let finalText = '';
  let totalInput = 0;
  let totalOutput = 0;
  const toolCounts = new Map<string, number>();
  for (const ln of sub.lines ?? []) {
    if (!ln || typeof ln !== 'object') continue;
    const lr = ln as Record<string, unknown>;
    if (lr.type !== 'assistant') continue;
    const message = lr.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (!c || typeof c !== 'object') continue;
        const cr = c as Record<string, unknown>;
        if (cr.type === 'text' && typeof cr.text === 'string') finalText = cr.text;
        if (cr.type === 'tool_use' && typeof cr.name === 'string') {
          toolCounts.set(cr.name, (toolCounts.get(cr.name) ?? 0) + 1);
        }
      }
    }
    const u = message?.usage as Record<string, unknown> | undefined;
    if (u) {
      if (typeof u.input_tokens === 'number') totalInput = Math.max(totalInput, u.input_tokens);
      if (typeof u.output_tokens === 'number') totalOutput += u.output_tokens;
    }
  }

  if (toolCounts.size > 0) {
    const summary = [...toolCounts.entries()].map(([n, c]) => `\`${n}\` × ${c}`).join(', ');
    lines.push(`**Tools used:** ${summary}`);
    lines.push('');
  }
  if (totalInput || totalOutput) {
    lines.push(`**Tokens:** ${totalInput.toLocaleString()} in / ${totalOutput.toLocaleString()} out`);
    lines.push('');
  }
  if (finalText) {
    lines.push('**Final reply:**');
    lines.push('');
    lines.push('> ' + finalText.split('\n').join('\n> '));
  }
  return lines.join('\n');
}

interface UsageBucket { lastInput: number; sumOutput: number }

function isTextUser(msg: Record<string, unknown> | undefined): boolean {
  if (!msg) return false;
  const content = msg.content;
  if (typeof content === 'string') return true;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((c) => c && typeof c === 'object' && (c as { type?: unknown }).type === 'text');
}

function toolResultText(item: Record<string, unknown>): string {
  const c = item.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object') {
          const text = (p as { text?: unknown }).text;
          if (typeof text === 'string') return text;
          return JSON.stringify(p);
        }
        return '';
      })
      .join('\n');
  }
  if (c == null) return '';
  return JSON.stringify(c);
}

export function adaptClaudeCode(
  lines: RawLine[],
  options: AdaptClaudeCodeOptions = {},
): ChatStreamEvent[] {
  const patchMode = options.patchMode ?? 'function_call';
  const subagentList = options.subagents ?? [];
  const agentIdToSubagent = new Map(subagentList.map((s) => [s.agentId, s]));
  const subagentQueue = [...subagentList];
  const consumedAgentIds = new Set<string>();

  const out: ChatStreamEvent[] = [];
  let threadStarted = false;
  const skipTypes = new Set(['attachment', 'system', 'last-prompt', 'queue-operation']);

  let currentTurnId: string | null = null;
  let turnUsage: UsageBucket | null = null;
  const pending = new Map<string, PendingEntry>();

  const closeTurn = (at: number) => {
    if (!currentTurnId) return;
    const usage = turnUsage
      ? {
          inputTokens: turnUsage.lastInput || 0,
          outputTokens: turnUsage.sumOutput || 0,
        }
      : undefined;
    const evt: ChatStreamEvent = usage
      ? { type: 'turn_completed', turnId: currentTurnId, at, usage }
      : { type: 'turn_completed', turnId: currentTurnId, at };
    out.push(evt);
    currentTurnId = null;
    turnUsage = null;
  };

  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    if ((line as RawLine).isSidechain === true) continue;

    const at = epoch((line as RawLine).timestamp);

    if (!threadStarted && typeof line.sessionId === 'string' && line.sessionId.length > 0) {
      out.push({ type: 'thread_started', threadId: line.sessionId, at });
      threadStarted = true;
    }

    const lineType = String(line.type || '');
    if (skipTypes.has(lineType)) continue;

    if (lineType === 'user' && line.message) {
      const message = line.message as Record<string, unknown>;
      if (isTextUser(message)) {
        closeTurn(at);
        currentTurnId = String(line.uuid || `cc-turn-${out.length}`);
        turnUsage = { lastInput: 0, sumOutput: 0 };
        out.push({ type: 'turn_started', turnId: currentTurnId, at });

        const content = message.content;
        if (typeof content === 'string') {
          out.push({
            type: 'user_message', turnId: currentTurnId, itemId: currentTurnId, text: content, at,
          });
        } else if (Array.isArray(content)) {
          content.forEach((c, idx) => {
            const text = c && typeof c === 'object' ? String((c as { text?: unknown }).text || '') : '';
            out.push({
              type: 'user_message',
              turnId: currentTurnId as string,
              itemId: `${currentTurnId}:${idx}`,
              text,
              at,
            });
          });
        }
        continue;
      }
      if (!currentTurnId) continue;
      const content = message.content;
      if (!Array.isArray(content)) continue;
      for (const item of content) {
        if (!item || typeof item !== 'object') continue;
        const it = item as Record<string, unknown>;
        if (it.type !== 'tool_result') continue;
        const callId = String(it.tool_use_id || `cc-tr-${out.length}`);
        const isError = it.is_error === true;
        const text = toolResultText(it);
        const p = pending.get(callId);

        if (p?.kind === 'exec') {
          out.push({
            type: 'exec_command_end',
            turnId: currentTurnId,
            callId,
            exit: isError ? 1 : 0,
            stdout: isError ? '' : text,
            stderr: isError ? text : '',
            durationMs: 0,
            at,
          });
          pending.delete(callId);
          continue;
        }
        if (p?.kind === 'todo') {
          pending.delete(callId);
          continue;
        }
        if (p?.kind === 'patch') {
          out.push({
            type: 'patch_apply_end',
            turnId: currentTurnId,
            callId,
            files: p.files,
            ok: !isError,
            at,
          });
          pending.delete(callId);
          continue;
        }
        if (p?.kind === 'web_search') {
          if (!isError) {
            const match = text.match(/^Links:\s*(\[.*?\])\s*$/m);
            if (match) {
              try {
                const links = JSON.parse(match[1] ?? '[]') as Array<{ title?: unknown; url?: unknown }>;
                if (Array.isArray(links)) {
                  const results: SearchResult[] = links
                    .filter((l) => typeof l?.url === 'string' && typeof l?.title === 'string')
                    .map((l) => ({ title: l.title as string, url: l.url as string }));
                  out.push({ type: 'web_search_end', turnId: currentTurnId, callId, results, at });
                  pending.delete(callId);
                  continue;
                }
              } catch { /* fall through to function_call_output */ }
            }
          }
          const evt: ChatStreamEvent = isError
            ? { type: 'function_call_output', turnId: currentTurnId, callId, error: text, at }
            : { type: 'function_call_output', turnId: currentTurnId, callId, output: text, at };
          out.push(evt);
          pending.delete(callId);
          continue;
        }
        if (p?.kind === 'mcp') {
          const evt: ChatStreamEvent = isError
            ? { type: 'mcp_tool_call_output', turnId: currentTurnId, callId, error: text, at }
            : { type: 'mcp_tool_call_output', turnId: currentTurnId, callId, output: text, at };
          out.push(evt);
          pending.delete(callId);
          continue;
        }
        if (p?.kind === 'agent') {
          let sub: SubagentInput | null = null;
          const toolUseResult = (line as RawLine).toolUseResult as { agentId?: unknown } | undefined;
          const agentId = typeof toolUseResult?.agentId === 'string' ? toolUseResult.agentId : null;
          if (agentId && agentIdToSubagent.has(agentId) && !consumedAgentIds.has(agentId)) {
            sub = agentIdToSubagent.get(agentId) ?? null;
            consumedAgentIds.add(agentId);
          } else if (subagentList.length > 0) {
            while (subagentQueue.length > 0) {
              const candidate = subagentQueue.shift();
              if (candidate && !consumedAgentIds.has(candidate.agentId)) {
                sub = candidate;
                consumedAgentIds.add(candidate.agentId);
                break;
              }
            }
          }
          const output = sub && !isError ? formatSubagentSummary(sub) : text;
          const evt: ChatStreamEvent = isError
            ? { type: 'function_call_output', turnId: currentTurnId, callId, error: output, at }
            : { type: 'function_call_output', turnId: currentTurnId, callId, output, at };
          out.push(evt);
          pending.delete(callId);
          continue;
        }
        if (p?.kind === 'function') {
          const evt: ChatStreamEvent = isError
            ? { type: 'function_call_output', turnId: currentTurnId, callId, error: text, at }
            : { type: 'function_call_output', turnId: currentTurnId, callId, output: text, at };
          out.push(evt);
          pending.delete(callId);
          continue;
        }
        // orphan tool_result without matching tool_use
        const evt: ChatStreamEvent = isError
          ? { type: 'function_call_output', turnId: currentTurnId, callId, error: text, at }
          : { type: 'function_call_output', turnId: currentTurnId, callId, output: text, at };
        out.push(evt);
      }
      continue;
    }

    if (lineType === 'assistant' && line.message) {
      if (!currentTurnId) continue;
      const message = line.message as Record<string, unknown>;
      const usage = message.usage as Record<string, unknown> | undefined;
      if (usage && turnUsage) {
        if (typeof usage.input_tokens === 'number') turnUsage.lastInput = usage.input_tokens;
        if (typeof usage.output_tokens === 'number') turnUsage.sumOutput = (turnUsage.sumOutput || 0) + usage.output_tokens;
      }
      const content = message.content;
      if (!Array.isArray(content)) continue;
      const asstUuid = String(line.uuid || `cc-a-${out.length}`);

      content.forEach((c, idx) => {
        if (!c || typeof c !== 'object') return;
        const cc = c as Record<string, unknown>;
        const itemId = `${asstUuid}:${idx}`;
        if (cc.type === 'text') {
          out.push({
            type: 'agent_message',
            turnId: currentTurnId as string,
            itemId,
            text: String(cc.text || ''),
            partial: false,
            at,
          });
          return;
        }
        if (cc.type === 'thinking') {
          const text = typeof cc.thinking === 'string' ? cc.thinking : '';
          if (!text) return;
          out.push({
            type: 'reasoning',
            turnId: currentTurnId as string,
            itemId,
            text,
            partial: false,
            at,
          });
          return;
        }
        if (cc.type === 'tool_use') {
          const callId = String(cc.id || `cc-tu-${out.length}`);
          const name = String(cc.name || '');
          const input = (cc.input as Record<string, unknown> | undefined) ?? {};

          if (name === 'Bash') {
            pending.set(callId, { kind: 'exec' });
            out.push({
              type: 'exec_command_begin',
              turnId: currentTurnId as string,
              callId,
              command: String(input.command || ''),
              at,
            });
            return;
          }
          if (name === 'TodoWrite') {
            pending.set(callId, { kind: 'todo' });
            const todos = Array.isArray(input.todos) ? input.todos as Record<string, unknown>[] : [];
            out.push({
              type: 'todo_list',
              turnId: currentTurnId as string,
              itemId: callId,
              items: todos.map((t) => ({
                text: String(t?.content || ''),
                completed: t?.status === 'completed',
              })),
              at,
            });
            return;
          }
          if (patchMode === 'patch_apply_end' && name === 'Edit') {
            pending.set(callId, {
              kind: 'patch',
              files: [{
                path: String(input.file_path ?? ''),
                status: 'modified',
                diff: ccEditDiff(String(input.old_string ?? ''), String(input.new_string ?? '')),
              }],
            });
            return;
          }
          if (patchMode === 'patch_apply_end' && name === 'Write') {
            pending.set(callId, {
              kind: 'patch',
              files: [{
                path: String(input.file_path ?? ''),
                status: 'added',
                diff: ccWriteDiff(String(input.content ?? '')),
              }],
            });
            return;
          }
          if (patchMode === 'patch_apply_end' && name === 'MultiEdit') {
            const edits = Array.isArray(input.edits)
              ? (input.edits as Record<string, unknown>[])
              : [];
            pending.set(callId, {
              kind: 'patch',
              files: [{
                path: String(input.file_path ?? ''),
                status: 'modified',
                diff: ccMultiEditDiff(edits),
              }],
            });
            return;
          }
          if (name === 'WebSearch') {
            pending.set(callId, { kind: 'web_search' });
            out.push({
              type: 'web_search_call',
              turnId: currentTurnId as string,
              callId,
              query: String(input.query ?? ''),
              at,
            });
            return;
          }
          if (name.startsWith('mcp__')) {
            const parts = name.split('__');
            const server = parts[1] || '';
            const toolName = parts.slice(2).join('__') || name;
            pending.set(callId, { kind: 'mcp' });
            out.push({
              type: 'mcp_tool_call',
              turnId: currentTurnId as string,
              callId,
              server,
              name: toolName,
              args: input,
              at,
            });
            return;
          }
          if (name === 'Agent') {
            pending.set(callId, { kind: 'agent' });
            out.push({
              type: 'function_call',
              turnId: currentTurnId as string,
              callId,
              name: 'Agent',
              args: input,
              at,
            });
            return;
          }
          pending.set(callId, { kind: 'function' });
          out.push({
            type: 'function_call',
            turnId: currentTurnId as string,
            callId,
            name,
            args: input,
            at,
          });
          return;
        }
      });
      continue;
    }
  }

  if (currentTurnId) {
    closeTurn(out[out.length - 1]?.at ?? Date.now());
  }

  return out;
}
