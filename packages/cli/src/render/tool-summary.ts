import type { PatchFile, TodoEntry } from '@codexview/adapters';

export const MAX_SUMMARY = 80;

export function truncate(s: string, max = MAX_SUMMARY): string {
  const flat = s.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1) + '…';
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function summarizeFunctionCall(name: string, args: unknown): string {
  const a = (args && typeof args === 'object') ? args as Record<string, unknown> : {};
  switch (name) {
    case 'Bash':       return truncate(str(a.command));
    case 'Edit':
    case 'Write':
    case 'MultiEdit':  return truncate(str(a.file_path));
    case 'Read':       return truncate(str(a.file_path));
    case 'Glob':
    case 'Grep':       return truncate(str(a.pattern));
    case 'Agent':      return truncate(str(a.description));
    case 'TodoWrite': {
      const todos = Array.isArray(a.todos) ? a.todos : [];
      return `(${todos.length} todos)`;
    }
    case 'WebSearch':  return truncate(str(a.query));
    case 'WebFetch':   return truncate(str(a.url));
    default:           return '';
  }
}

export function summarizeExec(command: string): string {
  return truncate(command);
}

export function summarizeMcpCall(server: string, name: string): string {
  return server ? `${server}.${name}` : name;
}

export function summarizePatch(files: PatchFile[]): string {
  const n = files.length;
  return `${n} file${n === 1 ? '' : 's'}`;
}

export function summarizeWebSearch(query: string): string {
  return truncate(query);
}

export function summarizeTodoList(items: TodoEntry[]): string {
  return `(${items.length} todos)`;
}
