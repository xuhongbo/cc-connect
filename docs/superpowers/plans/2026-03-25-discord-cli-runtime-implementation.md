# Discord CLI Runtime Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `discord-app/` 中把 `Claude`、`Codex`、`Gemini` 三代理从骨架升级为真实本地 CLI 运行层，并接通高保真事件流、权限请求、取消、懒恢复和结构化流式渲染。

**Architecture:** 先收紧运行时接口与统一事件模型，再补共享进程基础设施与附件边界，随后逐个落地三代理解析器和真实会话运行时，最后接入线程 busy 生命周期、状态持久化和 Discord 侧结构化流式消费。整个实现保持 Discord-only 单体结构，不引入多平台抽象，也不强行把三代理抹平成同一种底层过程。

**Tech Stack:** Node.js、TypeScript、Vitest、discord.js、本地 Claude/Codex/Gemini CLI、现有文件持久化仓储

---

## Chunk 1: 运行时契约与回合生命周期

### Task 1: 收紧运行时类型与统一事件模型

**Files:**
- Modify: `discord-app/src/agents/types.ts`
- Modify: `discord-app/src/agents/events.ts`
- Test: `discord-app/test/agent-runtime-contracts.test.ts`

- [ ] **Step 1: 写运行时契约测试**

测试点：
- `AgentAdapter.createSession` 需要接收 `workDir`、`binding`、`project`、`lastTurn`
- `AgentSessionRuntime.events()` 返回统一事件流而不是 `unknown`
- `AgentSessionRuntime` 包含 `respondPermission` 与 `getPendingPermission`
- `AgentRuntimeEvent` 覆盖 `session_init`、`turn_started`、`text_delta`、`text_final`、`thinking`、`tool_use`、`tool_result`、`permission_request`、`permission_resolved`、`turn_completed`、`turn_failed`、`runtime_error`
- `turn_failed.failureKind` 与 `runtime_error.runtimeFailureKind` 分开约束

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- agent-runtime-contracts.test.ts`
Expected: FAIL，提示新接口或新事件类型不存在

- [ ] **Step 3: 写最小类型实现**

要求：
- 直接替换当前宽松的 `unknown` 事件模型
- 在 `events.ts` 中定义判别联合和辅助构造函数
- `AgentRuntimeInput` 先只保留文本、已落盘文件、已落盘图片三类输入
- 不在这一任务里实现真实运行逻辑

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- agent-runtime-contracts.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/agents/types.ts discord-app/src/agents/events.ts discord-app/test/agent-runtime-contracts.test.ts
git commit -m "feat: define runtime contracts for discord cli agents"
```

### Task 2: 修正线程回合语义为事件驱动收尾

**Files:**
- Modify: `discord-app/src/sessions/session-manager.ts`
- Modify: `discord-app/src/discord/message-handler.ts`
- Modify: `discord-app/src/app/orchestrator.ts`
- Test: `discord-app/test/thread-turn-lifecycle.test.ts`

- [ ] **Step 1: 写线程回合生命周期测试**

测试点：
- `send()` 成功返回后线程仍保持 busy
- 只有收到 `turn_completed` / `turn_failed` / `runtime_error` 时才结束回合
- 同一线程事件流只能有一个消费方
- 提交前失败不会进入 busy 中的执行态

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- thread-turn-lifecycle.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小回合生命周期实现**

要求：
- 不再在 `await runtime.send()` 后立即 `finishTurn()`
- 由 orchestrator 或专门事件泵统一消费事件流
- `SessionManager` 要能追踪“逻辑会话对象”与“当前回合是否已启动”
- 先不做复杂队列

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- thread-turn-lifecycle.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/sessions/session-manager.ts discord-app/src/discord/message-handler.ts discord-app/src/app/orchestrator.ts discord-app/test/thread-turn-lifecycle.test.ts
git commit -m "feat: drive thread turns from runtime events"
```

## Chunk 2: 共享进程基础设施与附件边界

### Task 3: 建立共享进程基础设施

**Files:**
- Create: `discord-app/src/agents/base/process-runner.ts`
- Create: `discord-app/src/agents/base/jsonl-reader.ts`
- Create: `discord-app/src/agents/base/stdin-writer.ts`
- Test: `discord-app/test/process-runner.test.ts`

- [ ] **Step 1: 写共享进程层测试**

测试点：
- 能启动子进程并读取 `stdout` / `stderr`
- `stdin` 写入具备串行保护
- 取消时能结束子进程
- JSON 行读取器能逐行返回结构化内容

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- process-runner.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小共享基础设施实现**

要求：
- 基础层不带代理特定解析逻辑
- 明确谁负责关闭流、谁负责结束进程
- 先提供实现三代理所需的最小能力，不做过度抽象

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- process-runner.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/agents/base/process-runner.ts discord-app/src/agents/base/jsonl-reader.ts discord-app/src/agents/base/stdin-writer.ts discord-app/test/process-runner.test.ts
git commit -m "feat: add shared cli process helpers"
```

