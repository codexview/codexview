---
name: codexview-cli
description: Read or compress an AI coding agent session log (Codex exec JSONL or saved rollout, AgentWeb codex-team, Claude Code, OpenCode, or GitHub Copilot) into compact plaintext markdown using the `codexview-md` CLI. Keeps conversation text, plaintext reasoning, and subagent summaries (Claude Code `Agent` inline; OpenCode `task` via `--subagent`); drops tool outputs, diffs, encrypted reasoning. Use whenever the user wants to read, summarize, or compress an agent session log; mentions `codex exec --json`, paths like `~/.codex/sessions/.../rollout-*.jsonl`, `~/.claude/projects/<repo>/<sessionId>.jsonl`, `.codex-team/runs/*/events.jsonl`, OpenCode at `~/.local/share/opencode/`, or GitHub Copilot `chatSessions/*.json`; wants a past agent conversation as compressed context for another LLM; or is debugging earlier runs. Also triggers on "summarize this Claude Code session", "export this OpenCode session", "summarize my Copilot session", or any time the user pipes/cats a multi-megabyte agent session file into the conversation.
---

# codexview-cli — render agent session logs to compact markdown

`codexview-md` is a one-shot CLI that converts an AI coding agent session log into plaintext markdown. The output is small (typically ~5% of the raw input) and structured for both human skim-reading and feeding to another LLM as compressed context.

Accepts both **line-delimited jsonl** (Codex exec streams, saved rollouts, codex-team, Claude Code) and **single-document JSON** (OpenCode exports, GitHub Copilot Chat sessions) — auto-detected.

## When you should reach for this skill

- The user references an agent session by file path (`~/.codex/sessions/...`, `~/.claude/projects/...`, `.codex-team/runs/...`, `~/.local/share/opencode/...`) and wants to see what happened in it.
- The user pipes `opencode export <id>` output and wants it as markdown.
- The user has a giant log (often hundreds of KB to many MB) and any direct `Read` / `cat` would blow context.
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

**Consume the official Codex machine-readable stream:**
```bash
codex exec --json "summarize the repo" | npx -y @codexview/cli@latest -
```

**Force a format if auto-detect fails (rare):**
```bash
npx -y @codexview/cli@latest <jsonl> --format rollout
```

Valid `--format` values: `codex-exec` (`codex exec --json`), `rollout` (saved Codex session), `codex-team` (AgentWeb status log), `claude-code` (Claude Code session), `opencode` (OpenCode export), `github-copilot` (GitHub Copilot Chat session).

**OpenCode (live, no saved file):**
```bash
opencode export <sessionID> | npx -y @codexview/cli@latest -
```

**Embed OpenCode subagents** (parent's `task` tool invocations) by exporting each child and passing `--subagent` (repeatable):
```bash
opencode export ses_parent > /tmp/parent.json
opencode export ses_child_a > /tmp/child-a.json
opencode export ses_child_b > /tmp/child-b.json
npx -y @codexview/cli@latest /tmp/parent.json \
  --subagent /tmp/child-a.json \
  --subagent /tmp/child-b.json
```

Pairing key: child `info.id` must equal parent's `task` `state.metadata.sessionId`. Mismatched / missing children print a stderr note and the `task` line falls back to a one-line placeholder.

### Other flags

| Flag | Effect |
|------|--------|
| `-o, --output <path>` | Write to file instead of stdout |
| `--subagent <path>` | (repeatable) embed an OpenCode subagent child export into the parent's `task` line |
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
- Token usage, timestamps, durations, raw / unknown events.
- Claude Code system noise: `attachment`, `system`, `last-prompt`, `queue-operation` lines.

**Kept (inlined) since cli 0.4.0:** subagent summaries — Claude Code `Agent` tool outputs appear automatically when present in the parent jsonl; OpenCode `task` tool outputs appear when the matching child export is passed via `--subagent`. Both render as `### {description}` blocks under the parent's tool line.

If the user needs raw tool output (stdout, diffs, MCP results), the CLI is the wrong tool — recommend `@codexview/react`.

## Where to find session files on a user's machine

- **Codex exec stream:** capture or pipe stdout from `codex exec --json`; it has no default file path.
- **Codex saved rollouts:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- **Claude Code sessions:** `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` (the directory is the project's working-directory path with `/` replaced by `-`)
- **AgentWeb codex-team:** `<project>/.codex-team/runs/<runId>/events.jsonl`
- **OpenCode:** real data lives at `~/.local/share/opencode/` (the `~/.opencode/` dir is the install, not the data). List sessions with `opencode session list --format json` (project-scoped to cwd; `cd /tmp` first for cross-project listing); export one with `opencode export <sessionID>` (single JSON document). Subagent children share the same store; pair via `parent.task.state.metadata.sessionId == child.info.id`.
- **GitHub Copilot Chat:** single JSON files at `~/Library/Application Support/Code/User/workspaceStorage/<hash>/chatSessions/<uuid>.json` (macOS); `~/.config/Code/User/workspaceStorage/...` (Linux); use `Code - Insiders` instead of `Code` for Insiders builds. Filter to Copilot sessions by checking `agent.extensionId.value === 'GitHub.copilot-chat'` or sniff for `"copilot"` in the first 2 KB. GitHub Copilot has no subagent model; `--subagent` is not applicable.

When the user gestures vaguely at "my last session" without a path, `ls -t ~/.claude/projects/<...>/` to find the most recently modified file is usually the right move (Claude Code). For OpenCode, `opencode session list --format json | jq '.[0]'` from `/tmp` gets the latest across all projects.

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

### "Summarize my last OpenCode session"

```bash
LATEST_ID=$(cd /tmp && opencode session list --format json | jq -r '.[0].id')
opencode export "$LATEST_ID" | npx -y @codexview/cli@latest - -o /tmp/opencode.md
```

If the session dispatched subagents (parent has `task` tool calls), the cli will print a stderr hint like `note: 3 subagent task call(s) detected. Re-run with --subagent ...`. Export each child and re-run with `--subagent` to embed them.

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
