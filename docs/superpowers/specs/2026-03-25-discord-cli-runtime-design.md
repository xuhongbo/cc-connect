# Discord CLI Runtime Design

**Date:** 2026-03-25
**Status:** Draft approved in chat, awaiting written spec review
**Scope:** `discord-app/` 中三代理真实 CLI 运行层、高保真事件流、权限请求、取消与恢复

---

## 1. 背景与目标

当前 `discord-app/` 已具备一期骨架：

- Discord-only 项目模型
- 项目频道到线程的基础路由
- 线程会话映射与忙碌控制
- 最小持久化
- 流式预览骨架
- Claude / Codex / Gemini 三代理骨架

但运行层仍是占位实现，真实 CLI 尚未接入，因此还没有形成“线程消息 → 本地代理 CLI → 高保真事件 → Discord 流式反馈”的真实闭环。

本设计的目标是补上这条链路，并且尽量对齐当前仓库已有 Go 版 `cc-connect` 的三代理语义，而不是重新发明一套与现有系统割裂的模型。

### 本次目标

在 `discord-app/` 中实现：

- `Claude` 长驻进程型会话
- `Codex` 每轮子进程 + `resume` 型会话
- `Gemini` 每轮子进程 + `--resume` 型会话
- 统一的高保真内部事件模型
- 权限请求事件与响应回写
- 取消、关闭、异常退出处理
- 启动后逻辑恢复与下一轮懒恢复

### 明确不在本次完成的内容

- 二期项目管理面板
- 复杂消息卡片与高级线程管理
- 多平台兼容层
- 语音、定时任务、后台接口
- 把三代理强行抹平成同一种底层运行模型

---

## 2. 设计原则

### 2.1 语义对齐优先

实现应尽量贴近现有 Go 版 `cc-connect`：

- `Claude`：长驻进程、`stdio` 双向通信、会话内权限请求
- `Codex`：首轮 `exec`，续轮 `exec resume <thread_id>`
- `Gemini`：每轮子进程，使用 `--resume <chat_id>` 续聊

### 2.2 统一上层事件，不统一底层过程

`discord-app` 上层只消费统一事件接口，但运行时内部保留三代理差异：

- 命令行参数不同
- 会话标识不同
- 附件注入方式不同
- 权限语义不同
- 输出协议不同

### 2.3 高保真先体现在事件而不是界面

优先保证：

- 文本流真实
- 思考态可见
- 工具调用可见
- 权限请求可交互
- 取消和中断可恢复

而不是先做复杂富 UI。

### 2.4 恢复是逻辑恢复，不是启动即拉起所有进程

服务启动时：

- 恢复线程与代理绑定
- 恢复会话标识和上一轮快照
- 标记中断状态
- 不主动恢复全部 CLI 子进程

真正恢复发生在下一轮线程消息到来时。

---

## 3. 目标架构

建议把 `discord-app/src/agents/` 细化为四层。

### 3.1 代理适配器层

文件：

- `src/agents/claude/claude-agent.ts`
- `src/agents/codex/codex-agent.ts`
- `src/agents/gemini/gemini-agent.ts`
- `src/agents/manager.ts`

职责：

- 暴露代理种类与运行模型
- 做本地 CLI 可用性检测
- 根据持久化绑定创建新会话或恢复会话

### 3.2 会话运行时层

文件：

- `src/agents/claude/claude-session.ts`
- `src/agents/codex/codex-session.ts`
- `src/agents/gemini/gemini-session.ts`

职责：

- 真实启动 CLI 进程
- 发送文本、图片、文件输入
- 解析 CLI 输出为内部事件
- 管理存活状态、取消、关闭、恢复标识

### 3.3 进程基础设施层

建议新增：

- `src/agents/base/process-runner.ts`
- `src/agents/base/jsonl-reader.ts`
- `src/agents/base/stdin-writer.ts`

职责：

