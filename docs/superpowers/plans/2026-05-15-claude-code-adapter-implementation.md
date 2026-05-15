# Claude Code Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new playground adapter `adaptClaudeCode()` that converts `~/.claude/projects/<repo>/<sessionId>.jsonl` into the existing `ChatStreamEvent[]` union, so `<CodexTranscript />` can render Claude Code sessions with zero changes to `src/`.

**Architecture:** All adapter logic lives in `playground/adapter.mjs` (extend existing `detectFormat()` and `adapt()`). `playground/api.mjs` gains `~/.claude/projects/` scanning. `playground/src/App.tsx` adds a `claude-code` filter & badge. Raw Claude Code sample JSONL fixtures live in a new `fixtures/claude-code/` subfolder to keep them separate from the existing already-adapted fixtures consumed by `loadFixture.ts`.

**Tech Stack:** Node 20+, ESM modules, vitest (global APIs: `describe`/`it`/`expect`), React 18, TypeScript 5.5. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-15-claude-code-adapter-design.md](../specs/2026-05-15-claude-code-adapter-design.md)

---

## File Structure

| File | Purpose | Action |
|---|---|---|
| `playground/adapter.mjs` | Add `adaptClaudeCode()`, extend `detectFormat()`, extend `adapt()` | Modify |
| `playground/adapter.claude-code.test.mjs` | Vitest unit tests for `adaptClaudeCode()` | Create |
| `playground/api.mjs` | Add `CLAUDE_ROOT` scanner + permission check | Modify |
| `playground/src/App.tsx` | Add `claude-code` filter option + badge | Modify |
| `fixtures/claude-code/short.jsonl` | Real-derived minimal Claude Code session | Create |
| `fixtures/claude-code/tool-heavy.jsonl` | Multi-turn with Bash/Edit/MultiEdit/TodoWrite/MCP | Create |
| `fixtures/claude-code/thinking-mixed.jsonl` | Plaintext + encrypted thinking blocks | Create |
| `fixtures/README.md` | Add note about Claude Code raw fixtures and anonymization rules | Modify |

Adapter test file lives in `playground/` (not `src/`) because the adapter is playground-only. Vitest's default discovery (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) picks it up automatically.

---

## Task 1: Extend `detectFormat()` to recognize Claude Code lines

**Files:**
- Create: `playground/adapter.claude-code.test.mjs`
- Modify: `playground/adapter.mjs:41-49`

- [ ] **Step 1: Write the failing test**

Create `playground/adapter.claude-code.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { adapt } from './adapter.mjs';

describe('detectFormat (via adapt)', () => {
  it("returns format='claude-code' for Claude Code JSONL", () => {
    const lines = [
      { type: 'user', uuid: 'u1', sessionId: 's1', parentUuid: null, timestamp: '2026-05-15T00:00:00Z',
        message: { role: 'user', content: 'hi' } },
    ];
    const { format } = adapt(lines);
    expect(format).toBe('claude-code');
  });

  it("still returns format='rollout' for Codex CLI JSONL", () => {
    const lines = [
      { type: 'session_meta', timestamp: '2026-05-15T00:00:00Z', payload: { id: 'thread-x' } },
    ];
    const { format } = adapt(lines);
    expect(format).toBe('rollout');
  });

  it("returns format='unknown' for empty input", () => {
    expect(adapt([]).format).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run the test — expect it to fail**

Run:
```bash
pnpm test playground/adapter.claude-code.test.mjs
```
Expected: First test fails (`format` is `'unknown'` instead of `'claude-code'`). Second & third pass.

- [ ] **Step 3: Update `detectFormat()` and `adapt()` in `playground/adapter.mjs`**

Replace the `detectFormat` function:

```js
const detectFormat = (lines) => {
  for (const line of lines) {
    if (line && typeof line === 'object') {
      // Claude Code: every line carries sessionId + uuid + (parentUuid|null) + type
      if ('sessionId' in line && 'uuid' in line && 'parentUuid' in line && 'type' in line) return 'claude-code';
      // Codex rollout
      if ('type' in line && ('payload' in line || 'timestamp' in line)) return 'rollout';
      // AgentWeb codex-team status log
      if ('event' in line && 'at' in line) return 'codex-team';
    }
  }
  return 'unknown';
};
```

Update `adapt()` (the bottom of the file) to dispatch the new format — add the line marked `← NEW`:

```js
export function adapt(rawLines) {
  const fmt = detectFormat(rawLines);
  if (fmt === 'rollout')     return { format: 'rollout',     events: adaptRollout(rawLines) };
  if (fmt === 'codex-team')  return { format: 'codex-team',  events: adaptCodexTeam(rawLines) };
  if (fmt === 'claude-code') return { format: 'claude-code', events: adaptClaudeCode(rawLines) }; // ← NEW
  return { format: 'unknown', events: rawLines.map((p, i) => ({ type: 'raw', payload: p, at: Date.now() + i })) };
}
```

Add a stub at the bottom of the file (full implementation comes in later tasks):

```js
function adaptClaudeCode(lines) {
  return [];
}
```

- [ ] **Step 4: Run the test — expect it to pass**

```bash
pnpm test playground/adapter.claude-code.test.mjs
```
Expected: All three tests pass.

- [ ] **Step 5: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): detect Claude Code JSONL format"
```

---

## Task 2: Emit `thread_started` from `sessionId`

