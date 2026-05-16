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
- **`toolUseResult` on user-type lines:** When a parent session's user-type line carries the
  tool_result for an Agent call, it has a top-level `toolUseResult` key (alongside `message`,
  `promptId`, `sessionId`, etc.). Its shape is:
  ```json
  {
    "agentId":           "<hex string matching agent-{agentId}.jsonl filename>",
    "agentType":         "general-purpose" | "Explore" | ...,
    "status":            "completed" | ...,
    "content":           "<final output text>",
    "prompt":            "<original prompt>",
    "totalDurationMs":   12345,
    "totalTokens":       67890,
    "totalToolUseCount": 42,
    "toolStats":         { ... },
    "usage":             { ... }
  }
  ```
  This field is present on **every** user-type line that corresponds to a completed Agent call,
  and `toolUseResult.agentId` directly matches the hex ID in the `agent-{agentId}.jsonl`
  filename. Verified 50/50 (100%) in the primary session and 85/85 across all three sessions.

---

## Findings (5 Bullets)

1. **`agentId` in parent's Agent tool_result?**  
   Yes. The `agentId` (e.g. `a02fefd39fcaba1b4`) appears as a **structured field** on the
   user-type line that carries the tool_result for each Agent call — specifically as
   `toolUseResult.agentId`. It is NOT present in the `tool_use` block (the assistant-side line
   that initiates the Agent call); it is only present on the **tool_result side** (user-type
   line). The structural chain is:

   ```
   assistant line: tool_use { id: "toolu_01ABC...", name: "Agent", input: { description: "..." } }
     ↓  (tool_result response to that toolu_01ABC...)
   user line:      message.content[tool_result id="toolu_01ABC..."]
                   toolUseResult.agentId = "a02fefd39fcaba1b4"   ← direct structured field
     ↓
   subagents/agent-a02fefd39fcaba1b4.jsonl   ← filename matches exactly
   ```

   This is a **direct, unambiguous 1-to-1 pairing key**. Two Agent calls with identical
   descriptions would still be distinguishable via their distinct `agentId` values.

2. **`promptId` in parent lines?**  
   Yes — every **user-type** line in the parent session carries `promptId` at the top level (82
   of 82 user lines in one session, 220 of 220 in another). Non-user-type lines (assistant,
   attachment, queue-operation, system, last-prompt, ai-title) do not carry it. `promptId` is a
   **session-scoped UUID** (one value per continuous prompt session, not per Agent call). All 85
   subagent files share the same `promptId` as the parent session they belong to — it identifies
   the session, not the individual subagent. It cannot serve as a per-Agent-call pairing key.

3. **FIFO match order (count comparison)?**  
   In all 3 sessions, the count of Agent `tool_use` calls in the parent exactly equals the number
   of `agent-*.jsonl` files in `subagents/`. Lexicographic filename order does **not** match
   parent call order (agent IDs are hex strings that sort differently from creation order).
   However, **mtime order** (file modification time, oldest first) matches the parent's Agent
   call order perfectly — all 50 of 50 matched in the primary session, confirmed in the others.
   FIFO by mtime is therefore a valid tertiary pairing strategy when both primary and secondary
   keys fail.

4. **Orphan subagent files (no matching parent Agent call)?**  
   None observed across all 3 sessions. Every `agent-*.jsonl` file had a corresponding Agent
   `tool_use` in the parent, and every parent Agent call had a corresponding subagent file.
   Zero orphans in the examined data.

5. **Nested Agent tool_uses inside subagent files?**  
   None. All 85 subagent files were searched for nested `Agent` tool_use blocks; zero were
   found. Subagents in these sessions do not themselves spawn further subagents. v1 can safely
   treat subagent files as leaf nodes.

---

## The Real Pairing Key: `toolUseResult.agentId`

The actual reliable linkage is:

```
parent user line: toolUseResult.agentId  →  subagents/agent-{agentId}.jsonl filename
```

Concretely:
- Parent assistant line: `tool_use { name: "Agent", id: "toolu_01ABC...", input: { description: "Fix Task 1 detection bug" } }`
- Parent user line (tool_result for toolu_01ABC...): `toolUseResult.agentId = "a02fefd39fcaba1b4"`
- `subagents/agent-a02fefd39fcaba1b4.jsonl` — matched via `agentId` directly

The description cross-check:
- `subagents/agent-a02fefd39fcaba1b4.meta.json` contains `{ "description": "Fix Task 1 detection bug" }`
- This matches `tool_use.input.description` in the parent and serves as a human-readable confirmation.

Verified 85/85 (100%) across 3 sessions with 0 mismatches.

---

## Recommendation

**v1 should use `toolUseResult.agentId` (on user-type lines in the parent) as the primary pairing
key.** It is a direct structured field that unambiguously identifies which subagent file corresponds
to each Agent call — even if two Agent calls share an identical description.

**Secondary cross-check:** Match `Agent tool_use.input.description` against `agent-*.meta.json →
description` to confirm the pairing and provide a human-readable label. If `description` is empty
or blank, record it as `"<missing>"` and rely on `agentId` alone.

**Tertiary fallback:** If `toolUseResult.agentId` is absent (unexpected schema variation), fall
back to mtime-FIFO — sort `agent-*.jsonl` by modification time ascending and pair with Agent
`tool_use` calls in their appearance order in the parent session file.
