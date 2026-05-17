# @codexview/cli

CLI that renders AI coding agent session logs (Codex CLI rollouts, AgentWeb
codex-team status logs, Claude Code sessions, OpenCode exports, GitHub Copilot
Chat sessions) as compact plaintext markdown — suitable as compressed context
to hand to another LLM, or as a quick human-readable session summary.

## Install

```bash
npm i -g @codexview/cli
# or
pnpm add -g @codexview/cli
```

## Usage

```bash
codexview-md path/to/session.jsonl                       # → stdout
codexview-md path/to/session.jsonl -o out.md             # → file
cat session.jsonl | codexview-md -                       # → stdin
codexview-md path/to/session.jsonl --format rollout      # force a format
codexview-md parent.json --subagent child.json           # embed an OpenCode subagent
```

## Supported input formats

- **Codex CLI rollouts** — `~/.codex/sessions/.../rollout-*.jsonl`
- **AgentWeb codex-team** status logs — `.codex-team/runs/*/events.jsonl`
- **Claude Code** sessions — `~/.claude/projects/<repo>/<sessionId>.jsonl`
- **OpenCode** session exports — single JSON document, output of
  `opencode export <sessionID>`
- **GitHub Copilot Chat** sessions — single JSON document at
  `~/Library/Application Support/Code/User/workspaceStorage/<hash>/chatSessions/<uuid>.json`
  (macOS); `~/.config/Code/User/workspaceStorage/...` on Linux; `Code - Insiders` for Insiders builds.

Auto-detected by content; override with `--format rollout|codex-team|claude-code|opencode|github-copilot`.

## Embedding OpenCode subagents

OpenCode parent sessions invoke children via the `task` tool. Pass each
child's export with `--subagent` (repeatable) to inline its summary:

```bash
opencode export ses_parent > parent.json
opencode export ses_child_a > child-a.json
opencode export ses_child_b > child-b.json
codexview-md parent.json --subagent child-a.json --subagent child-b.json
```

Pairing is deterministic: parent's `task` `state.metadata.sessionId` must
equal the child's `info.id`. If a child can't be matched it's reported on
stderr and the parent's `task` line falls back to a one-line placeholder.

Claude Code subagent summaries (the `Agent` tool) are rendered inline
automatically when present in the parent jsonl — no flag needed.

GitHub Copilot sessions have no subagent model; `--subagent` is not applicable.

## What's in the output

- `# Session <threadId>` header.
- One block per turn, separated by `---`.
- Role-tagged sections: `## User`, `## Assistant`, `## Assistant (reasoning)`.
- Plaintext reasoning rendered as a blockquote.
- Tool calls render as one-line placeholders, e.g.:
  ```
  🔧 `Bash` npm test
  🔧 `Edit` src/foo.ts
  🔧 `mcp__github.create_issue`
  🔧 `TodoWrite` (6 todos)
  ```

## What's dropped

The point is to compress, so the output omits:

- Tool *outputs* (stdout, stderr, diffs, MCP results, function outputs).
- Encrypted reasoning blobs (Codex Fernet content, Claude Code empty thinking blocks).
- Token usage, timestamps, durations, raw / unknown events.

Subagent summaries (Claude Code `Agent`, OpenCode `task`) are kept and
inlined — see "Embedding OpenCode subagents" above. The cli inlines a tool
output only when it begins with a `### ` markdown header (the format used
by subagent summaries); other tool outputs are still dropped.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Unrecognised input format |
| 2 | File I/O error |
| 3 | Bad argument |

## Related

- [`@codexview/react`](https://www.npmjs.com/package/@codexview/react) — React components that render the same kinds of sessions interactively, with full tool output visible.

## License

MIT.