### Task 4: 把附件职责从 Discord 层迁到共享附件层

**Files:**
- Create: `discord-app/src/agents/base/attachment-staging.ts`
- Modify: `discord-app/src/discord/message-handler.ts`
- Modify: `discord-app/src/utils/files.ts`
- Test: `discord-app/test/attachment-boundary.test.ts`

- [ ] **Step 1: 写附件职责边界测试**

测试点：
- `message-handler` 只收集原始附件，不直接决定代理输入格式
- 共享附件层统一负责文件名净化、目录策略和落盘
- 运行时拿到的是已落盘文件与图片路径
- `Claude` 后续可在运行时内部把图片再编码成 base64

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- attachment-boundary.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小共享附件层实现**

要求：
- 持久目录沿用 `<workDir>/.cc-connect/attachments/` 与 `<workDir>/.cc-connect/images/`
- 共享层输出统一的 staged file / staged image 结构
- 不在这一任务里处理 Discord UI

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- attachment-boundary.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/agents/base/attachment-staging.ts discord-app/src/discord/message-handler.ts discord-app/src/utils/files.ts discord-app/test/attachment-boundary.test.ts
git commit -m "refactor: centralize attachment staging for cli runtimes"
```

## Chunk 3: 逐代理事件解析器

### Task 5: 实现 Claude 事件解析器与权限状态机

**Files:**
- Create: `discord-app/src/agents/claude/claude-event-parser.ts`
- Test: `discord-app/test/claude-event-parser.test.ts`

- [ ] **Step 1: 写 Claude 解析器测试**

测试点：
- `system(session_id)` -> `session_init`
- `assistant.thinking` -> `thinking`
- `assistant.tool_use` -> `tool_use`
- `assistant.text` -> `text_delta`
- `result` -> `text_final` + `turn_completed`
- `control_request(can_use_tool)` -> `permission_request`
- `control_cancel_request` -> `permission_resolved(decision=cancelled)`
- 单线程同一时刻只允许一个 pending permission

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- claude-event-parser.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小 Claude 解析器实现**

要求：
- 权限状态机至少覆盖 `running`、`awaiting_permission`、`permission_resolved`、`cancelled`、`timed_out`
- 重复权限响应保持幂等
- 默认超时策略是自动拒绝
- 先不接真实子进程，只实现纯解析与状态推进

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- claude-event-parser.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/agents/claude/claude-event-parser.ts discord-app/test/claude-event-parser.test.ts
git commit -m "feat: add claude event parser and permission state machine"
```

### Task 6: 实现 Codex 与 Gemini 事件解析器

**Files:**
- Create: `discord-app/src/agents/codex/codex-event-parser.ts`
- Create: `discord-app/src/agents/gemini/gemini-event-parser.ts`
- Test: `discord-app/test/codex-event-parser.test.ts`
- Test: `discord-app/test/gemini-event-parser.test.ts`

- [ ] **Step 1: 写 Codex 与 Gemini 解析器测试**

测试点：
- Codex：`thread.started`、`turn.started`、`reasoning`、`agent_message`、`item.started`、`turn.completed`、`turn.failed`
- Codex：工具前把缓冲正文刷成 `thinking`，回合结束前把缓冲正文刷成 `text_final`
- Gemini：`init`、`message(delta=true)`、非 delta `message`、`tool_use`、`tool_result`、`result(status=ok|error)`
- Gemini：非 delta message 在工具前刷 `thinking`，否则刷 `text_final`

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- codex-event-parser.test.ts gemini-event-parser.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小 Codex 与 Gemini 解析器实现**