- 子进程创建与关闭
- `stdout` / `stderr` 读取
- JSON 行流读取
- `stdin` 串行写保护
- 超时与取消辅助

### 3.4 事件映射层

建议新增：

- `src/agents/events.ts`
- `src/agents/claude/claude-event-parser.ts`
- `src/agents/codex/codex-event-parser.ts`
- `src/agents/gemini/gemini-event-parser.ts`

职责：

- 把各家原生输出映射为 `discord-app` 内部统一事件
- 只抽稳定字段
- 其余保留在 `raw` 里

### 3.5 运行时接口定稿

本次实现不再沿用当前宽松的 `createSession(): Promise<AgentSessionRuntime>` + `events(): AsyncIterable<unknown>` 模型，而是直接收紧 `src/agents/types.ts` 与 `src/agents/events.ts`。

需要明确替换为以下能力边界：

#### 适配器接口

```ts
interface CreateAgentSessionInput {
  workDir: string;
  binding: AgentSessionBinding;
  project: Project;
  lastTurn?: LastTurnSnapshot | null;
}

interface AgentAdapter {
  kind: AgentKind;
  runtimeKind: RuntimeKind;
  createSession(input: CreateAgentSessionInput): Promise<AgentSessionRuntime>;
  detectAvailability(): Promise<boolean>;
}
```

#### 运行时接口

```ts
interface AgentSessionRuntime {
  send(input: AgentRuntimeInput): Promise<void>;
  cancel(reason?: string): Promise<void>;
  close(): Promise<void>;
  isBusy(): boolean;
  isAlive(): boolean;
  getSessionId(): string;
  getPendingPermission(): PendingPermissionState | null;
  respondPermission(input: PermissionResponseInput): Promise<void>;
  events(): AsyncIterable<AgentRuntimeEvent>;
}
```

#### `send()` 完成语义

`send()` 在本设计中**只负责把本轮消息成功提交给运行时并启动本轮**，不会阻塞到整轮结束。

这意味着：

- `await runtime.send()` 成功，只表示“本轮已开始”
- 回合真正结束只以事件流中的以下事件为准：
  - `turn_completed`
  - `turn_failed`
  - `runtime_error`
- 上层**不得**在 `await send()` 之后立即调用 `finishTurn()`
- 线程 busy 生命周期由事件驱动，而不是由 `send()` 返回驱动
- `send()` 若在提交前就失败，应直接抛错，且不发 `turn_started`

#### 事件流消费约束

- 每个线程的 `events()` 只允许一个上层消费方
- 由 `app/orchestrator.ts` 或专用事件泵统一消费，再把结果分发到 streaming / persistence / UI
- 禁止多个调用方并发读取同一个运行时事件流

#### 会话对象生命周期

- `Claude`：线程级会话对象长期保留；真实长驻进程断开后，会话对象仍可保留逻辑绑定与 `sessionId`
- `Codex` / `Gemini`：线程级会话对象也长期保留，但每轮内部只启动一个短命子进程；会话对象负责持有 `thread_id` / `chat_id`
- `SessionManager` 保存的是“线程 -> 逻辑会话对象”的映射，而不是“线程 -> 当前进程对象”的弱引用

#### 持久化状态回写责任

运行时本身不直接写仓储，但必须通过事件把这些状态变化暴露给上层：

- `sessionId` 更新
- pending permission 进入 / 离开
- turn 开始 / 完成 / 失败
- 进程损坏或异常退出

由 `app/orchestrator.ts` 或专门的状态同步层负责把这些事件写回 `binding` / `runtime state`。

---

## 4. 统一事件模型

当前 `AgentSessionRuntime.events()` 使用 `unknown`，不够稳定。应改成明确判别联合。

### 4.1 事件种类

至少包含：

- `session_init`
- `turn_started`
- `text_delta`
- `text_final`
- `thinking`
- `tool_use`
- `tool_result`
- `permission_request`
- `permission_resolved`
- `turn_completed`
- `turn_failed`
- `runtime_error`

