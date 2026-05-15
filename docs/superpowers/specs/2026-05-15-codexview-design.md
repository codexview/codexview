# CodexView 设计文档

- **Created**: 2026-05-15
- **Status**: Approved
- **Owner**: Jay (maxazure)
- **Repo**: `/Volumes/MaxSSD1/MigratedHome/maxazure/projects/CodexView`
- **Primary consumer**: `~/Projects/agentweb`

## 1. 目标与非目标

### 1.1 目标

构建一个独立的 React 组件库 `codexview`，把 OpenAI Codex CLI 的对话事件流渲染成聊天式 transcript，具备：

- 多种 item 类型的 UI（文本消息、reasoning、function call、shell exec、MCP 调用、web search、patch apply、未知类型兑底）
- 会话级状态显示（正在工作 / 已完成 / 已停止 / 失败）+ 实时动画
- 可被 agentweb 一行代码引入；同时支持其他类似宿主复用
- 主题化通过 CSS variables 实现，与宿主样式无冲突
- 内部有完善的 reducer + fixture 测试，保证健壮

### 1.2 非目标

- **不**解析 Codex 原生 rollout JSONL 文件（`~/.codex/sessions/.../rollout-*.jsonl`）。Agentweb 后端 [`backend/src/codex/eventMap.ts`](file:///Users/maxazure/Projects/agentweb/backend/src/codex/eventMap.ts) 已经把它标准化成 `ChatStreamEvent`，本组件以这个标准化事件为输入。
- **不**实现 SSE 接收 / 网络层 / 状态持久化 —— 这是宿主的职责。
- **不**实现 composer（输入框）、会话列表、文件预览。仅渲染聊天主体（transcript）。
- **不**实现虚拟列表 v1。暴露 `maxItems` prop 让宿主裁剪历史。
- **不**实现可访问性以外的 i18n / RTL / 主题切换器（v1）。

## 2. 仓库与技术栈

### 2.1 目录结构

```
CodexView/
├── package.json
├── tsconfig.json                       # 严格模式 + noUncheckedIndexAccess
├── tsup.config.ts                      # 构建配置
├── vitest.config.ts                    # 测试配置
├── README.md
├── docs/
│   ├── api.md                          # 权威 API 参考（手写）
│   ├── events.md                       # ChatStreamEvent 输入契约
│   ├── styling.md                      # CSS variables 全清单
│   ├── integration-agentweb.md         # agentweb 集成手册
│   ├── changelog.md
│   └── superpowers/specs/
│       └── 2026-05-15-codexview-design.md   # 本文件
├── src/
│   ├── index.ts                        # 主入口：re-export 公共 API
│   ├── types/
│   │   ├── events.ts                   # ChatStreamEvent / NormalizedItem 类型
│   │   ├── model.ts                    # TranscriptModel / TurnView / ItemView
│   │   └── theme.ts                    # CSS variables 字典作为 TS 类型
│   ├── reducer/
│   │   ├── transcript.ts               # events[] → TranscriptModel
│   │   ├── transcript.test.ts          # 表驱动单测
│   │   ├── property.test.ts            # 性质测试：增量 vs 全量等价
│   │   └── status.ts                   # inferStatus(model)
│   ├── hooks/
│   │   ├── useCodexTranscript.ts       # 主 hook
│   │   ├── useCodexTranscript.test.ts
│   │   ├── useSmoothStream.ts          # 平滑打字机效果
│   │   └── useSmoothStream.test.ts
│   ├── components/
│   │   ├── CodexTranscript.tsx         # 主组件
│   │   ├── CodexTranscript.module.css
│   │   ├── StatusBar.tsx + .module.css
│   │   ├── TurnContainer.tsx + .module.css
│   │   ├── MessageBubble.tsx + .module.css
│   │   ├── ReasoningBlock.tsx + .module.css
│   │   ├── ToolCallBlock.tsx + .module.css
│   │   ├── ExecBlock.tsx + .module.css
│   │   ├── SearchBlock.tsx + .module.css
│   │   ├── PatchBlock.tsx + .module.css
│   │   ├── RawEventBlock.tsx + .module.css
│   │   ├── ItemErrorBoundary.tsx
│   │   └── icons.ts                    # lucide-react 别名
│   └── styles/
│       ├── reset.module.css            # 局部 reset，仅作用 .codexview-root
│       └── tokens.css                  # CSS variables 默认值（亮色）
├── fixtures/
│   ├── short-chat.jsonl
│   ├── tool-heavy.jsonl
│   ├── mcp-flow.jsonl
│   ├── failed-turn.jsonl
│   ├── aborted-turn.jsonl
│   ├── unknown-types.jsonl
│   └── README.md                       # 说明 fixture 来源与匿名化规则
└── dev/                                # 本地 demo（vite SPA）
    ├── index.html
    ├── main.tsx
    ├── App.tsx                         # 选择 fixture + 渲染组件
    └── vite.config.ts
```

### 2.2 技术栈

| 项 | 选择 | 理由 |
|---|---|---|
| UI 框架 | React 18.3 | 与 agentweb 一致 |
| 语言 | TypeScript 5.5 strict + `noUncheckedIndexAccess` | 严格类型保证 reducer 不变式 |
| 打包 | tsup（基于 esbuild） | 零配置出 ESM + d.ts，CSS 单独发出 |
| 测试 | vitest + @testing-library/react + jsdom | 与 agentweb 一致，复用心智 |
| 图标 | lucide-react（peerDependency） | 行业事实标准；agentweb 加上后体积小、tree-shake |
| 样式 | CSS Modules + CSS variables | 与 agentweb tokens.css 体系对接，零运行时 |
| 状态 | useReducer / useMemo（无外部状态库） | 组件库不应强制宿主用 Jotai |
| Dev 环境 | vite + 本地 fixture | 不依赖 agentweb 跑起来 |

### 2.3 包结构与发布

```jsonc
{
  "name": "codexview",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".":            { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./styles.css": "./dist/styles.css"
  },
  "files": ["dist/", "README.md", "docs/"],
  "sideEffects": ["**/*.css"],
  "peerDependencies": {
    "react":        "^18.3.0",
    "react-dom":    "^18.3.0",
    "lucide-react": "^0.400.0"
  }
}
```

集成阶段：
- **Phase A（开发期）**：agentweb 用 `pnpm add file:../CodexView` 本地 link
- **Phase B（接口稳定后）**：发布到 npm 或 GitHub Packages，agentweb 改为版本依赖

## 3. 公共 API

### 3.1 主组件

```ts
export interface CodexTranscriptProps {
  /** 受控的事件序列。append-only 与全量替换都受支持。 */
  events: ChatStreamEvent[];

  /** 显式覆盖 inferStatus(model) 的结果。SSE 异常断开时由宿主传 'stopped'。 */
  status?: TranscriptStatus;

  /** 显式错误信息（与 status='failed'/'stopped' 配合）。会显示在 StatusBar。 */
  error?: { message: string; details?: string };

  /** 透传到 .codexview-root 容器的额外 className。 */
  className?: string;

  /** 限制渲染最近 N 条 ItemView；超过时顶部显示 "省略 X 条" hint。默认不裁剪。 */
  maxItems?: number;

  /** events 为空时显示的内容。默认是一行灰字。 */
  emptyState?: ReactNode;

  /** 任意 ItemView 被点击时回调。语义由宿主决定（v1 自带空实现）。 */
  onItemClick?: (itemId: string) => void;

  /** 局部替换某种 item 块的渲染。未提供则用内置组件。 */
  components?: Partial<{
    StatusBar:       ComponentType<StatusBarProps>;
    MessageBubble:   ComponentType<MessageBubbleProps>;
    ReasoningBlock:  ComponentType<ReasoningBlockProps>;
    ToolCallBlock:   ComponentType<ToolCallBlockProps>;
    ExecBlock:       ComponentType<ExecBlockProps>;
    SearchBlock:     ComponentType<SearchBlockProps>;
    PatchBlock:      ComponentType<PatchBlockProps>;
    RawEventBlock:   ComponentType<RawEventBlockProps>;
  }>;

  /** 关闭 useSmoothStream 平滑打字机（默认开启）。低端设备或测试可关。 */
  disableSmoothStream?: boolean;

  /** reducer 内部异常上报。返回的 model 是异常前的最新可用状态。 */
  onInternalError?: (err: unknown, event?: ChatStreamEvent) => void;
}

export const CodexTranscript: FC<CodexTranscriptProps>;
```

### 3.2 子组件（escape hatch）

每个都是独立 export，参数最小化。详细 props 写在 [docs/api.md](../../api.md)。

```ts
export const StatusBar:       FC<StatusBarProps>;
export const TurnContainer:   FC<{ turn: TurnView; children: ReactNode }>;
export const MessageBubble:   FC<MessageBubbleProps>;
export const ReasoningBlock:  FC<ReasoningBlockProps>;
export const ToolCallBlock:   FC<ToolCallBlockProps>;
export const ExecBlock:       FC<ExecBlockProps>;
export const SearchBlock:     FC<SearchBlockProps>;
export const PatchBlock:      FC<PatchBlockProps>;
export const RawEventBlock:   FC<RawEventBlockProps>;
export const ItemErrorBoundary: FC<{ fallback?: ReactNode; children: ReactNode }>;
```

### 3.3 Hook 与纯函数

```ts
/**
 * 主 hook：把 events + 可选 status 转换为 (model, derivedStatus)。
 * 内部使用 useMemo 与增量 reduce；events 是 append-only 时性能最佳。
 */
export function useCodexTranscript(
  events: ChatStreamEvent[],
  options?: { status?: TranscriptStatus; onInternalError?: (e: unknown) => void },
): { model: TranscriptModel; status: TranscriptStatus };

/** 平滑打字机效果。返回当前应该显示的字符串。 */
export function useSmoothStream(
  fullText: string,
  options?: { enabled?: boolean; charsPerFrame?: number; minDelayMs?: number },
): string;

/** events[] → TranscriptModel 的纯函数 reducer（暴露用于 SSR / 测试 / 自定义 hook）。 */
export function reduceTranscript(prev: TranscriptModel, event: ChatStreamEvent): TranscriptModel;

/** 从 model 推断会话状态。等价于 useCodexTranscript 内部规则。 */
export function inferStatus(model: TranscriptModel): TranscriptStatus;

/** 空 model（reducer 初始状态）。 */
export const EMPTY_MODEL: TranscriptModel;
```

### 3.4 对外类型

```ts
export type ChatStreamEvent;     // 输入事件联合类型，详见 §4.1
export type TranscriptModel;
export type TurnView;
export type ItemView;
export type ItemKind;
export type ItemStatus;
export type TranscriptStatus;
export type TokenUsage;
export type SearchResult;
export type PatchFile;
```

## 4. 数据模型与 reducer

### 4.1 输入契约：`ChatStreamEvent`

CodexView 接受的事件类型来自 agentweb [`backend/src/codex/eventMap.ts`](file:///Users/maxazure/Projects/agentweb/backend/src/codex/eventMap.ts) 中的 `NormalizedEvent`。本组件**不**直接耦合 agentweb 类型，而是在 `src/types/events.ts` 中重新声明一个等价的 `ChatStreamEvent` 类型，作为契约边界。

```ts
export type ChatStreamEvent =
  // 会话/轮次生命周期
  | { type: 'thread_started';    threadId: string;  at: number }
  | { type: 'turn_started';      turnId: string;    at: number }
  | { type: 'turn_completed';    turnId: string;    at: number; usage?: TokenUsage }
  | { type: 'turn_failed';       turnId: string;    at: number; error: { message: string; code?: string } }
  | { type: 'turn_aborted';      turnId: string;    at: number; reason?: string }

  // 消息与思考
  | { type: 'user_message';      turnId: string;    itemId: string; text: string; at: number }
  | { type: 'agent_message';     turnId: string;    itemId: string; text: string; partial: boolean; at: number }
  | { type: 'reasoning';         turnId: string;    itemId: string; text: string; partial: boolean; at: number }

  // 工具调用（成对到达）
  | { type: 'function_call';        turnId: string; callId: string; name: string; args: unknown; at: number }
  | { type: 'function_call_output'; turnId: string; callId: string; output?: unknown; error?: string; at: number }

  // Shell 执行
  | { type: 'exec_command_begin';   turnId: string; callId: string; command: string; at: number }
  | { type: 'exec_command_end';     turnId: string; callId: string; exit: number; stdout: string; stderr: string; durationMs: number; at: number }

  // MCP / 自定义工具（与 function_call 同结构，type 区分）
  | { type: 'mcp_tool_call';        turnId: string; callId: string; server: string; name: string; args: unknown; at: number }
  | { type: 'mcp_tool_call_output'; turnId: string; callId: string; output?: unknown; error?: string; at: number }

  // Web search
  | { type: 'web_search_call';      turnId: string; callId: string; query: string; at: number }
  | { type: 'web_search_end';       turnId: string; callId: string; results: SearchResult[]; at: number }

  // Patch apply
  | { type: 'patch_apply_end';      turnId: string; callId: string; files: PatchFile[]; ok: boolean; at: number }

  // 未知 / 兑底
  | { type: 'raw';                  turnId?: string; itemId?: string; payload: unknown; at: number };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningOutputTokens?: number;
}

export interface SearchResult { title: string; url: string; snippet?: string }

export interface PatchFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  diff?: string;            // 统一 git diff 文本
}
```

不在上面列出的、agentweb 未来可能新增的事件类型，本组件以"无法识别"处理：reducer 落入 `kind: 'raw'` ItemView，UI 用 `RawEventBlock` 兑底。

### 4.2 视图模型

```ts
export type ItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
export type ItemKind   = 'user_message' | 'reasoning' | 'assistant_text'
                       | 'tool_call' | 'exec' | 'search' | 'patch' | 'raw';

export interface ItemViewBase {
  id: string;             // 稳定 ID（来自 itemId 或 callId 或合成）
  kind: ItemKind;
  status: ItemStatus;
  startedAt: number;
  updatedAt: number;
}

export type ItemView =
  | ItemViewBase & { kind: 'user_message';   text: string }
  | ItemViewBase & { kind: 'reasoning';      text: string }
  | ItemViewBase & { kind: 'assistant_text'; text: string }
  | ItemViewBase & { kind: 'tool_call'; name: string; args: unknown; result?: unknown; error?: string }
  | ItemViewBase & { kind: 'exec'; command: string; exit?: number; stdout?: string; stderr?: string; durationMs?: number }
  | ItemViewBase & { kind: 'search'; query: string; results?: SearchResult[] }
  | ItemViewBase & { kind: 'patch'; files: PatchFile[]; ok?: boolean }
  | ItemViewBase & { kind: 'raw'; payload: unknown };

export interface TurnView {
  turnId: string;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  items: ItemView[];                // 按时间顺序
  usage?: TokenUsage;
  error?: { message: string; code?: string };
}

export interface TranscriptModel {
  threadId?: string;
  turns: TurnView[];                // 按时间顺序
  lastEventAt: number;
}
```

### 4.3 reducer 的合并语义

| 输入事件 | reducer 行为 |
|---|---|
| `thread_started` | 设置 `model.threadId` |
| `turn_started` | 追加新 `TurnView { status: 'running' }` |
| `turn_completed` | 把对应 turn 标记为 `completed`、写入 `usage`，把所有 item 中状态为 `running`/`pending` 的全部翻转为 `completed` |
| `turn_failed` | turn 标 `failed`、写 `error`，未完成 item 翻转为 `failed` |
| `turn_aborted` | turn 标 `aborted`，未完成 item 翻转为 `stopped` |
| `user_message` | 追加 `kind: 'user_message'` ItemView，`status: 'completed'` |
| `agent_message` | 在事件指定的 `turnId` 内找同 `itemId` 的 `assistant_text` ItemView：存在则更新 `text`，根据 `partial` 决定 `status`（true → running，false → completed）；不存在则新建 |
| `reasoning` | 同 `agent_message`，但 `kind: 'reasoning'`。**不**与 `agent_message` 合并 |
| `function_call` / `mcp_tool_call` | 在事件指定的 `turnId` 内追加 `kind: 'tool_call'` ItemView，`status: 'pending'` |
| `function_call_output` / `mcp_tool_call_output` | 在事件指定的 `turnId` 内找同 `callId` 的 `tool_call`：写入 `result` / `error`，状态翻转 `completed` 或 `failed` |
| `exec_command_begin` | 在事件指定的 `turnId` 内追加 `kind: 'exec'` ItemView，`status: 'running'` |
| `exec_command_end` | 在事件指定的 `turnId` 内找同 `callId` 的 `exec`：写入 `exit/stdout/stderr/durationMs`，状态 `exit === 0 ? completed : failed` |
| `web_search_call` | 在事件指定的 `turnId` 内追加 `kind: 'search'`，`status: 'pending'` |
| `web_search_end` | 在事件指定的 `turnId` 内找同 `callId` 的 `search`：写入 `results`，状态 `completed` |
| `patch_apply_end` | 追加 `kind: 'patch'` ItemView，`status: ok ? completed : failed` |
| `raw` 或未知 type | 追加 `kind: 'raw'` ItemView，`status: 'completed'` |

**不变式**（必须在 property test 中验证）：

1. 任何 `events: ChatStreamEvent[]`，`events.reduce(reduceTranscript, EMPTY_MODEL)` **不抛错**
2. 对同一 events 序列，**全量 reduce 一次** 与 **逐个增量 reduce N 次**，最终 model 严格相等（深比较）
3. reducer 是纯函数：相同输入相同输出，不读不写外部状态
4. reducer 不持有 events 数组的引用；外部 mutate events 不影响已计算 model
5. 收到未知事件类型时不丢失任何字段（payload 完整保留在 `kind: 'raw'` ItemView）

### 4.4 性能与增量

`useCodexTranscript` 内部缓存上次的 `(eventsRef, model)`：
- 若新 events 是旧 events 的前缀加新元素（`events.slice(0, prev.length) === prev`），只 reduce 新增部分
- 否则全量重 reduce
- 这覆盖了 agentweb 的两种使用模式（增量 SSE + 历史一次性加载），无需配置

## 5. 状态机

### 5.1 Item 级（5 态）

```
                     pending ─────────┐
                        │              │
                  (开始执行)            │
                        ▼              │ (turn_aborted)
                     running ──────────┤
                    /   |   \          │
       (output 来了) | (失败) (turn_aborted)
                    ▼   ▼              │
              completed failed       stopped
```

适用范围：`tool_call` / `exec` / `search`。

文本类 (`assistant_text` / `reasoning`)：仅 `running` (partial=true) 与 `completed` (partial=false) 两态；`turn_failed` / `turn_aborted` 时仍然映射到 `failed` / `stopped`。

`user_message` / `patch`：始终 `completed` 或 `failed`（一次性事件）。

### 5.2 Turn 级（4 态）

```
        running ─── turn_completed ──▶ completed
            │
            ├─── turn_failed ─────────▶ failed
            │
            └─── turn_aborted ────────▶ aborted
```

### 5.3 会话级（5 态，由 inferStatus 推断）

```
type TranscriptStatus = 'idle' | 'working' | 'completed' | 'stopped' | 'failed';
```

推断规则（按顺序，第一条命中即返回）：

1. `model.turns.length === 0` → `idle`
2. 最后一个 turn 的 `status === 'running'` → `working`
3. 最后一个 turn 的 `status === 'failed'` → `failed`
4. 最后一个 turn 的 `status === 'aborted'` → `stopped`
5. 最后一个 turn 的 `status === 'completed'` → `completed`

外部覆盖：`props.status` 一旦传入，**直接采用**，跳过推断（典型场景：SSE 网络断开，宿主主动判定 `stopped`）。

## 6. 渲染规则

### 6.1 整体布局

```
.codexview-root  (CSS reset + 字体)
  └── <StatusBar />       sticky top, 仅 status !== 'idle' 时显示
  └── <ol> (semantic, role="log", aria-live="polite")
        └── <li><TurnContainer turn={turn}>
              ├── <MessageBubble />        (user_message，贴右、无时间轴)
              ├── ...assistant items 共享左侧时间轴竖线...
              │     ├── <ReasoningBlock />
              │     ├── <ToolCallBlock />
              │     ├── <ExecBlock />
              │     ├── <SearchBlock />
              │     ├── <PatchBlock />
              │     ├── <MessageBubble />  (assistant_text)
              │     └── <RawEventBlock />
              └── ...
            </TurnContainer></li>
```

`TurnContainer` 的 assistant 区段用 `border-left: 2px solid var(--cv-axis-color)` + `padding-left: 16px` 形成时间轴。每个 item 用 `::before` 渲染 8px 圆点。

### 6.2 各 ItemKind 的渲染惯例

| 类型 | 默认显示 | 折叠规则 | 关键视觉 |
|---|---|---|---|
| `user_message` | 完整气泡，贴右 | 不折叠 | `var(--cv-bg-user-bubble)` |
| `assistant_text` | 完整气泡，贴左 | 不折叠 | running 时末尾 `▋` blink；启用 useSmoothStream |
| `reasoning` | `<details>` 折叠，header "💭 思考中..." 或 "💭 思考 (X.Xs)" | 默认折叠 | 灰色斜体；展开后用 useSmoothStream 渲染 |
| `tool_call` | header 一行：`<icon> getName(name) status` | 参数默认展开（紧凑键值对列表，单行 max 60 字符截断+悬停 tooltip 全文）；result 默认折叠（触发条件：序列化后字符串 > 500 字符 **或** > 4 行 **或** 非标量 JSON 结构 > 3 层深度） | 状态色：pending 中性 / running 蓝 / completed 绿 / failed 红 |
| `exec` | header 一行：`$ command` + `(exit X, Yms)` | command 展开；stdout/stderr 默认折叠（同 tool_call 阈值） | 等宽字体、暗色背景；stderr 红字 |
| `search` | header 一行：`🔍 query` | query 展开；结果列表默认显示前 3，余 N 折叠 | 链接蓝 |
| `patch` | header 一行：`📝 N files (added/modified/deleted)` | 文件名列表展开；每个 diff 默认折叠 | git-diff 配色：绿/红行 |
| `raw` | header 一行：`Unknown event: <type>` | 默认折叠的 `<details>`，展开为 `<pre>` JSON | 暗色 chip 提示 |

### 6.3 工具命名与图标

`src/components/icons.ts` 用 lucide-react 别名导出：

```ts
import { Wrench, Terminal, FileEdit, Search, Globe, AlertCircle, Sparkles, MessageSquare } from 'lucide-react';
export const ICONS = { tool: Wrench, exec: Terminal, patch: FileEdit, search: Search, web: Globe, error: AlertCircle, reasoning: Sparkles, message: MessageSquare };
```

`src/components/ToolCallBlock.tsx` 内部一个 `getToolPhrase(name, args)` 函数，按已知工具名生成可读 label（参考 Proma `tool-phrase.ts`）。未知工具回退到 `name`。

### 6.4 状态动画（无 spinner）

| 层级 | 动画 | CSS 实现 |
|---|---|---|
| Turn 级 StatusBar | `working` 时 6×6 脉冲圆点 | `@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }` |
| Item 时间轴节点 | item.status === 'running' 时 8px 圆环旋转 | `@keyframes ring { to { transform: rotate(360deg) } }` |
| 长 exec 的输出区 | exec.status === 'running' 时，在 header 下方显示一条 4px 高度全宽 shimmer 条（linear-gradient 滑动），exec_command_end 到达后立即移除 | `@keyframes shimmer { from{background-pos:-200%} to{background-pos:200%} }`，配合 `linear-gradient(90deg, transparent, var(--cv-shimmer-color), transparent)` 与 200% background-size |
| assistant_text 文字末端 | running 时追加 `▋` 字符 + 1s blink | `@keyframes blink { 50% { opacity: 0 } } ::after { content: '▋' }` |

所有动画都是纯 CSS。`prefers-reduced-motion: reduce` 时全部退化为静态。

### 6.5 useSmoothStream

参考 [Proma packages/ui/src/hooks/useSmoothStream.ts:58-191](file:///Users/maxazure/Projects/Proma/packages/ui/src/hooks/useSmoothStream.ts) 的策略，简化后实现：

- 用 `Intl.Segmenter` 按 grapheme 切分（兼容 emoji 与 CJK）
- `requestAnimationFrame` 驱动；每帧追加 `Math.max(1, Math.ceil(remaining / 8))` 个 grapheme
- `partial: false` 后，每帧除以 4 加速排空
- `disableSmoothStream: true` 或 `prefers-reduced-motion` 时直接返回 `fullText`

## 7. 错误处理与降级

| 错误类别 | 来源 | 降级 |
|---|---|---|
| 未知 event.type / payload.type | Codex 升级、agentweb 新事件 | reducer 落 `kind: 'raw'`，UI 用 `RawEventBlock`（折叠 JSON） |
| 必填字段缺失（function_call 没 callId） | 上游 bug | reducer 用合成 ID `synth-${index}`，加 warning chip |
| reducer 内部异常 | 我们的 bug | try/catch；保留上一个有效 model；调用 `onInternalError(err, event)`；继续处理后续 events |
| 单个 item 渲染崩溃 | 渲染 bug 或恶意 payload | `<ItemErrorBoundary>` 包裹每个 item；崩溃后回退到 `<RawEventBlock payload={item} />` |
| SSE 断开 | 网络 | 宿主传 `status='stopped'` + `error={message}`；StatusBar 显示失败状态 |
| 空 events | 首次加载 | 渲染 `emptyState` prop（默认灰字"暂无对话"） |

## 8. 测试策略

### 8.1 测试矩阵

| 测试类型 | 路径 | 覆盖目标 | 验收 |
|---|---|---|---|
| reducer 表驱动单测 | `src/reducer/transcript.test.ts` | 每种事件类型至少一条 case | 行覆盖 100% |
| reducer 性质测试 | `src/reducer/property.test.ts` | 增量 vs 全量等价、reducer 纯净 | 5 个 fixture 全通过 |
| inferStatus 单测 | `src/reducer/status.ts` 同名 .test.ts | 5 态推断 | 行覆盖 100% |
| 各 Block RTL | `src/components/*.test.tsx` | 折叠/展开、状态颜色、a11y role | 每个组件至少 3 case |
| useSmoothStream | `src/hooks/useSmoothStream.test.ts` | RAF 行为、reduced-motion | fake timers |
| 回放集成测试 | `src/integration/replay.test.tsx` | 6 个 fixture 完整渲染 | 不抛错 + 关键 DOM 元素存在 |

### 8.2 fixtures

存放于 `fixtures/`，每个 `.jsonl` 一行一个 `ChatStreamEvent`。来源：从 `~/.codex/sessions/.../rollout-*.jsonl` 抽样后用脚本匿名化（替换 cwd / 用户名 / API key / URL 域名）。

| Fixture | 内容 | 用途 |
|---|---|---|
| `short-chat.jsonl` | 一个 turn，user_message + agent_message 各一条 | 最小路径 |
| `tool-heavy.jsonl` | 多 function_call + exec 混合 | 验证合并语义、状态翻转 |
| `mcp-flow.jsonl` | MCP 工具调用 + web_search | 验证 MCP 与 search |
| `failed-turn.jsonl` | turn_failed | 错误状态 |
| `aborted-turn.jsonl` | turn_aborted（用户中止） | 停止状态 |
| `unknown-types.jsonl` | 故意混入 `type: 'foobar'` 与未知 payload | 兑底 |

`fixtures/README.md` 说明匿名化规则与添加新 fixture 的流程。

### 8.3 a11y

- `<CodexTranscript>` 容器 `role="log"` `aria-live="polite"` `aria-relevant="additions text"`
- `StatusBar` `role="status"`
- 折叠 header `<button aria-expanded={open}>`
- 错误状态 `aria-invalid="true"`
- 测试中用 `@testing-library/react` 的 `getByRole` 而非 `getByTestId`

### 8.4 不做的事

- 不引入 visual regression（Chromatic / Percy）
- 不做 SSR 测试
- 不做跨浏览器（v1 假定现代 Chromium / Safari）

## 9. 文档契约

### 9.1 必交付清单

| 文件 | 作用 | 写完标准 |
|---|---|---|
| `README.md` | 5 分钟 quick start + cheatsheet | 含一个完整可运行示例（< 30 行） |
| `docs/api.md` | 权威 API 参考 | 每个 export 含签名 / 每个 prop 默认值 / 最小示例 / 副作用说明 |
| `docs/events.md` | ChatStreamEvent 输入契约 | 列出所有事件类型 + 字段 + reducer 行为 |
| `docs/styling.md` | CSS variables 全清单 | 含每个变量的默认值、推荐用途、覆盖示例 |
| `docs/integration-agentweb.md` | agentweb 集成手册 | 4 步走 + 回滚步骤 |
| `docs/changelog.md` | 每版变化 | 0.1.0 起按 keepachangelog 格式 |

### 9.2 强制规则

- 任何 `export` 没有 JSDoc 注释 → CI 不通过（用 ESLint `require-jsdoc` 规则在 v0.2 引入；v0.1 人工 review 把关）
- 任何新 export 没在 `docs/api.md` 出现 → 视为未完成
- README 必须有"开箱 60 秒上手"段落

## 10. agentweb 集成手册

### 10.1 替换步骤

1. 保留 agentweb 现有的 `streamingAtomFamily(sessionId)` 与 SSE 接收（[`agentweb/frontend/src/codex/atoms/streaming.ts`](file:///Users/maxazure/Projects/agentweb/frontend/src/codex/atoms/streaming.ts)）
2. 在 [`ChatThread.tsx`](file:///Users/maxazure/Projects/agentweb/frontend/src/codex/components/ChatThread.tsx) 内替换内部渲染：

   ```tsx
   import { CodexTranscript } from 'codexview';
   import 'codexview/styles.css';

   const events = useAtomValue(streamingAtomFamily(sessionId));
   return <CodexTranscript events={events.list} className="aw-codex-transcript" />;
   ```

3. 在 agentweb 全局 CSS 桥接 tokens：

   ```css
   .aw-codex-transcript {
     --cv-bg-user-bubble: var(--aw-bg-bubble-user);
     --cv-bg-assistant-bubble: var(--aw-bg-bubble-bot);
     --cv-text: var(--aw-text-primary);
     --cv-axis-color: var(--aw-border-subtle);
     --cv-radius: 12px;
     /* ... 完整清单见 docs/styling.md */
   }
   ```

4. 删除 agentweb 内的 `MessageBubble.tsx` / `StreamingBubble.tsx` / `ToolUseBlock.tsx`。同 PR 完成。**例外**：agentweb 现有的 approval 气泡逻辑（人类介入审批）**不**在 v1 codexview 范围内（见 §11），需要从 `StreamingBubble.tsx` 中拆出保留为独立的 `<ApprovalBubble>`，由 agentweb 自己继续维护，与 `<CodexTranscript>` 并排渲染。

### 10.2 契约边界

- agentweb 后端 [`backend/src/codex/eventMap.ts`](file:///Users/maxazure/Projects/agentweb/backend/src/codex/eventMap.ts) 的 `ChatStreamEvent` 类型应该和 codexview 的 `ChatStreamEvent` **结构等价**。
- 集成测试：在 agentweb 项目内加一个类型 assert（`type _check = AssertEqual<AgentwebChatStreamEvent, CodexChatStreamEvent>`），任一边新增字段都会编译失败提醒。

### 10.3 回滚

- v0.1.0 发现重大问题：git revert 替换 commit，恢复原 `MessageBubble`/`StreamingBubble`/`ToolUseBlock`
- 后端 `ChatStreamEvent` 与 SSE 端点不需要变化，回滚是纯前端

## 11. 不做的事（v1 显式范围外）

- 虚拟列表（`react-virtuoso` 等） —— v2 评估
- SSR / Next.js App Router 兼容（agentweb 是 Vite SPA）
- 国际化（i18n） —— UI 文案默认中文，extract 留 v2
- 暗色 / 亮色主题切换器 —— 通过 CSS variables 由宿主切换
- 自动生成 API 文档（TypeDoc） —— 手写权威 + JSDoc 已足够
- 文件预览（图片、视频、二进制） —— v2
- Composer / 输入框 —— 不在职责范围
- approval 气泡（人类介入审批） —— v2 评估
- 富 Markdown 渲染（表格、数学公式、Mermaid） —— assistant_text 当前用纯文本 + code-fence，富 markdown 看 v0.2 需求
- 链接预览 / OG 卡片 —— v2

## 12. 开放问题与决策日志

| # | 问题 | 决策 | 决策时间 |
|---|---|---|---|
| 1 | 数据源（原始 rollout vs ChatStreamEvent vs 兼） | ChatStreamEvent | 2026-05-15 |
| 2 | 仓库形态（独立包 vs monorepo 内 vs 暂定） | 独立 npm 包 | 2026-05-15 |
| 3 | API 形态（全包 vs hook + 积木 vs 双轨） | 全包 + 暴露子组件 | 2026-05-15 |
| 4 | 状态控制权与粒度 | 会话级从 events 推断 + 可被 prop 覆盖 | 2026-05-15 |
| 5 | 事件覆盖范围 | 核心 8 类 + RawEventBlock 兑底 | 2026-05-15 |
| 6 | 样式策略 | CSS Modules + CSS variables | 2026-05-15 |
| 7 | 文档形式 | 手写 docs/api.md + JSDoc，不用 TypeDoc | 2026-05-15 |
| 8 | API 待定项（components / maxItems / onItemClick） | 全部保留 | 2026-05-15 |
| 9 | 图标系统 | lucide-react peerDependency | 2026-05-15 |
| 10 | useSmoothStream 是否在 v1 | v1 包含，默认启用 | 2026-05-15 |
| 11 | 加载模式 | 全量 + 增量都支持 | 2026-05-15 |
| 12 | reasoning 是否合并进 assistant_text | 不合并；独立块；默认折叠 | 2026-05-15（research 修订） |
| 13 | 同 turn 多 item 渲染 | 分块渲染，左侧时间轴竖线串联 | 2026-05-15（research 修订） |
| 14 | item 级状态机 | 5 态：pending/running/completed/failed/stopped | 2026-05-15（research 修订） |
| 15 | 工具调用折叠默认 | 参数展开，结果折叠（>500 字符 / >4 行） | 2026-05-15（research 修订） |

## 13. 验收标准（v0.1.0 发布门槛）

- [ ] `pnpm build` 成功，`dist/` 含 `index.js` / `index.d.ts` / `styles.css`
- [ ] `pnpm test` 100% 通过
- [ ] reducer 行覆盖 = 100%；性质测试通过
- [ ] 6 个 fixture 在 dev/ SPA 中目视渲染正确
- [ ] `docs/api.md` 列出全部 export，每个含签名 + 示例
- [ ] `docs/integration-agentweb.md` 步骤可被新工程师独立完成
- [ ] 在 agentweb 项目内 `pnpm add file:../CodexView`，替换 ChatThread 渲染，agentweb 旧聊天功能无回归
- [ ] README 60 秒上手段落经新读者验证

## 14. 参考实现来源

- Proma：流式平滑、工具短语+图标+颜色三位一体、Jotai reducer 模式（[Proma packages/ui/src/hooks/useSmoothStream.ts](file:///Users/maxazure/Projects/Proma/packages/ui/src/hooks/useSmoothStream.ts)、[Proma apps/electron/src/renderer/components/chat/ChatToolBlock.tsx](file:///Users/maxazure/Projects/Proma/apps/electron/src/renderer/components/chat/ChatToolBlock.tsx)）
- Vercel AI SDK UI：parts[] 模型、useChat status 状态机、tool 4 态
- assistant-ui：makeAssistantToolUI 注册机制、ToolGroup / ToolFallback
- LangGraph agent-chat-ui：「输入展开 / 输出折叠」不对称默认、JSON 截断
- Aider / Continue.dev：read/write 工具二分配色、git-diff 视觉复用
- Claude Code：reasoning 独立块默认折叠的行业惯例
- AgentWeb 现有实现（[backend/src/codex/eventMap.ts](file:///Users/maxazure/Projects/agentweb/backend/src/codex/eventMap.ts)、[backend/src/codex/codexChatRunner.ts](file:///Users/maxazure/Projects/agentweb/backend/src/codex/codexChatRunner.ts)、[frontend/src/codex/components/StreamingBubble.tsx](file:///Users/maxazure/Projects/agentweb/frontend/src/codex/components/StreamingBubble.tsx)）
