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
- 图片：作为 base64 内容块发送，同时可保留本地落盘副本
- 文件：先落盘，再将文件路径追加到提示中，供 CLI 工具读取

### 输出事件

重点映射：

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

### 取消与关闭

- `cancel`：停止当前回合，必要时中断进程或发控制消息
- `close`：优雅结束进程，超时后强杀

### 恢复

- 使用持久化的 `sessionId`
- 下一轮消息到来时重建进程并带上恢复参数
- 启动时不恢复旧进程对象

---

## 5.2 Codex

### 运行模型

沿用 Go 版 `cc-connect` 现有方式：

- 每轮启动新子进程
- 首轮使用 `codex exec`
- 后续使用 `codex exec resume <thread_id>`

### 输入方式

- 文本：作为命令末尾提示词传入
- 图片：先落盘，再以 `--image <path>` 传入
- 文件：先落盘，再把本地文件引用拼到提示词中

### 输出事件

从 JSON 行事件中映射：

- `thread.started` -> `session_init`
- `turn.started` -> `turn_started`
- `reasoning` -> `thinking`
- `agent_message` -> `text_delta` / `text_final`
- `command_execution` / `function_call` / 搜索类项目 -> `tool_use`
- 工具输出摘要 -> `tool_result`
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
- 图片 / 文件：先落盘，再以文件引用方式拼入提示

### 输出事件

从 JSON 流映射：

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

---

## 6. 会话绑定与恢复设计

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

### 8.3 权限请求超时

对 `Claude`：

- 等待用户操作期间线程保持忙碌
- 若超时，可自动拒绝或将状态切为等待用户重试
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