### 4.2 稳定字段

建议统一字段：

- `kind`
- `sessionId`
- `requestId`
- `toolName`
- `toolInput`
- `content`
- `done`
- `isTransient`
- `raw`
- `timestamp`

### 4.3 不做的统一

不强行统一：

- 每家 CLI 的原始事件名字
- 每家工具事件的所有细节字段
- 每家权限系统的底层机制

这样可以让 `app/streaming.ts` 和 Discord 层只依赖统一事件，而不会直接耦合特定 CLI 输出格式。

### 4.4 判别联合类型约束

后续实现必须把 `src/agents/events.ts` 定成类似下面的结构，而不是继续保留宽松对象：

```ts
type AgentRuntimeEvent =
  | SessionInitEvent
  | TurnStartedEvent
  | TextDeltaEvent
  | TextFinalEvent
  | ThinkingEvent
  | ToolUseEvent
  | ToolResultEvent
  | PermissionRequestEvent
  | PermissionResolvedEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | RuntimeErrorEvent;
```

各事件至少满足：

#### `session_init`
- 必填：`kind`, `sessionId`, `timestamp`
- 含义：运行时确认本轮可用会话标识；用于更新 `binding.agentSessionId`

#### `turn_started`
- 必填：`kind`, `timestamp`
- 含义：当前回合开始；上层将线程标记为 busy

#### `text_delta`
- 必填：`kind`, `content`, `timestamp`
- 含义：流式正文增量；直接用于主预览消息持续追加

#### `text_final`
- 必填：`kind`, `content`, `timestamp`
- 含义：已经判定为最终正文的完整片段；若上层已累积 delta，则按覆盖或追加规则收敛

#### `thinking`
- 必填：`kind`, `content`, `timestamp`
- 含义：思考态文本；不与正文混排

#### `tool_use`
- 必填：`kind`, `toolName`, `timestamp`
- 可选：`toolCallId`, `toolInput`, `raw`
- 含义：工具调用开始

#### `tool_result`
- 必填：`kind`, `timestamp`
- 可选：`toolCallId`, `toolName`, `content`, `isError`, `raw`
- 含义：工具结果摘要。`toolCallId` 在代理原生协议有稳定标识时必须携带；没有时可缺省

#### `permission_request`
- 必填：`kind`, `requestId`, `toolName`, `timestamp`
- 可选：`toolInput`, `raw`
- 含义：运行时请求用户审批；仅 `Claude` 预计会发出

#### `permission_resolved`
- 必填：`kind`, `requestId`, `decision`, `timestamp`
- 含义：一次权限请求已被允许、拒绝、取消或超时
- 生产者：**运行时负责发出**，因为只有运行时知道底层请求是否真正被接收、取消或关闭

#### `turn_completed`
- 必填：`kind`, `timestamp`
- 可选：`sessionId`, `usage`, `done`
- 含义：回合正常结束

#### `turn_failed`
- 必填：`kind`, `timestamp`, `message`, `failureKind`
- 含义：这一轮失败，但运行时不一定损坏

#### `runtime_error`
- 必填：`kind`, `timestamp`, `message`, `runtimeFailureKind`
- 含义：进程层、协议层或解析层错误，可能需要重建运行时

### 4.5 恢复决策分类

为了让上层决定是否保留 `agentSessionId`、是否允许下轮懒恢复，需要额外区分失败种类：

- `recoverable_turn_failure`：本轮失败，但会话标识仍可能有效
- `session_id_invalid`：会话标识失效，下轮不能直接恢复
- `runtime_broken`：进程或协议损坏，需重建运行时
- `transient_warning`：瞬态告警，不应直接打断恢复链路
- `user_denied`：用户拒绝权限
- `user_cancelled`：用户或上层主动取消

`turn_failed` 与 `runtime_error` 必须至少携带其中一种分类，供状态同步层做恢复决策。

#### `turn_failed.failureKind`

