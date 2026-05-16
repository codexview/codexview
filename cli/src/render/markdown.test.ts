import { describe, it, expect } from 'vitest';
import { render } from './markdown.js';
import type { ChatStreamEvent } from '../types.js';

describe('render', () => {
  it('emits a session heading from thread_started', () => {
    const events: ChatStreamEvent[] = [
      { type: 'thread_started', threadId: 'T1', at: 0 },
      { type: 'turn_started', turnId: 'A', at: 1 },
      { type: 'user_message', turnId: 'A', itemId: 'u', text: 'hello', at: 2 },
      { type: 'agent_message', turnId: 'A', itemId: 'a', text: 'hi', partial: false, at: 3 },
      { type: 'turn_completed', turnId: 'A', at: 4 },
    ];
    const md = render(events);
    expect(md.startsWith('# Session T1')).toBe(true);
  });

  it('uses role headings and renders reasoning as blockquote', () => {
    const md = render([
      { type: 'thread_started', threadId: 'T', at: 0 },
      { type: 'turn_started', turnId: 'A', at: 1 },
      { type: 'user_message', turnId: 'A', itemId: 'u', text: 'q', at: 2 },
      { type: 'reasoning', turnId: 'A', itemId: 'r', text: 'thinking', partial: false, at: 3 },
      { type: 'agent_message', turnId: 'A', itemId: 'a', text: 'a', partial: false, at: 4 },
      { type: 'turn_completed', turnId: 'A', at: 5 },
    ]);
    expect(md).toContain('## User');
    expect(md).toContain('## Assistant (reasoning)');
    expect(md).toContain('## Assistant');
    expect(md).toContain('> thinking');
  });

  it('renders tool calls as 🔧 lines and drops outputs', () => {
    const md = render([
      { type: 'thread_started', threadId: 'T', at: 0 },
      { type: 'turn_started', turnId: 'A', at: 1 },
      { type: 'exec_command_begin', turnId: 'A', callId: 'c1', command: 'ls -la', at: 2 },
      { type: 'exec_command_end', turnId: 'A', callId: 'c1', exit: 0, stdout: 'huge output', stderr: '', durationMs: 1, at: 3 },
      { type: 'turn_completed', turnId: 'A', at: 4 },
    ]);
    expect(md).toContain('🔧 `Bash` ls -la');
    expect(md).not.toContain('huge output');
  });

  it('forces a new ## Assistant heading after tool calls between two text segments', () => {
    const md = render([
      { type: 'thread_started', threadId: 'T', at: 0 },
      { type: 'turn_started', turnId: 'A', at: 1 },
      { type: 'agent_message', turnId: 'A', itemId: 'a1', text: 'before', partial: false, at: 2 },
      { type: 'exec_command_begin', turnId: 'A', callId: 'c1', command: 'ls', at: 3 },
      { type: 'agent_message', turnId: 'A', itemId: 'a2', text: 'after', partial: false, at: 4 },
      { type: 'turn_completed', turnId: 'A', at: 5 },
    ]);
    const matches = md.match(/^## Assistant$/gm);
    expect(matches?.length).toBe(2);
  });

  it('separates turns with ---', () => {
    const md = render([
      { type: 'thread_started', threadId: 'T', at: 0 },
      { type: 'turn_started', turnId: 'A', at: 1 },
      { type: 'user_message', turnId: 'A', itemId: 'u1', text: 'q1', at: 2 },
      { type: 'turn_completed', turnId: 'A', at: 3 },
      { type: 'turn_started', turnId: 'B', at: 4 },
      { type: 'user_message', turnId: 'B', itemId: 'u2', text: 'q2', at: 5 },
      { type: 'turn_completed', turnId: 'B', at: 6 },
    ]);
    expect(md).toContain('\n---\n');
    expect((md.match(/\n---\n/g) || []).length).toBe(1);
  });

  it('annotates turn_failed with the error message', () => {
    const md = render([
      { type: 'thread_started', threadId: 'T', at: 0 },
      { type: 'turn_started', turnId: 'A', at: 1 },
      { type: 'user_message', turnId: 'A', itemId: 'u', text: 'q', at: 2 },
      { type: 'turn_failed', turnId: 'A', at: 3, error: { message: 'boom' } },
    ]);
    expect(md).toContain('_(turn failed: boom)_');
  });

  it('renders mcp_tool_call as 🔧 `mcp__server.tool`', () => {
    const md = render([
      { type: 'thread_started', threadId: 'T', at: 0 },
      { type: 'turn_started', turnId: 'A', at: 1 },
      { type: 'mcp_tool_call', turnId: 'A', callId: 'c', server: 'gh', name: 'list', args: {}, at: 2 },
      { type: 'mcp_tool_call_output', turnId: 'A', callId: 'c', output: 'huge mcp output', at: 3 },
      { type: 'turn_completed', turnId: 'A', at: 4 },
    ]);
    expect(md).toContain('🔧 `mcp__gh.list`');
    expect(md).not.toContain('huge mcp output');
  });

  it('drops function_call_output payloads', () => {
    const md = render([
      { type: 'thread_started', threadId: 'T', at: 0 },
      { type: 'turn_started', turnId: 'A', at: 1 },
      { type: 'function_call', turnId: 'A', callId: 'f', name: 'Read', args: { file_path: 'foo' }, at: 2 },
      { type: 'function_call_output', turnId: 'A', callId: 'f', output: 'huge file content', at: 3 },
      { type: 'turn_completed', turnId: 'A', at: 4 },
    ]);
    expect(md).not.toContain('huge file content');
    expect(md).toContain('🔧 `Read` foo');
  });

  it('groups consecutive tool calls without blank lines between', () => {
    const md = render([
      { type: 'thread_started', threadId: 'T', at: 0 },
      { type: 'turn_started', turnId: 'A', at: 1 },
      { type: 'exec_command_begin', turnId: 'A', callId: 'c1', command: 'ls', at: 2 },
      { type: 'function_call', turnId: 'A', callId: 'f', name: 'Read', args: { file_path: 'a.ts' }, at: 3 },
      { type: 'turn_completed', turnId: 'A', at: 4 },
    ]);
    expect(md).toMatch(/🔧 `Bash` ls\n🔧 `Read` a\.ts/);
  });
});
