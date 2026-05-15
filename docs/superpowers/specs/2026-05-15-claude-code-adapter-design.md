# CodexView · Claude Code Adapter 设计文档

- **Created**: 2026-05-15
- **Status**: Approved
- **Owner**: Jay (maxazure)
- **Repo**: `/Volumes/MaxSSD1/MigratedHome/maxazure/projects/CodexView`
- **Prior art**: [2026-05-15-codexview-design.md](2026-05-15-codexview-design.md)，[playground/adapter.mjs](../../../playground/adapter.mjs)（Codex CLI rollout adapter）

## 1. 目标与非目标

### 1.1 目标

让 CodexView 的 playground 像渲染 Codex CLI rollout 一样渲染 **Claude Code 会话日志**：

- 解析 `~/.claude/projects/<repo>/<sessionId>.jsonl`（主会话文件）
- 转换为既有 `ChatStreamEvent[]` 联合类型
- 通过既有 `<CodexTranscript />` 渲染，**零改动** `src/` 公共包
- playground 文件列表用 chip 区分来源（codex-cli / claude-code / agentweb-team / synthetic）

### 1.2 非目标

- **不**改 `@codexview/react` 包的公共 API、reducer、组件
- **不**做 `subagents/agent-*.jsonl` 子代理日志加载与 Task 关联（v2）
- **不**做 `isSidechain=true` 分支展示与 `parentUuid` DAG 重建（v2；v1 假定线性按文件行号顺序）
- **不**做 WebSearch / WebFetch 结果的结构化解析（v2；v1 全部走 `function_call`）
- **不**把 adapter 暴露为公共包；仅作为 playground 内的 ESM 模块复用
- **不**自动检测跨平台 Claude Code 日志位置（仅 macOS `~/.claude/projects/`）

## 2. 数据流

```
~/.claude/projects/<repo>/<sessionId>.jsonl
        │
        ▼
playground/api.mjs  listFiles() 扫描 + isAllowed() 校验
        │
        ▼
playground/adapter.mjs  detectFormat()
        │              ├─ 'claude-code' → adaptClaudeCode()      ← 本次新增
        │              ├─ 'rollout'     → adaptRollout()
        │              └─ 'codex-team'  → adaptCodexTeam()
        ▼
ChatStreamEvent[]
        │
        ▼
现有 <CodexTranscript />（零改动）
```

## 3. 输入：Claude Code JSONL 结构

每行一个 JSON 对象。顶层 `type` 取值与处理策略：

| `type` | 形态 | 处理 |
|---|---|---|
| `user` | `.message.content` 为字符串 | **真实用户 prompt**：触发 `turn_started`，emit `user_message` |
| `user` | `.message.content[]` 含 `tool_result` | 工具结果，按 `tool_use_id` 配对 |
| `user` | `.message.content[]` 含 `text` | 用户后续文本（罕见，例如继续输入） → 追加 `user_message` 到当前 turn，**不**开新 turn |
| `assistant` | `.message.content[]` 含 `text` / `thinking` / `tool_use` | 助手输出，按 content 分项处理 |
| `attachment` | `.attachment.type` ∈ `hook_success`/`hook_additional_context`/`deferred_tools_delta` | **静默 drop** |
| `system` | 元数据 | **静默 drop** |
| `last-prompt` | CLI 草稿 | **静默 drop** |
| `queue-operation` | CLI 队列状态 | **静默 drop** |
| 其他未知 `type` | — | `raw` event（兜底） |

**额外过滤规则**（在 type 判断之前）：

- `line.isSidechain === true` → 整行跳过（v1 不做分支）

**关键字段**：

```ts
// type=='user' (real prompt)
{ type, uuid, sessionId, timestamp, parentUuid?, isSidechain?, message: { role:'user', content: string } }

// type=='user' (tool result)
{ type, uuid, sessionId, timestamp, ...
  message: { role:'user', content: [{ type:'tool_result', tool_use_id, content: string|array, is_error?: boolean }] } }

// type=='assistant'
{ type, uuid, sessionId, timestamp, ...
  message: { role:'assistant', model, stop_reason, usage,
             content: [{ type:'text', text } | { type:'thinking', thinking, signature } | { type:'tool_use', id, name, input }] } }
```