**Files:**
- Modify: `playground/adapter.mjs` (the `adaptClaudeCode` stub from Task 1)
- Modify: `playground/adapter.claude-code.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `playground/adapter.claude-code.test.mjs`:

```js
describe('adaptClaudeCode · thread', () => {
  it('emits thread_started with sessionId from first line', () => {
    const lines = [
      { type: 'attachment', uuid: 'a1', sessionId: 'sess-abc', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', attachment: { type: 'hook_success' } },
    ];
    const { events } = adapt(lines);
    expect(events[0]).toMatchObject({ type: 'thread_started', threadId: 'sess-abc' });
    expect(typeof events[0].at).toBe('number');
  });

  it('emits thread_started only once even across many lines', () => {
    const lines = [
      { type: 'attachment', uuid: 'a1', sessionId: 'sess-X', parentUuid: null, timestamp: '2026-05-15T00:00:00Z', attachment: { type: 'hook_success' } },
      { type: 'attachment', uuid: 'a2', sessionId: 'sess-X', parentUuid: 'a1', timestamp: '2026-05-15T00:00:01Z', attachment: { type: 'hook_success' } },
    ];
    const { events } = adapt(lines);
    const threadStarts = events.filter((e) => e.type === 'thread_started');
    expect(threadStarts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect failures**

```bash
pnpm test playground/adapter.claude-code.test.mjs
```
Expected: Both new tests fail (`events[0]` is undefined).

- [ ] **Step 3: Implement scaffold + thread_started**

Replace the `adaptClaudeCode` stub with:

```js
function adaptClaudeCode(lines) {
  const out = [];
  let threadStarted = false;

  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    if (line.isSidechain === true) continue;

    const at = epoch(line.timestamp);

    if (!threadStarted && typeof line.sessionId === 'string' && line.sessionId.length > 0) {
      out.push({ type: 'thread_started', threadId: line.sessionId, at });
      threadStarted = true;
    }
  }

  return out;
}
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test playground/adapter.claude-code.test.mjs
```
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): emit thread_started for Claude Code"
```

---

## Task 3: Drop non-transcript types and sidechain lines

**Files:**
- Modify: `playground/adapter.mjs`
- Modify: `playground/adapter.claude-code.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```js
describe('adaptClaudeCode · filtering', () => {
  it('drops attachment / system / last-prompt / queue-operation (only thread_started emits)', () => {
    const base = { uuid: 'u1', sessionId: 'sess', parentUuid: null, timestamp: '2026-05-15T00:00:00Z' };
    const lines = [
      { ...base, type: 'attachment', attachment: { type: 'hook_success' } },
      { ...base, type: 'system', uuid: 'u2', content: 'whatever' },
      { ...base, type: 'last-prompt', uuid: 'u3', lastPrompt: 'draft' },
      { ...base, type: 'queue-operation', uuid: 'u4', operation: 'enqueue', content: 'queued' },
    ];
    const { events } = adapt(lines);
    expect(events.map((e) => e.type)).toEqual(['thread_started']);
  });

  it('drops lines where isSidechain === true entirely (even the first one)', () => {
    const lines = [
      { type: 'user', uuid: 'u1', sessionId: 'sess', parentUuid: null, isSidechain: true,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'side' } },
      { type: 'attachment', uuid: 'a1', sessionId: 'sess', parentUuid: null, isSidechain: false,
        timestamp: '2026-05-15T00:00:01Z', attachment: { type: 'hook_success' } },
    ];
    const { events } = adapt(lines);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'thread_started', threadId: 'sess' });
  });
});
```

- [ ] **Step 2: Run — expect failures only on the sidechain test**

The first test should already pass (we currently only emit thread_started and skip everything else). The second test should pass too if `isSidechain === true` is already skipped (it is, from Task 2). Run and confirm:

```bash
pnpm test playground/adapter.claude-code.test.mjs
```

Expected: Both pass. The purpose of this task is to **lock these invariants into tests** before later tasks (which will add emissions) could accidentally regress them.

- [ ] **Step 3: Add explicit type-filter in code (defensive)**

In `adaptClaudeCode`, after the `isSidechain` check, add:

```js
const skipTypes = new Set(['attachment', 'system', 'last-prompt', 'queue-operation']);
```

Move it outside the loop (top of function), then inside the loop after the `at` line:

```js
if (skipTypes.has(line.type)) continue;
```

This is currently a no-op (nothing else emits yet) but is the defensive guard for later tasks.

- [ ] **Step 4: Re-run tests**

```bash
pnpm test playground/adapter.claude-code.test.mjs
```
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): filter non-transcript Claude Code event types"
```

---

## Task 4: Text-user message → `turn_started` + `user_message`

**Files:**
- Modify: `playground/adapter.mjs`
- Modify: `playground/adapter.claude-code.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('adaptClaudeCode · text-user (turn boundary)', () => {
  it('emits turn_started + user_message for a string-content user message', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'hello' } },
    ];
    const { events } = adapt(lines);
    expect(events.map((e) => e.type)).toEqual(['thread_started', 'turn_started', 'user_message']);
    expect(events[1]).toMatchObject({ turnId: 'u-1' });
    expect(events[2]).toMatchObject({ turnId: 'u-1', itemId: 'u-1', text: 'hello' });
  });

  it('treats user with content[]={type:"text",text:...} as a text-user too', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z',
        message: { role: 'user', content: [{ type: 'text', text: 'multiline' }] } },
    ];
    const { events } = adapt(lines);
    const userMsgs = events.filter((e) => e.type === 'user_message');
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0]).toMatchObject({ text: 'multiline', itemId: 'u-1:0' });
  });

  it('does NOT open a new turn for user content that is a tool_result', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    ];
    const { events } = adapt(lines);
    expect(events.find((e) => e.type === 'turn_started')).toBeUndefined();
    expect(events.find((e) => e.type === 'user_message')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect failures**

```bash
pnpm test playground/adapter.claude-code.test.mjs
```

Expected: 3 new failures.

- [ ] **Step 3: Implement text-user handling**

In `adaptClaudeCode`, before the loop add state:

```js
  let threadStarted = false;
  let currentTurnId = null;
  let turnUsage = null; // { lastInput, sumOutput }
  const pending = new Map(); // tool_use.id -> { kind, ... }

  const closeTurn = (at) => {
    if (!currentTurnId) return;
    const evt = { type: 'turn_completed', turnId: currentTurnId, at };
    if (turnUsage) {
      evt.usage = {
        inputTokens: turnUsage.lastInput || 0,
        outputTokens: turnUsage.sumOutput || 0,
      };
    }
    out.push(evt);
    currentTurnId = null;
    turnUsage = null;
  };

  const isTextUser = (msg) => {
    const content = msg?.content;
    if (typeof content === 'string') return true;
    if (!Array.isArray(content) || content.length === 0) return false;
    return content.every((c) => c && c.type === 'text');
  };
```

Inside the loop, after the existing `thread_started` block, add:

```js
    if (line.type === 'user' && line.message) {
      if (isTextUser(line.message)) {
        // closeTurn intentionally NOT called here yet — Task 5 adds multi-turn closure.
        currentTurnId = String(line.uuid || `cc-turn-${out.length}`);
        turnUsage = { lastInput: 0, sumOutput: 0 };
        out.push({ type: 'turn_started', turnId: currentTurnId, at });

        const content = line.message.content;
        if (typeof content === 'string') {
          out.push({
            type: 'user_message', turnId: currentTurnId, itemId: currentTurnId, text: content, at,
          });
        } else {
          content.forEach((c, idx) => {
            out.push({
              type: 'user_message',
              turnId: currentTurnId,
              itemId: `${currentTurnId}:${idx}`,
              text: String(c.text || ''),
              at,
            });
          });
        }
        continue;
      }
      // Non-text-user (tool_result) handled in a later task.
      continue;
    }
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test playground/adapter.claude-code.test.mjs
```
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): map text-user to turn_started + user_message"
```

---

## Task 5: Two text-user messages → close previous turn first

**Files:**
- Modify: `playground/adapter.mjs`
- Modify: `playground/adapter.claude-code.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('adaptClaudeCode · multi-turn', () => {
  it('closes the previous turn before opening a new one', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'first' } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:01:00Z', message: { role: 'user', content: 'second' } },
    ];
    const { events } = adapt(lines);
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'thread_started',
      'turn_started', 'user_message',     // first turn opens
      'turn_completed',                    // first turn closes
      'turn_started', 'user_message',     // second turn opens
    ]);
    expect(events[3]).toMatchObject({ type: 'turn_completed', turnId: 'u-1' });
    expect(events[4]).toMatchObject({ type: 'turn_started', turnId: 'u-2' });
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm test playground/adapter.claude-code.test.mjs
```
Expected: Fails (no `turn_completed` between the two turns).

- [ ] **Step 3: Add `closeTurn(at)` at the top of the text-user branch**

In `adaptClaudeCode`, inside the `if (isTextUser(line.message))` block, **before** the `currentTurnId = …` assignment, insert:

```js
        closeTurn(at);
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test playground/adapter.claude-code.test.mjs
```
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): close previous Claude Code turn on new text-user"
```

