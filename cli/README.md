# @codexview/cli

CLI that renders AI coding agent jsonl logs (Codex CLI rollouts, AgentWeb
codex-team status logs, Claude Code sessions) as compact plaintext markdown
— suitable as compressed context to hand to another LLM, or as a quick
human-readable session summary.

## Install

```bash
npm i -g @codexview/cli
# or
pnpm add -g @codexview/cli
```

## Usage

```bash
codexview-md path/to/session.jsonl                   # → stdout
codexview-md path/to/session.jsonl -o out.md         # → file
cat session.jsonl | codexview-md -                   # → stdin
codexview-md path/to/session.jsonl --format rollout  # force a format
```

## Supported input formats

- **Codex CLI rollouts** — `~/.codex/sessions/.../rollout-*.jsonl`
- **AgentWeb codex-team** status logs — `.codex-team/runs/*/events.jsonl`
- **Claude Code** sessions — `~/.claude/projects/<repo>/<sessionId>.jsonl`

Auto-detected by content; override with `--format rollout|codex-team|claude-code`.

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
- Claude Code subagent transcripts — the `Agent` tool call appears once, no nested summary.
- Token usage, timestamps, durations, raw / unknown events.

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
