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

## Claude Code raw fixtures (`claude-code/`)

The files in `fixtures/claude-code/` are **raw Claude Code session JSONL** —
each line is exactly the shape Claude Code writes to
`~/.claude/projects/<repo>/<sessionId>.jsonl`. They are NOT
`ChatStreamEvent` and are NOT consumed by `loadFixture.ts`. They feed
`playground/adapter.claude-code.test.mjs` and the playground SPA.

Anonymization rules:
- Usernames in absolute paths → `<user>`
- Third-party hostnames (except anthropic.com, codexview.*, github.com, react.dev, openai.com) → `example.com`
- Email addresses → `user@example.com`
- API tokens / Bearer keys / `sk-…` / `npm_…` → `<redacted>`
- `sessionId`/`uuid`/`parentUuid` are kept (already random)

Inventory:
- `short.jsonl` — single turn: 1 user message + 2 Bash tool calls + 1 assistant text reply
- `tool-heavy.jsonl` — multi-turn: Bash/Edit/TodoWrite/mcp_tool (Claude-in-Chrome)/ToolSearch/AskUserQuestion
- `thinking-mixed.jsonl` — plaintext thinking + empty (encrypted) thinking blocks, plus Bash + mcp tool call
