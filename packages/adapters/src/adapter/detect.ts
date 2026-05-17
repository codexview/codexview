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
      // GitHub Copilot: single-JSON export with version=3 and copilot avatar id.
      // Must be checked before the claude-code branch because Copilot exports
      // also carry a top-level `sessionId` field.
      const first = line as Record<string, unknown>;
      if (
        first.version === 3 &&
        (first.responderAvatarIconUri as Record<string, unknown> | undefined)?.id === 'copilot' &&
        Array.isArray(first.requests)
      ) {
        return 'github-copilot';
      }
      // claude-code JSONL lines have sessionId but are NOT v3+requests-shaped
      // (that shape belongs to other tools like Copilot or Continue).
      if ('sessionId' in line && !(first.version === 3 && Array.isArray(first.requests))) {
        return 'claude-code';
      }
      if ('type' in line && ('payload' in line || 'timestamp' in line)) return 'rollout';
      if ('event' in line && 'at' in line) return 'codex-team';
    }
  }
  return 'unknown';
}
