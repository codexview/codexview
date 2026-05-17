import type { ChatStreamEvent, DetectedFormat, RawLine } from '../types.js';
import { detectFormat } from './detect.js';
import { adaptRollout } from './rollout.js';
import { adaptCodexTeam } from './codex-team.js';
import { adaptClaudeCode, type AdaptClaudeCodeOptions } from './claude-code.js';
import { adaptOpenCode, type AdaptOpenCodeOptions } from './opencode.js';

export { detectFormat };

export interface AdaptResult {
  format: DetectedFormat;
  events: ChatStreamEvent[];
}

export interface AdaptOptions extends AdaptClaudeCodeOptions, AdaptOpenCodeOptions {
  /** Skip detectFormat and use this format directly. */
  format?: DetectedFormat;
}

export function adapt(lines: RawLine[], options: AdaptOptions = {}): AdaptResult {
  const format = options.format ?? detectFormat(lines);
  switch (format) {
    case 'rollout':     return { format, events: adaptRollout(lines) };
    case 'codex-team':  return { format, events: adaptCodexTeam(lines) };
    case 'claude-code': return { format, events: adaptClaudeCode(lines, options) };
    case 'opencode':    return { format, events: adaptOpenCode(lines, options) };
    default:            return { format: 'unknown', events: [] };
  }
}