## 4. Turn 边界合成

Claude Code JSONL 没有 `task_started/task_complete`。合成规则：

**定义**：**text-user 行** = `type === 'user'` **且**（`message.content` 为字符串 **或** `message.content[]` 中只有 `type === 'text'` 项、不含 `tool_result`）。仅当真正是"新用户输入"时才会触发 turn 切换。

1. 进文件第一行就 `emit thread_started({ threadId: <sessionId>, at })`
2. 首次遇到 text-user 行 → `emit turn_started({ turnId: <user.uuid>, at })`
3. 之后所有 assistant / tool_result 归入当前 turn
4. 下一个 text-user 行触达 → 先 `emit turn_completed`（带累计 usage），再 `emit turn_started`
5. 文件结束、当前 turn 仍未关 → `emit turn_completed`（兜底；at = 最后事件时间）
6. 全程**不** emit `turn_failed` / `turn_aborted`（Claude Code 没有可靠信号；个别工具失败只在 tool_result.is_error 体现）

**TurnId 选取**：使用该 text-user 行的 `uuid`。这是 JSONL 自带的稳定 ID。

**Token usage 聚合**（per turn）：

```
turn_completed.usage = {
  inputTokens:  当前 turn 中最后一个 assistant 行的 message.usage.input_tokens
  outputTokens: 当前 turn 中所有 assistant 行的 message.usage.output_tokens 之和
}
```

理由：Anthropic API 的 `input_tokens` 是该请求的总输入（含历史），所以取最后一个就是 turn 结束时的累计上下文；`output_tokens` 是该请求的输出，按 turn 求和才是该轮真正生成的 token。

## 5. Content 项 → ChatStreamEvent 映射

### 5.1 文本与思考

`<idx>` 指该 content 项在所属消息 `content[]` 数组中的位置（0、1、2…）。reducer 已按 `(id, kind)` 去重（见 [reducer/transcript.ts:119](../../../src/reducer/transcript.ts)），因此即便 thinking 与 text 共用 `<assistant.uuid>:<idx>` 的命名空间，不同 kind 也不会相互覆盖。

| Claude Code content 项 | 输出事件 | 说明 |
|---|---|---|
| `user.content` (string, real prompt) | `user_message` | itemId = `user.uuid`, text 即原字符串 |
| `user.content[].text` | `user_message` | itemId = `<user.uuid>:<idx>`, text 直传 |
| `assistant.content[].text` | `agent_message`, `partial: false` | itemId = `<assistant.uuid>:<idx>`, text 直传 |
| `assistant.content[].thinking` 非空字符串 | `reasoning`, `partial: false` | itemId = `<assistant.uuid>:<idx>`, text 即 thinking |
| `assistant.content[].thinking` 为空字符串 | **跳过** | 这是加密态（仅有 signature）；与 Codex `encrypted_content` 同处理 |

### 5.2 工具调用映射（按 tool name）

| 工具名 | 配对事件 | 详细映射 |
|---|---|---|
| `Bash` | `exec_command_begin` + `exec_command_end` | command=`input.command`；stdout=`tool_result.content`（!is_error 时）或空；stderr=`tool_result.content`（is_error 时）或空；exit = `is_error ? 1 : 0`；durationMs = 0 |
| `TodoWrite` | `todo_list` | itemId=`tool_use.id`；items=`input.todos.map({content,status,activeForm}) → {text:content, completed: status==='completed'}`；对应的 tool_result 丢弃 |
| `Edit` | `patch_apply_end`（1 file, status='modified'）| diff 由 `input.old_string/new_string` 合成行级 `-`/`+`；ok=`!tool_result.is_error` |
| `Write` | `patch_apply_end`（1 file, status='added'） | diff = `input.content` 每行加 `+` 前缀；ok=`!tool_result.is_error` |
| `MultiEdit` | `patch_apply_end`（1 file, status='modified'）| 把 `input.edits[]` 顺次拼成 `-`/`+` 块，用空行分隔；ok=`!tool_result.is_error` |
| `mcp__<server>__<name>` | `mcp_tool_call` + `mcp_tool_call_output` | 按 `__` 拆分，server=`parts[1]`，name=剩余部分用 `__` 重连；output=tool_result.content；is_error → error |
| **其他**（`Read` `Glob` `Grep` `Task` `Skill` `WebSearch` `WebFetch` `Agent` `ToolSearch` `AskUserQuestion` `Monitor` 等） | `function_call` + `function_call_output` | name=`tool_use.name`；args=`tool_use.input`；output=`tool_result.content`；is_error → `error` 字符串 |

