# codexview

A monorepo for rendering AI coding agent transcripts (Codex CLI, Claude Code, OpenCode, AgentWeb codex-team, GitHub Copilot) as either React UI or compact plaintext markdown. Subagent transcripts (Claude Code `Agent`, OpenCode `task`) can be embedded inline.

## Packages

| Package | Purpose | npm |
|---|---|---|
| [`@codexview/react`](packages/react) | React components that render a `ChatStreamEvent[]` stream into a chat transcript UI | [![npm](https://img.shields.io/npm/v/@codexview/react)](https://www.npmjs.com/package/@codexview/react) |
| [`@codexview/adapters`](packages/adapters) | Stateless adapters that convert raw JSONL/JSON from Codex CLI / codex-team / Claude Code / OpenCode / GitHub Copilot into `ChatStreamEvent[]`. Optional subagent embedding. Zero runtime deps. | [![npm](https://img.shields.io/npm/v/@codexview/adapters)](https://www.npmjs.com/package/@codexview/adapters) |
| [`@codexview/cli`](packages/cli) | `codexview-md` CLI that converts an agent JSONL/JSON log to compact plaintext markdown (great as compressed context for another LLM) | [![npm](https://img.shields.io/npm/v/@codexview/cli)](https://www.npmjs.com/package/@codexview/cli) |

## Typical use

Install the two libraries side-by-side:

```bash
pnpm add @codexview/react @codexview/adapters lucide-react react react-dom
```

```tsx
import { CodexTranscript } from '@codexview/react';
import { adapt, parseJsonl } from '@codexview/adapters';
import '@codexview/react/styles.css';

const { format, events } = adapt(parseJsonl(rawJsonl));
return <CodexTranscript events={events} />;
```

Or invoke the cli for one-shot transcript compression:

```bash
# Claude Code
npx -y @codexview/cli ~/.claude/projects/<repo>/<sessionId>.jsonl > transcript.md

# OpenCode (single-document JSON export)
opencode export ses_… | npx -y @codexview/cli - > transcript.md

# GitHub Copilot Chat session (VS Code agent mode)
npx -y @codexview/cli ~/Library/Application\ Support/Code/User/workspaceStorage/<hash>/chatSessions/<uuid>.json > transcript.md
```

## Development

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm playground    # interactive viewer scanning ~/.codex, ~/.claude, ~/.local/share/opencode, ~/Projects/agentweb, ~/Library/Application\ Support/Code/User/workspaceStorage
```

The repo is a pnpm workspace under `packages/*`.

## Skills

This repo also ships a Claude Code skill at [`skills/codexview-cli/`](skills/codexview-cli) so agents can self-install the cli. See [`skills/README.md`](skills/README.md) for human install instructions.

## License

MIT for all three packages.
