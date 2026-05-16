# codexview

A monorepo for rendering AI coding agent transcripts (Codex CLI, Claude Code, AgentWeb codex-team) as either React UI or compact plaintext markdown.

## Packages

| Package | Purpose | npm |
|---|---|---|
| [`@codexview/react`](packages/react) | React components that render a `ChatStreamEvent[]` stream into a chat transcript UI | [![npm](https://img.shields.io/npm/v/@codexview/react)](https://www.npmjs.com/package/@codexview/react) |
| [`@codexview/adapters`](packages/adapters) | Stateless adapters that convert raw JSONL from Codex CLI / codex-team / Claude Code into `ChatStreamEvent[]`. Zero runtime deps. | [![npm](https://img.shields.io/npm/v/@codexview/adapters)](https://www.npmjs.com/package/@codexview/adapters) |
| [`@codexview/cli`](packages/cli) | `codexview-md` CLI that converts an agent JSONL log to compact plaintext markdown (great as compressed context for another LLM) | [![npm](https://img.shields.io/npm/v/@codexview/cli)](https://www.npmjs.com/package/@codexview/cli) |

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
npx -y @codexview/cli ~/.claude/projects/<repo>/<sessionId>.jsonl > transcript.md
```

## Development

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm playground    # interactive viewer scanning ~/.codex, ~/.claude, ~/Projects/agentweb
```

The repo is a pnpm workspace under `packages/*`.

## Skills

This repo also ships a Claude Code skill at [`skills/codexview-cli/`](skills/codexview-cli) so agents can self-install the cli. See [`skills/README.md`](skills/README.md) for human install instructions.

## License

MIT for all three packages.
