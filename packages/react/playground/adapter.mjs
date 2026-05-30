// Thin wrapper around @codexview/adapters. The playground wants diffs on
// Edit/Write/MultiEdit (patchMode='patch_apply_end') and embedded subagent
// summaries on Agent tool calls (subagents passed in by api.mjs). The
// adapter source itself lives in packages/adapters/ and is shared with cli.
import { adapt as adaptCore, detectFormat, parseJsonl } from '@codexview/adapters';

export { detectFormat, parseJsonl };

export function adapt(rawLines, options = {}) {
  return adaptCore(rawLines, {
    patchMode: 'patch_apply_end',
    subagents: options.subagents,
    format: options.format,
    closeOpenTurn: options.closeOpenTurn,
  });
}
