import type { ChatStreamEvent, PatchFile, RawLine } from '../types.js';

export interface OpenCodeSubagentInput {
  /** Child session id; matches parent's task.state.metadata.sessionId */
  sessionId: string;
  /** Child session export wrapped as RawLine[] — same shape adapt() consumes. */
  lines: RawLine[];
}

export interface AdaptOpenCodeOptions {
  /**
   * How to render `edit` / `write` tool calls.
   * - 'function_call' (default): emit them as opaque function_call entries (cli compact mode).
   * - 'patch_apply_end': emit a patch_apply_end with a synthesized PatchFile[] (playground).
   */
  patchMode?: 'function_call' | 'patch_apply_end';
  /**
   * Optional OpenCode subagent exports to associate with this session's
   * `task` tool calls. When supplied, each task tool's output is rewritten
   * to a Markdown summary of the matched child (description / agent_type /
   * tools used / tokens / final reply). Lookup key:
   * `state.metadata.sessionId` on the parent's task tool part.
   * Unmatched task calls fall through to v0.2.0 opaque rendering.
   */
  subagents?: OpenCodeSubagentInput[];
}

const epoch = (n: unknown): number => (typeof n === 'number' ? n : Date.now());

const ocPrefixLines = (text: string, prefix: string): string => {
  if (!text) return '';
  return text.split('\n').map((l) => `${prefix}${l}`).join('\n');
};

const ocEditDiff = (oldStr: string, newStr: string): string =>
  `${ocPrefixLines(oldStr, '- ')}\n${ocPrefixLines(newStr, '+ ')}`;

const ocWriteDiff = (content: string): string => ocPrefixLines(content, '+ ');

function formatOpenCodeSubagentSummary(
  parentTaskInput: Record<string, unknown>,
  child: OpenCodeSubagentInput,
): string {
  const description = String(parentTaskInput.description ?? '(no description)');
  const agentType = String(parentTaskInput.subagent_type ?? 'unknown');

  const root = (child.lines.find(
    (l) => l && typeof l === 'object' && Array.isArray((l as Record<string, unknown>).messages),
  ) ?? {}) as { messages?: Array<Record<string, unknown>> };
  const messages = Array.isArray(root.messages) ? root.messages : [];

  const toolCounts = new Map<string, number>();
  let totalInput = 0;
  let totalOutput = 0;
  let finalText = '';

  for (const m of messages) {
    const minfo = (m.info ?? {}) as Record<string, unknown>;
    const role = String(minfo.role ?? '');
    const tokens = minfo.tokens as Record<string, unknown> | undefined;
    if (tokens) {
      if (typeof tokens.input === 'number') totalInput = Math.max(totalInput, tokens.input);
      if (typeof tokens.output === 'number') totalOutput += tokens.output;
    }
    const parts = Array.isArray(m.parts) ? (m.parts as Array<Record<string, unknown>>) : [];
    for (const p of parts) {
      const ptype = String(p.type ?? '');
      if (ptype === 'tool') {
        const name = String(p.tool ?? '?');
        if (name === 'step-start' || name === 'step-finish') continue;
        toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
      }
      if (ptype === 'text' && role === 'assistant' && typeof p.text === 'string' && p.text.length > 0) {
        finalText = p.text;
      }
    }
  }

  const lines: string[] = [];
  lines.push(`### ${description}`);
  lines.push(`*agent_type:* \`${agentType}\` · *session_id:* \`${child.sessionId}\``);
  lines.push('');
  if (toolCounts.size > 0) {
    const summary = [...toolCounts.entries()].map(([n, c]) => `\`${n}\` × ${c}`).join(', ');
    lines.push(`**Tools used:** ${summary}`);
    lines.push('');
  }
  if (totalInput || totalOutput) {
    lines.push(`**Tokens:** ${totalInput.toLocaleString()} in / ${totalOutput.toLocaleString()} out`);
    lines.push('');
  }
  lines.push('**Final reply:**');
  lines.push('');
  if (finalText) {
    lines.push('> ' + finalText.split('\n').join('\n> '));
  } else {
    lines.push('> (no reply)');
  }
  return lines.join('\n');
}

