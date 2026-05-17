// Vite middleware that exposes a small REST API over the local Codex log files.
// Mounted by playground/vite.config.ts via the configureServer hook.
//
// Endpoints:
//   GET /api/logs                 → list of available log files (id, name, source, mtime, sizeKB, lineCount)
//   GET /api/logs/:id/events      → adapted ChatStreamEvent[]
//   GET /api/logs/:id/raw         → original parsed JSONL array (debug aid)
//
// IDs are URL-safe slugs derived from the absolute path (base64url + sha-ish hash).

import { readFileSync, statSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { adapt, parseJsonl } from './adapter.mjs';

const HOME = homedir();
const ROLLOUT_ROOT = join(HOME, '.codex/sessions');
const TEAM_ROOT = join(HOME, 'Projects/agentweb/.codex-team/runs');
const CLAUDE_ROOT = join(HOME, '.claude/projects');
const OPENCODE_PREFIX = 'opencode-session://';

// vite spawns its workers with a stripped-down PATH that may not contain
// user-local bins like ~/.opencode/bin. Probe known install locations directly.
import { existsSync } from 'node:fs';

const OPENCODE_BIN = (() => {
  const candidates = [
    join(HOME, '.opencode/bin/opencode'),
    join(HOME, '.local/bin/opencode'),
    '/usr/local/bin/opencode',
    '/opt/homebrew/bin/opencode',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
})();

function hasOpencodeCli() {
  return OPENCODE_BIN !== null;
}

function listOpencodeSessions() {
  // `opencode session list --format json` is project-scoped to cwd. Run from /tmp
  // (a neutral location) so we get sessions across all projects in one call.
  try {
    const stdout = execFileSync(
      OPENCODE_BIN,
      ['session', 'list', '--format', 'json'],
      { encoding: 'utf8', cwd: '/tmp', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 },
    );
    const sessions = JSON.parse(stdout || '[]');
    if (!Array.isArray(sessions)) return [];
    return sessions;
  } catch {
    return [];
  }
}

function exportOpencodeSession(sessionId) {
  // Returns the raw export JSON text (single object). Routed through a
  // temp file because execFileSync's stdout pipe corrupts large UTF-8
  // payloads (Unterminated string mid-document) — likely a node
  // child_process pipe encoding race; writing to disk via stdout-redirect
  // (fd from openSync) avoids it.
  const tmp = `/tmp/codexview-oc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const fd = openSync(tmp, 'w');
  try {
    execFileSync(
      OPENCODE_BIN,
      ['export', sessionId],
      { stdio: ['ignore', fd, 'ignore'] },
    );
  } finally {
    closeSync(fd);
  }
  try {
    return readFileSync(tmp, 'utf8');
  } finally {
    try { unlinkSync(tmp); } catch { /* best-effort cleanup */ }
  }
}

function loadOpenCodeSubagents(parentRoot) {
  // Walk parent.messages[].parts[] for {type:'tool', tool:'task'} and
  // collect each state.metadata.sessionId. Then export each child via the
  // opencode binary (reusing the fd-based stdout-redirect). Failed
  // exports are logged and skipped — never block the parent render.
  const childIds = [];
  const msgs = Array.isArray(parentRoot?.messages) ? parentRoot.messages : [];
  for (const m of msgs) {
    const parts = Array.isArray(m?.parts) ? m.parts : [];
    for (const p of parts) {
      if (p?.type === 'tool' && p?.tool === 'task') {
        const sid = p?.state?.metadata?.sessionId;
        if (typeof sid === 'string' && sid.startsWith('ses_') && !childIds.includes(sid)) {
          childIds.push(sid);
        }
      }
    }
  }
  const out = [];
  for (const sid of childIds) {
    let text;
    try { text = exportOpencodeSession(sid); }
    catch (err) {
      console.warn(`[codexview] failed to export subagent ${sid}: ${err.message || err}`);
      continue;
    }
    try {
      const childRoot = JSON.parse(text);
      out.push({ sessionId: sid, lines: [childRoot] });
    } catch (err) {
      console.warn(`[codexview] failed to parse subagent export ${sid}: ${err.message || err}`);
    }
  }
  return out;
}

let CACHE = { stamp: 0, files: [] };
const CACHE_TTL_MS = 30_000;

const SYNTHETIC_DEMO_EVENTS = (() => {
  const t0 = Date.now();
  const at = (offset) => t0 + offset;
  return [
    { type: 'thread_started', threadId: 'demo-thread', at: at(0) },
    { type: 'turn_started', turnId: 'demo-turn-1', at: at(10) },
    {
      type: 'user_message',
      turnId: 'demo-turn-1',
      itemId: 'u1',
      text: '请帮我评估一下当前 React 项目的依赖更新情况，并给出更新计划。重点关注 **breaking changes** 和性能影响。',
      at: at(20),
    },
    {
      type: 'reasoning',
      turnId: 'demo-turn-1',
      itemId: 'r1',
      partial: false,
      text: '用户希望了解依赖更新情况。我需要：\n1. 先查看 `package.json`\n2. 检查 `pnpm outdated`\n3. 评估 breaking changes 风险\n4. 输出一个结构化的计划',
      at: at(30),
    },
    {
      type: 'todo_list',
      turnId: 'demo-turn-1',
      itemId: 'plan-1',
      at: at(40),
      items: [
        { text: '读取并解析 package.json', completed: true },
        { text: '运行 pnpm outdated 收集版本信息', completed: true },
        { text: '检查每个 major bump 的 changelog', completed: false },
        { text: '生成更新计划 + 风险评估', completed: false },
      ],
    },
    {
      type: 'function_call',
      turnId: 'demo-turn-1',
      callId: 'call-read',
      name: 'read_file',
      args: { path: 'package.json' },
      at: at(50),
    },
    {
      type: 'function_call_output',
      turnId: 'demo-turn-1',
      callId: 'call-read',
      output: '## package.json\n\n- react: `^18.3.1`\n- react-dom: `^18.3.1`\n- vite: `^5.4.0`\n- vitest: `^2.0.0`\n- typescript: `^5.5.4`\n\n**注意**：当前 React 锁定在 18.x。',
      at: at(60),
    },
    {
      type: 'exec_command_begin',
      turnId: 'demo-turn-1',
      callId: 'exec-1',
      command: 'pnpm outdated',
      at: at(70),
    },
    {
      type: 'exec_command_end',
      turnId: 'demo-turn-1',
      callId: 'exec-1',
      exit: 0,
      stdout: 'Package      Current   Wanted   Latest\nreact         18.3.1   18.3.1   19.0.0\nvite          5.4.10   5.4.21    7.0.0\nvitest         2.1.9    2.1.9    3.0.0\ntypescript    5.5.4    5.5.4    5.7.2',
      stderr: '',
      durationMs: 320,
      at: at(80),
    },
    {
      type: 'web_search_call',
      turnId: 'demo-turn-1',
      callId: 'ws-1',
      query: 'React 19 breaking changes migration',
      at: at(90),
    },
    {
      type: 'web_search_end',
      turnId: 'demo-turn-1',
      callId: 'ws-1',
      results: [
        { title: 'React 19 release notes', url: 'https://react.dev/blog/2024/12/05/react-19' },
        { title: 'Migration guide: React 18 → 19', url: 'https://react.dev/blog/2024/04/25/react-19-upgrade-guide' },
      ],
      at: at(100),
    },
    {
      type: 'error_item',
      turnId: 'demo-turn-1',
      itemId: 'err-1',
      message: 'pnpm outdated 提示部分依赖无法直接解析（peerDependency 冲突），已跳过 lucide-react',
      at: at(110),
    },
    {
      type: 'todo_list',
      turnId: 'demo-turn-1',
      itemId: 'plan-1',
      at: at(120),
      items: [
        { text: '读取并解析 package.json', completed: true },
        { text: '运行 pnpm outdated 收集版本信息', completed: true },
        { text: '检查每个 major bump 的 changelog', completed: true },
        { text: '生成更新计划 + 风险评估', completed: true },
      ],
    },
    {
      type: 'patch_apply_end',
      turnId: 'demo-turn-1',
      callId: 'patch-1',
      ok: true,
      files: [
        {
          path: 'package.json',
          status: 'modified',
          diff: '@@ -10,3 +10,3 @@\n-    "react": "^18.3.1",\n+    "react": "^19.0.0",\n     "vite": "^5.4.0"',
        },
      ],
      at: at(130),
    },
    {
      type: 'agent_message',
      turnId: 'demo-turn-1',
      itemId: 'a1',
      partial: false,
      text: `## 依赖更新评估

我已经分析了你的项目依赖。下面是结论。

### 🚀 可以马上升级（低风险）

| 包 | 当前 | 建议 | 备注 |
|---|---|---|---|
| \`typescript\` | 5.5.4 | 5.7.2 | 仅 patch + minor，新增 [\`using\` 关键字](https://devblogs.microsoft.com/typescript/) |
| \`vite\` | 5.4.21 | 5.4.21 | 已是最新 |

### ⚠️ 需要谨慎评估（major bump）

- **React 19**：引入新的 \`use()\` hook、Action API、自动 batching 改进。**Breaking change**：移除了已弃用的 \`ReactDOM.render\`，需要全面切换到 \`createRoot\`。
- **Vitest 3**：snapshot 序列化格式变更。

### 📌 推荐计划

1. 先升级 TypeScript 到 5.7（无风险）
2. 单独开 PR 升级 React 19，跑完 \`pnpm test\` + 浏览器手测
3. Vitest 3 留到下个迭代

> 详见 [React 19 migration guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)。`,
      at: at(140),
    },
    {
      type: 'turn_completed',
      turnId: 'demo-turn-1',
      at: at(150),
      usage: { inputTokens: 524, outputTokens: 612 },
    },
  ];
})();

