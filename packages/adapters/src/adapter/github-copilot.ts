import type { ChatStreamEvent, DetectedFormat, RawLine } from '../types.js';
import type { AdaptResult } from './index.js';

export interface AdaptGithubCopilotOptions {
  patchMode?: 'function_call' | 'patch_apply_end';
}

interface CopilotSession {
  version: number;
  sessionId: string;
  creationDate: number;
  lastMessageDate?: number;
  requests: CopilotRequest[];
}

interface CopilotRequest {
  requestId: string;
  timestamp: number;
  agent: { extensionId?: { value?: string }; name?: string };
  modelId?: string;
  message: { text: string };
  response: CopilotResponseItem[];
  result?: { timings?: { totalElapsed?: number } };
}

type CopilotResponseItem =
  | { kind?: undefined; value: string }
  | { kind: 'prepareToolInvocation'; toolName: string }
  | { kind: 'mcpServersStarting'; servers?: string[] }
  | CopilotToolInvocation;

interface CopilotToolInvocation {
  kind: 'toolInvocationSerialized';
  toolId: string;
  toolCallId: string;
  isComplete: boolean;
  invocationMessage?: string;
  source?: { type?: 'internal' | 'mcp' | string; label?: string; serverId?: string };
  toolSpecificData?: { kind?: string; [k: string]: unknown };
}

export function adaptGithubCopilot(
  input: RawLine[] | CopilotSession,
  options: AdaptGithubCopilotOptions = {},
): AdaptResult {
  const session = (Array.isArray(input) ? input[0] : input) as CopilotSession | undefined;
  if (!session || typeof session !== 'object' || !Array.isArray(session.requests)) {
    return { format: 'github-copilot', events: [] };
  }

  const patchMode = options.patchMode ?? 'function_call';

  const events: ChatStreamEvent[] = [];
  events.push({ type: 'thread_started', threadId: session.sessionId, at: session.creationDate });

  for (const req of session.requests) {
    if (!req || !req.message) continue;
    const turnId = req.requestId;
    const at = req.timestamp;

    events.push({ type: 'turn_started', turnId, at });
    events.push({ type: 'user_message', turnId, itemId: `${turnId}-user`, text: req.message.text ?? '', at });

    // Concatenate adjacent text response items into one agent_message segment.
    let textBuf = '';
    let textIndex = 0;
    const flushText = () => {
      if (textBuf.length > 0) {
        events.push({
          type: 'agent_message',
          turnId,
          itemId: `${turnId}-text-${textIndex++}`,
          text: textBuf,
          partial: false,
          at,
        });
        textBuf = '';
      }
    };

    for (const item of req.response ?? []) {
      if (!item) continue;
      if ((item as any).kind === undefined && typeof (item as any).value === 'string') {
        textBuf += (textBuf ? '\n' : '') + (item as any).value;
        continue;
      }
      flushText();
      handleToolItem(item as any, turnId, at, events, patchMode);
    }
    flushText();

    const elapsed = req.result?.timings?.totalElapsed ?? 0;
    events.push({ type: 'turn_completed', turnId, at: at + elapsed });
  }

  return { format: 'github-copilot', events };
}

function handleToolItem(
  item: CopilotResponseItem,
  turnId: string,
  at: number,
  events: ChatStreamEvent[],
  patchMode: 'function_call' | 'patch_apply_end',
): void {
  const k = (item as any).kind;
  if (k === 'prepareToolInvocation' || k === 'mcpServersStarting') return; // drop
  if (k !== 'toolInvocationSerialized') return; // unknown kind, drop quietly

  const tool = item as CopilotToolInvocation;
  const callId = tool.toolCallId;
  const tsd = tool.toolSpecificData ?? {};
  const tsdKind = (tsd as any).kind as string | undefined;

  if (tsdKind === 'terminal') {
    const cmd: string =
      (tsd as any).commandLine?.original ??
      (tsd as any).commandLine?.toolEdited ??
      '';
    const state = (tsd as any).terminalCommandState ?? {};
    const out = (tsd as any).terminalCommandOutput ?? {};
    events.push({ type: 'exec_command_begin', turnId, callId, command: cmd, at });
    events.push({
      type: 'exec_command_end',
      turnId,
      callId,
      exit: typeof state.exitCode === 'number' ? state.exitCode : 0,
      stdout: typeof out.text === 'string' ? out.text : '',
      stderr: '',
      durationMs: typeof state.duration === 'number' ? state.duration : 0,
      at,
    });
    return;
  }

  const EDIT_TOOLS = new Set(['insert_edit_into_file', 'apply_patch', 'create_file', 'replace_string_in_file']);
  if (EDIT_TOOLS.has(tool.toolId)) {
    if (patchMode === 'patch_apply_end') {
      const path: string =
        (tsd as any).filePath ?? (tsd as any).path ?? (tsd as any).file ?? '<unknown>';
      const status: 'added' | 'modified' =
        tool.toolId === 'create_file' ? 'added' : 'modified';
      events.push({
        type: 'patch_apply_end',
        turnId,
        callId,
        ok: tool.isComplete,
        files: [{ path, status, diff: (tsd as any).code ?? (tsd as any).newString ?? '' }],
        at,
      });
    } else {
      events.push({
        type: 'function_call',
        turnId,
        callId,
        name: tool.toolId,
        args: tsd,
        at,
      });
      events.push({
        type: 'function_call_output',
        turnId,
        callId,
        output: tool.invocationMessage ?? 'ok',
        at,
      });
    }
    return;
  }

  // Generic fallback in Task 6.
}