---

## Task 6: Close dangling turn at end of file

**Files:**
- Modify: `playground/adapter.mjs`
- Modify: `playground/adapter.claude-code.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('adaptClaudeCode · EOF closure', () => {
  it('closes a dangling turn at end-of-file', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'only' } },
    ];
    const { events } = adapt(lines);
    expect(events[events.length - 1]).toMatchObject({ type: 'turn_completed', turnId: 'u-1' });
  });

  it('does not emit a stray turn_completed when there were no turns', () => {
    const lines = [
      { type: 'attachment', uuid: 'a1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', attachment: { type: 'hook_success' } },
    ];
    const { events } = adapt(lines);
    expect(events.some((e) => e.type === 'turn_completed')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm test playground/adapter.claude-code.test.mjs
```
Expected: First new test fails (no trailing turn_completed). Second passes.

- [ ] **Step 3: Add EOF closure**

At the very bottom of `adaptClaudeCode`, **before** `return out`:

```js
  if (currentTurnId) {
    const lastAt = out.length > 0 ? out[out.length - 1].at : Date.now();
    closeTurn(lastAt);
  }
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test playground/adapter.claude-code.test.mjs
```
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): close dangling Claude Code turn at EOF"
```

---

## Task 7: Assistant text content → `agent_message`

**Files:**
- Modify: `playground/adapter.mjs`
- Modify: `playground/adapter.claude-code.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('adaptClaudeCode · assistant text', () => {
  it('emits agent_message for each text block in assistant content[]', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', model: 'claude-opus-4-7',
          content: [{ type: 'text', text: 'answer1' }, { type: 'text', text: 'answer2' }],
          usage: { input_tokens: 0, output_tokens: 0 } } },
    ];
    const { events } = adapt(lines);
    const am = events.filter((e) => e.type === 'agent_message');
    expect(am).toHaveLength(2);
    expect(am[0]).toMatchObject({ turnId: 'u-1', itemId: 'a-1:0', text: 'answer1', partial: false });
    expect(am[1]).toMatchObject({ turnId: 'u-1', itemId: 'a-1:1', text: 'answer2', partial: false });
  });

  it('ignores assistant messages that arrive without an open turn', () => {
    const lines = [
      { type: 'assistant', uuid: 'a-orphan', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'orphan' }] } },
    ];
    const { events } = adapt(lines);
    expect(events.some((e) => e.type === 'agent_message')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect failures**

```bash
pnpm test playground/adapter.claude-code.test.mjs
```
Expected: First fails (no agent_message). Second passes.

- [ ] **Step 3: Implement assistant text branch**

In `adaptClaudeCode`, after the `if (line.type === 'user' && line.message) { … continue }` block, add:

```js
    if (line.type === 'assistant' && line.message) {
      if (!currentTurnId) continue;
      const content = line.message.content;
      if (!Array.isArray(content)) continue;
      const asstUuid = String(line.uuid || `cc-a-${out.length}`);

      content.forEach((c, idx) => {
        if (!c || typeof c !== 'object') return;
        const itemId = `${asstUuid}:${idx}`;
        if (c.type === 'text') {
          out.push({
            type: 'agent_message',
            turnId: currentTurnId,
            itemId,
            text: String(c.text || ''),
            partial: false,
            at,
          });
        }
        // thinking & tool_use handled in later tasks
      });
      continue;
    }
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test playground/adapter.claude-code.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): map assistant text content to agent_message"
```

---

## Task 8: Assistant thinking — plaintext → `reasoning`, empty → drop

**Files:**
- Modify: `playground/adapter.mjs` (the assistant `content.forEach` from Task 7)
- Modify: `playground/adapter.claude-code.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('adaptClaudeCode · thinking', () => {
  it('emits reasoning for non-empty thinking', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant',
          content: [{ type: 'thinking', thinking: 'pondering...', signature: 'sig' }] } },
    ];
    const { events } = adapt(lines);
    const reasoning = events.filter((e) => e.type === 'reasoning');
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0]).toMatchObject({ text: 'pondering...', itemId: 'a-1:0', partial: false });
  });

  it('drops thinking blocks whose .thinking is an empty string (encrypted)', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant',
          content: [{ type: 'thinking', thinking: '', signature: 'sig' }] } },
    ];
    const { events } = adapt(lines);
    expect(events.some((e) => e.type === 'reasoning')).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect failures**

Expected: First fails (no reasoning emitted), second passes vacuously.

- [ ] **Step 3: Extend the content branch**

Inside the `content.forEach((c, idx) => {…})` block from Task 7, after the `if (c.type === 'text')` branch, add:

```js
        if (c.type === 'thinking') {
          const text = typeof c.thinking === 'string' ? c.thinking : '';
          if (!text) return; // encrypted/empty — drop
          out.push({
            type: 'reasoning',
            turnId: currentTurnId,
            itemId,
            text,
            partial: false,
            at,
          });
        }
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): emit reasoning for plaintext thinking only"
```

---

## Task 9: Aggregate token usage per turn

**Files:**
- Modify: `playground/adapter.mjs` (assistant branch)
- Modify: `playground/adapter.claude-code.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('adaptClaudeCode · usage', () => {
  it('attaches summed output_tokens and last input_tokens to turn_completed', () => {
    const mkA = (uuid, input, output) => ({
      type: 'assistant', uuid, sessionId: 'sess', parentUuid: null,
      timestamp: '2026-05-15T00:00:01Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'x' }],
        usage: { input_tokens: input, output_tokens: output } },
    });
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'go' } },
      mkA('a-1', 100, 50),
      mkA('a-2', 200, 30),
      mkA('a-3', 250, 20),
    ];
    const { events } = adapt(lines);
    const done = events.find((e) => e.type === 'turn_completed');
    expect(done.usage).toEqual({ inputTokens: 250, outputTokens: 100 });
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Track usage inside the assistant branch**