### 5.3 Diff 合成示例

**Edit**：
```
- 旧第一行
- 旧第二行
+ 新第一行
+ 新第二行
```

**Write**：
```
+ 新文件第一行
+ 新文件第二行
+ ...
```

**MultiEdit** （`edits: [{old_string, new_string}, ...]`）：
```
- edit1 旧第一行
+ edit1 新第一行

- edit2 旧第一行
+ edit2 新第一行
```

PatchBlock 已支持行首字符 `-`/`+` 着色（见 [PatchBlock.tsx:11-18](../../../src/components/PatchBlock.tsx)），无需 UI 改动。

### 5.4 配对策略

`tool_use.id` ↔ `tool_result.tool_use_id` 是稳定 ID。adapter 内部维护 `Map<callId, pendingItem>`：

- 遇到 tool_use：emit 对应 begin/call 事件，记入 map
- 遇到 tool_result：从 map 取出对应 begin，emit 对应 end/output 事件，从 map 删除
- 文件结束仍在 map 里的 → 视为未完成，**不**再补 end 事件（让 reducer 的 turn_completed 自动将其翻转为 `completed`，符合既有语义）

## 6. playground 改动

### 6.1 playground/api.mjs

```js
const CLAUDE_ROOT = join(HOME, '.claude/projects');
```

`listFiles()` 新增第三段扫描：

```js
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
      // 例：a7d93eaf · projects-CodexView
      const name = `${filename.slice(0, 8)} · ${parentDir.slice(-20)}`;
      out.push({
        path,
        source: 'claude-code',
        name,
        mtime: Math.floor(st.mtimeMs),
        sizeKB: Math.round(st.size / 102.4) / 10,
      });
    } catch { /* skip */ }
  }
} catch { /* root absent */ }
```

`isAllowed(path)`：

```js
function isAllowed(path) {
  return path && (
    path.startsWith(ROLLOUT_ROOT) ||
    path.startsWith(TEAM_ROOT) ||
    path.startsWith(CLAUDE_ROOT)
  );
}
```

`-maxdepth 2` 同时排除了 subagents 子目录（位于第 3 层）。`if (path.includes('/subagents/'))` 是双保险。

### 6.2 playground/adapter.mjs

新增 `adaptClaudeCode(lines)` 函数；扩展 `detectFormat(lines)`：

```js
const detectFormat = (lines) => {
  for (const line of lines) {
    if (line && typeof line === 'object') {
      // Claude Code: every line carries `sessionId` (queue-operation, system,
      // last-prompt, user, assistant, attachment, …). Codex rollout and
      // codex-team logs do not. Tested against multiple real Claude Code
      // sessions including ones whose first lines are queue-operation rows
      // that lack uuid/parentUuid.
      if ('sessionId' in line) return 'claude-code';
      // Codex rollout: top-level { type, payload, timestamp }
      if ('type' in line && ('payload' in line || 'timestamp' in line)) return 'rollout';
      // AgentWeb codex-team status log: { event, at, status, payload }
      if ('event' in line && 'at' in line) return 'codex-team';
    }
  }
  return 'unknown';
};
```

`adapt(rawLines)` 入口在 'unknown' 之前加 'claude-code' 分支。

### 6.3 playground/src/App.tsx（前端）

文件列表每项渲染时，名字旁加一个浅灰 chip：

