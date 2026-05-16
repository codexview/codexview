import type { ChatStreamEvent, DetectedFormat, RawLine } from '../types.js';
import { detectFormat } from './detect.js';
import { adaptRollout } from './rollout.js';
import { adaptCodexTeam } from './codex-team.js';
import { adaptClaudeCode } from './claude-code.js';

export { detectFormat };

export interface AdaptResult {
  format: DetectedFormat;
  events: ChatStreamEvent[];
}

export function adapt(lines: RawLine[], formatOverride?: DetectedFormat): AdaptResult {
  const format = formatOverride ?? detectFormat(lines);
  switch (format) {
    case 'rollout':     return { format, events: adaptRollout(lines) };
    case 'codex-team':  return { format, events: adaptCodexTeam(lines) };
    case 'claude-code': return { format, events: adaptClaudeCode(lines) };
    default:            return { format: 'unknown', events: [] };
  }
}