要求：
- Codex 默认先与 Go 版主语义对齐，不强制输出 `tool_result`
- Gemini 保留 `tool_result`
- 明确 `turn_failed.failureKind` 与 `runtime_error.runtimeFailureKind`

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- codex-event-parser.test.ts gemini-event-parser.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/agents/codex/codex-event-parser.ts discord-app/src/agents/gemini/gemini-event-parser.ts discord-app/test/codex-event-parser.test.ts discord-app/test/gemini-event-parser.test.ts
git commit -m "feat: add codex and gemini event parsers"
```

## Chunk 4: 三代理真实运行时

### Task 7: 落地 Claude 真实长驻运行时

**Files:**
- Modify: `discord-app/src/agents/claude/claude-session.ts`
- Modify: `discord-app/src/agents/claude/claude-agent.ts`
- Test: `discord-app/test/claude-runtime.test.ts`

- [ ] **Step 1: 写 Claude 运行时测试**

测试点：
- 命令包含 `--output-format stream-json`、`--input-format stream-json`、`--permission-prompt-tool stdio`
- 继续最近时包含 `--continue --fork-session`
- 恢复指定会话时包含 `--resume <sessionId>`
- 过滤 `CLAUDECODE` 环境变量
- `stdin` 写入成功后发出 `turn_started`
- 权限响应会回写 `control_response`
- 关闭超时后会进入强制终止路径

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- claude-runtime.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小 Claude 真实运行时实现**

要求：
- 使用共享进程层
- 集成 Claude 解析器
- `respondPermission` 真正写回 `stdin`
- 保留 `sessionId` 以支持懒恢复
- 先不做复杂权限 UI，只保证事件与回写链路

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- claude-runtime.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/agents/claude/claude-session.ts discord-app/src/agents/claude/claude-agent.ts discord-app/test/claude-runtime.test.ts
git commit -m "feat: add real claude cli runtime"
```

### Task 8: 落地 Codex 真实运行时

**Files:**
- Modify: `discord-app/src/agents/codex/codex-session.ts`
- Modify: `discord-app/src/agents/codex/codex-agent.ts`
- Test: `discord-app/test/codex-runtime.test.ts`

- [ ] **Step 1: 写 Codex 运行时测试**

测试点：
- 首轮命令走 `codex exec --skip-git-repo-check`
- 恢复轮走 `codex exec resume --skip-git-repo-check <thread_id> ... --json <prompt>`
- 恢复轮不带 `--cd`
- `reasoningEffort` 转成 `-c model_reasoning_effort=...`
- 图片路径转成 `--image <path>`
- 取消会结束当前子进程

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- codex-runtime.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小 Codex 真实运行时实现**

要求：
- 使用共享进程层
- 集成 Codex 解析器
- 首轮与恢复轮命令拼装严格对齐 Go 语义
- 运行时对象长期保留 `thread_id`，但每轮只创建短命子进程

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- codex-runtime.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/agents/codex/codex-session.ts discord-app/src/agents/codex/codex-agent.ts discord-app/test/codex-runtime.test.ts
git commit -m "feat: add real codex cli runtime"
```

### Task 9: 落地 Gemini 真实运行时

**Files:**
- Modify: `discord-app/src/agents/gemini/gemini-session.ts`
- Modify: `discord-app/src/agents/gemini/gemini-agent.ts`
- Test: `discord-app/test/gemini-runtime.test.ts`

- [ ] **Step 1: 写 Gemini 运行时测试**

测试点：
- 命令包含 `--output-format stream-json`
- 恢复轮带 `--resume <chat_id>`
- `yolo` / `auto_edit` / `plan` 能映射到正确参数
- 每轮有独立超时
- 图片与文件通过已落盘路径拼入 prompt
- 取消会结束当前进程

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- gemini-runtime.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小 Gemini 真实运行时实现**

要求：
- 使用共享进程层
- 集成 Gemini 解析器
- 运行时对象长期保留 `chat_id`
- 每轮超时来源要可配置或至少可注入

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- gemini-runtime.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/agents/gemini/gemini-session.ts discord-app/src/agents/gemini/gemini-agent.ts discord-app/test/gemini-runtime.test.ts
git commit -m "feat: add real gemini cli runtime"
```

