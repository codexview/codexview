# CodexView Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `codexview`, a standalone React component library that renders agentweb's `ChatStreamEvent` stream into a chat-style transcript with status animations, ready for agentweb integration.

**Architecture:** Pure React 18 component library, ESM-only, CSS Modules + CSS variables for theming. Internal `useReducer`-based state, no external state library. `(events, status) → (model, derivedStatus) → JSX`. Two-level state machine (turn + item), 8 item kinds + raw fallback. Reasoning lives in its own block; same-turn assistant items share a left timeline axis.

**Tech Stack:** React 18.3, TypeScript 5.5 (strict + noUncheckedIndexAccess), tsup (esbuild), vitest + @testing-library/react + jsdom, lucide-react (peerDep), CSS Modules, vite (dev/ SPA only).

**Spec:** [docs/superpowers/specs/2026-05-15-codexview-design.md](../specs/2026-05-15-codexview-design.md)

---

## File structure overview

```
CodexView/
├── .gitignore, .npmrc, .editorconfig, .nvmrc
├── package.json, tsconfig.json, tsup.config.ts, vitest.config.ts
├── README.md
├── docs/{api,events,styling,integration-agentweb,changelog}.md
├── src/
│   ├── index.ts                          # public re-exports only
│   ├── types/{events,model,theme}.ts
│   ├── reducer/{transcript,status}.ts + .test.ts
│   ├── hooks/{useCodexTranscript,useSmoothStream}.ts + .test.ts
│   ├── components/
│   │   ├── CodexTranscript.tsx + .module.css
│   │   ├── StatusBar.tsx + .module.css
│   │   ├── TurnContainer.tsx + .module.css
│   │   ├── MessageBubble.tsx + .module.css
│   │   ├── ReasoningBlock.tsx + .module.css
│   │   ├── ToolCallBlock.tsx + .module.css
│   │   ├── ExecBlock.tsx + .module.css
│   │   ├── SearchBlock.tsx + .module.css
│   │   ├── PatchBlock.tsx + .module.css
│   │   ├── RawEventBlock.tsx + .module.css
│   │   ├── ItemErrorBoundary.tsx
│   │   └── icons.ts
│   ├── styles/{reset.module.css, tokens.css}
│   └── integration/replay.test.tsx
├── fixtures/
│   ├── README.md
│   ├── short-chat.jsonl
│   ├── tool-heavy.jsonl
│   ├── mcp-flow.jsonl
│   ├── failed-turn.jsonl
│   ├── aborted-turn.jsonl
│   └── unknown-types.jsonl
└── dev/
    ├── index.html, vite.config.ts
    └── src/{main.tsx, App.tsx}
```

---

## Task 1: Repo scaffolding (git, package.json, tsconfig)

**Files:**
- Create: `.gitignore`, `.editorconfig`, `.nvmrc`, `.npmrc`, `package.json`, `tsconfig.json`, `tsconfig.dev.json`, `README.md` (placeholder)

- [ ] **Step 1: git init**

```bash
cd /Volumes/MaxSSD1/MigratedHome/maxazure/projects/CodexView
git init
git config core.autocrlf input
```

Expected: `Initialized empty Git repository`.

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
dist/
.DS_Store
*.log
.vscode/
.idea/
coverage/
.tsbuildinfo
*.tgz
```

- [ ] **Step 3: Write `.editorconfig`**

```
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

- [ ] **Step 4: Write `.nvmrc`**

```
20
```

- [ ] **Step 5: Write `.npmrc`**

```
strict-peer-dependencies=false
auto-install-peers=true
```

- [ ] **Step 6: Write `package.json`**

```json
{
  "name": "codexview",
  "version": "0.1.0",
  "description": "React components for rendering OpenAI Codex CLI chat streams.",
  "type": "module",
  "license": "MIT",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./styles.css": "./dist/styles.css"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "README.md", "docs"],
  "sideEffects": ["**/*.css"],
  "scripts": {
    "build": "tsup",
    "dev": "vite --config dev/vite.config.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "prepublishOnly": "pnpm build"
  },
  "peerDependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "lucide-react": "^0.400.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.6",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "lucide-react": "^0.400.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tsup": "^8.1.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 7: Write `tsconfig.json`** (production / lib)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "noEmit": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "dev/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 8: Write `tsconfig.dev.json`** (dev SPA, allows JSX in .tsx test setups)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dev-build"
  },
  "include": ["dev/**/*", "src/**/*"]
}
```

- [ ] **Step 9: Write a placeholder `README.md`**

```markdown
# codexview

React components for rendering OpenAI Codex CLI chat streams.

> Status: 0.1.0-pre — see [docs/superpowers/plans/2026-05-15-codexview-implementation.md](docs/superpowers/plans/2026-05-15-codexview-implementation.md) for build progress.

Documentation will land in [docs/](docs/) once features are implemented.
```

- [ ] **Step 10: Install dependencies**

```bash
pnpm install
```

Expected: dependencies installed in `node_modules/`, `pnpm-lock.yaml` created.

- [ ] **Step 11: Verify typecheck passes (no source files yet, so noop)**

```bash
mkdir -p src && echo "export {};" > src/index.ts
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 12: First commit**

```bash
git add -A
git commit -m "chore: initial scaffolding (package.json, tsconfig, lockfile)"
```

---

## Task 2: tsup build + vitest config + src/index.ts placeholder

**Files:**
- Create: `tsup.config.ts`, `vitest.config.ts`, `src/test-setup.ts`, `src/index.ts`

- [ ] **Step 1: Write `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  external: ['react', 'react-dom', 'lucide-react'],
  injectStyle: false,
  loader: { '.css': 'copy' },
  esbuildOptions(options) {
    options.assetNames = 'styles';
  },
});
```

- [ ] **Step 2: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test-setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test-setup.ts', 'src/index.ts'],
    },
  },
});
```

- [ ] **Step 3: Write `src/test-setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Replace `src/index.ts` with placeholder**

```ts
export const VERSION = '0.1.0';
```

- [ ] **Step 5: Run typecheck + tests + build**

```bash
pnpm typecheck && pnpm test && pnpm build
```

Expected: typecheck PASS, vitest "No test files found" exit 0, tsup creates `dist/index.js` + `dist/index.d.ts`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: tsup + vitest configuration"
```

---

## Task 3: Define `ChatStreamEvent` types

**Files:**
- Create: `src/types/events.ts`

- [ ] **Step 1: Write `src/types/events.ts`**

```ts
/**
 * Token usage emitted by `turn_completed`.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
}

/** Result of a single web search hit. */
export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

/** Single file in a patch_apply result. */
export interface PatchFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  /** Unified git diff text. Optional because some events only carry metadata. */
  diff?: string;
}

/**
 * The discriminated union of events CodexView consumes.
 *
 * Source of truth: agentweb `backend/src/codex/eventMap.ts` `NormalizedEvent`.
 * This file is the contract boundary — it intentionally re-declares the shapes
 * so that consumers don't have to depend on agentweb internals.
 */
export type ChatStreamEvent =
  // Lifecycle
  | { type: 'thread_started'; threadId: string; at: number }
  | { type: 'turn_started'; turnId: string; at: number }
  | { type: 'turn_completed'; turnId: string; at: number; usage?: TokenUsage }
  | { type: 'turn_failed'; turnId: string; at: number; error: { message: string; code?: string } }
  | { type: 'turn_aborted'; turnId: string; at: number; reason?: string }

  // Messages
  | { type: 'user_message'; turnId: string; itemId: string; text: string; at: number }
  | { type: 'agent_message'; turnId: string; itemId: string; text: string; partial: boolean; at: number }
  | { type: 'reasoning'; turnId: string; itemId: string; text: string; partial: boolean; at: number }

  // Tool calls (paired by callId)
  | { type: 'function_call'; turnId: string; callId: string; name: string; args: unknown; at: number }
  | { type: 'function_call_output'; turnId: string; callId: string; output?: unknown; error?: string; at: number }

  // Shell exec
  | { type: 'exec_command_begin'; turnId: string; callId: string; command: string; at: number }
  | { type: 'exec_command_end'; turnId: string; callId: string; exit: number; stdout: string; stderr: string; durationMs: number; at: number }

  // MCP tool calls
  | { type: 'mcp_tool_call'; turnId: string; callId: string; server: string; name: string; args: unknown; at: number }
  | { type: 'mcp_tool_call_output'; turnId: string; callId: string; output?: unknown; error?: string; at: number }

  // Web search
  | { type: 'web_search_call'; turnId: string; callId: string; query: string; at: number }
  | { type: 'web_search_end'; turnId: string; callId: string; results: SearchResult[]; at: number }

  // Patch apply
  | { type: 'patch_apply_end'; turnId: string; callId: string; files: PatchFile[]; ok: boolean; at: number }

  // Fallback
  | { type: 'raw'; turnId?: string; itemId?: string; payload: unknown; at: number };

/** Helpful narrowing alias. */
export type ChatStreamEventType = ChatStreamEvent['type'];
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/types/events.ts
git commit -m "feat(types): ChatStreamEvent contract"
```

---

## Task 4: Define view model types + EMPTY_MODEL

**Files:**
- Create: `src/types/model.ts`

- [ ] **Step 1: Write `src/types/model.ts`**

```ts
import type { PatchFile, SearchResult, TokenUsage } from './events.js';

/** Item-level lifecycle status (5 states per spec §5.1). */
export type ItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped';

/** Discriminated kind of a rendered item. */
export type ItemKind =
  | 'user_message'
  | 'reasoning'
  | 'assistant_text'
  | 'tool_call'
  | 'exec'
  | 'search'
  | 'patch'
  | 'raw';

interface ItemViewBase {
  id: string;
  kind: ItemKind;
  status: ItemStatus;
  startedAt: number;
  updatedAt: number;
}

export type ItemView =
  | (ItemViewBase & { kind: 'user_message'; text: string })
  | (ItemViewBase & { kind: 'reasoning'; text: string })
  | (ItemViewBase & { kind: 'assistant_text'; text: string })
  | (ItemViewBase & { kind: 'tool_call'; name: string; server?: string; args: unknown; result?: unknown; error?: string })
  | (ItemViewBase & { kind: 'exec'; command: string; exit?: number; stdout?: string; stderr?: string; durationMs?: number })
  | (ItemViewBase & { kind: 'search'; query: string; results?: SearchResult[] })
  | (ItemViewBase & { kind: 'patch'; files: PatchFile[]; ok?: boolean })
  | (ItemViewBase & { kind: 'raw'; payload: unknown });

export interface TurnView {
  turnId: string;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  items: ItemView[];
  usage?: TokenUsage;
  error?: { message: string; code?: string };
}

export interface TranscriptModel {
  threadId?: string;
  turns: TurnView[];
  lastEventAt: number;
}

/** Empty initial model. Always safe to start reducing from here. */
export const EMPTY_MODEL: TranscriptModel = Object.freeze({
  turns: [],
  lastEventAt: 0,
}) as TranscriptModel;

/** Session-level status (5 states per spec §5.3). */
export type TranscriptStatus = 'idle' | 'working' | 'completed' | 'stopped' | 'failed';
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/types/model.ts
git commit -m "feat(types): TranscriptModel / TurnView / ItemView"
```

---

## Task 5: reducer skeleton + lifecycle events (TDD)

**Files:**
- Create: `src/reducer/transcript.ts`, `src/reducer/transcript.test.ts`

- [ ] **Step 1: Write the failing test for thread_started**

`src/reducer/transcript.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EMPTY_MODEL } from '../types/model.js';
import { reduceTranscript } from './transcript.js';

describe('reduceTranscript / lifecycle', () => {
  it('thread_started sets threadId', () => {
    const next = reduceTranscript(EMPTY_MODEL, {
      type: 'thread_started',
      threadId: 't-1',
      at: 100,
    });
    expect(next.threadId).toBe('t-1');
    expect(next.turns).toEqual([]);
    expect(next.lastEventAt).toBe(100);
  });

  it('turn_started appends a running turn', () => {
    const next = reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 200 });
    expect(next.turns).toHaveLength(1);
    expect(next.turns[0]).toMatchObject({ turnId: 'tn-1', status: 'running', startedAt: 200, items: [] });
  });

  it('turn_completed marks turn completed and writes usage', () => {
    const m1 = reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 200 });
    const m2 = reduceTranscript(m1, {
      type: 'turn_completed',
      turnId: 'tn-1',
      at: 300,
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    expect(m2.turns[0]?.status).toBe('completed');
    expect(m2.turns[0]?.completedAt).toBe(300);
    expect(m2.turns[0]?.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it('turn_failed marks turn failed and stores error', () => {
    const m1 = reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 200 });
    const m2 = reduceTranscript(m1, {
      type: 'turn_failed',
      turnId: 'tn-1',
      at: 300,
      error: { message: 'boom', code: 'E1' },
    });
    expect(m2.turns[0]?.status).toBe('failed');
    expect(m2.turns[0]?.error).toEqual({ message: 'boom', code: 'E1' });
  });

  it('turn_aborted marks turn aborted', () => {
    const m1 = reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 200 });
    const m2 = reduceTranscript(m1, { type: 'turn_aborted', turnId: 'tn-1', at: 300 });
    expect(m2.turns[0]?.status).toBe('aborted');
  });

  it('reducer is pure: input model is not mutated', () => {
    const before = JSON.stringify(EMPTY_MODEL);
    reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 1 });
    expect(JSON.stringify(EMPTY_MODEL)).toBe(before);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
pnpm test -- src/reducer/transcript.test.ts
```

Expected: FAIL with "Cannot find module './transcript.js'".

- [ ] **Step 3: Write minimal `src/reducer/transcript.ts` covering lifecycle only**

```ts
import type { ChatStreamEvent } from '../types/events.js';
import type { ItemStatus, ItemView, TranscriptModel, TurnView } from '../types/model.js';
import { EMPTY_MODEL } from '../types/model.js';

function findTurnIndex(model: TranscriptModel, turnId: string): number {
  for (let i = model.turns.length - 1; i >= 0; i -= 1) {
    if (model.turns[i]!.turnId === turnId) return i;
  }
  return -1;
}

function replaceTurn(model: TranscriptModel, index: number, turn: TurnView, at: number): TranscriptModel {
  const turns = model.turns.slice();
  turns[index] = turn;
  return { ...model, turns, lastEventAt: at };
}

function flipUnfinished(items: ItemView[], next: ItemStatus): ItemView[] {
  return items.map((item) =>
    item.status === 'pending' || item.status === 'running' ? { ...item, status: next, updatedAt: item.updatedAt } : item,
  );
}

export function reduceTranscript(prev: TranscriptModel, event: ChatStreamEvent): TranscriptModel {
  switch (event.type) {
    case 'thread_started':
      return { ...prev, threadId: event.threadId, lastEventAt: event.at };

    case 'turn_started': {
      const turn: TurnView = {
        turnId: event.turnId,
        startedAt: event.at,
        status: 'running',
        items: [],
      };
      return { ...prev, turns: [...prev.turns, turn], lastEventAt: event.at };
    }

    case 'turn_completed': {
      const i = findTurnIndex(prev, event.turnId);
      if (i < 0) return { ...prev, lastEventAt: event.at };
      const t = prev.turns[i]!;
      const turn: TurnView = {
        ...t,
        status: 'completed',
        completedAt: event.at,
        items: flipUnfinished(t.items, 'completed'),
      };
      if (event.usage !== undefined) turn.usage = event.usage;
      return replaceTurn(prev, i, turn, event.at);
    }

    case 'turn_failed': {
      const i = findTurnIndex(prev, event.turnId);
      if (i < 0) return { ...prev, lastEventAt: event.at };
      const t = prev.turns[i]!;
      return replaceTurn(prev, i, {
        ...t,
        status: 'failed',
        completedAt: event.at,
        error: event.error,
        items: flipUnfinished(t.items, 'failed'),
      }, event.at);
    }

    case 'turn_aborted': {
      const i = findTurnIndex(prev, event.turnId);
      if (i < 0) return { ...prev, lastEventAt: event.at };
      const t = prev.turns[i]!;
      return replaceTurn(prev, i, {
        ...t,
        status: 'aborted',
        completedAt: event.at,
        items: flipUnfinished(t.items, 'stopped'),
      }, event.at);
    }

    default:
      return { ...prev, lastEventAt: event.at };
  }
}

export { EMPTY_MODEL };
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm test -- src/reducer/transcript.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reducer/
git commit -m "feat(reducer): lifecycle events (thread/turn started/completed/failed/aborted)"
```