- `recoverable_turn_failure`
- `session_id_invalid`
- `user_denied`
- `user_cancelled`

#### `runtime_error.runtimeFailureKind`

- `runtime_broken`
- `transient_warning`

### 4.6 逐代理映射规则样例

#### Claude

原生事件序列：

```text
system -> assistant(text/thinking/tool_use) -> control_request -> result
```

内部事件序列规则：

- `system(session_id)` -> `session_init`
- `assistant.thinking` -> `thinking`
- `assistant.tool_use` -> `tool_use`
- `assistant.text` -> 默认按 `text_delta` 处理
- `result` -> 先发 `text_final`（若 `result.result` 含最终汇总文本），再发 `turn_completed`
- `control_request(can_use_tool)` -> `permission_request`
- `control_cancel_request` -> `permission_resolved(decision=cancelled)`

#### Codex

原生事件序列：

```text
thread.started -> turn.started -> item.started/item.completed -> turn.completed|turn.failed
```

内部事件序列规则：

- `thread.started(thread_id)` -> `session_init`
- `turn.started` -> `turn_started`
- `reasoning` -> `thinking`
- `agent_message` / `message`：
  - 默认先缓冲
  - 若随后进入工具调用，则将当前缓冲刷为 `thinking`
  - 若直到 `turn.completed` 仍未转义，则刷为 `text_final`
- `command_execution` / `function_call` 开始 -> `tool_use`
- `command_execution` / `function_call` 完成：
  - 当前轮先**保持与 Go 版主语义对齐**
  - 默认只发 `tool_use`，不强制发 `tool_result`
  - 若后续实现决定增强 `tool_result`，必须在计划里明确这是有意增强，不是对齐现状
- `turn.completed` -> `turn_completed`
- `turn.failed` -> `turn_failed(failureKind=recoverable_turn_failure)`

#### Gemini

原生事件序列：

```text
init -> message(delta/non-delta) -> tool_use -> tool_result -> result
```

内部事件序列规则：

- `init(session_id)` -> `session_init`
- `message(delta=true)` -> `text_delta`
- 非 delta `message`：
  - 先缓冲
  - 若随后发生 `tool_use`，则将缓冲刷为 `thinking`
  - 若直到 `result` 才结束，则刷为 `text_final`
- `tool_use` -> `tool_use`
- `tool_result` -> `tool_result`
- `result(status=ok)` -> `turn_completed`
- `result(status=error)` -> `turn_failed`

---

## 5. 三代理具体设计

## 5.1 Claude

### 运行模型

沿用 Go 版 `cc-connect` 的思路：

- 长驻进程
- `--output-format stream-json`
- `--input-format stream-json`
- `--permission-prompt-tool stdio`
- 支持新会话、继续最近、恢复指定会话

### 输入方式

- 纯文本：通过 `stdin` 发送 JSON 用户消息
- 图片：从共享附件层提供的已落盘图片路径读取内容，再由 `ClaudeSessionRuntime` 编码成 base64 内容块
- 文件：消费共享附件层提供的已落盘文件路径，并将文件路径追加到提示中，供 CLI 工具读取

### 输出事件

重点映射（以第 4.6 节为唯一规范源）：

- `system` -> `session_init`
- `assistant.text` -> `text_delta` 或 `text_final`
- `assistant.thinking` -> `thinking`
- `assistant.tool_use` -> `tool_use`
- `result` -> `turn_completed`
- `control_request(can_use_tool)` -> `permission_request`
- 进程失败 / stderr -> `runtime_error`

### 权限请求

`Claude` 是唯一需要真正支持“会话中权限回填”的代理：

- 收到 `permission_request`
- Discord 层展示允许 / 拒绝操作
- 用户选择后调用 `RespondPermission`
- 通过 `stdin` 写入 `control_response`

### 权限状态机

`Claude` 需要一套明确的 pending permission 状态机：

- `running`
- `awaiting_permission`
- `permission_resolved`
- `cancelled`
- `timed_out`

约束：