## Chunk 5: 状态回写、恢复与结构化流式渲染

### Task 10: 同步运行时状态到持久化与恢复链路

**Files:**
- Modify: `discord-app/src/app/orchestrator.ts`
- Modify: `discord-app/src/sessions/session-manager.ts`
- Modify: `discord-app/src/sessions/recovery.ts`
- Modify: `discord-app/src/storage/repositories/session-bindings-repo.ts`
- Modify: `discord-app/src/storage/repositories/runtime-state-repo.ts`
- Test: `discord-app/test/runtime-state-sync.test.ts`

- [ ] **Step 1: 写状态回写与恢复测试**

测试点：
- `session_init` 会更新 `binding.agentSessionId`
- `turn_started` / `turn_completed` / `turn_failed` 会同步 `isBusy` 与 `processState`
- `runtime_error(runtime_broken)` 会把状态写成 `broken`
- 启动恢复只恢复逻辑绑定，不主动重启全部子进程
- 下一轮消息会使用已保存 `sessionId` / `thread_id` / `chat_id` 触发懒恢复

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- runtime-state-sync.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小状态同步实现**

要求：
- 上层通过统一事件流同步 `binding` 与 `runtime state`
- 区分长驻进程型与每轮恢复型状态迁移
- 对 `session_id_invalid` 做清空或作废处理

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- runtime-state-sync.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/app/orchestrator.ts discord-app/src/sessions/session-manager.ts discord-app/src/sessions/recovery.ts discord-app/src/storage/repositories/session-bindings-repo.ts discord-app/src/storage/repositories/runtime-state-repo.ts discord-app/test/runtime-state-sync.test.ts
git commit -m "feat: sync runtime events into persistence and recovery"
```

### Task 11: 把结构化事件接入流式预览与权限交互

**Files:**
- Modify: `discord-app/src/app/streaming.ts`
- Modify: `discord-app/src/discord/ui/messages.ts`
- Modify: `discord-app/src/discord/ui/embeds.ts`
- Modify: `discord-app/src/discord/message-handler.ts`
- Test: `discord-app/test/structured-streaming.test.ts`

- [ ] **Step 1: 写结构化流式渲染测试**

测试点：
- `text_delta` 持续更新主预览正文
- `text_final` 会正确收敛最终正文
- `thinking` 与正文不混排
- `tool_use` / `tool_result` 只显示摘要轨迹
- `permission_request` 可触发权限侧消息状态
- `turn_completed` 移除处理中状态
- `turn_failed` / `runtime_error` 正确收尾错误态

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- structured-streaming.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小结构化流式渲染实现**

要求：
- `app/streaming.ts` 不再只是 `push(delta)`，而要变成结构化事件消费者
- 仍优先维持“单主消息持续编辑”的策略
- 权限侧消息先用最小状态表示，不提前做复杂 Discord 组件系统

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- structured-streaming.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/app/streaming.ts discord-app/src/discord/ui/messages.ts discord-app/src/discord/ui/embeds.ts discord-app/src/discord/message-handler.ts discord-app/test/structured-streaming.test.ts
git commit -m "feat: render structured agent events into discord previews"
```

### Task 12: 全量验证与文档回写

**Files:**
- Modify: `discord-app/README.md`
- Modify: `docs/discord-only-agent-runtime-notes.md`
- Modify: `docs/discord-only-architecture-phase1.md`

- [ ] **Step 1: 更新运行说明与限制**

必须覆盖：
- 三代理真实 CLI 运行模型差异
- `Claude` 权限回填存在 Discord 侧交互依赖
- 懒恢复原则与 `interrupted` 行为
- 当前仍未进入二期管理能力

- [ ] **Step 2: 跑类型检查**

Run: `cd discord-app && npm run typecheck`
Expected: PASS

- [ ] **Step 3: 跑完整测试**

Run: `cd discord-app && npm test`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add discord-app/README.md docs/discord-only-agent-runtime-notes.md docs/discord-only-architecture-phase1.md docs/superpowers/plans/2026-03-25-discord-cli-runtime-implementation.md
git commit -m "docs: record discord cli runtime implementation plan"
```