Right after `if (!currentTurnId) continue;` inside the assistant branch, before the `content` parsing, insert:

```js
      const usage = line.message.usage;
      if (usage && turnUsage) {
        if (typeof usage.input_tokens === 'number') turnUsage.lastInput = usage.input_tokens;
        if (typeof usage.output_tokens === 'number') turnUsage.sumOutput = (turnUsage.sumOutput || 0) + usage.output_tokens;
      }
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): aggregate Claude Code token usage per turn"
```

---

## Task 10: `Bash` tool → `exec_command_begin` + `exec_command_end`

**Files:**
- Modify: `playground/adapter.mjs` (assistant content & user content branches)
- Modify: `playground/adapter.claude-code.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('adaptClaudeCode · Bash tool', () => {
  it('maps tool_use(Bash) + tool_result(ok) to exec_command_begin + exec_command_end', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'Bash',
            input: { command: 'ls -la', description: 'list' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'total 0\n', is_error: false },
        ] } },
    ];
    const { events } = adapt(lines);
    const begin = events.find((e) => e.type === 'exec_command_begin');
    const end = events.find((e) => e.type === 'exec_command_end');
    expect(begin).toMatchObject({ callId: 'tu-1', command: 'ls -la' });
    expect(end).toMatchObject({ callId: 'tu-1', exit: 0, stdout: 'total 0\n', stderr: '' });
  });

  it('maps tool_result(is_error=true) to exit=1 and routes content to stderr', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'false' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'oh no', is_error: true },
        ] } },
    ];
    const { events } = adapt(lines);
    const end = events.find((e) => e.type === 'exec_command_end');
    expect(end).toMatchObject({ exit: 1, stdout: '', stderr: 'oh no' });
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Add a `toolResultText()` helper and a tool-use dispatcher**

Near the top of `adaptClaudeCode` (before the `for` loop), add helpers:

```js
  const toolResultText = (item) => {
    const c = item?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      return c.map((p) => (typeof p === 'string' ? p : (p && typeof p === 'object' && typeof p.text === 'string') ? p.text : JSON.stringify(p))).join('\n');
    }
    if (c == null) return '';
    return JSON.stringify(c);
  };
```

Inside the assistant `content.forEach`, after the `thinking` branch, add a `tool_use` branch:

```js
        if (c.type === 'tool_use') {
          const callId = String(c.id || `cc-tu-${out.length}`);
          const name = String(c.name || '');
          const input = c.input ?? {};

          if (name === 'Bash') {
            pending.set(callId, { kind: 'exec' });
            out.push({
              type: 'exec_command_begin',
              turnId: currentTurnId,
              callId,
              command: String(input.command || ''),
              at,
            });
            return;
          }
          // other tools handled in later tasks
        }
```

In the **non-text-user** branch (currently `// Non-text-user (tool_result) handled in a later task. continue;`), replace with full tool_result dispatch:

```js
      if (!currentTurnId) continue;
      const content = line.message.content;
      if (!Array.isArray(content)) continue;
      for (const item of content) {
        if (!item || item.type !== 'tool_result') continue;
        const callId = String(item.tool_use_id || `cc-tr-${out.length}`);
        const isError = item.is_error === true;
        const text = toolResultText(item);
        const p = pending.get(callId);

        if (p?.kind === 'exec') {
          out.push({
            type: 'exec_command_end',
            turnId: currentTurnId,
            callId,
            exit: isError ? 1 : 0,
            stdout: isError ? '' : text,
            stderr: isError ? text : '',
            durationMs: 0,
            at,
          });
          pending.delete(callId);
          continue;
        }
        // other kinds handled in later tasks
      }
      continue;
```

- [ ] **Step 4: Run — expect pass**

```bash
pnpm test playground/adapter.claude-code.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): map Bash tool to exec_command_begin/end"
```

---

## Task 11: `TodoWrite` tool → `todo_list`

**Files:**
- Modify: `playground/adapter.mjs`
- Modify: `playground/adapter.claude-code.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('adaptClaudeCode · TodoWrite', () => {
  it('emits a todo_list with completed=true only for status==="completed"', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'plan it' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'TodoWrite', input: { todos: [
            { content: 'A', status: 'completed', activeForm: 'Doing A' },
            { content: 'B', status: 'in_progress', activeForm: 'Doing B' },
            { content: 'C', status: 'pending', activeForm: 'Doing C' },
          ] } },
        ] } },
    ];
    const { events } = adapt(lines);
    const td = events.find((e) => e.type === 'todo_list');
    expect(td).toMatchObject({
      itemId: 'tu-1',
      turnId: 'u-1',
      items: [
        { text: 'A', completed: true },
        { text: 'B', completed: false },
        { text: 'C', completed: false },
      ],
    });
  });

  it('drops the matching tool_result ack (no extra events)', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'TodoWrite', input: { todos: [] } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'ok', is_error: false },
        ] } },
    ];
    const { events } = adapt(lines);
    // 1 thread_started + 1 turn_started + 1 user_message + 1 todo_list + 1 turn_completed = 5
    expect(events).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Add TodoWrite branch**

In the tool_use dispatcher (assistant content branch), after the `Bash` branch, add:

```js
          if (name === 'TodoWrite') {
            pending.set(callId, { kind: 'todo' });
            const todos = Array.isArray(input.todos) ? input.todos : [];
            out.push({
              type: 'todo_list',
              turnId: currentTurnId,
              itemId: callId,
              items: todos.map((t) => ({
                text: String(t?.content || ''),
                completed: t?.status === 'completed',
              })),
              at,
            });
            return;
          }
