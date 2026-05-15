# Claude Code Subagent Pairing Key — Research Note

**Date:** 2026-05-16  
**Status:** Verified on 3 real local sessions (85 total Agent calls, 85 subagent files)

---

## Data Observed

- **Sessions examined:** 3 parent sessions in the CodexView project, each with a `subagents/`
  directory. Total Agent tool_use calls across all three: 85. Total agent `.jsonl` files: 85.
- **Tool name correction:** The spawning tool is named **`Agent`** (not `Task`) in Claude Code
  session files. Each Agent tool_use has `input.description` (a short human-readable label like
  `"Implement Task 1: detectFormat for claude-code"`) and a `tool_use.id` (`toolu_01...`).
- **Subagent file naming:** Files are stored as `subagents/agent-{agentId}.jsonl` plus
  `subagents/agent-{agentId}.meta.json`. The `meta.json` contains `{ "agentType":
  "general-purpose", "description": "<same description as Agent tool input>" }`.

---

## Findings (5 Bullets)

1. **`agentId` in parent's Agent tool_use?**  
   No. The `agentId` (e.g. `a02fefd39fcaba1b4`) does not appear as a structured field anywhere
   in the parent session file — not in the `tool_use` block, not in top-level keys, not in
   `tool_result` blocks. It only appears in the subagent's own `.jsonl` header line as a
   first-class field. There is no direct ID linkage from parent to child.

2. **`promptId` in parent lines?**  
   Yes — every line in the parent session carries `promptId` at the top level. However, it is a
   **session-scoped UUID** (one value per continuous prompt session, not per Agent call). All 85
   subagent files share the same `promptId` as the parent session they belong to — it identifies
   the session, not the individual subagent. It cannot serve as a per-Agent-call pairing key.

3. **FIFO match order (count comparison)?**  
   In all 3 sessions, the count of Agent `tool_use` calls in the parent exactly equals the number
   of `agent-*.jsonl` files in `subagents/`. Lexicographic filename order does **not** match
   parent call order (agent IDs are hex strings that sort differently from creation order).
   However, **mtime order** (file modification time, oldest first) matches the parent's Agent
   call order perfectly — 50/50 in the primary session, confirmed in the others. FIFO by mtime
   is therefore a valid secondary pairing strategy when description matching fails.

4. **Orphan subagent files (no matching parent Agent call)?**  
   None observed across all 3 sessions. Every `agent-*.jsonl` file had a corresponding Agent
   `tool_use` in the parent, and every parent Agent call had a corresponding subagent file.
   Zero orphans in the examined data.

5. **Nested Agent tool_uses inside subagent files?**  
   None. All 85 subagent files were searched for nested `Agent` tool_use blocks; zero were
   found. Subagents in these sessions do not themselves spawn further subagents. v1 can safely
   treat subagent files as leaf nodes.

---

## The Real Pairing Key: `description` via `meta.json`

The actual reliable linkage is:

```
parent: Agent tool_use.input.description  →  subagents/agent-{agentId}.meta.json → description
```

Concretely:
- Parent line contains `tool_use { name: "Agent", id: "toolu_01ABC...", input: { description: "Fix Task 1 detection bug", ... } }`
- `subagents/agent-a02fefd39fcaba1b4.meta.json` contains `{ "description": "Fix Task 1 detection bug" }`
- **Exact string match** links them. Verified 85/85 (100%) across 3 sessions with 0 duplicates.

The `description` field is set by the user/orchestrator when calling the Agent tool; Claude Code
writes the same string into the meta file when persisting the subagent session. It is stable,
unique within a session, and human-readable.

---

## Recommendation

**v1 should use `Agent tool_use.input.description` matched against `agent-*.meta.json →
description` as the primary pairing key.**

This is the only field that creates an unambiguous 1-to-1 link between a parent Agent call and
its subagent file — `agentId` does not appear in the parent, `promptId` is session-scoped and
shared by all agents, and FIFO by mtime works in practice but is fragile (filesystem timestamps
can be unreliable across copies or restores). Description matching is exact, verified at 100%
across all observed data, and requires no assumptions about file ordering.

**Secondary fallback:** If `description` is missing or not unique, fall back to mtime-FIFO — sort
`agent-*.jsonl` by modification time ascending and pair with Agent `tool_use` calls in their
appearance order in the parent session file.