```tsx
<span className="source-chip" data-source={file.source}>{file.source}</span>
```

CSS：

```css
.source-chip {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--cv-bg-subtle);
  color: var(--cv-text-muted);
}
.source-chip[data-source='claude-code'] { background: #f4e3ff; color: #6b21a8; }
.source-chip[data-source='codex-cli']   { background: #e0f2fe; color: #075985; }
.source-chip[data-source='agentweb-team'] { background: #fef3c7; color: #92400e; }
.source-chip[data-source='synthetic']   { background: #f3f4f6; color: #4b5563; }
```

具体配色待 UI 实施时按现有 token 调整；本节仅是占位说明。

## 7. 错误处理与降级

| 错误类别 | 处理 |
|---|---|
| 行非法 JSON | parseJsonl 已自动 skip |
| 行没有 sessionId / uuid | adapter 跳过；不进 raw |
| tool_use 没有匹配的 tool_result（被中断或未完成）| 不补 end 事件；reducer 在 turn_completed 时翻转为 `completed` |
| tool_result 没有对应的 tool_use（罕见，乱序）| pushRaw |
| 未知工具名 | 走 function_call 通用通道（不进 raw） |
| 加密 thinking（空字符串）| 跳过 |
| 完全未知的顶层 type | pushRaw |
| 文件不存在 / 权限不足 | api.mjs 返回 404 |

reducer 与组件错误边界（既有 `ItemErrorBoundary`）已覆盖渲染期。

## 8. 测试矩阵

### 8.1 单元测试

`playground/adapter.claude-code.test.mjs`（vitest 风格）：

| Case | 验收 |
|---|---|
| empty file | events=[] |
| 单 turn + 1 个 Bash | thread_started + turn_started + user_message + exec_begin + exec_end + agent_message + turn_completed |
| 多 turn（2 个 text-user）| 两组 turn_started/completed |
| Bash is_error=true | exec_command_end.exit===1 && stderr 非空 |
| Edit | patch_apply_end, files[0].status='modified', diff 含 `-`/`+` |
| Write | patch_apply_end, files[0].status='added' |
| MultiEdit | patch_apply_end, diff 含多个 `-`/`+` 块 |
| TodoWrite 三状态 | todo_list, items 中 completed=true 仅当 status==='completed' |
| `mcp__server__name` | mcp_tool_call.server==='server', mcp_tool_call.name==='name' |
| `mcp__a__b__c` | server='a', name='b__c' |
| thinking 为空字符串 | 不 emit reasoning |
| thinking 非空 | emit reasoning |
| `attachment` / `system` / `last-prompt` / `queue-operation` | 不 emit 任何事件，包括 raw |
| `isSidechain: true` | 不 emit 任何事件 |
| tool_use 没匹配 tool_result | 仅 begin，无 end；reducer 自然处理 |
| Token usage 跨多 assistant | turn_completed.usage.outputTokens = 求和 |
| 未知工具名 `FooBar` | function_call.name==='FooBar', args 直传 |

### 8.2 Fixtures

存放于 `fixtures/`：

| 文件 | 内容 |
|---|---|
| `claude-code-short.jsonl` | 单 turn：1 Bash + 1 agent_message |
| `claude-code-tool-heavy.jsonl` | 多 turn：Edit / MultiEdit / Bash / TodoWrite / mcp_tool / Task / WebSearch 混合 |
| `claude-code-thinking-mixed.jsonl` | thinking 明文与空字符串各几个 + 普通 text 输出 |

每份 fixture **20–60 行**，从真实日志手工裁剪 + 匿名化。

### 8.3 匿名化规则

| 字段 | 替换 |
|---|---|
| `cwd`、命令中的绝对路径里的用户名 | 替换为 `<user>` |
| `sessionId`、`uuid` | 保留（已是无意义随机串）|
| API key / token（命令、env、URL）| 正则替换为 `<redacted>` |
| 第三方服务域名（除 anthropic/codexview/github/react 等公开/项目相关） | 替换为 `example.com` |
| 邮箱 | 替换为 `user@example.com` |