- 单线程同一时刻只允许一个未决权限请求
- 重复点击允许 / 拒绝必须幂等；首次成功响应后，后续点击只返回“已处理”
- 默认超时策略定为：**自动拒绝**
- 收到 `control_cancel_request` 时：
  - 清理运行时内部 pending request
  - 发出 `permission_resolved(decision=cancelled)`
  - 通知 UI 清理按钮或改成已取消态
- 若在 `awaiting_permission` 阶段调用 `cancel()`：
  - 优先取消当前未决权限请求
  - 再把回合状态收敛为 `user_cancelled`

### 权限请求存放位置

- pending permission 状态保存在 `ClaudeSessionRuntime` 内部
- `SessionManager` 不直接保存请求对象，但可通过 `getPendingPermission()` 查询当前线程是否存在未决审批
- UI 层根据 `permission_request` 事件创建交互消息，根据 `permission_resolved` 事件关闭交互态

### 取消与关闭

- `cancel`：停止当前回合，必要时中断进程或发控制消息
- `close`：优雅结束进程，超时后强杀

### 恢复

- 使用持久化的 `sessionId`
- 下一轮消息到来时重建进程并带上恢复参数
- 启动时不恢复旧进程对象

### 命令拼装表

| 场景 | 参数要求 |
|---|---|
| 新会话 | `claude --output-format stream-json --input-format stream-json --permission-prompt-tool stdio` |
| 继续最近 | 额外带 `--continue --fork-session` |
| 恢复指定会话 | 额外带 `--resume <sessionId>` |
| 指定模型 | 额外带 `--model <model>` |
| 指定权限模式 | 额外带 `--permission-mode <mode>` |
| 允许/拒绝工具清单 | 额外带 `--allowedTools ...` / `--disallowedTools ...` |

特殊要求：

- 过滤环境变量 `CLAUDECODE`，避免被 CLI 识别为嵌套会话
- `acceptEdits` / `dontAsk` / `bypassPermissions` 语义应与现有 Go 实现保持一致
- 权限响应通过 `stdin` 写 `control_response`，必须有串行写保护
- `turn_started` 由运行时在“用户输入成功写入 Claude stdin 后”合成发出；若写入失败则直接报错，不发 `turn_started`

---

## 5.2 Codex

### 运行模型

沿用 Go 版 `cc-connect` 现有方式：

- 每轮启动新子进程
- 首轮使用 `codex exec`
- 后续使用 `codex exec resume <thread_id>`

### 输入方式

- 文本：作为命令末尾提示词传入
- 图片：消费共享附件层提供的已落盘图片路径，再以 `--image <path>` 传入
- 文件：消费共享附件层提供的已落盘文件路径，再把本地文件引用拼到提示词中

### 输出事件

从 JSON 行事件中映射（以第 4.6 节为唯一规范源）：

- `thread.started` -> `session_init`
- `turn.started` -> `turn_started`
- `reasoning` -> `thinking`
- `agent_message` 先缓冲；在工具前刷为 `thinking`，在 `turn.completed` 前刷为 `text_final`
- `command_execution` / `function_call` / 搜索类项目 -> `tool_use`
- 默认先不强制发送 `tool_result`
- `turn.completed` -> `turn_completed`
- `turn.failed` -> `turn_failed`
- 进程失败 / stderr -> `runtime_error`

### 权限语义

Codex 不走会话内权限回填，主要由 CLI 模式参数控制。因此：

- 内部事件模型仍保留 `permission_request` 类型
- 但 Codex 适配器一般不会发出该事件
- UI 层不能假设三家都有权限请求

### 取消与恢复

- `cancel`：终止当前子进程
- `resume`：依赖已持久化 `thread_id`

### 命令拼装表

