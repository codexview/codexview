import type { ChatStreamEvent, DetectedFormat, RawLine } from '../types.js';
import { detectFormat } from './detect.js';
import { adaptRollout } from './rollout.js';
import { adaptCodexTeam } from './codex-team.js';
import { adaptClaudeCode, type AdaptClaudeCodeOptions, type SubagentInput } from './claude-code.js';
import { adaptOpenCode, type AdaptOpenCodeOptions, type OpenCodeSubagentInput } from './opencode.js';
import { adaptGithubCopilot, type AdaptGithubCopilotOptions } from './github-copilot.js';

export { detectFormat };
export { adaptGithubCopilot };
export type { AdaptGithubCopilotOptions };

export interface AdaptResult {
  format: DetectedFormat;
  events: ChatStreamEvent[];
}

/**
 * Umbrella options accepted by `adapt()`. `patchMode` is shared between
 * the Claude Code and OpenCode adapters. `subagents` is a union — each
 * adapter only consumes the shape it understands; the other shape is
 * silently ignored at lookup time, so it's safe to pass either.
 */
export interface AdaptOptions {
  /** Skip detectFormat and use this format directly. */
  format?: DetectedFormat;
  patchMode?: 'function_call' | 'patch_apply_end';
  subagents?: SubagentInput[] | OpenCodeSubagentInput[];
}

export function adapt(lines: RawLine[], options: AdaptOptions = {}): AdaptResult {
  const format = options.format ?? detectFormat(lines);
  switch (format) {
    case 'rollout':     return { format, events: adaptRollout(lines) };
    case 'codex-team':  return { format, events: adaptCodexTeam(lines) };
    case 'claude-code': return { format, events: adaptClaudeCode(lines, options as AdaptClaudeCodeOptions) };
    case 'opencode':        return { format, events: adaptOpenCode(lines, options as AdaptOpenCodeOptions) };
    case 'github-copilot':  return adaptGithubCopilot(lines, options as any);
    default:                return { format: 'unknown', events: [] };
  }
}
