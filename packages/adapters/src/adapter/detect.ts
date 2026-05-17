import type { DetectedFormat, RawLine } from '../types.js';

export function detectFormat(lines: RawLine[]): DetectedFormat {
  for (const line of lines) {
    if (line && typeof line === 'object') {
      // OpenCode: single-JSON export wrapped in a one-element array.
      // Top level has { info: { id: 'ses_...' }, messages: [...] }.
      const info = (line as Record<string, unknown>).info;
      if (
        info && typeof info === 'object' &&
        Array.isArray((line as Record<string, unknown>).messages) &&
        typeof (info as Record<string, unknown>).id === 'string' &&
        ((info as Record<string, unknown>).id as string).startsWith('ses_')
      ) {
        return 'opencode';
      }
      if ('sessionId' in line) return 'claude-code';
      if ('type' in line && ('payload' in line || 'timestamp' in line)) return 'rollout';
      if ('event' in line && 'at' in line) return 'codex-team';
    }
  }
  return 'unknown';
}