| 场景 | 参数要求 |
|---|---|
| 首轮 | `codex exec --skip-git-repo-check [mode flags] [model flags] [image flags] --json --cd <workDir> <prompt>` |
| 恢复轮 | `codex exec resume --skip-git-repo-check [mode flags] [model flags] <thread_id> [image flags] --json <prompt>` |
| 推理强度 | 使用 `-c model_reasoning_effort=<value>` |
| 图片 | 使用 `--image <path>` |

特殊要求：

- 恢复轮参数顺序必须与现有 Go 实现一致
- 恢复轮**不能带 `--cd`**，由 `cmd.Dir` 负责工作目录
- 模式参数如 `--full-auto` / `--dangerously-bypass-approvals-and-sandbox` 应与现有 Go 语义一致

---

## 5.3 Gemini

### 运行模型

对齐当前 Go 实现：

- 每轮启动新子进程
- 通过 `--resume <chat_id>` 续聊
- 使用 `--output-format stream-json`
- 每轮独立超时，避免挂死

### 输入方式

- 文本：通过 `-p` 传入
- 图片 / 文件：消费共享附件层提供的已落盘路径，再以文件引用方式拼入提示

### 输出事件

从 JSON 流映射（以第 4.6 节为唯一规范源）：

- `init` -> `session_init`
- `message(delta=true)` -> `text_delta`
- 非 delta `message` -> 暂存，按后续事件归类为 `thinking` 或 `text_final`
- `tool_use` -> `tool_use`
- `tool_result` -> `tool_result`
- `result` -> `turn_completed` 或 `turn_failed`
- `error` -> `runtime_error`

### 权限语义

Gemini 与 Codex 类似，权限主要由模式参数控制，不走会话内交互回填。

### 取消与恢复

- `cancel`：终止当前进程
- `resume`：依赖已持久化 `chat_id`
- 失败时允许线程重新绑定或重开

### 命令拼装表

| 场景 | 参数要求 |
|---|---|
| 首轮 | `gemini --output-format stream-json [mode flags] [model flags] -p <prompt>` |
| 恢复轮 | `gemini --output-format stream-json [mode flags] --resume <chat_id> [model flags] -p <prompt>` |
| yolo | `-y` |
| auto_edit | `--approval-mode auto_edit` |
| plan | `--approval-mode plan` |

特殊要求：

- 每轮超时由运行时配置提供，默认值应在配置层明确
- 图片与文件都先转成本地引用再拼入 prompt
- 恢复轮只依赖持久化 `chat_id`，不维持长驻进程状态

---

## 6. 会话绑定与恢复设计

### 6.0 附件职责边界定稿

当前一期代码里 `discord/message-handler.ts` 已经先做了附件落盘，但这与架构文档不完全一致。本次设计明确修正为：

- `discord` / `app` 层：只负责收集原始文本、图片、文件输入
- 新增共享附件处理层：负责文件名净化、目录策略、落盘、临时清理
- 各运行时：只消费“已落盘引用”或“已编码载荷”

也就是说，后续应把当前 `message-handler.ts` 中的直接落盘职责迁移到共享层，而不是继续留在 Discord 层。

#### 目录策略

- 持久附件目录：`<workDir>/.cc-connect/attachments/`
- 持久图片目录：`<workDir>/.cc-connect/images/`
- 临时目录：仅用于必须的短命转换产物，由运行时在回合结束后清理

#### 各代理消费方式

- `Claude`：
  - 图片：消费共享层产出的持久图片路径，并在运行时读取后编码为 base64
  - 文件：消费共享层产出的持久文件路径
- `Codex`：
  - 图片：消费共享层产出的持久图片路径
  - 文件：消费共享层产出的持久文件路径
- `Gemini`：
  - 图片 / 文件：优先消费共享层已落盘路径；若必须生成临时格式，再由运行时负责清理

### 6.1 需要持久化的关键数据

`AgentSessionBinding` 需要可靠记录：

- `agentSessionId`
- `runtimeKind`
- `resumeStrategy`
- `processState`
- `model`
- `mode`
- `reasoningEffort`
- `lastSeenAt`

`RuntimeState` 需要可靠记录：

