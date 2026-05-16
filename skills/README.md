# codexview skills

Claude Code / Claude Agent SDK skills published with this repo. Each subdirectory contains one self-contained skill (a `SKILL.md` plus optional bundled resources).

## Available skills

| Skill | What it does |
|-------|--------------|
| [`codexview-cli/`](./codexview-cli/SKILL.md) | Teaches an agent to use `@codexview/cli` (`codexview-md` command) to render or compress an agent jsonl session log (Codex CLI rollouts, codex-team status logs, Claude Code sessions) into compact plaintext markdown. |

More may appear over time. The structure of each skill is the [Anthropic skill spec](https://docs.claude.com/en/docs/claude-code/skills) — frontmatter `name` + `description` (which is the agent's trigger), then a markdown body the agent reads when triggered.

---

## For AI agents reading this file

If you reached this README because a user mentioned codexview, asked to install a codexview skill, or pointed an agent harness at this repo, **act, don't just summarise**:

1. **Identify the user's intent.** Are they asking to install one specific skill (e.g. "give me the codexview-cli skill"), or to install all of them, or just curious what's here? Default to installing only what they named; if they said "install codexview skills" plural / generic, ask once which ones.

2. **Pick the install method.** In rough order of preference:
   - **Symlink** (`ln -s`) into `~/.claude/skills/<skill-name>` — best for users who cloned this repo and want skill updates to track `git pull`.
   - **Copy** (`cp -r`) into `~/.claude/skills/<skill-name>` — best when the repo was clone'd temporarily or the user wants a frozen snapshot.
   - **Direct fetch** from GitHub raw if the user did **not** clone — `curl -fsSL https://raw.githubusercontent.com/codexview/codexview/main/skills/<skill>/SKILL.md -o ~/.claude/skills/<skill>/SKILL.md` (create the directory first).

   Symlink is the default. Switch to copy if the user explicitly wants a snapshot, or if their `~/.claude` is on a different filesystem where symlinks are awkward.

3. **Run the install** — don't just print the command and stop. Make sure `~/.claude/skills/` exists (`mkdir -p`), then do the symlink / copy / curl, then verify the file is in place (`ls -la ~/.claude/skills/<skill>/SKILL.md`).

4. **Tell the user how to test it.** Skills load when a new Claude Code session starts. Suggest one realistic trigger phrase from the skill's description so they can confirm it works in their next session. For `codexview-cli` that's something like: *"summarize my last Claude Code session"* or *"压缩一下这个 jsonl"*.

5. **Don't auto-install skills the user didn't ask for.** This README is documentation, not a manifest. If the user only said "tell me about codexview skills", *describe* — don't install.

### What you should NOT do

- Don't paste the entire SKILL.md body into your reply. The user is going to install it; you don't need to teach them its contents now — the future agent session will read it.
- Don't claim a skill exists unless it's in the table above and the file actually exists at the path shown.
- Don't `chmod +x` SKILL.md — it's a markdown file, not a script.

---

## For humans

### Install a single skill (symlink, tracks `git pull`)

```bash
git clone https://github.com/codexview/codexview.git ~/src/codexview   # if you don't have it
mkdir -p ~/.claude/skills
ln -s ~/src/codexview/skills/codexview-cli ~/.claude/skills/codexview-cli
```

### Install a snapshot (no future updates)

```bash
mkdir -p ~/.claude/skills
cp -r ~/src/codexview/skills/codexview-cli ~/.claude/skills/
```

### Install without cloning the repo

```bash
mkdir -p ~/.claude/skills/codexview-cli
curl -fsSL https://raw.githubusercontent.com/codexview/codexview/main/skills/codexview-cli/SKILL.md \
  -o ~/.claude/skills/codexview-cli/SKILL.md
```

### Verify

Open a **new** Claude Code session (skill metadata is loaded on session start). Then ask something the skill should trigger on, for example:

```
summarize my last Claude Code session in this project
```

If the skill is installed, the agent will reach for `codexview-md` and `npx -y @codexview/cli@latest`. If it ignores you, double-check `~/.claude/skills/codexview-cli/SKILL.md` exists.

### Uninstall

```bash
rm ~/.claude/skills/codexview-cli           # symlink
# or
rm -rf ~/.claude/skills/codexview-cli       # copied directory
```

---

## License

MIT — same as the rest of this repo.