```

In the tool_result dispatcher (non-text-user branch), after the `exec` branch, add:

```js
        if (p?.kind === 'todo') {
          pending.delete(callId);
          continue;
        }
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): map TodoWrite tool to todo_list"
```

---

## Task 12: `Edit` → `patch_apply_end` (delayed emit at tool_result)

**Files:**
- Modify: `playground/adapter.mjs`
- Modify: `playground/adapter.claude-code.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('adaptClaudeCode · Edit', () => {
  it('synthesises patch_apply_end with -/+ diff on tool_result', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'Edit',
            input: { file_path: '/p.ts', old_string: 'foo\nbar', new_string: 'baz\nqux' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'edited', is_error: false },
        ] } },
    ];
    const { events } = adapt(lines);
    // Edit must NOT emit at tool_use (no early patch_apply_end before tool_result)
    const idxAssistant = events.findIndex((e) => e.type === 'exec_command_begin' || e.type === 'function_call' || e.type === 'patch_apply_end');
    const patch = events.find((e) => e.type === 'patch_apply_end');
    expect(patch).toBeDefined();
    expect(patch).toMatchObject({
      callId: 'tu-1',
      ok: true,
      files: [{ path: '/p.ts', status: 'modified' }],
    });
    expect(patch.files[0].diff).toBe('- foo\n- bar\n+ baz\n+ qux');
  });

  it('sets ok=false when tool_result.is_error is true', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'Edit',
            input: { file_path: '/p.ts', old_string: 'x', new_string: 'y' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'not found', is_error: true },
        ] } },
    ];
    const { events } = adapt(lines);
    expect(events.find((e) => e.type === 'patch_apply_end').ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Add diff helpers near the top of `adapter.mjs` (outside `adaptClaudeCode`)**

Just before `function adaptClaudeCode(lines) {`, add:

```js
const ccPrefixLines = (text, prefix) => {
  if (!text) return '';
  return text.split('\n').map((line) => `${prefix}${line}`).join('\n');
};

const ccEditDiff = (oldStr, newStr) =>
  `${ccPrefixLines(oldStr, '- ')}\n${ccPrefixLines(newStr, '+ ')}`;

const ccWriteDiff = (content) => ccPrefixLines(content, '+ ');

const ccMultiEditDiff = (edits) =>
  edits.map((e) => `${ccPrefixLines(String(e?.old_string || ''), '- ')}\n${ccPrefixLines(String(e?.new_string || ''), '+ ')}`).join('\n\n');
```

- [ ] **Step 4: Add Edit branch to tool_use dispatcher**

After the `TodoWrite` branch:

```js
          if (name === 'Edit') {
            pending.set(callId, {
              kind: 'patch',
              files: [{
                path: String(input.file_path || ''),
                status: 'modified',
                diff: ccEditDiff(String(input.old_string || ''), String(input.new_string || '')),
              }],
            });
            return; // emission deferred to tool_result so we know `ok`
          }
```

- [ ] **Step 5: Add patch branch to tool_result dispatcher**

After the `todo` branch:

```js
        if (p?.kind === 'patch') {
          out.push({
            type: 'patch_apply_end',
            turnId: currentTurnId,
            callId,
            files: p.files,
            ok: !isError,
            at,
          });
          pending.delete(callId);
          continue;
        }
```

- [ ] **Step 6: Run — expect pass**

```bash
pnpm test playground/adapter.claude-code.test.mjs
```

- [ ] **Step 7: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): map Edit tool to patch_apply_end"
```

---

## Task 13: `Write` → `patch_apply_end` (status='added')

**Files:**
- Modify: `playground/adapter.mjs`
- Modify: `playground/adapter.claude-code.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('adaptClaudeCode · Write', () => {
  it('emits patch_apply_end with status="added" and +-prefixed diff', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'Write',
            input: { file_path: '/new.ts', content: 'line1\nline2' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'written', is_error: false },
        ] } },
    ];
    const { events } = adapt(lines);
    const patch = events.find((e) => e.type === 'patch_apply_end');
    expect(patch.files[0]).toMatchObject({ path: '/new.ts', status: 'added' });
    expect(patch.files[0].diff).toBe('+ line1\n+ line2');
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Add Write branch**

After the `Edit` branch:

```js
          if (name === 'Write') {
            pending.set(callId, {
              kind: 'patch',
              files: [{
                path: String(input.file_path || ''),
                status: 'added',
                diff: ccWriteDiff(String(input.content || '')),
              }],
            });
            return;
          }
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): map Write tool to patch_apply_end(status=added)"
```

---

## Task 14: `MultiEdit` → `patch_apply_end` with multiple -/+ blocks

**Files:**
- Modify: `playground/adapter.mjs`
- Modify: `playground/adapter.claude-code.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('adaptClaudeCode · MultiEdit', () => {
  it('joins multiple edits with blank lines and labels them as modified', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'MultiEdit',
            input: { file_path: '/p.ts', edits: [
              { old_string: 'a', new_string: 'A' },
              { old_string: 'b', new_string: 'B' },
            ] } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'done', is_error: false },
        ] } },
    ];
    const { events } = adapt(lines);
    const patch = events.find((e) => e.type === 'patch_apply_end');
    expect(patch.files[0].status).toBe('modified');
    expect(patch.files[0].diff).toBe('- a\n+ A\n\n- b\n+ B');
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Add MultiEdit branch**

After the `Write` branch:

```js
          if (name === 'MultiEdit') {
            const edits = Array.isArray(input.edits) ? input.edits : [];
            pending.set(callId, {
              kind: 'patch',
              files: [{
                path: String(input.file_path || ''),
                status: 'modified',
                diff: ccMultiEditDiff(edits),
              }],
            });
            return;
          }
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): map MultiEdit tool to patch_apply_end"
```

---

## Task 15: MCP tools (`mcp__server__name`) → `mcp_tool_call` + `mcp_tool_call_output`

**Files:**
- Modify: `playground/adapter.mjs`
- Modify: `playground/adapter.claude-code.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('adaptClaudeCode · MCP', () => {
  it('parses mcp__server__name into server + name', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'mcp__weather__get_forecast', input: { city: 'AKL' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'rain', is_error: false },
        ] } },
    ];
    const { events } = adapt(lines);
    const call = events.find((e) => e.type === 'mcp_tool_call');
    const output = events.find((e) => e.type === 'mcp_tool_call_output');
    expect(call).toMatchObject({ callId: 'tu-1', server: 'weather', name: 'get_forecast', args: { city: 'AKL' } });
    expect(output).toMatchObject({ callId: 'tu-1', output: 'rain' });
    expect(output.error).toBeUndefined();
  });

  it('handles names with three+ segments by treating extras as part of name', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'mcp__foo__bar__baz', input: {} },
        ] } },
    ];
    const { events } = adapt(lines);
    const call = events.find((e) => e.type === 'mcp_tool_call');
    expect(call).toMatchObject({ server: 'foo', name: 'bar__baz' });
  });

  it('routes tool_result with is_error=true into mcp_tool_call_output.error', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'mcp__svc__op', input: {} },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'boom', is_error: true },
        ] } },
    ];
    const { events } = adapt(lines);
    const output = events.find((e) => e.type === 'mcp_tool_call_output');
    expect(output).toMatchObject({ error: 'boom' });
    expect(output.output).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Add MCP branch (tool_use dispatcher)**

After the `MultiEdit` branch:

```js
          if (name.startsWith('mcp__')) {
            const parts = name.split('__');
            const server = parts[1] || '';
            const toolName = parts.slice(2).join('__') || name;
            pending.set(callId, { kind: 'mcp' });
            out.push({
              type: 'mcp_tool_call',
              turnId: currentTurnId,
              callId,
              server,
              name: toolName,
              args: input,
              at,
            });
            return;
          }
```

- [ ] **Step 4: Add MCP branch (tool_result dispatcher)**

After the `patch` branch:

```js
        if (p?.kind === 'mcp') {
          const evt = { type: 'mcp_tool_call_output', turnId: currentTurnId, callId, at };
          if (isError) evt.error = text; else evt.output = text;
          out.push(evt);
          pending.delete(callId);
          continue;
        }
```

