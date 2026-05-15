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