function listFiles() {
  if (Date.now() - CACHE.stamp < CACHE_TTL_MS) return CACHE.files;
  const out = [];

  // Rollouts: bounded by `find -newer` for speed, but for a dev tool just take the
  // 80 most recent.
  try {
    const stdout = execFileSync(
      'find',
      [ROLLOUT_ROOT, '-name', 'rollout-*.jsonl', '-type', 'f'],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
    for (const path of stdout.split('\n').filter(Boolean)) {
      try {
        const st = statSync(path);
        const name = path.split('/').pop().replace(/^rollout-|\.jsonl$/g, '');
        out.push({
          path,
          source: 'codex-cli',
          name,
          mtime: Math.floor(st.mtimeMs),
          sizeKB: Math.round(st.size / 102.4) / 10,
        });
      } catch { /* skip */ }
    }
  } catch { /* find missing or root absent */ }

  // AgentWeb codex-team status logs
  try {
    const stdout = execFileSync(
      'find',
      [TEAM_ROOT, '-name', 'events.jsonl', '-type', 'f'],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    );
    for (const path of stdout.split('\n').filter(Boolean)) {
      try {
        const st = statSync(path);
        // Use the parent directory's name as the human label (more meaningful than "events")
        const segments = path.split('/');
        const parent = segments[segments.length - 2] || 'events';
        out.push({
          path,
          source: 'agentweb-team',
          name: parent,
          mtime: Math.floor(st.mtimeMs),
          sizeKB: Math.round(st.size / 102.4) / 10,
        });
      } catch { /* skip */ }
    }
  } catch { /* not on this machine */ }

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

  // OpenCode (sst/opencode) — only if the CLI is installed.
  if (hasOpencodeCli()) {
    for (const s of listOpencodeSessions()) {
      const id = String(s?.id ?? '');
      if (!id.startsWith('ses_')) continue;
      const dir = String(s?.directory ?? '');
      const projectTail = dir ? dir.replace(/^.*\//, '').slice(-30) : 'global';
      const slug = String(s?.title || s?.id).slice(0, 40);
      const updated = typeof s?.updated === 'number' ? s.updated : Date.now();
      out.push({
        path: `${OPENCODE_PREFIX}${id}`,
        source: 'opencode',
        name: `${slug} · ${projectTail}`,
        mtime: updated,
        sizeKB: 0, // unknown without exporting; cheap to leave at 0
      });
    }
  }

  // Sort newest first, cap at 200
  out.sort((a, b) => b.mtime - a.mtime);
  const limited = out.slice(0, 200).map((f) => ({
    ...f,
    id: encodeURIComponent(Buffer.from(f.path).toString('base64url')),
  }));
  // Prepend synthetic demos so they're easy to find at the top of the list.
  CACHE = {
    stamp: Date.now(),
    files: [
      {
        id: 'synthetic:demo-md-plan-error',
        path: 'synthetic://demo-md-plan-error',
        source: 'synthetic',
        name: 'Demo: Markdown · Plan · Error · Tool',
        mtime: Date.now(),
        sizeKB: 1,
      },
      ...limited,
    ],
  };
  return CACHE.files;
}

function decodeId(id) {
  try {
    return Buffer.from(decodeURIComponent(id), 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function isAllowed(path) {
  return path && (
    path.startsWith(ROLLOUT_ROOT) ||
    path.startsWith(TEAM_ROOT) ||
    path.startsWith(CLAUDE_ROOT) ||
    path.startsWith(OPENCODE_PREFIX)
  );
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(json);
}

function loadSubagents(parentJsonlPath) {
  // parentJsonlPath: .../<repo>/<sessionId>.jsonl
  // subagents live at: .../<repo>/<sessionId>/subagents/agent-<agentId>.jsonl
  const m = parentJsonlPath.match(/^(.*\/[^/]+)\/([0-9a-f-]+)\.jsonl$/);
  if (!m) return [];
  const subagentsDir = join(m[1], m[2], 'subagents');
  let names;
  try {
    names = execFileSync('ls', [subagentsDir], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return [];   // no subagents/ directory — fine
  }
  // Sort by .jsonl mtime ascending so the FIFO fallback in the adapter consumes subagents
  // in their actual invocation order (filenames are random UUIDs and don't sort temporally).
  const sortable = [];
  for (const name of names) {
    if (!name.startsWith('agent-') || !name.endsWith('.jsonl')) continue;
    const jsonlPath = join(subagentsDir, name);
    let mtime;
    try { mtime = statSync(jsonlPath).mtimeMs; } catch { continue; }
    sortable.push({ name, mtime });
  }
  sortable.sort((a, b) => a.mtime - b.mtime);

  const out = [];
  for (const { name } of sortable) {
    const agentId = name.replace(/^agent-/, '').replace(/\.jsonl$/, '');
    const jsonlPath = join(subagentsDir, name);
    const metaPath = join(subagentsDir, `agent-${agentId}.meta.json`);
    let text;
    try { text = readFileSync(jsonlPath, 'utf8'); } catch { continue; }
    let meta = null;
    try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch { /* meta optional */ }
    out.push({ agentId, meta, lines: parseJsonl(text) });
  }
  return out;
}

export function apiPlugin() {
  return {
    name: 'codexview-playground-api',
    configureServer(server) {
      server.middlewares.use('/api', (req, res, next) => {
        try {
          const url = new URL(req.url || '', 'http://x');
          const path = url.pathname;

          if (req.method === 'GET' && (path === '' || path === '/' || path === '/logs')) {
            return sendJson(res, 200, { files: listFiles() });
          }

          const m = path.match(/^\/logs\/([^/]+)\/(events|raw)$/);
          if (req.method === 'GET' && m) {
            const id = m[1];
            const kind = m[2];

            // Synthetic demo — bypasses file system, returns hand-crafted events
            // that exercise the new item kinds (todo_list, error) and Markdown.
            if (id.startsWith('synthetic%3A') || id.startsWith('synthetic:')) {
              const events = SYNTHETIC_DEMO_EVENTS;
              if (kind === 'raw') return sendJson(res, 200, { file: 'synthetic://demo', count: events.length, lines: events });
              return sendJson(res, 200, { file: 'synthetic://demo', format: 'synthetic', count: events.length, events });
            }

            const file = decodeId(id);
            if (!file || !isAllowed(file)) {
              return sendJson(res, 404, { error: 'unknown id' });
            }

            // OpenCode sessions: shell out to `opencode export <sessionID>` instead
            // of reading a file from disk. Then auto-discover and export any
            // subagent children so the adapter can inline their summaries.
            if (file.startsWith(OPENCODE_PREFIX)) {
              const sessionId = file.slice(OPENCODE_PREFIX.length);
              let text;
              try { text = exportOpencodeSession(sessionId); }
              catch (err) { return sendJson(res, 404, { error: String(err.message || err) }); }
              const root = JSON.parse(text);
              const lines = [root];
              if (kind === 'raw') return sendJson(res, 200, { file, count: lines.length, lines });
              const subagents = loadOpenCodeSubagents(root);
              const { format, events } = adapt(lines, { subagents });
              return sendJson(res, 200, { file, format, count: events.length, events });
            }

            let text;
            try { text = readFileSync(file, 'utf8'); }
            catch (err) { return sendJson(res, 404, { error: String(err.message || err) }); }
            const lines = parseJsonl(text);
            if (kind === 'raw') return sendJson(res, 200, { file, count: lines.length, lines });
            // For Claude Code main sessions, also load subagent transcripts so adapter can embed them.
            const subagents = file.includes('/.claude/projects/') && !file.includes('/subagents/')
              ? loadSubagents(file)
              : [];
            const { format, events } = adapt(lines, { subagents });
            return sendJson(res, 200, { file, format, count: events.length, events });
          }

          return next();
        } catch (err) {
          return sendJson(res, 500, { error: String(err.stack || err.message || err) });
        }
      });
    },
  };
}
