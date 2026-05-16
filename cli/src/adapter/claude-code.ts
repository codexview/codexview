import type { ChatStreamEvent, PatchFile, RawLine } from '../types.js';

const epoch = (iso: unknown): number => {
  if (typeof iso === 'number') return iso;
  if (typeof iso !== 'string') return Date.now();
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Date.now() : ms;
};

const ccPrefixLines = (text: string, prefix: string): string => {
  if (!text) return '';
  return text.split('\n').map((line) => `${prefix}${line}`).join('\n');
};

const ccEditDiff = (oldStr: string, newStr: string): string =>
  `${ccPrefixLines(oldStr, '- ')}\n${ccPrefixLines(newStr, '+ ')}`;

const ccWriteDiff = (content: string): string => ccPrefixLines(content, '+ ');

const ccMultiEditDiff = (edits: Array<Record<string, unknown>>): string =>
  edits
    .map((e) => `${ccPrefixLines(String(e?.old_string || ''), '- ')}\n${ccPrefixLines(String(e?.new_string || ''), '+ ')}`)
    .join('\n\n');

type PendingKind = 'exec' | 'todo' | 'patch' | 'mcp' | 'agent' | 'function';
interface PendingEntry {
  kind: PendingKind;
  files?: PatchFile[];
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

export function adaptClaudeCode(lines: RawLine[]): ChatStreamEvent[] {
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
            files: p.files || [],
            ok: !isError,
            at,
          });
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
        if (p?.kind === 'agent' || p?.kind === 'function') {
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
          if (name === 'Edit') {
            pending.set(callId, {
              kind: 'patch',
              files: [{
                path: String(input.file_path || ''),
                status: 'modified',
                diff: ccEditDiff(String(input.old_string || ''), String(input.new_string || '')),
              }],
            });
            return;
          }
          if (name === 'Write') {
            pending.set(callId, {
              kind: 'patch',
              files: [{
                path: String(input.file_path || ''),
                status: 'added',
                diff: ccWriteDiff(String(input.content || '')),
              }],
            });
            return;
          }
          if (name === 'MultiEdit') {
            const edits = Array.isArray(input.edits) ? input.edits as Record<string, unknown>[] : [];
            pending.set(callId, {
              kind: 'patch',
              files: [{
                path: String(input.file_path || ''),
                status: 'modified',
                diff: ccMultiEditDiff(edits),
              }],
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