- `isBusy`
- `lastMessageId`
- `lastPreviewMessageId`
- `lastError`
- `queuedMessageCount`

`LastTurnSnapshot` 继续记录：

- 文本
- 附件引用
- 模型
- 模式
- 代理种类

### 6.2 启动时恢复什么

- 项目
- 线程
- 绑定
- 运行态快照
- 最后一轮输入快照
- 执行中线程的 `interrupted` 状态

### 6.3 启动时不恢复什么

- 不重启所有代理进程
- 不继续上一次未完成的流式输出
- 不假设进程对象仍然有效

### 6.4 下一轮懒恢复

线程收到新消息时：

- `Claude`：带已有 `sessionId` 重建长驻会话
- `Codex`：若有 `thread_id`，走 `resume`
- `Gemini`：若有 `chat_id`，走 `--resume`

若恢复失败：

- 更新线程为明确错误态
- 更新运行态错误信息
- 允许用户重开或重绑线程

### 6.5 状态迁移表

#### 长驻进程型（Claude）

| 时机 | `processState` | 其他回写 |
|---|---|---|
| 创建会话对象，进程未就绪 | `not_started` | 不更新 `agentSessionId` |
| 进程启动成功 | `running` | 刷新 `lastSeenAt` |
| 收到 `session_init` | `running` | 更新 `agentSessionId` |
| `turn_started` | `running` | `isBusy=true` |
| `permission_request` | `running` | 标记 pending permission |
| `turn_completed` | `idle` | `isBusy=false`，刷新 `lastSeenAt` |
| `turn_failed(recoverable_turn_failure)` | `idle` | `isBusy=false`，保留 `agentSessionId` |
| `runtime_error(runtime_broken)` | `broken` | `isBusy=false` |
| 正常关闭 | `exited` | `isBusy=false` |

#### 每轮恢复型（Codex / Gemini）

| 时机 | `processState` | 其他回写 |
|---|---|---|
| 创建逻辑会话对象 | `not_started` | 可已有旧 `agentSessionId` |
| 启动本轮子进程 | `running` | `isBusy=true` |
| 收到 `session_init` | `running` | 更新 `agentSessionId` |
| `turn_completed` | `idle` | `isBusy=false`，刷新 `lastSeenAt` |
| `turn_failed(recoverable_turn_failure)` | `idle` | `isBusy=false`，通常保留 `agentSessionId` |
| `turn_failed(session_id_invalid)` | `idle` | `isBusy=false`，清空或作废 `agentSessionId` |
| `runtime_error(runtime_broken)` | `broken` | `isBusy=false` |
| 主动 `cancel` | `idle` | `isBusy=false`，按错误分类保留或清空 `agentSessionId` |

---

## 7. Discord 消费模型

高保真事件不意味着立刻做复杂 UI。建议先稳定主预览消息模型。

### 7.1 单主消息更新策略

线程内每回合维护一个主预览消息：

- 首次事件创建消息
- 后续事件持续编辑同一条消息
- 完成后写入最终状态
- 错误时切成错误态

### 7.2 各事件如何显示

- `thinking`：显示思考摘要或折叠区
- `text_delta`：持续追加主回答正文
- `tool_use`：记录工具轨迹
- `tool_result`：只展示摘要，避免刷屏
- `permission_request`：额外创建交互消息或按钮
- `turn_completed`：清除处理中状态
- `turn_failed` / `runtime_error`：转成错误展示

### 7.3 状态回写

每次关键状态变更都要更新：

- `last_preview_message_id`
- `isBusy`
- `lastError`
- `processState`
- `agentSessionId`

---

## 8. 取消、错误与边界情况

### 8.1 取消

统一接口保留 `cancel()`，但语义按代理区分：

- `Claude`：尽量中止当前回合，必要时终止长驻进程并标记可恢复状态
- `Codex` / `Gemini`：直接结束当前子进程

### 8.2 错误分类

内部区分两类：

