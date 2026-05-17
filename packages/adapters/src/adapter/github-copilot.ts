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
  _options: AdaptGithubCopilotOptions = {},
): AdaptResult {
  const session = (Array.isArray(input) ? input[0] : input) as CopilotSession | undefined;
  if (!session || typeof session !== 'object' || !Array.isArray(session.requests)) {
    return { format: 'github-copilot', events: [] };
  }

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
      // Tool / mcp / prepare events handled in Task 4–6.
    }
    flushText();

    const elapsed = req.result?.timings?.totalElapsed ?? 0;
    events.push({ type: 'turn_completed', turnId, at: at + elapsed });
  }

  return { format: 'github-copilot', events };
}
