import type { DetectedFormat, RawLine } from '../types.js';

export function detectFormat(lines: RawLine[]): DetectedFormat {
  for (const line of lines) {
    if (line && typeof line === 'object') {
      if ('sessionId' in line) return 'claude-code';
      if ('type' in line && ('payload' in line || 'timestamp' in line)) return 'rollout';
      if ('event' in line && 'at' in line) return 'codex-team';
    }
  }
  return 'unknown';
}