- [ ] **Step 5: Run — expect pass**

- [ ] **Step 6: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): map mcp__server__name tools to mcp_tool_call(_output)"
```

---

## Task 16: Generic tool fallback → `function_call` + `function_call_output`

**Files:**
- Modify: `playground/adapter.mjs`
- Modify: `playground/adapter.claude-code.test.mjs`

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('adaptClaudeCode · function_call fallback', () => {
  it('maps unknown tools (e.g. Read) to function_call', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/x' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'contents', is_error: false },
        ] } },
    ];
    const { events } = adapt(lines);
    const call = events.find((e) => e.type === 'function_call');
    const out_ = events.find((e) => e.type === 'function_call_output');
    expect(call).toMatchObject({ callId: 'tu-1', name: 'Read', args: { file_path: '/x' } });
    expect(out_).toMatchObject({ callId: 'tu-1', output: 'contents' });
  });

  it('routes is_error into function_call_output.error', () => {
    const lines = [
      { type: 'user', uuid: 'u-1', sessionId: 'sess', parentUuid: null,
        timestamp: '2026-05-15T00:00:00Z', message: { role: 'user', content: 'q' } },
      { type: 'assistant', uuid: 'a-1', sessionId: 'sess', parentUuid: 'u-1',
        timestamp: '2026-05-15T00:00:01Z',
        message: { role: 'assistant', content: [
          { type: 'tool_use', id: 'tu-1', name: 'Glob', input: { pattern: '**/*.ts' } },
        ] } },
      { type: 'user', uuid: 'u-2', sessionId: 'sess', parentUuid: 'a-1',
        timestamp: '2026-05-15T00:00:02Z',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'bad pattern', is_error: true },
        ] } },
    ];
    const { events } = adapt(lines);
    const out_ = events.find((e) => e.type === 'function_call_output');
    expect(out_).toMatchObject({ error: 'bad pattern' });
    expect(out_.output).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect failures**

- [ ] **Step 3: Add default branch in tool_use dispatcher**

After the MCP branch (at the end of the `if (c.type === 'tool_use') {…}` block):

```js
          // Fallback: any other tool name (Read, Glob, Grep, Task, Skill, WebSearch, WebFetch, …)
          pending.set(callId, { kind: 'function' });
          out.push({
            type: 'function_call',
            turnId: currentTurnId,
            callId,
            name,
            args: input,
            at,
          });
          return;
```

- [ ] **Step 4: Add default branch in tool_result dispatcher**

After the MCP branch:

```js
        if (p?.kind === 'function') {
          const evt = { type: 'function_call_output', turnId: currentTurnId, callId, at };
          if (isError) evt.error = text; else evt.output = text;
          out.push(evt);
          pending.delete(callId);
          continue;
        }
        // Unknown / orphan tool_result with no matching tool_use — surface as a function_call_output
        // so the user can at least see it in the transcript.
        const evt = { type: 'function_call_output', turnId: currentTurnId, callId, at };
        if (isError) evt.error = text; else evt.output = text;
        out.push(evt);
