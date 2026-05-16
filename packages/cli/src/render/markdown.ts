import type { ChatStreamEvent } from '@codexview/adapters';
import {
  summarizeFunctionCall, summarizeExec, summarizeMcpCall,
  summarizePatch, summarizeWebSearch, summarizeTodoList,
} from './tool-summary.js';

interface TurnState {
  lastRole: 'user' | 'assistant' | 'reasoning' | null;
  lastWasToolCall: boolean;
  status: { kind: 'failed' | 'aborted'; message: string } | null;
  buffer: string[];
}

const newTurn = (): TurnState => ({
  lastRole: null, lastWasToolCall: false, status: null, buffer: [],
});

const blockquote = (text: string): string =>
  text.split('\n').map((l) => `> ${l}`).join('\n');

const toolLine = (name: string, summary: string): string =>
  summary ? `🔧 \`${name}\` ${summary}` : `🔧 \`${name}\``;

function appendTool(turn: TurnState, line: string): void {
  if (turn.lastWasToolCall) {
    const last = turn.buffer[turn.buffer.length - 1];
    turn.buffer[turn.buffer.length - 1] = `${last}\n${line}`;
  } else {
    turn.buffer.push(line);
    turn.lastWasToolCall = true;
  }
}

export function render(events: ChatStreamEvent[]): string {
  const sections: string[] = [];
  let threadId: string | null = null;
  let turn = newTurn();
  let turnOpen = false;

  const ensureTurnOpen = () => { if (!turnOpen) turnOpen = true; };

  const flushTurn = () => {
    if (!turnOpen) return;
    if (turn.status) {
      const label = turn.status.kind;
      const msg = turn.status.message;
      turn.buffer.push(`_(turn ${label}${msg ? ': ' + msg : ''})_`);
    }
    sections.push(turn.buffer.join('\n\n'));
    turn = newTurn();
    turnOpen = false;
  };

  for (const e of events) {
    switch (e.type) {
      case 'thread_started':
        threadId = e.threadId;
        break;

      case 'turn_started':
        flushTurn();
        turnOpen = true;
        break;

      case 'turn_completed':
        flushTurn();
        break;

      case 'turn_failed':
        ensureTurnOpen();
        turn.status = { kind: 'failed', message: e.error?.message || '' };
        flushTurn();
        break;

      case 'turn_aborted':
        ensureTurnOpen();
        turn.status = { kind: 'aborted', message: e.reason || '' };
        flushTurn();
        break;

      case 'user_message': {
        ensureTurnOpen();
        turn.buffer.push(`## User\n${e.text}`);
        turn.lastRole = 'user';
        turn.lastWasToolCall = false;
        break;
      }

      case 'agent_message': {
        ensureTurnOpen();
        if (turn.lastRole === 'assistant' && !turn.lastWasToolCall) {
          const last = turn.buffer[turn.buffer.length - 1];
          turn.buffer[turn.buffer.length - 1] = `${last}\n\n${e.text}`;
        } else {
          turn.buffer.push(`## Assistant\n${e.text}`);
        }
        turn.lastRole = 'assistant';
        turn.lastWasToolCall = false;
        break;
      }

      case 'reasoning': {
        ensureTurnOpen();
        if (!e.text) break;
        turn.buffer.push(`## Assistant (reasoning)\n${blockquote(e.text)}`);
        turn.lastRole = 'reasoning';
        turn.lastWasToolCall = false;
        break;
      }

      case 'function_call': {
        ensureTurnOpen();
        appendTool(turn, toolLine(e.name, summarizeFunctionCall(e.name, e.args)));
        break;
      }

      case 'exec_command_begin': {
        ensureTurnOpen();
        appendTool(turn, toolLine('Bash', summarizeExec(e.command)));
        break;
      }

      case 'mcp_tool_call': {
        ensureTurnOpen();
        appendTool(turn, toolLine(`mcp__${summarizeMcpCall(e.server, e.name)}`, ''));
        break;
      }

      case 'patch_apply_end': {
        ensureTurnOpen();
        appendTool(turn, toolLine('patch', summarizePatch(e.files)));
        break;
      }

      case 'web_search_call': {
        ensureTurnOpen();
        appendTool(turn, toolLine('WebSearch', summarizeWebSearch(e.query)));
        break;
      }

      case 'todo_list': {
        ensureTurnOpen();
        appendTool(turn, toolLine('TodoWrite', summarizeTodoList(e.items)));
        break;
      }

      case 'function_call_output':
      case 'exec_command_end':
      case 'mcp_tool_call_output':
      case 'web_search_end':
      case 'raw':
      case 'error_item':
        break;
    }
  }

  flushTurn();

  const heading = threadId ? `# Session ${threadId}\n` : '';
  const body = sections.join('\n\n---\n\n');
  return heading + (body ? `\n${body}\n` : '');
}