interface ToolPart {
  type: 'tool';
  tool: string;
  callID?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    output?: unknown;
    metadata?: Record<string, unknown>;
    time?: { start?: number; end?: number };
  };
  id?: string;
  messageID?: string;
}

interface ReasoningPart {
  type: 'reasoning';
  text?: string;
  time?: { start?: number; end?: number };
}

interface TextPart {
  type: 'text';
  text?: string;
}

type Part = ToolPart | ReasoningPart | TextPart | { type: string };

export function adaptOpenCode(
  lines: RawLine[],
  options: AdaptOpenCodeOptions = {},
): ChatStreamEvent[] {
  const patchMode = options.patchMode ?? 'function_call';
  const subagentList = options.subagents ?? [];
  const sessionIdToSubagent = new Map(subagentList.map((s) => [s.sessionId, s]));
  const out: ChatStreamEvent[] = [];

  // OpenCode is exported as a single JSON object; we accept it wrapped in
  // a one-element RawLine[] for parity with the other adapters.
  const root = (lines.find(
    (l) => l && typeof l === 'object' && Array.isArray((l as Record<string, unknown>).messages),
  ) ?? {}) as { info?: Record<string, unknown>; messages?: Array<Record<string, unknown>> };
  const info = root.info ?? {};
  const messages = Array.isArray(root.messages) ? root.messages : [];

  const sessionId = String(info.id ?? `oc-${Date.now()}`);
  const sessionTime = (info.time as Record<string, unknown> | undefined) ?? {};
  const sessionStart = epoch(sessionTime.created);
  out.push({ type: 'thread_started', threadId: sessionId, at: sessionStart });

  let currentTurnId: string | null = null;
  let lastTokens: { input: number; output: number; reasoning: number } | null = null;

  const closeTurn = (at: number) => {
    if (!currentTurnId) return;
    const evt: ChatStreamEvent = lastTokens
      ? {
          type: 'turn_completed', turnId: currentTurnId, at,
          usage: {
            inputTokens: lastTokens.input,
            outputTokens: lastTokens.output,
            reasoningOutputTokens: lastTokens.reasoning || undefined,
          },
        }
      : { type: 'turn_completed', turnId: currentTurnId, at };
    out.push(evt);
    currentTurnId = null;
    lastTokens = null;
  };

  for (const msg of messages) {
    const msgInfo = (msg.info ?? {}) as Record<string, unknown>;
    const role = String(msgInfo.role ?? '');
    const parts = (Array.isArray(msg.parts) ? msg.parts : []) as Part[];
    const msgTime = (msgInfo.time as Record<string, unknown> | undefined) ?? {};
    const at = epoch(msgTime.created);
    const msgId = String(msgInfo.id ?? `oc-msg-${out.length}`);

    if (role === 'user') {
      closeTurn(at);
      currentTurnId = msgId;
      out.push({ type: 'turn_started', turnId: currentTurnId, at });
      parts.forEach((p, idx) => {
        if (p.type === 'text' && typeof (p as TextPart).text === 'string' && (p as TextPart).text!.length > 0) {
          out.push({
            type: 'user_message',
            turnId: currentTurnId as string,
            itemId: `${msgId}:${idx}`,
            text: (p as TextPart).text as string,
            at,
          });
        }
      });
      continue;
    }

    if (role !== 'assistant') continue;
    if (!currentTurnId) {
      // Defensive: assistant before any user — open a synthetic turn so events have a parent.
      currentTurnId = msgId;
      out.push({ type: 'turn_started', turnId: currentTurnId, at });
    }

    const tokens = msgInfo.tokens as Record<string, unknown> | undefined;
    if (tokens) {
      const prev: { input: number; output: number; reasoning: number } =
        lastTokens ?? { input: 0, output: 0, reasoning: 0 };
      lastTokens = {
        input: typeof tokens.input === 'number' ? tokens.input : prev.input,
        output: typeof tokens.output === 'number' ? prev.output + tokens.output : prev.output,
        reasoning:
          typeof tokens.reasoning === 'number' ? prev.reasoning + tokens.reasoning : prev.reasoning,
      };
    }

    parts.forEach((p, idx) => {
      const itemId = `${msgId}:${idx}`;
      if (p.type === 'reasoning') {
        const text = (p as ReasoningPart).text ?? '';
        if (text.length === 0) return;
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
      if (p.type === 'text') {
        const text = (p as TextPart).text ?? '';
        if (text.length === 0) return;
        out.push({
          type: 'agent_message',
          turnId: currentTurnId as string,
          itemId,
          text,
          partial: false,
          at,
        });
        return;
      }
      if (p.type === 'tool') {
        const tp = p as ToolPart;
        const name = String(tp.tool ?? '');
        const callId = String(tp.callID ?? tp.id ?? `oc-tool-${out.length}`);
        const state = tp.state ?? {};
        const input = (state.input ?? {}) as Record<string, unknown>;
        const isError = state.status === 'error';
        const output = typeof state.output === 'string' ? state.output : JSON.stringify(state.output ?? '');

        if (name === 'task') {
          const meta = (state.metadata ?? {}) as Record<string, unknown>;
          const childId = typeof meta.sessionId === 'string' ? meta.sessionId : null;
          const sub = childId ? sessionIdToSubagent.get(childId) ?? null : null;
          const argsOut = {
            description: input.description,
            subagent_type: input.subagent_type,
            prompt: input.prompt,
          };
          out.push({
            type: 'function_call',
            turnId: currentTurnId as string,
            callId,
            name,
            args: argsOut,
            at,
          });
          const summary = sub ? formatOpenCodeSubagentSummary(input, sub) : output;
          const evt: ChatStreamEvent = isError && !sub
            ? { type: 'function_call_output', turnId: currentTurnId as string, callId, error: summary, at }
            : { type: 'function_call_output', turnId: currentTurnId as string, callId, output: summary, at };
          out.push(evt);
          return;
        }

        if (name === 'bash') {
          out.push({
            type: 'exec_command_begin',
            turnId: currentTurnId as string,
            callId,
            command: String(input.command ?? ''),
            at,
          });
          out.push({
            type: 'exec_command_end',
            turnId: currentTurnId as string,
            callId,
            exit: isError ? 1 : 0,
            stdout: isError ? '' : output,
            stderr: isError ? output : '',
            durationMs:
              state.time?.start && state.time?.end ? state.time.end - state.time.start : 0,
            at,
          });
          return;
        }

        if (patchMode === 'patch_apply_end' && name === 'edit') {
          const files: PatchFile[] = [{
            path: String(input.filePath ?? ''),
            status: 'modified',
            diff: ocEditDiff(String(input.oldString ?? ''), String(input.newString ?? '')),
          }];
          out.push({
            type: 'patch_apply_end',
            turnId: currentTurnId as string,
            callId,
            files,
            ok: !isError,
            at,
          });
          return;
        }
        if (patchMode === 'patch_apply_end' && name === 'write') {
          const files: PatchFile[] = [{
            path: String(input.filePath ?? ''),
            status: 'added',
            diff: ocWriteDiff(String(input.content ?? '')),
          }];
          out.push({
            type: 'patch_apply_end',
            turnId: currentTurnId as string,
            callId,
            files,
            ok: !isError,
            at,
          });
          return;
        }

        // Fallback: opaque function_call + function_call_output (covers
        // read / glob / grep / write / edit-when-patchMode='function_call' /
        // any unknown tool name).
        out.push({
          type: 'function_call',
          turnId: currentTurnId as string,
          callId,
          name,
          args: input,
          at,
        });
        const evt: ChatStreamEvent = isError
          ? { type: 'function_call_output', turnId: currentTurnId as string, callId, error: output, at }
          : { type: 'function_call_output', turnId: currentTurnId as string, callId, output, at };
        out.push(evt);
        return;
      }
      // step-start / step-finish / unknown part types → silently dropped.
    });
  }

  if (currentTurnId) {
    const lastAt = out[out.length - 1]?.at ?? sessionStart;
    closeTurn(lastAt);
  }

  return out;
}