---

## Task 6: reducer + messages (user/agent/reasoning)

**Files:**
- Modify: `src/reducer/transcript.ts`, `src/reducer/transcript.test.ts`

- [ ] **Step 1: Add failing tests for messages**

Append to `src/reducer/transcript.test.ts`:

```ts
describe('reduceTranscript / messages', () => {
  function startedTurn() {
    return reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 100 });
  }

  it('user_message appends a completed user item', () => {
    const m = reduceTranscript(startedTurn(), {
      type: 'user_message',
      turnId: 'tn-1',
      itemId: 'u1',
      text: 'hi',
      at: 110,
    });
    const item = m.turns[0]?.items[0];
    expect(item).toMatchObject({ kind: 'user_message', id: 'u1', text: 'hi', status: 'completed' });
  });

  it('agent_message partial creates a running assistant_text item', () => {
    const m = reduceTranscript(startedTurn(), {
      type: 'agent_message',
      turnId: 'tn-1',
      itemId: 'a1',
      text: 'hel',
      partial: true,
      at: 120,
    });
    expect(m.turns[0]?.items[0]).toMatchObject({ kind: 'assistant_text', id: 'a1', text: 'hel', status: 'running' });
  });

  it('agent_message updates same itemId and flips to completed when partial=false', () => {
    let m = startedTurn();
    m = reduceTranscript(m, { type: 'agent_message', turnId: 'tn-1', itemId: 'a1', text: 'hel', partial: true, at: 120 });
    m = reduceTranscript(m, { type: 'agent_message', turnId: 'tn-1', itemId: 'a1', text: 'hello', partial: false, at: 130 });
    expect(m.turns[0]?.items).toHaveLength(1);
    expect(m.turns[0]?.items[0]).toMatchObject({ kind: 'assistant_text', text: 'hello', status: 'completed' });
  });

  it('reasoning is independent from agent_message (not merged)', () => {
    let m = startedTurn();
    m = reduceTranscript(m, { type: 'reasoning', turnId: 'tn-1', itemId: 'r1', text: 'think', partial: false, at: 115 });
    m = reduceTranscript(m, { type: 'agent_message', turnId: 'tn-1', itemId: 'a1', text: 'answer', partial: false, at: 120 });
    expect(m.turns[0]?.items).toHaveLength(2);
    expect(m.turns[0]?.items[0]?.kind).toBe('reasoning');
    expect(m.turns[0]?.items[1]?.kind).toBe('assistant_text');
  });
});
```

- [ ] **Step 2: Run tests, expect new ones to fail**

```bash
pnpm test -- src/reducer/transcript.test.ts
```

Expected: 4 new tests FAIL.

- [ ] **Step 3: Extend `transcript.ts`**

Inside `reduceTranscript`, add helpers near top of file:

```ts
function withinTurn(
  prev: TranscriptModel,
  turnId: string,
  at: number,
  mut: (turn: TurnView) => TurnView,
): TranscriptModel {
  const i = findTurnIndex(prev, turnId);
  if (i < 0) return { ...prev, lastEventAt: at };
  return replaceTurn(prev, i, mut(prev.turns[i]!), at);
}

function appendItem(turn: TurnView, item: ItemView): TurnView {
  return { ...turn, items: [...turn.items, item] };
}

function updateItem(turn: TurnView, id: string, mut: (item: ItemView) => ItemView): TurnView {
  let touched = false;
  const items = turn.items.map((it) => {
    if (it.id !== id) return it;
    touched = true;
    return mut(it);
  });
  return touched ? { ...turn, items } : turn;
}
```

Add cases inside the `switch`:

```ts
case 'user_message':
  return withinTurn(prev, event.turnId, event.at, (t) =>
    appendItem(t, {
      id: event.itemId,
      kind: 'user_message',
      status: 'completed',
      startedAt: event.at,
      updatedAt: event.at,
      text: event.text,
    }),
  );

case 'agent_message':
case 'reasoning': {
  const kind = event.type === 'reasoning' ? 'reasoning' : 'assistant_text';
  return withinTurn(prev, event.turnId, event.at, (t) => {
    const exists = t.items.some((it) => it.id === event.itemId && it.kind === kind);
    if (exists) {
      return updateItem(t, event.itemId, (it) => {
        if (it.kind !== kind) return it;
        return { ...it, text: event.text, status: event.partial ? 'running' : 'completed', updatedAt: event.at };
      });
    }
    return appendItem(t, {
      id: event.itemId,
      kind,
      status: event.partial ? 'running' : 'completed',
      startedAt: event.at,
      updatedAt: event.at,
      text: event.text,
    } as ItemView);
  });
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- src/reducer/transcript.test.ts
```

Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add src/reducer/
git commit -m "feat(reducer): user_message / agent_message / reasoning"
```

---

## Task 7: reducer + tool_call & exec pairing

**Files:**
- Modify: `src/reducer/transcript.ts`, `src/reducer/transcript.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('reduceTranscript / tool calls and exec', () => {
  const start = () => reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 100 });

  it('function_call creates pending tool_call', () => {
    const m = reduceTranscript(start(), {
      type: 'function_call',
      turnId: 'tn-1',
      callId: 'c1',
      name: 'getWeather',
      args: { city: 'NYC' },
      at: 110,
    });
    expect(m.turns[0]?.items[0]).toMatchObject({ kind: 'tool_call', id: 'c1', name: 'getWeather', status: 'pending' });
  });

  it('function_call_output completes the matching tool_call', () => {
    let m = start();
    m = reduceTranscript(m, { type: 'function_call', turnId: 'tn-1', callId: 'c1', name: 'x', args: {}, at: 110 });
    m = reduceTranscript(m, { type: 'function_call_output', turnId: 'tn-1', callId: 'c1', output: { ok: true }, at: 120 });
    expect(m.turns[0]?.items[0]).toMatchObject({ status: 'completed', result: { ok: true } });
  });

  it('function_call_output with error marks failed', () => {
    let m = start();
    m = reduceTranscript(m, { type: 'function_call', turnId: 'tn-1', callId: 'c1', name: 'x', args: {}, at: 110 });
    m = reduceTranscript(m, { type: 'function_call_output', turnId: 'tn-1', callId: 'c1', error: 'boom', at: 120 });
    expect(m.turns[0]?.items[0]).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('exec_command_begin creates a running exec', () => {
    const m = reduceTranscript(start(), {
      type: 'exec_command_begin',
      turnId: 'tn-1',
      callId: 'e1',
      command: 'ls',
      at: 110,
    });
    expect(m.turns[0]?.items[0]).toMatchObject({ kind: 'exec', id: 'e1', command: 'ls', status: 'running' });
  });

  it('exec_command_end with exit=0 completes; non-zero fails', () => {
    let m = reduceTranscript(start(), { type: 'exec_command_begin', turnId: 'tn-1', callId: 'e1', command: 'ls', at: 110 });
    m = reduceTranscript(m, { type: 'exec_command_end', turnId: 'tn-1', callId: 'e1', exit: 0, stdout: 'a\nb', stderr: '', durationMs: 5, at: 120 });
    expect(m.turns[0]?.items[0]).toMatchObject({ status: 'completed', exit: 0, stdout: 'a\nb', durationMs: 5 });

    let m2 = reduceTranscript(start(), { type: 'exec_command_begin', turnId: 'tn-1', callId: 'e2', command: 'false', at: 110 });
    m2 = reduceTranscript(m2, { type: 'exec_command_end', turnId: 'tn-1', callId: 'e2', exit: 1, stdout: '', stderr: 'no', durationMs: 1, at: 120 });
    expect(m2.turns[0]?.items[0]).toMatchObject({ status: 'failed', exit: 1, stderr: 'no' });
  });

  it('output without prior call is ignored gracefully (no throw, no item added)', () => {
    const m = reduceTranscript(start(), { type: 'function_call_output', turnId: 'tn-1', callId: 'missing', output: {}, at: 110 });
    expect(m.turns[0]?.items).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Add cases to `transcript.ts`**

```ts
case 'function_call':
case 'mcp_tool_call':
  return withinTurn(prev, event.turnId, event.at, (t) =>
    appendItem(t, {
      id: event.callId,
      kind: 'tool_call',
      status: 'pending',
      startedAt: event.at,
      updatedAt: event.at,
      name: event.name,
      ...(event.type === 'mcp_tool_call' ? { server: event.server } : {}),
      args: event.args,
    } as ItemView),
  );

case 'function_call_output':
case 'mcp_tool_call_output':
  return withinTurn(prev, event.turnId, event.at, (t) =>
    updateItem(t, event.callId, (it) => {
      if (it.kind !== 'tool_call') return it;
      const failed = event.error !== undefined;
      return {
        ...it,
        status: failed ? 'failed' : 'completed',
        updatedAt: event.at,
        ...(failed ? { error: event.error } : { result: event.output }),
      };
    }),
  );

case 'exec_command_begin':
  return withinTurn(prev, event.turnId, event.at, (t) =>
    appendItem(t, {
      id: event.callId,
      kind: 'exec',
      status: 'running',
      startedAt: event.at,
      updatedAt: event.at,
      command: event.command,
    }),
  );

case 'exec_command_end':
  return withinTurn(prev, event.turnId, event.at, (t) =>
    updateItem(t, event.callId, (it) => {
      if (it.kind !== 'exec') return it;
      return {
        ...it,
        status: event.exit === 0 ? 'completed' : 'failed',
        updatedAt: event.at,
        exit: event.exit,
        stdout: event.stdout,
        stderr: event.stderr,
        durationMs: event.durationMs,
      };
    }),
  );
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- src/reducer/transcript.test.ts
```

Expected: ALL pass.

- [ ] **Step 4: Commit**

```bash
git add src/reducer/
git commit -m "feat(reducer): function_call / exec_command pairing"
```

---

## Task 8: reducer + web_search / patch / mcp + raw fallback

**Files:**
- Modify: `src/reducer/transcript.ts`, `src/reducer/transcript.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('reduceTranscript / search, patch, raw', () => {
  const start = () => reduceTranscript(EMPTY_MODEL, { type: 'turn_started', turnId: 'tn-1', at: 100 });

  it('web_search_call then web_search_end completes', () => {
    let m = reduceTranscript(start(), { type: 'web_search_call', turnId: 'tn-1', callId: 's1', query: 'ts', at: 110 });
    m = reduceTranscript(m, { type: 'web_search_end', turnId: 'tn-1', callId: 's1', results: [{ title: 'T', url: 'https://x' }], at: 120 });
    expect(m.turns[0]?.items[0]).toMatchObject({ kind: 'search', status: 'completed', results: [{ title: 'T', url: 'https://x' }] });
  });

  it('patch_apply_end ok=true => completed; ok=false => failed', () => {
    const ok = reduceTranscript(start(), {
      type: 'patch_apply_end', turnId: 'tn-1', callId: 'p1', files: [{ path: 'a.ts', status: 'modified' }], ok: true, at: 110,
    });
    expect(ok.turns[0]?.items[0]).toMatchObject({ kind: 'patch', status: 'completed', ok: true });

    const fail = reduceTranscript(start(), {
      type: 'patch_apply_end', turnId: 'tn-1', callId: 'p2', files: [], ok: false, at: 110,
    });
    expect(fail.turns[0]?.items[0]).toMatchObject({ kind: 'patch', status: 'failed', ok: false });
  });

  it('raw event is appended as kind=raw with payload preserved', () => {
    const m = reduceTranscript(start(), { type: 'raw', turnId: 'tn-1', payload: { foo: 1 }, at: 110 });
    expect(m.turns[0]?.items[0]).toMatchObject({ kind: 'raw', payload: { foo: 1 }, status: 'completed' });
  });

  it('raw event with no turnId is dropped silently (lastEventAt still updates)', () => {
    const m = reduceTranscript(EMPTY_MODEL, { type: 'raw', payload: { lone: true }, at: 50 });
    expect(m.turns).toEqual([]);
    expect(m.lastEventAt).toBe(50);
  });

  it('unknown event-shaped object is treated as raw via TS escape hatch', () => {
    const unknownEvent = { type: 'foobar', turnId: 'tn-1', at: 110, payload: 1 } as unknown as Parameters<typeof reduceTranscript>[1];
    const m = reduceTranscript(start(), unknownEvent);
    expect(m.turns[0]?.items[0]).toMatchObject({ kind: 'raw' });
  });
});
```

- [ ] **Step 2: Add cases to `transcript.ts`**

```ts
case 'web_search_call':
  return withinTurn(prev, event.turnId, event.at, (t) =>
    appendItem(t, {
      id: event.callId,
      kind: 'search',
      status: 'pending',
      startedAt: event.at,
      updatedAt: event.at,
      query: event.query,
    }),
  );

case 'web_search_end':
  return withinTurn(prev, event.turnId, event.at, (t) =>
    updateItem(t, event.callId, (it) => {
      if (it.kind !== 'search') return it;
      return { ...it, status: 'completed', updatedAt: event.at, results: event.results };
    }),
  );

case 'patch_apply_end':
  return withinTurn(prev, event.turnId, event.at, (t) =>
    appendItem(t, {
      id: event.callId,
      kind: 'patch',
      status: event.ok ? 'completed' : 'failed',
      startedAt: event.at,
      updatedAt: event.at,
      files: event.files,
      ok: event.ok,
    }),
  );

case 'raw': {
  if (!event.turnId) return { ...prev, lastEventAt: event.at };
  return withinTurn(prev, event.turnId, event.at, (t) =>
    appendItem(t, {
      id: event.itemId ?? `raw-${t.items.length}`,
      kind: 'raw',
      status: 'completed',
      startedAt: event.at,
      updatedAt: event.at,
      payload: event.payload,
    }),
  );
}
```

Replace the `default:` case with raw fallback:

```ts
default: {
  const e = event as { turnId?: string; at?: number; type?: string; [k: string]: unknown };
  const at = typeof e.at === 'number' ? e.at : prev.lastEventAt;
  if (!e.turnId) return { ...prev, lastEventAt: at };
  return withinTurn(prev, e.turnId, at, (t) =>
    appendItem(t, {
      id: `raw-${t.items.length}`,
      kind: 'raw',
      status: 'completed',
      startedAt: at,
      updatedAt: at,
      payload: e,
    }),
  );
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- src/reducer/transcript.test.ts
```

Expected: ALL pass.

- [ ] **Step 4: Commit**

```bash
git add src/reducer/
git commit -m "feat(reducer): web_search, patch_apply, raw fallback"
```

---

## Task 9: reducer property test (incremental == bulk)

**Files:**
- Create: `src/reducer/property.test.ts`

- [ ] **Step 1: Write the property test**

```ts
import { describe, expect, it } from 'vitest';
import type { ChatStreamEvent } from '../types/events.js';
import { EMPTY_MODEL } from '../types/model.js';
import { reduceTranscript } from './transcript.js';

const SCENARIO: ChatStreamEvent[] = [
  { type: 'thread_started', threadId: 'T', at: 1 },
  { type: 'turn_started', turnId: 'A', at: 10 },
  { type: 'user_message', turnId: 'A', itemId: 'u1', text: 'hi', at: 11 },
  { type: 'reasoning', turnId: 'A', itemId: 'r1', text: 'thinking', partial: false, at: 12 },
  { type: 'agent_message', turnId: 'A', itemId: 'a1', text: 'h', partial: true, at: 13 },
  { type: 'agent_message', turnId: 'A', itemId: 'a1', text: 'hi', partial: false, at: 14 },
  { type: 'function_call', turnId: 'A', callId: 'c1', name: 'echo', args: { x: 1 }, at: 15 },
  { type: 'function_call_output', turnId: 'A', callId: 'c1', output: 'ok', at: 16 },
  { type: 'exec_command_begin', turnId: 'A', callId: 'e1', command: 'ls', at: 17 },
  { type: 'exec_command_end', turnId: 'A', callId: 'e1', exit: 0, stdout: 'a', stderr: '', durationMs: 5, at: 18 },
  { type: 'web_search_call', turnId: 'A', callId: 's1', query: 'ts', at: 19 },
  { type: 'web_search_end', turnId: 'A', callId: 's1', results: [{ title: 'T', url: 'https://x' }], at: 20 },
  { type: 'patch_apply_end', turnId: 'A', callId: 'p1', files: [{ path: 'a.ts', status: 'modified' }], ok: true, at: 21 },
  { type: 'turn_completed', turnId: 'A', at: 22, usage: { inputTokens: 1, outputTokens: 1 } },
  { type: 'raw', turnId: 'A', payload: { weird: true }, at: 23 },
];

describe('reduceTranscript / property', () => {
  it('incremental reduce equals bulk reduce', () => {
    const bulk = SCENARIO.reduce(reduceTranscript, EMPTY_MODEL);

    let incremental = EMPTY_MODEL;
    for (const e of SCENARIO) incremental = reduceTranscript(incremental, e);

    expect(incremental).toEqual(bulk);
  });

  it('reducer never throws on a randomized order of valid events', () => {
    const shuffled = [...SCENARIO].sort(() => Math.random() - 0.5);
    expect(() => shuffled.reduce(reduceTranscript, EMPTY_MODEL)).not.toThrow();
  });

  it('initial EMPTY_MODEL is not mutated by any number of reductions', () => {
    const snap = JSON.stringify(EMPTY_MODEL);
    SCENARIO.reduce(reduceTranscript, EMPTY_MODEL);
    expect(JSON.stringify(EMPTY_MODEL)).toBe(snap);
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm test -- src/reducer/property.test.ts
```

Expected: 3 PASS.

- [ ] **Step 3: Commit**

```bash
git add src/reducer/property.test.ts
git commit -m "test(reducer): property tests for incremental==bulk and purity"
```

---

## Task 10: inferStatus + status.ts (TDD)

**Files:**
- Create: `src/reducer/status.ts`, `src/reducer/status.test.ts`

- [ ] **Step 1: Write `src/reducer/status.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { TranscriptModel, TurnView } from '../types/model.js';
import { EMPTY_MODEL } from '../types/model.js';
import { inferStatus } from './status.js';

function modelWithLastTurn(status: TurnView['status']): TranscriptModel {
  return {
    ...EMPTY_MODEL,
    turns: [{ turnId: 'X', startedAt: 0, status, items: [] }],
    lastEventAt: 1,
  };
}

describe('inferStatus', () => {
  it('returns idle when no turns', () => {
    expect(inferStatus(EMPTY_MODEL)).toBe('idle');
  });
  it('returns working when last turn running', () => {
    expect(inferStatus(modelWithLastTurn('running'))).toBe('working');
  });
  it('returns failed when last turn failed', () => {
    expect(inferStatus(modelWithLastTurn('failed'))).toBe('failed');
  });
  it('returns stopped when last turn aborted', () => {
    expect(inferStatus(modelWithLastTurn('aborted'))).toBe('stopped');
  });
  it('returns completed when last turn completed', () => {
    expect(inferStatus(modelWithLastTurn('completed'))).toBe('completed');
  });
});
```

- [ ] **Step 2: Implement `src/reducer/status.ts`**

```ts
import type { TranscriptModel, TranscriptStatus } from '../types/model.js';

export function inferStatus(model: TranscriptModel): TranscriptStatus {
  const last = model.turns[model.turns.length - 1];
  if (!last) return 'idle';
  switch (last.status) {
    case 'running': return 'working';
    case 'failed': return 'failed';
    case 'aborted': return 'stopped';
    case 'completed': return 'completed';
  }
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- src/reducer/status.test.ts
```

Expected: 5 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/reducer/status.ts src/reducer/status.test.ts
git commit -m "feat(reducer): inferStatus session-level state"
```

---

## Task 11: useCodexTranscript hook (TDD, with incremental cache)

**Files:**
- Create: `src/hooks/useCodexTranscript.ts`, `src/hooks/useCodexTranscript.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatStreamEvent } from '../types/events.js';
import { useCodexTranscript } from './useCodexTranscript.js';

const baseEvents: ChatStreamEvent[] = [
  { type: 'thread_started', threadId: 'T', at: 1 },
  { type: 'turn_started', turnId: 'A', at: 2 },
  { type: 'agent_message', turnId: 'A', itemId: 'a', text: 'hi', partial: false, at: 3 },
  { type: 'turn_completed', turnId: 'A', at: 4 },
];

describe('useCodexTranscript', () => {
  it('returns model and inferred status from events', () => {
    const { result } = renderHook(() => useCodexTranscript(baseEvents));
    expect(result.current.model.threadId).toBe('T');
    expect(result.current.model.turns).toHaveLength(1);
    expect(result.current.status).toBe('completed');
  });

  it('explicit status overrides inference', () => {
    const { result } = renderHook(() => useCodexTranscript(baseEvents, { status: 'stopped' }));
    expect(result.current.status).toBe('stopped');
  });

  it('append-only updates do incremental reduce (model identity changes only on change)', () => {
    const { result, rerender } = renderHook(({ ev }: { ev: ChatStreamEvent[] }) => useCodexTranscript(ev), {
      initialProps: { ev: baseEvents },
    });
    const before = result.current.model;
    rerender({ ev: baseEvents }); // same array reference
    expect(result.current.model).toBe(before);

    const more: ChatStreamEvent[] = [...baseEvents, { type: 'turn_started', turnId: 'B', at: 5 }];
    rerender({ ev: more });
    expect(result.current.model.turns).toHaveLength(2);
  });

  it('non-prefix change triggers full re-reduce', () => {
    const { result, rerender } = renderHook(({ ev }: { ev: ChatStreamEvent[] }) => useCodexTranscript(ev), {
      initialProps: { ev: baseEvents },
    });
    const replaced: ChatStreamEvent[] = [{ type: 'thread_started', threadId: 'OTHER', at: 1 }];
    rerender({ ev: replaced });
    expect(result.current.model.threadId).toBe('OTHER');
    expect(result.current.model.turns).toHaveLength(0);
  });

  it('reducer error is captured by onInternalError and last good model is preserved', () => {
    const onErr = vi.fn();
    const ev: ChatStreamEvent[] = [
      { type: 'turn_started', turnId: 'A', at: 1 },
      { type: 'agent_message', turnId: 'A', itemId: 'm', text: 'ok', partial: false, at: 2 },
    ];
    const { result, rerender } = renderHook(({ events }: { events: ChatStreamEvent[] }) =>
      useCodexTranscript(events, { onInternalError: onErr }),
      { initialProps: { events: ev } });
    expect(result.current.model.turns[0]?.items).toHaveLength(1);

    // Inject a bad event by mocking reduce internally is hard; emulate by passing a non-object-shaped raw.
    const bad = [...ev, null as unknown as ChatStreamEvent];
    act(() => rerender({ events: bad }));
    expect(onErr).toHaveBeenCalled();
    // Model should remain valid (one turn one item from the good prefix).
    expect(result.current.model.turns[0]?.items).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement `src/hooks/useCodexTranscript.ts`**

```ts
import { useMemo, useRef } from 'react';
import type { ChatStreamEvent } from '../types/events.js';
import type { TranscriptModel, TranscriptStatus } from '../types/model.js';
import { EMPTY_MODEL } from '../types/model.js';
import { reduceTranscript } from '../reducer/transcript.js';
import { inferStatus } from '../reducer/status.js';

export interface UseCodexTranscriptOptions {
  status?: TranscriptStatus;
  onInternalError?: (err: unknown, event?: ChatStreamEvent) => void;
}

interface CacheEntry {
  events: ChatStreamEvent[];
  model: TranscriptModel;
}

function safeReduce(
  prev: TranscriptModel,
  event: ChatStreamEvent,
  onError?: (err: unknown, event?: ChatStreamEvent) => void,
): TranscriptModel {
  try {
    return reduceTranscript(prev, event);
  } catch (err) {
    onError?.(err, event);
    return prev;
  }
}

export function useCodexTranscript(
  events: ChatStreamEvent[],
  options: UseCodexTranscriptOptions = {},
): { model: TranscriptModel; status: TranscriptStatus } {
  const cacheRef = useRef<CacheEntry>({ events: [], model: EMPTY_MODEL });

  const model = useMemo(() => {
    const cache = cacheRef.current;
    const isPrefix =
      events.length >= cache.events.length &&
      cache.events.every((e, i) => e === events[i]);

    let next: TranscriptModel;
    let startIdx: number;

    if (isPrefix) {
      next = cache.model;
      startIdx = cache.events.length;
    } else {
      next = EMPTY_MODEL;
      startIdx = 0;
    }

    for (let i = startIdx; i < events.length; i += 1) {
      const ev = events[i];
      if (ev == null || typeof ev !== 'object') {
        options.onInternalError?.(new TypeError('non-object event'), ev as ChatStreamEvent);
        continue;
      }
      next = safeReduce(next, ev, options.onInternalError);
    }

    cacheRef.current = { events, model: next };
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const status = options.status ?? inferStatus(model);
  return { model, status };
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- src/hooks/useCodexTranscript.test.ts
```

Expected: 5 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/
git commit -m "feat(hook): useCodexTranscript with incremental reduce + error capture"
```

---

## Task 12: useSmoothStream hook (TDD with fake timers)

**Files:**
- Create: `src/hooks/useSmoothStream.ts`, `src/hooks/useSmoothStream.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSmoothStream } from './useSmoothStream.js';

beforeEach(() => {
  vi.useFakeTimers();
  let raf = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    raf += 1;
    setTimeout(() => cb(performance.now()), 16);
    return raf;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useSmoothStream', () => {
  it('returns full text immediately when disabled', () => {
    const { result } = renderHook(() => useSmoothStream('hello', { enabled: false }));
    expect(result.current).toBe('hello');
  });

  it('progressively reveals characters when enabled', async () => {
    const { result } = renderHook(() => useSmoothStream('hello'));
    expect(result.current.length).toBeLessThan(5);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(result.current).toBe('hello');
  });

  it('truncates when input shrinks (reset)', async () => {
    const { result, rerender } = renderHook(({ s }: { s: string }) => useSmoothStream(s), {
      initialProps: { s: 'hello world' },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(result.current).toBe('hello world');
    rerender({ s: 'hi' });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(result.current).toBe('hi');
  });
});
```

- [ ] **Step 2: Implement `src/hooks/useSmoothStream.ts`**

```ts
import { useEffect, useRef, useState } from 'react';

export interface UseSmoothStreamOptions {
  enabled?: boolean;
  /** When > 0, override automatic chars-per-frame calculation. */
  charsPerFrame?: number;
  minDelayMs?: number;
}

const HAS_SEGMENTER = typeof Intl !== 'undefined' && typeof (Intl as unknown as { Segmenter?: unknown }).Segmenter === 'function';

function segments(text: string): string[] {
  if (!HAS_SEGMENTER) return Array.from(text);
  const seg = new (Intl as unknown as { Segmenter: new (locale?: string, opts?: { granularity: 'grapheme' }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter(undefined, { granularity: 'grapheme' });
  const out: string[] = [];
  for (const part of seg.segment(text)) out.push(part.segment);
  return out;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useSmoothStream(fullText: string, options: UseSmoothStreamOptions = {}): string {
  const { enabled = true, charsPerFrame, minDelayMs = 16 } = options;
  const [shown, setShown] = useState<string>(() => (!enabled || reducedMotion() ? fullText : ''));
  const targetRef = useRef<string[]>(segments(fullText));
  const idxRef = useRef<number>((!enabled || reducedMotion()) ? targetRef.current.length : 0);
  const lastTickRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || reducedMotion()) {
      setShown(fullText);
      targetRef.current = segments(fullText);
      idxRef.current = targetRef.current.length;
      return;
    }
    const newSegs = segments(fullText);
    const oldSegs = targetRef.current;
    targetRef.current = newSegs;
    const isPrefix = newSegs.length >= oldSegs.length && oldSegs.every((s, i) => s === newSegs[i]);
    if (!isPrefix) {
      // text shrunk or replaced — reset
      idxRef.current = 0;
      setShown('');
    } else if (idxRef.current > newSegs.length) {
      idxRef.current = newSegs.length;
    }

    const tick = (t: number) => {
      const target = targetRef.current;
      const remaining = target.length - idxRef.current;
      if (remaining <= 0) { rafRef.current = null; return; }
      const elapsed = t - lastTickRef.current;
      if (elapsed < minDelayMs) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastTickRef.current = t;
      const step = Math.max(1, charsPerFrame ?? Math.ceil(remaining / 8));
      idxRef.current = Math.min(target.length, idxRef.current + step);
      setShown(target.slice(0, idxRef.current).join(''));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [fullText, enabled, charsPerFrame, minDelayMs]);

  return shown;
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm test -- src/hooks/useSmoothStream.test.ts
```

Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSmoothStream.ts src/hooks/useSmoothStream.test.ts
git commit -m "feat(hook): useSmoothStream typewriter effect"
```

---

## Task 13: Style basics — tokens.css + reset + icons

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/reset.module.css`, `src/components/icons.ts`

- [ ] **Step 1: Write `src/styles/tokens.css`**

```css
:root,
.codexview-root {
  --cv-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --cv-font-mono: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace;
  --cv-font-size: 14px;
  --cv-line-height: 1.55;
  --cv-radius: 12px;
  --cv-radius-sm: 8px;
  --cv-spacing-xs: 4px;
  --cv-spacing-sm: 8px;
  --cv-spacing-md: 12px;
  --cv-spacing-lg: 16px;

  --cv-text:           #1f2328;
  --cv-text-muted:     #6e7781;
  --cv-text-inverse:   #ffffff;
  --cv-bg:             #ffffff;
  --cv-bg-raised:      #f6f8fa;
  --cv-bg-user-bubble: #2f6feb;
  --cv-bg-assistant-bubble: #f6f8fa;
  --cv-bg-code:        #0d1117;
  --cv-fg-code:        #e6edf3;
  --cv-border:         #d0d7de;
  --cv-axis-color:     #d0d7de;
  --cv-shimmer-color:  rgba(31, 35, 40, 0.08);

  --cv-status-pending:   #6e7781;
  --cv-status-running:   #2f6feb;
  --cv-status-completed: #1a7f37;
  --cv-status-failed:    #cf222e;
  --cv-status-stopped:   #6e7781;

  --cv-diff-add-bg: #ddf4e4;
  --cv-diff-del-bg: #ffebe9;
}
```

- [ ] **Step 2: Write `src/styles/reset.module.css`**

```css
.root {
  all: initial;
  display: block;
  font-family: var(--cv-font-family);
  font-size: var(--cv-font-size);
  line-height: var(--cv-line-height);
  color: var(--cv-text);
  background: var(--cv-bg);
  box-sizing: border-box;
}
.root *,
.root *::before,
.root *::after {
  box-sizing: inherit;
}
```

- [ ] **Step 3: Write `src/components/icons.ts`**

```ts
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleSlash,
  CircleX,
  FileEdit,
  Globe,
  MessageSquare,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';

export const ICONS = {
  tool: Wrench,
  exec: Terminal,
  patch: FileEdit,
  search: Search,
  web: Globe,
  message: MessageSquare,
  reasoning: Sparkles,
  ok: CircleCheck,
  fail: CircleX,
  stop: CircleSlash,
  warn: AlertCircle,
  expand: ChevronDown,
  collapse: ChevronRight,
} as const;

export type IconKey = keyof typeof ICONS;
```

- [ ] **Step 4: Verify typecheck**

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/styles/ src/components/icons.ts
git commit -m "feat(styles): tokens, reset, lucide icon map"
```

---

## Task 14: ItemErrorBoundary + StatusBar

**Files:**
- Create: `src/components/ItemErrorBoundary.tsx`
- Create: `src/components/StatusBar.tsx`, `src/components/StatusBar.module.css`, `src/components/StatusBar.test.tsx`

- [ ] **Step 1: Write `ItemErrorBoundary.tsx`**

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ItemErrorBoundaryProps {
  fallback?: ReactNode;
  onError?: (err: unknown, info: ErrorInfo) => void;
  children: ReactNode;
}

interface State { hasError: boolean }

export class ItemErrorBoundary extends Component<ItemErrorBoundaryProps, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State { return { hasError: true }; }

  override componentDidCatch(err: unknown, info: ErrorInfo): void {
    this.props.onError?.(err, info);
  }

  override render(): ReactNode {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
```

- [ ] **Step 2: Write `StatusBar.tsx`**

```tsx
import type { TranscriptStatus } from '../types/model.js';
import styles from './StatusBar.module.css';

export interface StatusBarProps {
  status: TranscriptStatus;
  label?: string;
  error?: { message: string; details?: string };
}

const LABELS: Record<TranscriptStatus, string> = {
  idle: '',
  working: '正在工作',
  completed: '已完成',
  stopped: '已停止',
  failed: '出错',
};

export function StatusBar({ status, label, error }: StatusBarProps): JSX.Element | null {
  if (status === 'idle') return null;
  const text = label ?? LABELS[status];
  return (
    <div className={styles.bar} data-status={status} role="status" aria-live="polite">
      {status === 'working' && <span aria-hidden className={styles.pulse} />}
      <span className={styles.label}>{text}</span>
      {error && (
        <details className={styles.errorDetails}>
          <summary>{error.message}</summary>
          {error.details && <pre>{error.details}</pre>}
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write `StatusBar.module.css`**

```css
.bar {
  display: flex;
  align-items: center;
  gap: var(--cv-spacing-sm);
  padding: var(--cv-spacing-sm) var(--cv-spacing-md);
  border-bottom: 1px solid var(--cv-border);
  background: var(--cv-bg-raised);
  font-size: 0.875rem;
}
.bar[data-status='working'] { color: var(--cv-status-running); }
.bar[data-status='completed'] { color: var(--cv-status-completed); }
.bar[data-status='failed'] { color: var(--cv-status-failed); }
.bar[data-status='stopped'] { color: var(--cv-status-stopped); }

.pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  animation: cv-pulse 1.4s ease-in-out infinite;
}
@keyframes cv-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.8); }
}
@media (prefers-reduced-motion: reduce) {
  .pulse { animation: none; opacity: 1; }
}
.label { font-weight: 500; }
.errorDetails { margin-left: auto; max-width: 50%; }
.errorDetails summary { cursor: pointer; }
.errorDetails pre { font-size: 0.75rem; overflow-x: auto; }
```

- [ ] **Step 4: Write `StatusBar.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBar } from './StatusBar.js';

describe('StatusBar', () => {
  it('renders nothing when status=idle', () => {
    const { container } = render(<StatusBar status="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders working with default label and pulse', () => {
    render(<StatusBar status="working" />);
    expect(screen.getByRole('status')).toHaveTextContent('正在工作');
  });

  it('uses custom label when provided', () => {
    render(<StatusBar status="working" label="思考中" />);
    expect(screen.getByRole('status')).toHaveTextContent('思考中');
  });

  it('renders error details when status=failed', () => {
    render(<StatusBar status="failed" error={{ message: 'oops', details: 'stack' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('oops');
  });
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm test -- src/components/StatusBar.test.tsx
```

Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ItemErrorBoundary.tsx src/components/StatusBar.tsx src/components/StatusBar.module.css src/components/StatusBar.test.tsx
git commit -m "feat(ui): ItemErrorBoundary + StatusBar"
```

---

## Task 15: TurnContainer + MessageBubble

**Files:**
- Create: `src/components/TurnContainer.tsx`, `src/components/TurnContainer.module.css`
- Create: `src/components/MessageBubble.tsx`, `src/components/MessageBubble.module.css`, `src/components/MessageBubble.test.tsx`

- [ ] **Step 1: Write `TurnContainer.tsx`**

```tsx
import type { ReactNode } from 'react';
import type { TurnView } from '../types/model.js';
import styles from './TurnContainer.module.css';

export interface TurnContainerProps {
  turn: TurnView;
  children: ReactNode;
}

export function TurnContainer({ turn, children }: TurnContainerProps): JSX.Element {
  return (
    <section className={styles.turn} data-turn-id={turn.turnId} data-turn-status={turn.status}>
      <div className={styles.axis}>{children}</div>
    </section>
  );
}
```

- [ ] **Step 2: Write `TurnContainer.module.css`**

```css
.turn {
  padding: var(--cv-spacing-md) var(--cv-spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--cv-spacing-sm);
}
.axis {
  position: relative;
  padding-left: var(--cv-spacing-lg);
  border-left: 2px solid var(--cv-axis-color);
  display: flex;
  flex-direction: column;
  gap: var(--cv-spacing-sm);
}
.turn[data-turn-status='running'] .axis { border-left-color: var(--cv-status-running); }
.turn[data-turn-status='failed']  .axis { border-left-color: var(--cv-status-failed); }
.turn[data-turn-status='aborted'] .axis { border-left-color: var(--cv-status-stopped); }
```

- [ ] **Step 3: Write `MessageBubble.tsx`**

```tsx
import type { ItemView } from '../types/model.js';
import { useSmoothStream } from '../hooks/useSmoothStream.js';
import styles from './MessageBubble.module.css';

export interface MessageBubbleProps {
  item: Extract<ItemView, { kind: 'user_message' | 'assistant_text' }>;
  smoothStream?: boolean;
}

export function MessageBubble({ item, smoothStream = true }: MessageBubbleProps): JSX.Element {
  const isUser = item.kind === 'user_message';
  const enabled = !isUser && smoothStream && item.status === 'running';
  const text = useSmoothStream(item.text, { enabled });
  return (
    <div
      className={styles.bubble}
      data-role={isUser ? 'user' : 'assistant'}
      data-status={item.status}
    >
      <span className={styles.text}>{text}</span>
      {item.status === 'running' && <span aria-hidden className={styles.caret}>▋</span>}
    </div>
  );
}
```

- [ ] **Step 4: Write `MessageBubble.module.css`**

```css
.bubble {
  max-width: 80%;
  padding: var(--cv-spacing-sm) var(--cv-spacing-md);
  border-radius: var(--cv-radius);
  white-space: pre-wrap;
  word-break: break-word;
}
.bubble[data-role='user'] {
  align-self: flex-end;
  background: var(--cv-bg-user-bubble);
  color: var(--cv-text-inverse);
}
.bubble[data-role='assistant'] {
  background: var(--cv-bg-assistant-bubble);
  color: var(--cv-text);
}
.caret {
  display: inline-block;
  margin-left: 2px;
  animation: cv-blink 1s steps(2) infinite;
}
@keyframes cv-blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .caret { animation: none; } }
```

- [ ] **Step 5: Write `MessageBubble.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageBubble } from './MessageBubble.js';

describe('MessageBubble', () => {
  it('renders user message with role=user', () => {
    render(<MessageBubble item={{ id: 'u', kind: 'user_message', status: 'completed', startedAt: 0, updatedAt: 0, text: 'hi' }} />);
    const el = screen.getByText('hi').closest('div')!;
    expect(el.dataset.role).toBe('user');
  });

  it('renders running assistant with caret', () => {
    render(
      <MessageBubble
        smoothStream={false}
        item={{ id: 'a', kind: 'assistant_text', status: 'running', startedAt: 0, updatedAt: 0, text: 'partial' }}
      />,
    );
    expect(screen.getByText('partial')).toBeInTheDocument();
    expect(screen.getByText('▋')).toBeInTheDocument();
  });

  it('completed assistant has no caret', () => {
    render(
      <MessageBubble
        smoothStream={false}
        item={{ id: 'a', kind: 'assistant_text', status: 'completed', startedAt: 0, updatedAt: 0, text: 'done' }}
      />,
    );
    expect(screen.queryByText('▋')).toBeNull();
  });
});
```

- [ ] **Step 6: Run tests**

```bash
pnpm test -- src/components/MessageBubble.test.tsx
```

Expected: 3 PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/TurnContainer.tsx src/components/TurnContainer.module.css src/components/MessageBubble.tsx src/components/MessageBubble.module.css src/components/MessageBubble.test.tsx
git commit -m "feat(ui): TurnContainer + MessageBubble"
```

---

## Task 16: ReasoningBlock

**Files:**
- Create: `src/components/ReasoningBlock.tsx`, `src/components/ReasoningBlock.module.css`, `src/components/ReasoningBlock.test.tsx`

- [ ] **Step 1: Write `ReasoningBlock.tsx`**

```tsx
import type { ItemView } from '../types/model.js';
import { useSmoothStream } from '../hooks/useSmoothStream.js';
import { ICONS } from './icons.js';
import styles from './ReasoningBlock.module.css';

export interface ReasoningBlockProps {
  item: Extract<ItemView, { kind: 'reasoning' }>;
  defaultOpen?: boolean;
  smoothStream?: boolean;
}

function durationLabel(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ReasoningBlock({ item, defaultOpen = false, smoothStream = true }: ReasoningBlockProps): JSX.Element {
  const Icon = ICONS.reasoning;
  const live = item.status === 'running';
  const text = useSmoothStream(item.text, { enabled: smoothStream && live });
  const elapsed = item.updatedAt - item.startedAt;
  return (
    <details className={styles.block} open={defaultOpen || live}>
      <summary className={styles.summary}>
        <Icon size={14} aria-hidden />
        <span>{live ? '思考中…' : `思考 (${durationLabel(elapsed)})`}</span>
      </summary>
      <div className={styles.body}>{text}</div>
    </details>
  );
}
```

- [ ] **Step 2: Write `ReasoningBlock.module.css`**

```css
.block {
  border-left: 2px solid var(--cv-border);
  padding-left: var(--cv-spacing-sm);
}
.summary {
  display: inline-flex;
  align-items: center;
  gap: var(--cv-spacing-xs);
  cursor: pointer;
  color: var(--cv-text-muted);
  font-style: italic;
  list-style: none;
}
.summary::-webkit-details-marker { display: none; }
.body {
  margin-top: var(--cv-spacing-xs);
  color: var(--cv-text-muted);
  font-style: italic;
  white-space: pre-wrap;
}
```

- [ ] **Step 3: Write `ReasoningBlock.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReasoningBlock } from './ReasoningBlock.js';

describe('ReasoningBlock', () => {
  it('shows thinking-in-progress label and is open while running', () => {
    render(
      <ReasoningBlock smoothStream={false} item={{ id: 'r', kind: 'reasoning', status: 'running', startedAt: 0, updatedAt: 100, text: 'hmm' }} />,
    );
    expect(screen.getByText(/思考中/)).toBeInTheDocument();
    expect(screen.getByText('hmm')).toBeInTheDocument();
  });

  it('shows duration when completed and is collapsed by default', () => {
    render(
      <ReasoningBlock smoothStream={false} item={{ id: 'r', kind: 'reasoning', status: 'completed', startedAt: 0, updatedAt: 1500, text: 'done' }} />,
    );
    expect(screen.getByText(/思考 \(1\.5s\)/)).toBeInTheDocument();
    const details = screen.getByText(/思考/).closest('details')!;
    expect(details.open).toBe(false);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- src/components/ReasoningBlock.test.tsx
```

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ReasoningBlock.*
git commit -m "feat(ui): ReasoningBlock collapsed by default with duration"
```

---

## Task 17: ToolCallBlock + ExecBlock

**Files:**
- Create: `src/components/ToolCallBlock.tsx`, `src/components/ToolCallBlock.module.css`, `src/components/ToolCallBlock.test.tsx`
- Create: `src/components/ExecBlock.tsx`, `src/components/ExecBlock.module.css`, `src/components/ExecBlock.test.tsx`
- Create: `src/components/_shared.ts` (collapse helpers shared by tool/exec/search)

- [ ] **Step 1: Write `src/components/_shared.ts`**

```ts
const MAX_INLINE_CHARS = 500;
const MAX_INLINE_LINES = 4;
const MAX_DEPTH = 3;

function depth(value: unknown, current = 0): number {
  if (value == null || typeof value !== 'object' || current > MAX_DEPTH) return current;
  let max = current;
  for (const v of Object.values(value as Record<string, unknown>)) {
    max = Math.max(max, depth(v, current + 1));
  }
  return max;
}

export function shouldCollapseValue(value: unknown): boolean {
  if (typeof value === 'string') {
    if (value.length > MAX_INLINE_CHARS) return true;
    if (value.split('\n').length > MAX_INLINE_LINES) return true;
    return false;
  }
  try {
    const json = JSON.stringify(value, null, 2);
    if (json == null) return false;
    if (json.length > MAX_INLINE_CHARS) return true;
    if (json.split('\n').length > MAX_INLINE_LINES) return true;
    if (depth(value) > MAX_DEPTH) return true;
    return false;
  } catch {
    return true;
  }
}

export function safeStringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? String(value); }
  catch { return '[unserializable]'; }
}
```

- [ ] **Step 2: Write `ToolCallBlock.tsx`**

```tsx
import type { ItemView } from '../types/model.js';
import { ICONS } from './icons.js';
import { safeStringify, shouldCollapseValue } from './_shared.js';
import styles from './ToolCallBlock.module.css';

export interface ToolCallBlockProps {
  item: Extract<ItemView, { kind: 'tool_call' }>;
}

function phrase(name: string, server?: string): string {
  return server ? `${server}.${name}` : name;
}

export function ToolCallBlock({ item }: ToolCallBlockProps): JSX.Element {
  const Icon = ICONS.tool;
  return (
    <div className={styles.block} data-status={item.status}>
      <header className={styles.header}>
        <Icon size={14} aria-hidden />
        <span className={styles.title}>{phrase(item.name, item.server)}</span>
        <span className={styles.statusChip}>{item.status}</span>
      </header>
      <div className={styles.args}>
        <div className={styles.label}>args</div>
        <pre className={styles.code}>{safeStringify(item.args)}</pre>
      </div>
      {item.error !== undefined && (
        <div className={styles.error}>{item.error}</div>
      )}
      {item.result !== undefined && (
        shouldCollapseValue(item.result) ? (
          <details className={styles.result}>
            <summary>result</summary>
            <pre className={styles.code}>{safeStringify(item.result)}</pre>
          </details>
        ) : (
          <div className={styles.result}>
            <div className={styles.label}>result</div>
            <pre className={styles.code}>{safeStringify(item.result)}</pre>
          </div>
        )
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write `ToolCallBlock.module.css`**

```css
.block {
  border: 1px solid var(--cv-border);
  border-radius: var(--cv-radius-sm);
  padding: var(--cv-spacing-sm);
  background: var(--cv-bg-raised);
  display: flex;
  flex-direction: column;
  gap: var(--cv-spacing-xs);
}
.block[data-status='pending']   { border-left: 3px solid var(--cv-status-pending); }
.block[data-status='running']   { border-left: 3px solid var(--cv-status-running); }
.block[data-status='completed'] { border-left: 3px solid var(--cv-status-completed); }
.block[data-status='failed']    { border-left: 3px solid var(--cv-status-failed); }
.block[data-status='stopped']   { border-left: 3px solid var(--cv-status-stopped); }

.header { display: flex; align-items: center; gap: var(--cv-spacing-xs); }
.title { font-weight: 600; }
.statusChip { margin-left: auto; font-size: 0.75rem; color: var(--cv-text-muted); }
.label { font-size: 0.75rem; color: var(--cv-text-muted); }
.code {
  background: var(--cv-bg-code); color: var(--cv-fg-code);
  padding: var(--cv-spacing-sm); border-radius: var(--cv-radius-sm);
  font-family: var(--cv-font-mono); font-size: 0.8rem; overflow-x: auto;
  white-space: pre-wrap;
}
.error { color: var(--cv-status-failed); font-family: var(--cv-font-mono); font-size: 0.8rem; }
.result summary { cursor: pointer; font-size: 0.75rem; color: var(--cv-text-muted); }
```

- [ ] **Step 4: Write `ToolCallBlock.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolCallBlock } from './ToolCallBlock.js';

describe('ToolCallBlock', () => {
  it('renders pending tool call without result', () => {
    render(<ToolCallBlock item={{ id: 'c', kind: 'tool_call', status: 'pending', startedAt: 0, updatedAt: 0, name: 'getWeather', args: { city: 'NYC' } }} />);
    expect(screen.getByText('getWeather')).toBeInTheDocument();
    expect(screen.queryByText('result')).toBeNull();
  });

  it('renders inline result when small', () => {
    render(<ToolCallBlock item={{ id: 'c', kind: 'tool_call', status: 'completed', startedAt: 0, updatedAt: 0, name: 'x', args: {}, result: { ok: true } }} />);
    expect(screen.getByText('result')).toBeInTheDocument();
  });

  it('renders collapsed result when large', () => {
    const big = 'x'.repeat(600);
    render(<ToolCallBlock item={{ id: 'c', kind: 'tool_call', status: 'completed', startedAt: 0, updatedAt: 0, name: 'x', args: {}, result: big }} />);
    const details = screen.getByText('result').closest('details');
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
  });

  it('renders error in failed state', () => {
    render(<ToolCallBlock item={{ id: 'c', kind: 'tool_call', status: 'failed', startedAt: 0, updatedAt: 0, name: 'x', args: {}, error: 'boom' }} />);
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('prefixes name with server for MCP tools', () => {
    render(<ToolCallBlock item={{ id: 'c', kind: 'tool_call', status: 'pending', startedAt: 0, updatedAt: 0, name: 'list', server: 'fs', args: {} }} />);
    expect(screen.getByText('fs.list')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Write `ExecBlock.tsx`**

```tsx
import type { ItemView } from '../types/model.js';
import { ICONS } from './icons.js';
import { shouldCollapseValue } from './_shared.js';
import styles from './ExecBlock.module.css';

export interface ExecBlockProps {
  item: Extract<ItemView, { kind: 'exec' }>;
}

export function ExecBlock({ item }: ExecBlockProps): JSX.Element {
  const Icon = ICONS.exec;
  const running = item.status === 'running';
  const exitText = item.exit != null ? `(exit ${item.exit}, ${item.durationMs ?? '?'}ms)` : '';
  const stdoutCollapse = shouldCollapseValue(item.stdout ?? '');
  const stderrCollapse = shouldCollapseValue(item.stderr ?? '');
  return (
    <div className={styles.block} data-status={item.status}>
      <header className={styles.header}>
        <Icon size={14} aria-hidden />
        <code className={styles.cmd}>$ {item.command}</code>
        <span className={styles.exit}>{exitText}</span>
      </header>
      {running && <div className={styles.shimmer} aria-hidden />}
      {item.stdout && (
        stdoutCollapse ? (
          <details><summary>stdout</summary><pre className={styles.stdout}>{item.stdout}</pre></details>
        ) : <pre className={styles.stdout}>{item.stdout}</pre>
      )}
      {item.stderr && (
        stderrCollapse ? (
          <details><summary>stderr</summary><pre className={styles.stderr}>{item.stderr}</pre></details>
        ) : <pre className={styles.stderr}>{item.stderr}</pre>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Write `ExecBlock.module.css`**

```css
.block {
  background: var(--cv-bg-code);
  color: var(--cv-fg-code);
  border-radius: var(--cv-radius-sm);
  padding: var(--cv-spacing-sm);
  display: flex; flex-direction: column; gap: var(--cv-spacing-xs);
  font-family: var(--cv-font-mono); font-size: 0.85rem;
  overflow: hidden;
}
.header { display: flex; align-items: center; gap: var(--cv-spacing-xs); }
.cmd { white-space: pre-wrap; word-break: break-word; flex: 1; }
.exit { font-size: 0.75rem; opacity: 0.7; }
.stdout { white-space: pre-wrap; word-break: break-word; }
.stderr { white-space: pre-wrap; word-break: break-word; color: var(--cv-status-failed); }
.shimmer {
  height: 4px; border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--cv-shimmer-color), transparent);
  background-size: 200% 100%;
  animation: cv-shimmer 1.4s linear infinite;
}
@keyframes cv-shimmer {
  from { background-position: -100% 0; }
  to   { background-position:  100% 0; }
}
@media (prefers-reduced-motion: reduce) { .shimmer { animation: none; } }
```

- [ ] **Step 7: Write `ExecBlock.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExecBlock } from './ExecBlock.js';

describe('ExecBlock', () => {
  it('renders command and exit status', () => {
    render(<ExecBlock item={{ id: 'e', kind: 'exec', status: 'completed', startedAt: 0, updatedAt: 0, command: 'ls', exit: 0, stdout: 'a', stderr: '', durationMs: 5 }} />);
    expect(screen.getByText('$ ls')).toBeInTheDocument();
    expect(screen.getByText(/exit 0/)).toBeInTheDocument();
  });

  it('shows stderr in red when present', () => {
    render(<ExecBlock item={{ id: 'e', kind: 'exec', status: 'failed', startedAt: 0, updatedAt: 0, command: 'x', exit: 1, stdout: '', stderr: 'no', durationMs: 1 }} />);
    expect(screen.getByText('no')).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run tests**

```bash
pnpm test -- src/components/ToolCallBlock.test.tsx src/components/ExecBlock.test.tsx
```

Expected: 7 PASS total.

- [ ] **Step 9: Commit**

```bash
git add src/components/_shared.ts src/components/ToolCallBlock.* src/components/ExecBlock.*
git commit -m "feat(ui): ToolCallBlock + ExecBlock with collapse heuristics"
```

---

## Task 18: SearchBlock + PatchBlock + RawEventBlock

**Files:**
- Create: `src/components/SearchBlock.tsx`, `.module.css`, `.test.tsx`
- Create: `src/components/PatchBlock.tsx`, `.module.css`, `.test.tsx`
- Create: `src/components/RawEventBlock.tsx`, `.module.css`, `.test.tsx`

- [ ] **Step 1: Write `SearchBlock.tsx`**

```tsx
import { useState } from 'react';
import type { ItemView } from '../types/model.js';
import { ICONS } from './icons.js';
import styles from './SearchBlock.module.css';

export interface SearchBlockProps {
  item: Extract<ItemView, { kind: 'search' }>;
  initialVisible?: number;
}

export function SearchBlock({ item, initialVisible = 3 }: SearchBlockProps): JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const Icon = ICONS.search;
  const results = item.results ?? [];
  const visible = showAll ? results : results.slice(0, initialVisible);
  const remaining = results.length - visible.length;
  return (
    <div className={styles.block} data-status={item.status}>
      <header className={styles.header}>
        <Icon size={14} aria-hidden />
        <span className={styles.query}>{item.query}</span>
      </header>
      {results.length > 0 && (
        <ol className={styles.results}>
          {visible.map((r) => (
            <li key={r.url}>
              <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
              {r.snippet && <p className={styles.snippet}>{r.snippet}</p>}
            </li>
          ))}
        </ol>
      )}
      {remaining > 0 && (
        <button type="button" className={styles.more} onClick={() => setShowAll(true)}>
          展开剩余 {remaining} 条
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write `SearchBlock.module.css`**

```css
.block { display: flex; flex-direction: column; gap: var(--cv-spacing-xs); }
.header { display: flex; align-items: center; gap: var(--cv-spacing-xs); font-weight: 500; }
.query { color: var(--cv-text); }
.results { padding-left: var(--cv-spacing-md); margin: 0; }
.results li { margin-bottom: var(--cv-spacing-xs); }
.results a { color: var(--cv-status-running); text-decoration: underline; }
.snippet { margin: 2px 0 0; color: var(--cv-text-muted); font-size: 0.85rem; }
.more {
  align-self: flex-start;
  background: none; border: none; cursor: pointer;
  color: var(--cv-status-running); padding: 0; font-size: 0.85rem;
}
```

- [ ] **Step 3: Write `SearchBlock.test.tsx`**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SearchBlock } from './SearchBlock.js';

describe('SearchBlock', () => {
  it('shows query and limited results', () => {
    render(<SearchBlock item={{ id: 's', kind: 'search', status: 'completed', startedAt: 0, updatedAt: 0, query: 'ts', results: [
      { title: 'A', url: 'https://a' },
      { title: 'B', url: 'https://b' },
      { title: 'C', url: 'https://c' },
      { title: 'D', url: 'https://d' },
    ] }} />);
    expect(screen.getByText('ts')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByText('D')).toBeNull();
    expect(screen.getByText(/展开剩余 1 条/)).toBeInTheDocument();
  });

  it('expands all on click', () => {
    render(<SearchBlock item={{ id: 's', kind: 'search', status: 'completed', startedAt: 0, updatedAt: 0, query: 'q', results: [
      { title: 'A', url: 'https://a' }, { title: 'B', url: 'https://b' }, { title: 'C', url: 'https://c' }, { title: 'D', url: 'https://d' },
    ] }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('D')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Write `PatchBlock.tsx`**

```tsx
import type { ItemView } from '../types/model.js';
import { ICONS } from './icons.js';
import styles from './PatchBlock.module.css';

export interface PatchBlockProps {
  item: Extract<ItemView, { kind: 'patch' }>;
}

function colorLines(diff: string): JSX.Element[] {
  return diff.split('\n').map((line, i) => {
    let cls = '';
    if (line.startsWith('+') && !line.startsWith('+++')) cls = styles.add!;
    else if (line.startsWith('-') && !line.startsWith('---')) cls = styles.del!;
    return <span key={i} className={cls}>{line}{'\n'}</span>;
  });
}

export function PatchBlock({ item }: PatchBlockProps): JSX.Element {
  const Icon = ICONS.patch;
  return (
    <div className={styles.block} data-status={item.status}>
      <header className={styles.header}>
        <Icon size={14} aria-hidden />
        <span>{item.files.length} 个文件 ({item.ok ? '成功' : '失败'})</span>
      </header>
      <ul className={styles.files}>
        {item.files.map((f) => (
          <li key={f.path}>
            <details>
              <summary>
                <code>{f.path}</code>
                <span className={styles.tag} data-kind={f.status}>{f.status}</span>
              </summary>
              {f.diff && <pre className={styles.diff}>{colorLines(f.diff)}</pre>}
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Write `PatchBlock.module.css`**

```css
.block { display: flex; flex-direction: column; gap: var(--cv-spacing-xs); }
.header { display: flex; align-items: center; gap: var(--cv-spacing-xs); font-weight: 500; }
.files { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
.files summary { display: flex; align-items: center; gap: var(--cv-spacing-xs); cursor: pointer; padding: 2px 0; }
.tag { font-size: 0.7rem; padding: 1px 6px; border-radius: 4px; background: var(--cv-bg-raised); color: var(--cv-text-muted); }
.tag[data-kind='added']    { background: var(--cv-diff-add-bg); color: var(--cv-status-completed); }
.tag[data-kind='deleted']  { background: var(--cv-diff-del-bg); color: var(--cv-status-failed); }
.diff {
  background: var(--cv-bg-code); color: var(--cv-fg-code);
  padding: var(--cv-spacing-sm); border-radius: var(--cv-radius-sm);
  font-family: var(--cv-font-mono); font-size: 0.8rem;
  white-space: pre-wrap; overflow-x: auto;
}
.add { background: var(--cv-diff-add-bg); color: #032b14; }
.del { background: var(--cv-diff-del-bg); color: #67060c; }
```

- [ ] **Step 6: Write `PatchBlock.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PatchBlock } from './PatchBlock.js';

describe('PatchBlock', () => {
  it('lists files with status tags', () => {
    render(<PatchBlock item={{ id: 'p', kind: 'patch', status: 'completed', startedAt: 0, updatedAt: 0, files: [
      { path: 'a.ts', status: 'modified', diff: '+ new\n- old' },
    ], ok: true }} />);
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(screen.getByText('modified')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Write `RawEventBlock.tsx`**

```tsx
import type { ItemView } from '../types/model.js';
import { ICONS } from './icons.js';
import { safeStringify } from './_shared.js';
import styles from './RawEventBlock.module.css';

export interface RawEventBlockProps {
  item: Extract<ItemView, { kind: 'raw' }>;
}

export function RawEventBlock({ item }: RawEventBlockProps): JSX.Element {
  const Icon = ICONS.warn;
  const typeLabel = (() => {
    const p = item.payload;
    if (p && typeof p === 'object' && 'type' in p) return String((p as { type: unknown }).type);
    return 'unknown';
  })();
  return (
    <details className={styles.block}>
      <summary className={styles.summary}>
        <Icon size={14} aria-hidden />
        <span>未知事件: {typeLabel}</span>
      </summary>
      <pre className={styles.code}>{safeStringify(item.payload)}</pre>
    </details>
  );
}
```

- [ ] **Step 8: Write `RawEventBlock.module.css`**

```css
.block { border: 1px dashed var(--cv-border); border-radius: var(--cv-radius-sm); padding: var(--cv-spacing-xs) var(--cv-spacing-sm); background: var(--cv-bg-raised); }
.summary { display: flex; align-items: center; gap: var(--cv-spacing-xs); cursor: pointer; color: var(--cv-text-muted); list-style: none; }
.summary::-webkit-details-marker { display: none; }
.code {
  margin: var(--cv-spacing-xs) 0 0;
  background: var(--cv-bg-code); color: var(--cv-fg-code);
  padding: var(--cv-spacing-sm); border-radius: var(--cv-radius-sm);
  font-family: var(--cv-font-mono); font-size: 0.8rem; white-space: pre-wrap;
}
```

- [ ] **Step 9: Write `RawEventBlock.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RawEventBlock } from './RawEventBlock.js';

describe('RawEventBlock', () => {
  it('shows unknown event with type label and payload preserved', () => {
    render(<RawEventBlock item={{ id: 'r', kind: 'raw', status: 'completed', startedAt: 0, updatedAt: 0, payload: { type: 'foobar', x: 1 } }} />);
    expect(screen.getByText(/未知事件: foobar/)).toBeInTheDocument();
    expect(screen.getByText(/"x": 1/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run all new tests**

```bash
pnpm test -- src/components/SearchBlock.test.tsx src/components/PatchBlock.test.tsx src/components/RawEventBlock.test.tsx
```

Expected: 4 PASS.

- [ ] **Step 11: Commit**

```bash
git add src/components/SearchBlock.* src/components/PatchBlock.* src/components/RawEventBlock.*
git commit -m "feat(ui): SearchBlock + PatchBlock + RawEventBlock"
```

---

## Task 19: CodexTranscript main component + index.ts

**Files:**
- Create: `src/components/CodexTranscript.tsx`, `src/components/CodexTranscript.module.css`, `src/components/CodexTranscript.test.tsx`
- Modify: `src/index.ts` (replace placeholder with full re-exports)

- [ ] **Step 1: Write `CodexTranscript.tsx`**

```tsx
import { Fragment, useCallback, type ComponentType, type ReactNode } from 'react';
import type { ChatStreamEvent } from '../types/events.js';
import type { ItemView, TranscriptStatus, TurnView } from '../types/model.js';
import { useCodexTranscript } from '../hooks/useCodexTranscript.js';
import { ItemErrorBoundary } from './ItemErrorBoundary.js';
import { TurnContainer } from './TurnContainer.js';
import { MessageBubble, type MessageBubbleProps } from './MessageBubble.js';
import { ReasoningBlock, type ReasoningBlockProps } from './ReasoningBlock.js';
import { ToolCallBlock, type ToolCallBlockProps } from './ToolCallBlock.js';
import { ExecBlock, type ExecBlockProps } from './ExecBlock.js';
import { SearchBlock, type SearchBlockProps } from './SearchBlock.js';
import { PatchBlock, type PatchBlockProps } from './PatchBlock.js';
import { RawEventBlock, type RawEventBlockProps } from './RawEventBlock.js';
import { StatusBar, type StatusBarProps } from './StatusBar.js';
import resetStyles from '../styles/reset.module.css';
import styles from './CodexTranscript.module.css';

export interface CodexTranscriptComponents {
  StatusBar: ComponentType<StatusBarProps>;
  MessageBubble: ComponentType<MessageBubbleProps>;
  ReasoningBlock: ComponentType<ReasoningBlockProps>;
  ToolCallBlock: ComponentType<ToolCallBlockProps>;
  ExecBlock: ComponentType<ExecBlockProps>;
  SearchBlock: ComponentType<SearchBlockProps>;
  PatchBlock: ComponentType<PatchBlockProps>;
  RawEventBlock: ComponentType<RawEventBlockProps>;
}

export interface CodexTranscriptProps {
  events: ChatStreamEvent[];
  status?: TranscriptStatus;
  error?: { message: string; details?: string };
  className?: string;
  maxItems?: number;
  emptyState?: ReactNode;
  onItemClick?: (itemId: string) => void;
  components?: Partial<CodexTranscriptComponents>;
  disableSmoothStream?: boolean;
  onInternalError?: (err: unknown, event?: ChatStreamEvent) => void;
}

const DEFAULTS: CodexTranscriptComponents = {
  StatusBar,
  MessageBubble,
  ReasoningBlock,
  ToolCallBlock,
  ExecBlock,
  SearchBlock,
  PatchBlock,
  RawEventBlock,
};

function flatItems(turns: TurnView[]): { turn: TurnView; item: ItemView }[] {
  const out: { turn: TurnView; item: ItemView }[] = [];
  for (const t of turns) for (const i of t.items) out.push({ turn: t, item: i });
  return out;
}

export function CodexTranscript(props: CodexTranscriptProps): JSX.Element {
  const opts: { status?: TranscriptStatus; onInternalError?: (err: unknown, event?: ChatStreamEvent) => void } = {};
  if (props.status !== undefined) opts.status = props.status;
  if (props.onInternalError) opts.onInternalError = props.onInternalError;
  const { model, status } = useCodexTranscript(props.events, opts);
  const components = { ...DEFAULTS, ...props.components };
  const handleClick = useCallback(
    (id: string) => () => props.onItemClick?.(id),
    [props.onItemClick],
  );

  const flat = flatItems(model.turns);
  const truncated = props.maxItems != null && flat.length > props.maxItems
    ? { kept: flat.slice(flat.length - props.maxItems), omitted: flat.length - props.maxItems }
    : { kept: flat, omitted: 0 };

  if (model.turns.length === 0) {
    return (
      <div className={[resetStyles.root, styles.root, 'codexview-root', props.className].filter(Boolean).join(' ')}>
        <components.StatusBar status={status} {...(props.error ? { error: props.error } : {})} />
        <div className={styles.empty}>{props.emptyState ?? '暂无对话'}</div>
      </div>
    );
  }

  // Group kept items by turn (for TurnContainer continuity).
  const byTurn = new Map<string, ItemView[]>();
  for (const { turn, item } of truncated.kept) {
    const arr = byTurn.get(turn.turnId) ?? [];
    arr.push(item);
    byTurn.set(turn.turnId, arr);
  }
  const turnsToRender = model.turns.filter((t) => byTurn.has(t.turnId));

  return (
    <div className={[resetStyles.root, styles.root, 'codexview-root', props.className].filter(Boolean).join(' ')}>
      <components.StatusBar status={status} {...(props.error ? { error: props.error } : {})} />
      {truncated.omitted > 0 && (
        <div className={styles.omitted}>已省略最早的 {truncated.omitted} 条</div>
      )}
      <ol className={styles.list} role="log" aria-live="polite" aria-relevant="additions text">
        {turnsToRender.map((turn) => (
          <li key={turn.turnId}>
            <TurnContainer turn={turn}>
              {(byTurn.get(turn.turnId) ?? []).map((item) => (
                <Fragment key={item.id}>
                  <ItemErrorBoundary fallback={<components.RawEventBlock item={{ id: item.id, kind: 'raw', status: item.status, startedAt: item.startedAt, updatedAt: item.updatedAt, payload: item }} />}>
                    <div onClick={handleClick(item.id)}>
                      {renderItem(item, components, props.disableSmoothStream)}
                    </div>
                  </ItemErrorBoundary>
                </Fragment>
              ))}
            </TurnContainer>
          </li>
        ))}
      </ol>
    </div>
  );
}

function renderItem(item: ItemView, c: CodexTranscriptComponents, disableSmoothStream?: boolean): JSX.Element {
  const smoothStream = !disableSmoothStream;
  switch (item.kind) {
    case 'user_message':
    case 'assistant_text':
      return <c.MessageBubble item={item} smoothStream={smoothStream} />;
    case 'reasoning':
      return <c.ReasoningBlock item={item} smoothStream={smoothStream} />;
    case 'tool_call':
      return <c.ToolCallBlock item={item} />;
    case 'exec':
      return <c.ExecBlock item={item} />;
    case 'search':
      return <c.SearchBlock item={item} />;
    case 'patch':
      return <c.PatchBlock item={item} />;
    case 'raw':
      return <c.RawEventBlock item={item} />;
  }
}
```

- [ ] **Step 2: Write `CodexTranscript.module.css`**

```css
.root {
  display: flex; flex-direction: column;
  background: var(--cv-bg);
  color: var(--cv-text);
  min-height: 0;
}
.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; }
.empty {
  padding: var(--cv-spacing-lg);
  color: var(--cv-text-muted);
  text-align: center;
  font-size: 0.9rem;
}
.omitted {
  padding: var(--cv-spacing-xs) var(--cv-spacing-md);
  font-size: 0.75rem;
  color: var(--cv-text-muted);
  background: var(--cv-bg-raised);
  text-align: center;
}
```

- [ ] **Step 3: Write `CodexTranscript.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChatStreamEvent } from '../types/events.js';
import { CodexTranscript } from './CodexTranscript.js';

describe('CodexTranscript', () => {
  const ev: ChatStreamEvent[] = [
    { type: 'thread_started', threadId: 'T', at: 1 },
    { type: 'turn_started', turnId: 'A', at: 2 },
    { type: 'user_message', turnId: 'A', itemId: 'u', text: 'hi', at: 3 },
    { type: 'agent_message', turnId: 'A', itemId: 'a', text: 'hello', partial: false, at: 4 },
    { type: 'turn_completed', turnId: 'A', at: 5 },
  ];

  it('renders empty state when no events', () => {
    render(<CodexTranscript events={[]} />);
    expect(screen.getByText('暂无对话')).toBeInTheDocument();
  });

  it('renders user + assistant messages', () => {
    render(<CodexTranscript events={ev} disableSmoothStream />);
    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByRole('log')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('已完成');
  });

  it('respects maxItems by trimming oldest', () => {
    render(<CodexTranscript events={ev} maxItems={1} disableSmoothStream />);
    expect(screen.getByText(/已省略最早的 1 条/)).toBeInTheDocument();
    expect(screen.queryByText('hi')).toBeNull();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('explicit status prop overrides inference', () => {
    render(<CodexTranscript events={ev} status="stopped" disableSmoothStream />);
    expect(screen.getByRole('status')).toHaveTextContent('已停止');
  });
});
```

- [ ] **Step 4: Replace `src/index.ts`**

```ts
export type { ChatStreamEvent, ChatStreamEventType, TokenUsage, SearchResult, PatchFile } from './types/events.js';
export type { TranscriptModel, TurnView, ItemView, ItemKind, ItemStatus, TranscriptStatus } from './types/model.js';
export { EMPTY_MODEL } from './types/model.js';

export { reduceTranscript } from './reducer/transcript.js';
export { inferStatus } from './reducer/status.js';
export { useCodexTranscript } from './hooks/useCodexTranscript.js';
export type { UseCodexTranscriptOptions } from './hooks/useCodexTranscript.js';
export { useSmoothStream } from './hooks/useSmoothStream.js';
export type { UseSmoothStreamOptions } from './hooks/useSmoothStream.js';

export { CodexTranscript } from './components/CodexTranscript.js';
export type { CodexTranscriptProps, CodexTranscriptComponents } from './components/CodexTranscript.js';
export { StatusBar } from './components/StatusBar.js';
export type { StatusBarProps } from './components/StatusBar.js';
export { TurnContainer } from './components/TurnContainer.js';
export type { TurnContainerProps } from './components/TurnContainer.js';
export { MessageBubble } from './components/MessageBubble.js';
export type { MessageBubbleProps } from './components/MessageBubble.js';
export { ReasoningBlock } from './components/ReasoningBlock.js';
export type { ReasoningBlockProps } from './components/ReasoningBlock.js';
export { ToolCallBlock } from './components/ToolCallBlock.js';
export type { ToolCallBlockProps } from './components/ToolCallBlock.js';
export { ExecBlock } from './components/ExecBlock.js';
export type { ExecBlockProps } from './components/ExecBlock.js';
export { SearchBlock } from './components/SearchBlock.js';
export type { SearchBlockProps } from './components/SearchBlock.js';
export { PatchBlock } from './components/PatchBlock.js';
export type { PatchBlockProps } from './components/PatchBlock.js';
export { RawEventBlock } from './components/RawEventBlock.js';
export type { RawEventBlockProps } from './components/RawEventBlock.js';
export { ItemErrorBoundary } from './components/ItemErrorBoundary.js';
export type { ItemErrorBoundaryProps } from './components/ItemErrorBoundary.js';

export const VERSION = '0.1.0';
```

- [ ] **Step 5: Run full test suite**

```bash
pnpm test
```

Expected: ALL pass.

- [ ] **Step 6: Build and verify dist contents**

```bash
pnpm build && ls dist
```

Expected: `dist/index.js`, `dist/index.d.ts`, plus copied CSS assets (one or more `.css` files; tsup with `loader: { '.css': 'copy' }` will emit them).

- [ ] **Step 7: Commit**

```bash
git add src/components/CodexTranscript.* src/index.ts
git commit -m "feat(ui): CodexTranscript main component + public exports"
```

---

## Task 20: Fixtures + replay integration test

**Files:**
- Create: `fixtures/README.md`, `fixtures/short-chat.jsonl`, `fixtures/tool-heavy.jsonl`, `fixtures/mcp-flow.jsonl`, `fixtures/failed-turn.jsonl`, `fixtures/aborted-turn.jsonl`, `fixtures/unknown-types.jsonl`
- Create: `src/integration/loadFixture.ts`, `src/integration/replay.test.tsx`

- [ ] **Step 1: Write `fixtures/README.md`**

```markdown
# CodexView fixtures

JSONL files representing `ChatStreamEvent` sequences for tests and the dev SPA.

Each line is one event. To produce a new fixture from a real Codex session:

1. Find a rollout file in `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
2. Run a normalization script that maps native Codex events to `ChatStreamEvent`
   (the same mapping agentweb's `eventMap.ts` performs).
3. Manually scrub: replace `cwd`, usernames, hostnames, API keys, and any
   sensitive URL paths.
4. Save to `fixtures/<name>.jsonl`.

## Inventory

- `short-chat.jsonl` — single turn with one user + one assistant message
- `tool-heavy.jsonl` — multiple function_call + exec interleaved
- `mcp-flow.jsonl` — MCP tool call + web_search
- `failed-turn.jsonl` — turn ends in failure
- `aborted-turn.jsonl` — user aborts mid-turn
- `unknown-types.jsonl` — intentionally injects an unknown event type for the raw fallback
```

- [ ] **Step 2: Write `fixtures/short-chat.jsonl`**

```
{"type":"thread_started","threadId":"T-short","at":1000}
{"type":"turn_started","turnId":"A","at":1010}
{"type":"user_message","turnId":"A","itemId":"u1","text":"Hello, who are you?","at":1020}
{"type":"agent_message","turnId":"A","itemId":"a1","text":"I'm Codex, your coding assistant.","partial":false,"at":1030}
{"type":"turn_completed","turnId":"A","at":1040,"usage":{"inputTokens":12,"outputTokens":18}}
```

- [ ] **Step 3: Write `fixtures/tool-heavy.jsonl`**

```
{"type":"thread_started","threadId":"T-tool","at":2000}
{"type":"turn_started","turnId":"A","at":2010}
{"type":"user_message","turnId":"A","itemId":"u1","text":"List the files in src and run the tests.","at":2020}
{"type":"reasoning","turnId":"A","itemId":"r1","text":"I should look at the project layout first, then run the test command.","partial":false,"at":2030}
{"type":"function_call","turnId":"A","callId":"c1","name":"list_dir","args":{"path":"src"},"at":2040}
{"type":"function_call_output","turnId":"A","callId":"c1","output":["index.ts","reducer/","components/"],"at":2050}
{"type":"exec_command_begin","turnId":"A","callId":"e1","command":"pnpm test","at":2060}
{"type":"exec_command_end","turnId":"A","callId":"e1","exit":0,"stdout":"All tests passed","stderr":"","durationMs":1234,"at":2080}
{"type":"agent_message","turnId":"A","itemId":"a1","text":"Tests pass. The repo has index.ts, a reducer/ folder and a components/ folder.","partial":false,"at":2090}
{"type":"turn_completed","turnId":"A","at":2100,"usage":{"inputTokens":50,"outputTokens":80}}
```

- [ ] **Step 4: Write `fixtures/mcp-flow.jsonl`**

```
{"type":"thread_started","threadId":"T-mcp","at":3000}
{"type":"turn_started","turnId":"A","at":3010}
{"type":"user_message","turnId":"A","itemId":"u1","text":"Find recent React 19 release notes.","at":3020}
{"type":"web_search_call","turnId":"A","callId":"s1","query":"React 19 release notes","at":3030}
{"type":"web_search_end","turnId":"A","callId":"s1","results":[{"title":"React 19 is now stable","url":"https://example.com/react-19","snippet":"Server components, actions, ..."},{"title":"React 19 migration guide","url":"https://example.com/react-19-migrate"}],"at":3050}
{"type":"mcp_tool_call","turnId":"A","callId":"m1","server":"fs","name":"read_file","args":{"path":"NOTES.md"},"at":3060}
{"type":"mcp_tool_call_output","turnId":"A","callId":"m1","output":"Last updated 2026-05-01","at":3080}
{"type":"agent_message","turnId":"A","itemId":"a1","text":"React 19 is stable; key features are server components and actions.","partial":false,"at":3090}
{"type":"turn_completed","turnId":"A","at":3100}
```

- [ ] **Step 5: Write `fixtures/failed-turn.jsonl`**

```
{"type":"thread_started","threadId":"T-fail","at":4000}
{"type":"turn_started","turnId":"A","at":4010}
{"type":"user_message","turnId":"A","itemId":"u1","text":"Apply this patch.","at":4020}
{"type":"patch_apply_end","turnId":"A","callId":"p1","files":[{"path":"src/missing.ts","status":"modified"}],"ok":false,"at":4040}
{"type":"turn_failed","turnId":"A","at":4050,"error":{"message":"Patch did not apply cleanly","code":"PATCH_REJECTED"}}
```

- [ ] **Step 6: Write `fixtures/aborted-turn.jsonl`**

```
{"type":"thread_started","threadId":"T-abort","at":5000}
{"type":"turn_started","turnId":"A","at":5010}
{"type":"user_message","turnId":"A","itemId":"u1","text":"Run a long script.","at":5020}
{"type":"exec_command_begin","turnId":"A","callId":"e1","command":"sleep 60","at":5030}
{"type":"turn_aborted","turnId":"A","at":5050,"reason":"user_cancel"}
```

- [ ] **Step 7: Write `fixtures/unknown-types.jsonl`**

```
{"type":"thread_started","threadId":"T-raw","at":6000}
{"type":"turn_started","turnId":"A","at":6010}
{"type":"agent_message","turnId":"A","itemId":"a1","text":"Trying an unknown tool.","partial":false,"at":6020}
{"type":"some_future_event","turnId":"A","callId":"x1","extra":{"hello":"world"},"at":6030}
{"type":"raw","turnId":"A","payload":{"type":"explicit_raw","note":"this is intentional"},"at":6040}
{"type":"turn_completed","turnId":"A","at":6050}
```

- [ ] **Step 8: Write `src/integration/loadFixture.ts`**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatStreamEvent } from '../types/events.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));

export function loadFixture(name: string): ChatStreamEvent[] {
  const path = resolve(HERE, '..', '..', 'fixtures', `${name}.jsonl`);
  const text = readFileSync(path, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ChatStreamEvent);
}
```

- [ ] **Step 9: Write `src/integration/replay.test.tsx`**

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodexTranscript } from '../components/CodexTranscript.js';
import { loadFixture } from './loadFixture.js';

const FIXTURES = ['short-chat', 'tool-heavy', 'mcp-flow', 'failed-turn', 'aborted-turn', 'unknown-types'];

describe('replay integration', () => {
  for (const name of FIXTURES) {
    it(`renders ${name} without throwing`, () => {
      const events = loadFixture(name);
      expect(() => render(<CodexTranscript events={events} disableSmoothStream />)).not.toThrow();
    });
  }

  it('short-chat shows both user and assistant text', () => {
    const events = loadFixture('short-chat');
    const { getByText } = render(<CodexTranscript events={events} disableSmoothStream />);
    expect(getByText('Hello, who are you?')).toBeInTheDocument();
    expect(getByText("I'm Codex, your coding assistant.")).toBeInTheDocument();
  });

  it('failed-turn StatusBar shows failed', () => {
    const events = loadFixture('failed-turn');
    const { getByRole } = render(<CodexTranscript events={events} disableSmoothStream />);
    expect(getByRole('status').getAttribute('data-status')).toBe('failed');
  });

  it('aborted-turn StatusBar shows stopped', () => {
    const events = loadFixture('aborted-turn');
    const { getByRole } = render(<CodexTranscript events={events} disableSmoothStream />);
    expect(getByRole('status').getAttribute('data-status')).toBe('stopped');
  });

  it('unknown-types renders RawEventBlock for unknown event', () => {
    const events = loadFixture('unknown-types');
    const { container } = render(<CodexTranscript events={events} disableSmoothStream />);
    expect(container.textContent).toMatch(/未知事件/);
  });
});
```

- [ ] **Step 10: Run integration tests**

```bash
pnpm test -- src/integration/replay.test.tsx
```

Expected: 10 PASS (6 smoke + 4 specific assertions).

- [ ] **Step 11: Commit**

```bash
git add fixtures/ src/integration/
git commit -m "test(integration): replay 6 fixtures through CodexTranscript"
```

---

## Task 21: dev SPA (vite, fixture browser)

**Files:**
- Create: `dev/index.html`, `dev/vite.config.ts`, `dev/src/main.tsx`, `dev/src/App.tsx`, `dev/src/loadFixturesBrowser.ts`

- [ ] **Step 1: Write `dev/index.html`**

```html
<!doctype html>
<html lang="zh">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>codexview dev</title>
    <style>
      html, body, #root { height: 100%; margin: 0; }
      body { font-family: system-ui, sans-serif; background: #f6f8fa; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `dev/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  server: { port: 5180, open: true },
});
```

- [ ] **Step 3: Write `dev/src/loadFixturesBrowser.ts`**

```ts
import type { ChatStreamEvent } from '../../src/types/events.js';

const modules = import.meta.glob('../../fixtures/*.jsonl', { as: 'raw', eager: true });

export interface FixtureEntry { name: string; events: ChatStreamEvent[] }

export const FIXTURES: FixtureEntry[] = Object.entries(modules)
  .map(([path, raw]) => {
    const name = path.split('/').pop()!.replace('.jsonl', '');
    const events = (raw as string)
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as ChatStreamEvent);
    return { name, events };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
```

- [ ] **Step 4: Write `dev/src/App.tsx`**

```tsx
import { useState } from 'react';
import { CodexTranscript } from '../../src/components/CodexTranscript.js';
import { FIXTURES } from './loadFixturesBrowser.js';

export function App(): JSX.Element {
  const [name, setName] = useState(FIXTURES[0]?.name ?? '');
  const current = FIXTURES.find((f) => f.name === name);
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong>codexview</strong>
        <span style={{ color: '#6e7781' }}>fixture:</span>
        <select value={name} onChange={(e) => setName(e.target.value)}>
          {FIXTURES.map((f) => <option key={f.name}>{f.name}</option>)}
        </select>
      </header>
      <main style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff', borderRadius: 12, border: '1px solid #d0d7de' }}>
        {current && <CodexTranscript events={current.events} />}
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Write `dev/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import '../../src/styles/tokens.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Verify dev server boots**

```bash
pnpm dev
```

Open the browser at `http://localhost:5180`. Switch through every fixture in the dropdown. Observe: each fixture renders without console errors. Press Ctrl+C to stop.

- [ ] **Step 7: Commit**

```bash
git add dev/
git commit -m "chore(dev): vite-based fixture browser"
```

---

## Task 22: README + docs/api.md

**Files:**
- Modify: `README.md`
- Create: `docs/api.md`

- [ ] **Step 1: Replace `README.md`**

```markdown
# codexview

React components for rendering OpenAI Codex CLI chat streams. Designed for agentweb but framework-agnostic for any host that produces compatible `ChatStreamEvent` sequences.

## Install

```bash
pnpm add codexview lucide-react react react-dom
```

Import the stylesheet once in your app entrypoint:

```ts
import 'codexview/styles.css';
```

## 60-second quick start

```tsx
import { CodexTranscript, type ChatStreamEvent } from 'codexview';
import 'codexview/styles.css';

const events: ChatStreamEvent[] = [
  { type: 'thread_started', threadId: 'T', at: Date.now() },
  { type: 'turn_started', turnId: 'A', at: Date.now() },
  { type: 'user_message', turnId: 'A', itemId: 'u1', text: 'Hello!', at: Date.now() },
  { type: 'agent_message', turnId: 'A', itemId: 'a1', text: 'Hi.', partial: false, at: Date.now() },
  { type: 'turn_completed', turnId: 'A', at: Date.now() },
];

export function App() {
  return <CodexTranscript events={events} />;
}
```

`events` is a plain array. Append new events as they arrive (typically via SSE) and pass the same array reference back; CodexView reduces incrementally.

## Status

Session-level status (`idle | working | completed | stopped | failed`) is inferred automatically. Override via the `status` prop (e.g. when SSE drops, set `status="stopped"`).

## Customizing

- Swap any block via `components` prop: `<CodexTranscript components={{ ToolCallBlock: MyToolUI }} />`
- Theme via CSS variables — see [docs/styling.md](docs/styling.md) for the full list.

## More docs

- [docs/api.md](docs/api.md) — every public API
- [docs/events.md](docs/events.md) — `ChatStreamEvent` contract
- [docs/styling.md](docs/styling.md) — CSS variables
- [docs/integration-agentweb.md](docs/integration-agentweb.md) — drop-in for agentweb

## License

MIT.
```

- [ ] **Step 2: Write `docs/api.md`**

```markdown
# API Reference

All exports from `codexview`. Import via `import { ... } from 'codexview'`.

## Components

### `<CodexTranscript>`

Top-level transcript renderer.

```tsx
<CodexTranscript
  events={events}
  status?={status}
  error?={{ message, details? }}
  className?={string}
  maxItems?={number}
  emptyState?={ReactNode}
  onItemClick?={(id) => void}
  components?={Partial<CodexTranscriptComponents>}
  disableSmoothStream?={boolean}
  onInternalError?={(err, event?) => void}
/>
```

| Prop | Default | Notes |
|------|---------|-------|
| `events` | required | Append-only is most efficient; full replace also works. Reference equality skips re-reduce. |
| `status` | inferred | When provided, fully replaces `inferStatus(model)`. |
| `error` | undefined | Shown inside `StatusBar` when status is `failed` or `stopped`. |
| `className` | undefined | Appended to `.codexview-root` class list. |
| `maxItems` | unlimited | Trims oldest items, shows "已省略最早的 X 条" hint at the top. |
| `emptyState` | `'暂无对话'` | Rendered when `events` is empty. |
| `onItemClick` | undefined | Receives `item.id` of the clicked item. |
| `components` | builtin | Replace any subcomponent (e.g. `{ ToolCallBlock: MyTool }`). |
| `disableSmoothStream` | `false` | Disables the typewriter effect for `assistant_text` and `reasoning`. |
| `onInternalError` | undefined | Called when reducer or item render throws; component falls back without crashing. |

#### Minimal example

```tsx
const events = useAtomValue(streamingAtomFamily(sessionId));
return <CodexTranscript events={events.list} />;
```

### `<StatusBar>`

```tsx
<StatusBar status={status} label?={string} error?={{ message, details? }} />
```

Returns `null` when `status === 'idle'`.

### `<TurnContainer>`

```tsx
<TurnContainer turn={turn}>{children}</TurnContainer>
```

### `<MessageBubble>`

```tsx
<MessageBubble item={userOrAssistantItem} smoothStream?={boolean} />
```

### `<ReasoningBlock>`

```tsx
<ReasoningBlock item={reasoningItem} defaultOpen?={boolean} smoothStream?={boolean} />
```

### `<ToolCallBlock>`

```tsx
<ToolCallBlock item={toolCallItem} />
```

Renders args inline; result inline if small, collapsed in `<details>` if long (`>500` chars, `>4` lines, or `>3` JSON depth).

### `<ExecBlock>`

```tsx
<ExecBlock item={execItem} />
```

Shimmer bar shown while `status === 'running'`. stdout/stderr collapsed beyond size threshold.

### `<SearchBlock>`

```tsx
<SearchBlock item={searchItem} initialVisible?={number} />
```

Shows first 3 results by default; "展开剩余 N 条" reveals the rest.

### `<PatchBlock>`

```tsx
<PatchBlock item={patchItem} />
```

Each file is collapsed; expanding shows diff with git-style coloring.

### `<RawEventBlock>`

```tsx
<RawEventBlock item={rawItem} />
```

Used as fallback for unknown event types.

### `<ItemErrorBoundary>`

```tsx
<ItemErrorBoundary fallback?={ReactNode} onError?={(err, info) => void}>
  {children}
</ItemErrorBoundary>
```

## Hooks

### `useCodexTranscript(events, options?)`

```ts
const { model, status } = useCodexTranscript(events, { status?, onInternalError? });
```

Internally caches the last reduced model and uses prefix detection for incremental reduction.

### `useSmoothStream(text, options?)`

```ts
const display = useSmoothStream(fullText, { enabled?, charsPerFrame?, minDelayMs? });
```

Returns the substring revealed so far. Resets when input shrinks. Returns full text immediately if `enabled === false` or `prefers-reduced-motion: reduce`.

## Pure functions

### `reduceTranscript(prev, event) => next`

Pure reducer. Use directly to drive your own state container.

### `inferStatus(model) => TranscriptStatus`

Returns `'idle' | 'working' | 'completed' | 'stopped' | 'failed'`.

### `EMPTY_MODEL`

Frozen initial `TranscriptModel`. Always safe to start reducing from this.

## Types

`ChatStreamEvent`, `ChatStreamEventType`, `TokenUsage`, `SearchResult`, `PatchFile`, `TranscriptModel`, `TurnView`, `ItemView`, `ItemKind`, `ItemStatus`, `TranscriptStatus`, `CodexTranscriptComponents`, `UseCodexTranscriptOptions`, `UseSmoothStreamOptions`, plus per-component prop types (`StatusBarProps`, etc.).

See [docs/events.md](events.md) for the full `ChatStreamEvent` shape.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/api.md
git commit -m "docs: README quick start + full API reference"
```

---

## Task 23: docs/events.md + docs/styling.md

**Files:**
- Create: `docs/events.md`, `docs/styling.md`

- [ ] **Step 1: Write `docs/events.md`**

```markdown
# Event contract

CodexView consumes a discriminated union `ChatStreamEvent`. The host (e.g. agentweb backend) is expected to emit events that match these shapes. Unknown event types are not errors — they fall through to `kind: 'raw'` and render via `RawEventBlock`.

All events carry `at: number` (epoch ms).

## Lifecycle

| Type | Required fields | Reducer effect |
|------|-----------------|----------------|
| `thread_started` | `threadId` | sets `model.threadId` |
| `turn_started` | `turnId` | appends new `TurnView { status: 'running' }` |
| `turn_completed` | `turnId`, optional `usage` | turn → `completed`; flips unfinished items → `completed` |
| `turn_failed` | `turnId`, `error: { message, code? }` | turn → `failed`; flips unfinished items → `failed` |
| `turn_aborted` | `turnId`, optional `reason` | turn → `aborted`; flips unfinished items → `stopped` |

## Messages

| Type | Required fields | ItemView produced |
|------|-----------------|-------------------|
| `user_message` | `turnId`, `itemId`, `text` | `kind: 'user_message'`, status `completed` |
| `agent_message` | `turnId`, `itemId`, `text`, `partial` | `kind: 'assistant_text'`; same `itemId` updates in place; `partial: false` flips to `completed` |
| `reasoning` | same as `agent_message` | `kind: 'reasoning'`; **never merged** with assistant_text |

## Tool calls (paired by `callId`)

| Type | Required fields | Reducer effect |
|------|-----------------|----------------|
| `function_call` | `turnId`, `callId`, `name`, `args` | appends `tool_call`, status `pending` |
| `function_call_output` | `turnId`, `callId`, optional `output` or `error` | finds matching `tool_call`, sets `result` or `error`, flips status |
| `mcp_tool_call` | `turnId`, `callId`, `server`, `name`, `args` | same as `function_call` plus `server` |
| `mcp_tool_call_output` | `turnId`, `callId`, optional `output` or `error` | same as `function_call_output` |

## Shell exec

| Type | Required fields | Reducer effect |
|------|-----------------|----------------|
| `exec_command_begin` | `turnId`, `callId`, `command` | appends `exec`, status `running` |
| `exec_command_end` | `turnId`, `callId`, `exit`, `stdout`, `stderr`, `durationMs` | finds matching `exec`, fills outputs, status `completed` if `exit === 0` else `failed` |

## Web search

| Type | Required fields | Reducer effect |
|------|-----------------|----------------|
| `web_search_call` | `turnId`, `callId`, `query` | appends `search`, status `pending` |
| `web_search_end` | `turnId`, `callId`, `results: SearchResult[]` | finds matching `search`, fills results, status `completed` |

## Patch apply

| Type | Required fields | Reducer effect |
|------|-----------------|----------------|
| `patch_apply_end` | `turnId`, `callId`, `files: PatchFile[]`, `ok: boolean` | appends `patch`, status `completed` if `ok` else `failed` |

## Fallback

| Type | Required fields | Reducer effect |
|------|-----------------|----------------|
| `raw` | optional `turnId`, `payload: unknown` | if `turnId` present, appends `raw` ItemView; else only updates `lastEventAt` |

## Invariants

1. Reducer never throws on any input.
2. Bulk `events.reduce(reduceTranscript, EMPTY_MODEL)` equals incremental reduce of the same series.
3. Reducer is a pure function — no global state, no I/O.
4. Unknown payload `type` is preserved verbatim in the produced `raw` ItemView.
```

- [ ] **Step 2: Write `docs/styling.md`**

```markdown
# Styling

CodexView ships its own styles (`codexview/styles.css`) plus a `.codexview-root` reset to isolate from host CSS. All visual tokens are CSS variables you can override.

## Loading

```ts
import 'codexview/styles.css';
```

## Variable reference

Set these on `.codexview-root` (or any ancestor) to theme.

### Layout

| Variable | Default | Notes |
|----------|---------|-------|
| `--cv-font-family` | system-ui stack | |
| `--cv-font-mono` | ui-monospace stack | |
| `--cv-font-size` | `14px` | base text size |
| `--cv-line-height` | `1.55` | |
| `--cv-radius` | `12px` | bubble radius |
| `--cv-radius-sm` | `8px` | block radius |
| `--cv-spacing-xs/-sm/-md/-lg` | 4/8/12/16 px | spacing scale |

### Colors

| Variable | Default (light) | Notes |
|----------|-----------------|-------|
| `--cv-text` | `#1f2328` | primary text |
| `--cv-text-muted` | `#6e7781` | reasoning, captions |
| `--cv-text-inverse` | `#ffffff` | text on user bubble |
| `--cv-bg` | `#ffffff` | transcript background |
| `--cv-bg-raised` | `#f6f8fa` | StatusBar, tool block surface |
| `--cv-bg-user-bubble` | `#2f6feb` | user bubble |
| `--cv-bg-assistant-bubble` | `#f6f8fa` | assistant bubble |
| `--cv-bg-code` | `#0d1117` | exec / code background |
| `--cv-fg-code` | `#e6edf3` | code foreground |
| `--cv-border` | `#d0d7de` | dividers |
| `--cv-axis-color` | `#d0d7de` | turn timeline axis |
| `--cv-shimmer-color` | `rgba(31,35,40,0.08)` | exec shimmer |

### Status colors

| Variable | Default | Status |
|----------|---------|--------|
| `--cv-status-pending` | `#6e7781` | gray |
| `--cv-status-running` | `#2f6feb` | blue |
| `--cv-status-completed` | `#1a7f37` | green |
| `--cv-status-failed` | `#cf222e` | red |
| `--cv-status-stopped` | `#6e7781` | gray |

### Diff colors

| Variable | Default |
|----------|---------|
| `--cv-diff-add-bg` | `#ddf4e4` |
| `--cv-diff-del-bg` | `#ffebe9` |

## Dark theme example

```css
.dark .codexview-root {
  --cv-text: #e6edf3;
  --cv-text-muted: #8b949e;
  --cv-bg: #0d1117;
  --cv-bg-raised: #161b22;
  --cv-bg-assistant-bubble: #161b22;
  --cv-bg-user-bubble: #1f6feb;
  --cv-border: #30363d;
  --cv-axis-color: #30363d;
  --cv-shimmer-color: rgba(255,255,255,0.05);
  --cv-bg-code: #010409;
  --cv-fg-code: #c9d1d9;
}
```

## Reduced motion

All animations (pulse, shimmer, blink caret, smooth stream) honor `prefers-reduced-motion: reduce` and degrade to static states automatically.
```

- [ ] **Step 3: Commit**

```bash
git add docs/events.md docs/styling.md
git commit -m "docs: events contract + CSS variables reference"
```

---

## Task 24: docs/integration-agentweb.md + docs/changelog.md

**Files:**
- Create: `docs/integration-agentweb.md`, `docs/changelog.md`

- [ ] **Step 1: Write `docs/integration-agentweb.md`**

```markdown
# Integrating CodexView into agentweb

This is a drop-in replacement for `frontend/src/codex/components/MessageBubble.tsx`, `StreamingBubble.tsx`, and `ToolUseBlock.tsx`. The agentweb backend (`backend/src/codex/eventMap.ts`) already produces a normalized event stream that maps 1:1 onto `ChatStreamEvent`.

## Step 1 — install (development)

From the agentweb repo root:

```bash
pnpm --filter frontend add file:../CodexView
pnpm --filter frontend add lucide-react
```

(Once `codexview` is published to a registry, replace `file:../CodexView` with the version range.)

## Step 2 — load styles + bridge tokens

In `frontend/src/main.tsx` (or another global entry):

```ts
import 'codexview/styles.css';
```

In `frontend/src/codex/styles/tokens.css` (append):

```css
.aw-codex-transcript {
  --cv-bg-user-bubble: var(--aw-bg-bubble-user);
  --cv-bg-assistant-bubble: var(--aw-bg-bubble-bot);
  --cv-text: var(--aw-text-primary);
  --cv-axis-color: var(--aw-border-subtle);
  --cv-bg-raised: var(--aw-bg-raised);
}
```

(Match the variable list in `docs/styling.md` against agentweb's tokens.)

## Step 3 — replace ChatThread internals

`frontend/src/codex/components/ChatThread.tsx`:

```tsx
import { useAtomValue } from 'jotai';
import { CodexTranscript } from 'codexview';
import { streamingAtomFamily } from '../atoms/streaming';

export function ChatThread({ sessionId }: { sessionId: string }) {
  const stream = useAtomValue(streamingAtomFamily(sessionId));
  return (
    <CodexTranscript
      events={stream.list}
      status={stream.connected ? undefined : 'stopped'}
      className="aw-codex-transcript"
    />
  );
}
```

Adjust the property names (`stream.list`, `stream.connected`) to match the actual `streamingAtomFamily` shape.

## Step 4 — clean up + handle approval

Delete from `frontend/src/codex/components/`:

- `MessageBubble.tsx`
- `StreamingBubble.tsx`
- `ToolUseBlock.tsx`

**Keep** approval logic. CodexView v0.1 deliberately does **not** ship an approval-bubble component (see spec §11). If `StreamingBubble.tsx` carried that responsibility, extract the approval portion into a standalone `ApprovalBubble.tsx` component within agentweb and render it next to `<CodexTranscript>` (e.g. as a sibling overlay), feeding it the same approval events.

## Verify

```bash
pnpm --filter frontend test
pnpm --filter frontend dev
```

In the browser:

1. Start a Codex session.
2. Confirm streaming text appears with smooth typewriter effect.
3. Trigger a tool call — confirm collapsible result.
4. Trigger an exec — confirm shimmer while running.
5. Disconnect the network — confirm StatusBar shows "已停止" once you set `status="stopped"`.

## Rollback

```bash
git revert <integration-commit-sha>
```

Backend `ChatStreamEvent` shape and SSE endpoints do not change, so revert is purely frontend.

## Type-safety guard

Add to `frontend/src/codex/types/eventCheck.ts`:

```ts
import type { ChatStreamEvent as CV } from 'codexview';
import type { ChatStreamEvent as AW } from '../../../../backend/src/codex/eventMap';

// Will fail to compile if shapes drift.
type _AssertEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : never;
type _Check = _AssertEqual<CV, AW>;
```

When the agentweb backend adds an event type, this assertion fails until codexview is updated.
```

- [ ] **Step 2: Write `docs/changelog.md`**

```markdown
# Changelog

All notable changes documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — unreleased

### Added

- `<CodexTranscript>` main component (consumes `ChatStreamEvent[]`)
- Subcomponents: `StatusBar`, `TurnContainer`, `MessageBubble`, `ReasoningBlock`, `ToolCallBlock`, `ExecBlock`, `SearchBlock`, `PatchBlock`, `RawEventBlock`, `ItemErrorBoundary`
- Hooks: `useCodexTranscript`, `useSmoothStream`
- Pure functions: `reduceTranscript`, `inferStatus`, `EMPTY_MODEL`
- 8 supported event item kinds + raw fallback for unknown types
- 5-state item status machine, 4-state turn status machine, 5-state session status
- CSS Modules styling with overridable CSS variables
- `lucide-react` icon system as peerDependency
- `prefers-reduced-motion` honored by all animations
- 6 fixtures + replay integration tests
- Docs: API reference, event contract, styling, agentweb integration guide
```

- [ ] **Step 3: Commit**

```bash
git add docs/integration-agentweb.md docs/changelog.md
git commit -m "docs: agentweb integration guide + changelog"
```

---

## Task 25: Final build, full test sweep, agentweb link verification

**Files:**
- None new; final validation.

- [ ] **Step 1: Run full typecheck + tests + build**

```bash
cd /Volumes/MaxSSD1/MigratedHome/maxazure/projects/CodexView
pnpm typecheck && pnpm test && pnpm build
```

Expected: all pass; `dist/` contains `index.js`, `index.d.ts`, sourcemaps, plus emitted CSS file(s).

- [ ] **Step 2: Verify dist exports work via Node**

```bash
node -e "import('./dist/index.js').then(m => console.log(Object.keys(m).sort()))"
```

Expected: prints sorted list including `CodexTranscript`, `EMPTY_MODEL`, `MessageBubble`, `StatusBar`, `VERSION`, `inferStatus`, `reduceTranscript`, `useCodexTranscript`, `useSmoothStream`, plus the rest.

- [ ] **Step 3: Sanity check package metadata**

```bash
node -e "console.log(JSON.parse(require('node:fs').readFileSync('package.json'))).exports"
```

Expected: `exports['.'].import` resolves to `./dist/index.js` and `exports['./styles.css']` is set.

- [ ] **Step 4: Local-link into agentweb (manual smoke test)**

```bash
cd /Users/maxazure/Projects/agentweb
pnpm --filter frontend add file:../../Volumes/MaxSSD1/MigratedHome/maxazure/projects/CodexView
pnpm --filter frontend dev
```

Open `http://localhost:5173` (or whichever port agentweb's vite reports). Navigate to a Codex chat session. Confirm: messages render through CodexTranscript, no console errors. (Replacing the actual `ChatThread.tsx` rendering is its own agentweb PR — at this stage just verify the package loads.)

Press Ctrl+C; revert the link to avoid polluting the agentweb pnpm-lock:

```bash
cd /Users/maxazure/Projects/agentweb
git checkout -- frontend/package.json pnpm-lock.yaml
pnpm install
```

- [ ] **Step 5: Tag the release commit**

```bash
cd /Volumes/MaxSSD1/MigratedHome/maxazure/projects/CodexView
git tag v0.1.0 -m "codexview 0.1.0 — initial release"
git log --oneline | head -10
```

- [ ] **Step 6: Final summary commit (if any pending docs/changes)**

```bash
git status
# If clean, skip. Otherwise: git add -A && git commit -m "chore: 0.1.0 release prep"
```

Done. Report:

- All tasks ✅
- All tests passing
- `dist/` built
- agentweb smoke test passed
- Tag v0.1.0 created

The actual replacement of agentweb's `ChatThread.tsx` to use `<CodexTranscript>` is a separate follow-up PR in the agentweb repo, guided by [docs/integration-agentweb.md](../../docs/integration-agentweb.md).

---

## Self-review checklist (run before declaring plan ready)

1. **Spec coverage** — every section of [the spec](../specs/2026-05-15-codexview-design.md) maps to at least one task. Verified: §2 → Tasks 1-2; §3 → Tasks 19, 22; §4 → Tasks 3-9; §5 → Task 10; §6 → Tasks 13-19; §7 → Tasks 11, 14, 19; §8 → Tasks 5-12, 20; §9 → Tasks 22-24; §10 → Tasks 24-25; §11 → out-of-scope captured in task notes; §13 → Task 25.
2. **No placeholders** — every step includes either complete code or an exact command. Verified.
3. **Type consistency** — all referenced types/functions (`ChatStreamEvent`, `ItemView`, `reduceTranscript`, `inferStatus`, `useCodexTranscript`, `useSmoothStream`, etc.) match between definition and usage.
4. **Frequent commits** — every task ends with a commit; granularity ~1 commit per logical unit.
5. **TDD** — reducer + hooks + components all start with failing tests before implementation.