```

- [ ] **Step 5: Run — expect pass**

```bash
pnpm test playground/adapter.claude-code.test.mjs
```

- [ ] **Step 6: Run the full test suite to make sure existing Codex tests still pass**

```bash
pnpm test
```
Expected: All green.

- [ ] **Step 7: Commit**

```bash
git add playground/adapter.mjs playground/adapter.claude-code.test.mjs
git commit -m "feat(adapter): fallback unknown tools to function_call"
```

---

## Task 17: `playground/api.mjs` — scan `~/.claude/projects/`

**Files:**
- Modify: `playground/api.mjs`

- [ ] **Step 1: Read the current `playground/api.mjs:11-22`**

Verify the current top-of-file imports and `HOME` / `ROLLOUT_ROOT` / `TEAM_ROOT` constants.

- [ ] **Step 2: Add `CLAUDE_ROOT` constant**

After `const TEAM_ROOT = join(HOME, 'Projects/agentweb/.codex-team/runs');`, add:

```js
const CLAUDE_ROOT = join(HOME, '.claude/projects');
```

- [ ] **Step 3: Add a third scan block in `listFiles()`**

After the AgentWeb codex-team block (inside `listFiles()`, before the `out.sort(...)` line), add:

```js
  // Claude Code session JSONL (main session only; subagents/ excluded by maxdepth + path filter)
  try {
    const stdout = execFileSync(
      'find',
      [CLAUDE_ROOT, '-maxdepth', '2', '-name', '*.jsonl', '-type', 'f'],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
    for (const path of stdout.split('\n').filter(Boolean)) {
      if (path.includes('/subagents/')) continue;
      try {
        const st = statSync(path);
        const segments = path.split('/');
        const filename = segments[segments.length - 1] || '';
        const parentDir = segments[segments.length - 2] || '';
        // e.g. "a7d93eaf · projects-CodexView"
        const sessionPrefix = filename.replace(/\.jsonl$/, '').slice(0, 8);
        const projectTail = parentDir.replace(/^-+/, '').slice(-30);
        out.push({
          path,
          source: 'claude-code',
          name: `${sessionPrefix} · ${projectTail}`,
          mtime: Math.floor(st.mtimeMs),
          sizeKB: Math.round(st.size / 102.4) / 10,
        });
      } catch { /* skip unreadable */ }
    }
  } catch { /* CLAUDE_ROOT absent — fine */ }
```

- [ ] **Step 4: Update `isAllowed()` to permit `CLAUDE_ROOT` paths**

Replace:

```js
function isAllowed(path) {
  return path && (path.startsWith(ROLLOUT_ROOT) || path.startsWith(TEAM_ROOT));
}
```

With:

```js
function isAllowed(path) {
  return path && (
    path.startsWith(ROLLOUT_ROOT) ||
    path.startsWith(TEAM_ROOT) ||
    path.startsWith(CLAUDE_ROOT)
  );
}
```

- [ ] **Step 5: Smoke test — start playground and curl the API**

In one terminal:

```bash
pnpm playground
```

In another:

```bash
curl -s http://127.0.0.1:5181/api/logs | python3 -c "import sys, json; data = json.load(sys.stdin); print('total:', len(data['files'])); from collections import Counter; print(Counter(f['source'] for f in data['files']))"
```

Expected: total > 0, the Counter includes `'claude-code': N` (N > 0 on a machine with prior Claude Code usage).

If you have at least one Claude Code session, also:

```bash
ID=$(curl -s http://127.0.0.1:5181/api/logs | python3 -c "import sys,json; print(next(f['id'] for f in json.load(sys.stdin)['files'] if f['source']=='claude-code'))")
curl -s "http://127.0.0.1:5181/api/logs/$ID/events" | python3 -c "import sys,json; d=json.load(sys.stdin); print('format:', d['format']); print('event types:', sorted({e['type'] for e in d['events']}))"
```

Expected: `format: claude-code`, event types include `thread_started`, `turn_started`, `user_message`, `agent_message`, etc.

Stop the playground (Ctrl-C in its terminal).

- [ ] **Step 6: Commit**

```bash
git add playground/api.mjs
git commit -m "feat(playground): scan ~/.claude/projects/ as a third source"
```

---

## Task 18: `playground/src/App.tsx` — add `claude-code` filter & badge

**Files:**
- Modify: `playground/src/App.tsx`

- [ ] **Step 1: Update `FileEntry.source` type union**

Find the `interface FileEntry` block at the top of `App.tsx` and replace the `source` field:

```ts
  source: 'codex-cli' | 'agentweb-team' | 'claude-code' | 'synthetic';
```

- [ ] **Step 2: Update `EventsResponse.format` type union**

```ts
  format: 'rollout' | 'codex-team' | 'claude-code' | 'synthetic' | 'unknown';
```

- [ ] **Step 3: Update the filter `useState` and dropdown**

Replace the `useState<'all' | 'codex-cli' | 'agentweb-team'>('all')` declaration:

```ts
  const [filter, setFilter] = useState<'all' | 'codex-cli' | 'agentweb-team' | 'claude-code'>('all');
```

In the `<select>` below the search input, add a new `<option>` after the existing two:

```tsx
            <option value="claude-code">Claude Code ({files.filter((f) => f.source === 'claude-code').length})</option>
```

- [ ] **Step 4: Extend the badge label and color in `styles.badge`**

Find the JSX that renders the badge (around `<span style={styles.badge} data-source={f.source}>`). Replace with:

```tsx
                    <span style={styles.badge} data-source={f.source}>
                      {f.source === 'codex-cli' ? 'CLI'
                        : f.source === 'agentweb-team' ? 'Team'
                        : f.source === 'claude-code' ? 'Claude'
                        : 'Demo'}
                    </span>
```

(The `'synthetic'` case maps to `'Demo'` to match the existing synthetic demo entry.)

- [ ] **Step 5: Add a per-source background colour for the badge**

Locate the `badge` style in the `styles` object near the bottom of the file. Replace the existing `badge: { … }` block with:

```ts
  badge: {
    padding: '1px 6px',
    borderRadius: 3,
    fontSize: 10,
    background: '#eef2f5',
  },
  badgeClaude: { background: '#f4e3ff', color: '#6b21a8' },
  badgeCli: { background: '#e0f2fe', color: '#075985' },
  badgeTeam: { background: '#fef3c7', color: '#92400e' },
  badgeDemo: { background: '#f3f4f6', color: '#4b5563' },
```

Then update the badge JSX from Step 4 to merge styles:

```tsx
                    <span
                      style={{
                        ...styles.badge,
                        ...(f.source === 'codex-cli' ? styles.badgeCli
                          : f.source === 'agentweb-team' ? styles.badgeTeam
                          : f.source === 'claude-code' ? styles.badgeClaude
                          : styles.badgeDemo),
                      }}
                      data-source={f.source}
                    >
                      {f.source === 'codex-cli' ? 'CLI'
                        : f.source === 'agentweb-team' ? 'Team'
                        : f.source === 'claude-code' ? 'Claude'
                        : 'Demo'}
                    </span>
```

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 7: Visual smoke**

Start playground:

```bash
pnpm playground
```

Open http://127.0.0.1:5181 in a browser:
- Confirm filter dropdown shows "Claude Code (N)"
- Confirm a `Claude` badge with purple background appears next to Claude Code entries
- Click a `Claude Code` file → confirm `format: claude-code` in the top meta row
- Confirm transcript renders without console errors

Stop the playground (Ctrl-C).

- [ ] **Step 8: Commit**

```bash
git add playground/src/App.tsx
git commit -m "feat(playground): show claude-code source in filter and badge"
```

---

## Task 19: Add real-derived anonymized fixtures

**Files:**
- Create: `fixtures/claude-code/short.jsonl`
- Create: `fixtures/claude-code/tool-heavy.jsonl`
- Create: `fixtures/claude-code/thinking-mixed.jsonl`
- Modify: `fixtures/README.md`

These fixtures are **raw Claude Code JSONL** (NOT adapted `ChatStreamEvent`). They live in a subfolder so they aren't accidentally picked up by `loadFixture.ts` (which expects `ChatStreamEvent` shape in `fixtures/*.jsonl` directly).

- [ ] **Step 1: Choose three real source sessions**

Run:

```bash
find ~/.claude/projects -maxdepth 2 -name '*.jsonl' -size +5k -size -200k -not -path '*/subagents/*' 2>/dev/null | head -10
```

Pick three that collectively cover:
- A small one (≤20 lines) with one Bash and one assistant text reply → `short.jsonl`
- A medium one with Edit / Write or MultiEdit / TodoWrite / at least one `mcp__*` call → `tool-heavy.jsonl`
- One containing **both** plaintext thinking AND empty-string thinking → `thinking-mixed.jsonl`. To find one:

```bash
for f in $(find ~/.claude/projects -maxdepth 2 -name '*.jsonl' -not -path '*/subagents/*' 2>/dev/null); do
  has_plain=$(jq -r 'select(.message.content[]?.type=="thinking" and .message.content[]?.thinking != "") | .uuid' "$f" 2>/dev/null | head -1)
  has_empty=$(jq -r 'select(.message.content[]?.type=="thinking" and .message.content[]?.thinking == "") | .uuid' "$f" 2>/dev/null | head -1)
  [ -n "$has_plain" ] && [ -n "$has_empty" ] && { echo "$f"; break; }
done
```

- [ ] **Step 2: For each source, hand-pick a 20–60 line slice**

Use `jq -c` to flatten one line per object, then manually trim with a text editor to the smallest contiguous slice that demonstrates the case. Keep ordering intact (the adapter relies on file order).

- [ ] **Step 3: Anonymize each fixture**

Apply these replacements to all three fixtures:

| Match | Replace with |
|---|---|
| `/Users/<username>` (any username) | `/Users/<user>` |
| Hostnames in URLs (anything not anthropic.com/codexview/github.com/react.dev/openai.com) | `example.com` |
| Email addresses | `user@example.com` |
| API tokens / Bearer keys / `sk-…` / `npm_…` | `<redacted>` |
| Real `sessionId` / `uuid` / `parentUuid` | leave as-is (already random) |

You can do the path replacement with sed; for the more selective stuff, hand-edit:

```bash
sed -i.bak -E 's|/Users/[^/"]+|/Users/<user>|g; s|(npm|sk)[-_][A-Za-z0-9_-]{20,}|<redacted>|g' fixtures/claude-code/*.jsonl
rm fixtures/claude-code/*.bak
```

- [ ] **Step 4: Save the three fixtures**

```
fixtures/claude-code/short.jsonl
fixtures/claude-code/tool-heavy.jsonl
fixtures/claude-code/thinking-mixed.jsonl
```

- [ ] **Step 5: Sanity-check each fixture goes through `adapt()` without errors**

Run a small one-off check:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { adapt, parseJsonl } from './playground/adapter.mjs';
for (const name of ['short', 'tool-heavy', 'thinking-mixed']) {
  const path = 'fixtures/claude-code/' + name + '.jsonl';
  const lines = parseJsonl(readFileSync(path, 'utf8'));
  const { format, events } = adapt(lines);
  console.log(name, 'format=' + format, 'events=' + events.length, 'types=' + JSON.stringify([...new Set(events.map(e => e.type))].sort()));
}
"
```

Expected:
- `format=claude-code` for all three
- short.jsonl events include at least `thread_started`, `turn_started`, `user_message`, `exec_command_begin`, `exec_command_end`, `agent_message`, `turn_completed`
- tool-heavy.jsonl events include at least `patch_apply_end`, `todo_list`, `mcp_tool_call`
- thinking-mixed.jsonl events include `reasoning` (the count of `reasoning` events must equal the count of `thinking` blocks with non-empty text)

If any fixture fails the sanity check, fix the slice (likely a truncation issue) and retry.

- [ ] **Step 6: Append to `fixtures/README.md`**

At the bottom of `fixtures/README.md`, add:

```markdown
## Claude Code raw fixtures (`claude-code/`)

The files in `fixtures/claude-code/` are **raw Claude Code session JSONL** —
each line is exactly the shape Claude Code writes to
`~/.claude/projects/<repo>/<sessionId>.jsonl`. They are NOT
`ChatStreamEvent` and are NOT consumed by `loadFixture.ts`. They feed
`playground/adapter.claude-code.test.mjs` and the playground SPA.

Anonymization rules:
- Usernames in absolute paths → `<user>`
- Third-party hostnames (except anthropic.com, codexview.*, github.com, react.dev) → `example.com`
- Email addresses → `user@example.com`
- API tokens / Bearer keys / `sk-…` / `npm_…` → `<redacted>`
- `sessionId`/`uuid`/`parentUuid` are kept (already random)

Inventory:
- `short.jsonl` — single turn with 1 Bash + 1 assistant message
- `tool-heavy.jsonl` — multi-turn: Edit/MultiEdit/Bash/TodoWrite/mcp_tool/WebSearch
- `thinking-mixed.jsonl` — plaintext thinking + empty (encrypted) thinking
```

- [ ] **Step 7: Commit**

```bash
git add fixtures/claude-code/ fixtures/README.md
git commit -m "test: add anonymized Claude Code raw JSONL fixtures"
```

---

## Task 20: Playground end-to-end smoke + full test suite

**Files:**
- (No code changes — verification only.)

- [ ] **Step 1: Run the full test suite**

```bash
pnpm test
```
Expected: All tests green (existing Codex tests + new Claude Code tests).

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Build**

```bash
pnpm build
```
Expected: clean build, `dist/` populated.

- [ ] **Step 4: Playground smoke**

Start the playground:

```bash
pnpm playground
```

In a browser at http://127.0.0.1:5181, verify:

1. Filter dropdown shows: "All", "Codex CLI rollout", "AgentWeb codex-team", "Claude Code" — each with non-zero counts where applicable.
2. Pick the filter "Claude Code" → list shows only Claude Code entries with the purple "Claude" badge.
3. Pick at least 3 different Claude Code files in succession. For each, verify:
   - The "format: claude-code" appears in the top meta row.
   - The transcript renders without browser console errors.
   - For sessions that contained Bash, an exec block renders with `$ <command>`.
   - For sessions that contained Edit/Write/MultiEdit, a patch block renders with `-` / `+` lines.
   - For sessions that contained TodoWrite, the plan items render with checkboxes.
   - No raw "gibberish" text (i.e. thinking signatures are not displayed).
4. The "适配后" tab shows event counts > 0 with reasonable type distribution.
5. The "原始" tab shows raw JSON with `type`/`uuid`/`sessionId` keys.

Stop the playground (Ctrl-C).

- [ ] **Step 5: Verify `subagents/` is excluded**

Open the file list and confirm no entries under any `subagents/` directory:

```bash
curl -s http://127.0.0.1:5181/api/logs 2>/dev/null | python3 -c "import sys,json; print([f['path'] for f in json.load(sys.stdin)['files'] if '/subagents/' in f['path']])"
```

(Run the curl while playground is up if needed.) Expected: `[]`.

- [ ] **Step 6: Final commit (none — everything already committed)**

If anything in the smoke uncovered an issue, fix it in a focused commit. Otherwise, nothing to commit.

- [ ] **Step 7: Confirm acceptance**

Walk the acceptance checklist in [the spec, Section 10](../specs/2026-05-15-claude-code-adapter-design.md#10-验收标准) and tick off each item. If any item fails, file a follow-up commit with a fix.

---

## Self-Review Notes

After writing the plan, I walked it against the spec:

- **§2 Data flow** → Tasks 1, 17, 19 cover detection / scanning / fixtures.
- **§3 Top-level type filtering** → Task 3.
- **§4 Turn boundary synthesis** (text-user open, multi-turn close, EOF close) → Tasks 4, 5, 6.
- **§5.1 Text & thinking mapping** → Tasks 7, 8.
- **§5.2 Tool dispatch table** → Tasks 10 (Bash), 11 (TodoWrite), 12 (Edit), 13 (Write), 14 (MultiEdit), 15 (MCP), 16 (fallback).
- **§5.3 Diff synthesis** → Tasks 12–14 (helpers added in Task 12).
- **§5.4 Pairing strategy via `pending` map** → Established in Task 10, reused in 11–16.
- **§6.1 `playground/api.mjs` scan + isAllowed** → Task 17.
- **§6.3 `playground/src/App.tsx` chip** → Task 18.
- **§7 Error handling** → Tasks 3 (filter), 16 (orphan tool_result fallback).
- **§8 Test matrix + anonymized fixtures** → Each adapter task adds tests; Task 19 adds the three fixtures; Task 20 runs full suite.
- **§9 Package impact** — `src/` untouched; only playground + fixtures + spec/plan docs.
- **§10 Acceptance** → Task 20.

Token-usage aggregation rule from §4 is implemented in Task 9. Pre-thread `thread_started` once-per-file rule is locked in Task 2. The "no `turn_failed`/`turn_aborted`" decision is implicit — no task ever emits them.

Plan complete and saved to [docs/superpowers/plans/2026-05-15-claude-code-adapter-implementation.md](2026-05-15-claude-code-adapter-implementation.md).