`fixtures/README.md` 追加一节说明 Claude Code fixture 来源与匿名脚本。

### 8.4 不做的测试

- 不做端到端 SSE / 实时增量（playground 是一次性加载）
- 不做跨平台路径测试（v1 仅 macOS）

## 9. 包结构影响

| 文件 | 改动 |
|---|---|
| `playground/adapter.mjs` | 新增 `adaptClaudeCode()` + 扩展 `detectFormat()` |
| `playground/api.mjs` | 新增 `CLAUDE_ROOT` 扫描 + `isAllowed()` 放行 |
| `playground/src/App.tsx` | 文件列表加 source chip |
| `playground/adapter.claude-code.test.mjs` | 新文件，单元测试 |
| `fixtures/claude-code-*.jsonl` | 3 个新 fixture |
| `fixtures/README.md` | 追加 Claude Code 来源说明与匿名规则 |
| `src/` | **零改动** |
| `package.json` | **零改动** |
| `README.md` | 在 Status 节追加一行：本地 playground 已能渲染 Claude Code 主会话 |

## 10. 验收标准

- [ ] `adapter.claude-code.test.mjs` 全部 case 通过
- [ ] `pnpm test` 全绿（既有测试不受影响）
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm playground` 启动后，文件列表能看到本机 `~/.claude/projects/` 下最近 100 个会话
- [ ] 来源 chip 视觉可识别（claude-code / codex-cli 颜色不同）
- [ ] 至少 5 个真实 Claude Code 会话能正确渲染（含 Bash / Edit / TodoWrite / mcp 工具）
- [ ] subagents/ 子目录不出现在列表里
- [ ] 加密 thinking 不显示乱码
- [ ] adapter 不抛错（在 ≥20 个真实会话上 smoke 通过）

## 11. 开放问题与决策日志

| # | 问题 | 决策 | 决策时间 |
|---|---|---|---|
| 1 | 覆盖范围 | 仅主会话 | 2026-05-15 |
| 2 | Adapter 位置 | playground/adapter.mjs（不动公共包）| 2026-05-15 |
| 3 | Turn 划分 | text-user prompt 开新 turn | 2026-05-15 |
| 4 | 加密 thinking | 整体跳过（不渲染占位）| 2026-05-15 |
| 5 | 工具映射深度 | 深映射（Bash/TodoWrite/Edit 系列/MCP 走专用事件，其他 function_call 兜底）| 2026-05-15 |
| 6 | Edit/Write/MultiEdit 渲染 | 合成 patch_apply_end + 行级 -/+ diff | 2026-05-15 |
| 7 | 文件列表呈现 | 同一列表 + source chip | 2026-05-15 |
| 8 | 测试粒度 | adapter 纯函数单测 + 3 份匿名 fixture | 2026-05-15 |
| 9 | Token usage 聚合 | 末 inputTokens + 累计 outputTokens | 2026-05-15 |
| 10 | tool_use 无 tool_result | 不补 end；交给 turn_completed 翻转 | 2026-05-15 |

## 12. 后续工作（v2 候选）

1. 加载 `subagents/agent-*.jsonl` 并通过 `tool_use_id` 与父会话 Task 调用关联
2. 渲染 sidechain 分支为可折叠子树
3. WebSearch / WebFetch 结果结构化解析
4. 把 adapter 抽到 `@codexview/adapters` 独立包发布
5. 跨平台路径自动检测（Linux `~/.claude/projects/`, Windows `%USERPROFILE%\.claude\projects\`）
6. 主页 README 更新："First-class adapters: Codex CLI + Claude Code"

## 13. 参考

- 本设计延续 [CodexView 原始设计](2026-05-15-codexview-design.md) 的 ChatStreamEvent 契约
- 既有 Codex 适配器实现：[playground/adapter.mjs:51-601](../../../playground/adapter.mjs)
- `~/.claude/projects/` 真实样本（个人机器，2026-05 抽样）
- launch-2026-05-15.md（前一次会话总结，Open follow-up #2）