- `turn_failed`：这一轮失败，但会话标识可能仍可恢复
- `runtime_error`：进程层或协议层错误，可能需要重建运行时

但上层恢复决策不能只靠这两个大类，还必须读取第 4.5 节定义的失败分类。

### 8.3 权限请求超时

对 `Claude`：

- 等待用户操作期间线程保持忙碌
- 一期默认超时策略为自动拒绝
- 需要显式记录 pending request id，避免重复响应

### 8.4 异常退出

如果 CLI 进程异常退出：

- 发送 `runtime_error`
- 更新 `processState`
- 若已有会话标识则保留，以便下次懒恢复

---

## 9. 测试策略

必须走测试优先，并覆盖以下层次。

### 9.1 事件模型测试

验证：

- 联合类型收敛正确
- 不同事件字段约束清晰

### 9.2 解析器测试

逐家验证：

- `Claude`：`system`、`assistant`、`control_request`、`result`
- `Codex`：`thread.started`、`turn.started`、`item.started`、`item.completed`、`turn.completed`
- `Gemini`：`init`、`message`、`tool_use`、`tool_result`、`result`

### 9.3 运行时测试

验证：

- 命令拼装
- 恢复参数
- `stdin` 串行写
- 子进程取消
- 超时
- 会话标识更新

### 9.4 恢复测试

验证：

- 启动时不主动重启进程
- 新消息到来时使用已持久化会话标识恢复
- 恢复失败进入错误态

### 9.5 Discord 流式联动测试

验证：

- 事件能驱动同一条主预览消息更新
- 权限请求能触发交互响应链路
- 完成和错误状态能正确收尾

---

## 10. 实施顺序建议

推荐按下面顺序推进：

1. 收紧 `agents/types.ts`，定义统一事件模型
2. 为三家代理补解析器测试
3. 先落地会话运行时命令拼装和会话标识更新
4. 接上取消、关闭和异常退出
5. 再接权限请求回路（重点是 `Claude`）
6. 最后把统一事件接到 `app/streaming.ts` 与 Discord 消息更新

原因：

- 先稳定事件边界，后续代码不容易返工
- 先把三家 CLI 运行模型真实落地，再做 UI 层联动
- 权限回路复杂度最高，放在基础运行链路稳定后处理更稳

### 10.1 对 `streaming.ts` 的明确要求

当前 `app/streaming.ts` 只支持简单 `push(delta)`，后续不能只“接一下事件”，而应升级为结构化事件消费者，至少能处理：

- 正文增量
- 最终正文收敛
- thinking 区域
- 工具轨迹
- 权限侧消息
- 完成收尾
- 失败收尾

---

## 11. 风险与应对

### 风险 1：CLI 输出协议变化

应对：

- 解析器按代理独立文件维护
- 原始事件保留在 `raw`
- 先依赖稳定字段，不耦合全部细节

### 风险 2：过度抽象导致运行语义走样

应对：

- 只统一上层事件
- 不统一底层启动 / 恢复 / 权限模型

### 风险 3：权限请求阻塞线程

应对：

- 引入明确的 pending permission 状态
- 限制同线程单次只处理一个未决权限请求
- 超时后自动收敛到拒绝或错误态

### 风险 4：恢复逻辑与运行时状态不同步

应对：

- 每轮结束与异常退出时都持久化关键状态
- 启动恢复只恢复逻辑绑定，不恢复进程对象

---

## 12. 成功标准

本设计完成后的最小验收标准：

- Discord 线程内发送文本，可真实调用三种本地 CLI
- 三种代理都能输出文本流并更新主预览消息
- `Claude` 的权限请求可在 Discord 中允许 / 拒绝并回写 CLI
- `Codex` / `Gemini` 可使用已保存会话标识恢复下一轮
- 服务重启后执行中线程标记为 `interrupted`
- 下一轮消息触发懒恢复，而不是启动即重拉全部进程
- 错误、取消、异常退出都有明确状态反馈
