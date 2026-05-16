---
name: codexview-cli
description: Read or compress an AI coding agent session jsonl (Codex CLI rollouts, AgentWeb codex-team logs, or Claude Code sessions) into compact plaintext markdown using the `codexview-md` CLI. Keeps conversation text and plaintext reasoning; drops tool outputs, diffs, encrypted reasoning, and subagent transcripts. Use this skill whenever the user wants to read, summarize, skim, peek into, or compress an agent jsonl log; mentions paths like `~/.codex/sessions/.../rollout-*.jsonl`, `~/.claude/projects/<repo>/<sessionId>.jsonl`, or `.codex-team/runs/*/events.jsonl`; wants to feed a past agent conversation to another LLM as compressed context; or is debugging by inspecting earlier runs. Also triggers on phrases like "turn this jsonl into readable text", "summarize this Claude Code session", "what did this rollout do", "看 session 内容", "压缩 jsonl 当上下文", "把这个 jsonl 转成 markdown", or any time the user pipes/cats a multi-megabyte agent jsonl file into the conversation.
---

# codexview-cli — render agent jsonl to compact markdown

`codexview-md` is a one-shot CLI that converts an AI coding agent session log into plaintext markdown. The output is small (typically ~5% of the raw jsonl) and structured for both human skim-reading and feeding to another LLM as compressed context.

## When you should reach for this skill

- The user references an agent session by file path (`~/.codex/sessions/...`, `~/.claude/projects/...`, `.codex-team/runs/...`) and wants to see what happened in it.
- The user has a giant jsonl (often hundreds of KB to many MB) and any direct `Read` / `cat` would blow context.
- The user wants a session summary to paste into another conversation, into a doc, or to compare two runs.
- The user is debugging "what did the agent do at step N" and needs to read the turn-by-turn flow.

If the user wants to see the **raw tool outputs** (stdout, diffs, MCP results) — this CLI **drops those by design**. Tell them so, and point at [`@codexview/react`](https://www.npmjs.com/package/@codexview/react) for an interactive viewer that keeps the detail.

## Invocation

Always invoke via `npx` so the latest version is used and no global install is required:

```bash
npx -y @codexview/cli@latest <input.jsonl>
```

`-y` skips the install confirmation. The first run downloads the package (~20 KB tarball); subsequent runs are cached.

### Common patterns

**View a session, head-limited (the default for unknown-size files):**
```bash
npx -y @codexview/cli@latest ~/.claude/projects/<repo>/<sessionId>.jsonl | head -80
```

**Save to a markdown file, then read it back in chunks:**
```bash
npx -y @codexview/cli@latest <jsonl> -o /tmp/session.md
wc -l /tmp/session.md
# then Read /tmp/session.md with offset/limit as needed
```

**Stream from stdin:**
```bash
cat <jsonl> | npx -y @codexview/cli@latest -
```

**Force a format if auto-detect fails (rare):**
```bash
npx -y @codexview/cli@latest <jsonl> --format rollout
```

Valid `--format` values: `rollout` (Codex CLI), `codex-team` (AgentWeb status log), `claude-code` (Claude Code session).

### Other flags

| Flag | Effect |
|------|--------|
| `-o, --output <path>` | Write to file instead of stdout |
| `-h, --help` | Print usage |
| `-v, --version` | Print version |

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Unrecognised format (try `--format`) |
| 2 | File I/O error |
| 3 | Bad argument |

## Output format

```markdown
# Session <threadId>

## User
<user text>

## Assistant (reasoning)
> plaintext reasoning rendered as blockquote

## Assistant
<assistant text>

🔧 `Bash` npm test
🔧 `Edit` src/foo.ts
🔧 `mcp__github.create_issue`
🔧 `TodoWrite` (6 todos)
🔧 `Agent` <description>

<continued assistant text after tools>

---

## User
<next turn>
```

Rules:

- `# Session` header carries the thread/session id from the original log.
- Turns separated by `---`.
- Three role headings — `## User`, `## Assistant`, `## Assistant (reasoning)`. Reasoning is a separate block from the assistant text.
- Tool calls render as **one-line placeholders** (no stdout, no stderr, no diff). The short summary shown depends on the tool — `Bash` shows the command, `Edit`/`Write`/`Read` show the `file_path`, `mcp__server.tool` shows the qualified name, `Agent` shows the description, `TodoWrite` shows the count.
- Consecutive tool calls group without blank lines; an assistant text segment that follows tool calls starts a fresh `## Assistant` heading so the reader sees that work happened in between.
- `turn_failed` / `turn_aborted` append a single italic line at the end of the turn (e.g. `_(turn failed: rate limited)_`).

## What's dropped (so you don't promise it to the user)

- Tool outputs: stdout, stderr, exit codes, file diffs, MCP results, function call outputs.
- Encrypted reasoning (Codex Fernet blobs, Claude Code empty `thinking` blocks).
- Claude Code subagent transcripts — the parent's `Agent` tool call appears once as a single 🔧 line; no nested summary.
- Token usage, timestamps, durations, raw / unknown events.
- Claude Code system noise: `attachment`, `system`, `last-prompt`, `queue-operation` lines.

If the user needs any of those, the CLI is the wrong tool — recommend `@codexview/react`.

## Where to find jsonl files on a user's machine

- **Codex CLI rollouts:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- **Claude Code sessions:** `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` (the directory is the project's working-directory path with `/` replaced by `-`)
- **AgentWeb codex-team:** `<project>/.codex-team/runs/<runId>/events.jsonl`

When the user gestures vaguely at "my last session" without a path, `ls -t ~/.claude/projects/<...>/` to find the most recently modified file is usually the right move.

## Worked examples

### "Summarize my last Claude Code session in this project"

```bash
LATEST=$(ls -t ~/.claude/projects/<encoded-cwd>/*.jsonl | head -1)
echo "Raw: $(wc -c < "$LATEST") bytes"
npx -y @codexview/cli@latest "$LATEST" -o /tmp/last-session.md
echo "Markdown: $(wc -c < /tmp/last-session.md) bytes"
```

Then read `/tmp/last-session.md` to answer the user's question.

### "I want to give Claude.ai context about what I did yesterday in Codex CLI"

```bash
F=~/.codex/sessions/2026/05/16/rollout-<...>.jsonl
npx -y @codexview/cli@latest "$F" -o /tmp/yesterday.md
# then attach /tmp/yesterday.md or paste its contents
```

### "What tool calls did this run make?"

```bash
npx -y @codexview/cli@latest <jsonl> | grep "^🔧" | sort -u
```

### "Did the agent ever read foo.ts in this session?"

```bash
npx -y @codexview/cli@latest <jsonl> | grep -E "🔧 \`(Read|Edit|Write)\` .*foo\.ts"
```

## When NOT to use this skill

- The user wants the **full transcript with tool outputs visible** (use `@codexview/react` interactive viewer instead).
- The user wants to **modify** the jsonl, not read it (parse it directly).
- The file is **not** an agent session log (e.g. it's some other jsonl data file). The CLI will exit 1 with "could not detect input format" — that's the signal it's not the right tool.
- The file is **a Claude Code subagent file** (path includes `/subagents/agent-*.jsonl`). Those are sidechain-only and the CLI will produce empty output; you want the parent session jsonl one level up.
