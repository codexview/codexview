import { describe, it, expect } from 'vitest';
import {
  summarizeFunctionCall, summarizeExec, summarizeMcpCall,
  summarizePatch, summarizeWebSearch, summarizeTodoList, truncate,
} from './tool-summary.js';
import type { PatchFile } from '../types.js';

describe('truncate', () => {
  it('keeps short strings as-is', () => {
    expect(truncate('hello', 80)).toBe('hello');
  });
  it('caps at limit and appends …', () => {
    expect(truncate('a'.repeat(100), 10)).toBe('aaaaaaaaa…');
  });
  it('replaces newlines with spaces', () => {
    expect(truncate('a\nb', 80)).toBe('a b');
  });
});

describe('summarizeFunctionCall (Claude Code tools)', () => {
  it('Bash → command', () => {
    expect(summarizeFunctionCall('Bash', { command: 'echo hi' })).toBe('echo hi');
  });
  it('Edit / Write / MultiEdit → file_path', () => {
    expect(summarizeFunctionCall('Edit', { file_path: 'src/foo.ts' })).toBe('src/foo.ts');
    expect(summarizeFunctionCall('Write', { file_path: 'x.ts' })).toBe('x.ts');
    expect(summarizeFunctionCall('MultiEdit', { file_path: 'x.ts' })).toBe('x.ts');
  });
  it('Read → file_path', () => {
    expect(summarizeFunctionCall('Read', { file_path: 'src/foo.ts' })).toBe('src/foo.ts');
  });
  it('Glob/Grep → pattern', () => {
    expect(summarizeFunctionCall('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
    expect(summarizeFunctionCall('Grep', { pattern: 'TODO' })).toBe('TODO');
  });
  it('Agent → description', () => {
    expect(summarizeFunctionCall('Agent', { description: 'find the bug' })).toBe('find the bug');
  });
  it('TodoWrite → (<n> todos)', () => {
    expect(summarizeFunctionCall('TodoWrite', { todos: [1, 2, 3] })).toBe('(3 todos)');
  });
  it('WebSearch → query', () => {
    expect(summarizeFunctionCall('WebSearch', { query: 'codex view' })).toBe('codex view');
  });
  it('WebFetch → url', () => {
    expect(summarizeFunctionCall('WebFetch', { url: 'https://example.com' })).toBe('https://example.com');
  });
  it('unknown tool → empty string', () => {
    expect(summarizeFunctionCall('SomeOtherTool', { x: 1 })).toBe('');
  });
});

describe('other summarizers', () => {
  it('exec', () => { expect(summarizeExec('npm test')).toBe('npm test'); });
  it('mcp', () => { expect(summarizeMcpCall('gh', 'list_issues')).toBe('gh.list_issues'); });
  it('patch with 0 files', () => { expect(summarizePatch([])).toBe('0 files'); });
  it('patch with 1 file', () => {
    expect(summarizePatch([{ path: 'a', status: 'modified' }] as PatchFile[])).toBe('1 file');
  });
  it('patch with 3 files', () => {
    expect(summarizePatch([
      { path: 'a', status: 'modified' },
      { path: 'b', status: 'modified' },
      { path: 'c', status: 'modified' },
    ] as PatchFile[])).toBe('3 files');
  });
  it('web_search', () => { expect(summarizeWebSearch('hello')).toBe('hello'); });
  it('todo_list', () => {
    expect(summarizeTodoList([
      { text: '', completed: false },
      { text: '', completed: false },
    ])).toBe('(2 todos)');
  });
});
