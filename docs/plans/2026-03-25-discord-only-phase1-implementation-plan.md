# Discord-only Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前仓库中新增一个独立的 `Node + Discord.js` 子项目，完成 Discord-only 第一阶段最小可运行闭环：项目频道、单代理线程、本地 CLI 驱动、流式回复、基础持久化与恢复。

**Architecture:** 新实现放在仓库根目录下的 `discord-app/` 子目录中，采用模块化单体。Discord 交互层、会话映射层、代理运行层和存储层分开建模，同时保留当前 Go 仓库与 `references/agentcord/` 作为设计参考，不在第一期直接删除旧实现。

**Tech Stack:** Node.js、TypeScript、discord.js、SQLite（或更轻量持久层包装）、本地 Claude/Codex/Gemini CLI、Vitest

---

## Chunk 1: 项目骨架与基础运行

### Task 1: 创建 `discord-app/` 子项目骨架

**Files:**
- Create: `discord-app/package.json`
- Create: `discord-app/tsconfig.json`
- Create: `discord-app/.gitignore`
- Create: `discord-app/.env.example`
- Create: `discord-app/src/index.ts`
- Create: `discord-app/src/config/env.ts`
- Create: `discord-app/src/utils/logger.ts`

- [ ] **Step 1: 创建最小 Node 项目配置**

内容要求：
- `package.json` 包含 `build`、`dev`、`typecheck`、`test`
- 依赖至少包含 `discord.js`、`dotenv`
- 开发依赖至少包含 `typescript`、`vitest`、`@types/node`

- [ ] **Step 2: 创建 TypeScript 基础配置**

要求：
- 使用 `NodeNext` 或等价的现代 ESM 配置
- 输出目录与源码目录清晰分离

- [ ] **Step 3: 创建环境变量加载模块**

实现：
- 读取 `DISCORD_TOKEN`
- 读取 `DISCORD_CLIENT_ID`
- 读取可选 `DISCORD_GUILD_ID`
- 读取数据目录与日志级别
- 启动时对缺失必填配置报错

- [ ] **Step 4: 创建最小启动入口**

要求：
- 能加载配置
- 能初始化日志
- 暂时只输出“boot ok”级别信息

- [ ] **Step 5: 运行类型检查**

Run: `cd discord-app && npm run typecheck`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add discord-app/package.json discord-app/tsconfig.json discord-app/.gitignore discord-app/.env.example discord-app/src/index.ts discord-app/src/config/env.ts discord-app/src/utils/logger.ts
git commit -m "feat: scaffold discord-only app"
```

### Task 2: 建立基础目录结构与空模块

**Files:**
- Create: `discord-app/src/app/bootstrap.ts`
- Create: `discord-app/src/discord/client.ts`
- Create: `discord-app/src/discord/commands/register.ts`
- Create: `discord-app/src/sessions/session-manager.ts`
- Create: `discord-app/src/agents/manager.ts`
- Create: `discord-app/src/storage/db.ts`

- [ ] **Step 1: 创建模块入口空实现**

要求：
- 每个模块导出最小可调用接口
- 不提前填充复杂逻辑

- [ ] **Step 2: 在 `src/index.ts` 中串起 bootstrap**

要求：
- `index.ts` 只负责调用 `bootstrap`
- 不把业务逻辑堆在入口文件

- [ ] **Step 3: 再次运行类型检查**

Run: `cd discord-app && npm run typecheck`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add discord-app/src/index.ts discord-app/src/app/bootstrap.ts discord-app/src/discord/client.ts discord-app/src/discord/commands/register.ts discord-app/src/sessions/session-manager.ts discord-app/src/agents/manager.ts discord-app/src/storage/db.ts
git commit -m "feat: add discord-only app module skeleton"
```

## Chunk 2: 数据模型与持久化基础

### Task 3: 定义核心领域类型

**Files:**
- Create: `discord-app/src/domain/project.ts`
- Create: `discord-app/src/domain/thread.ts`
- Create: `discord-app/src/domain/session-binding.ts`
- Create: `discord-app/src/domain/runtime-state.ts`
- Create: `discord-app/src/domain/last-turn.ts`
- Test: `discord-app/test/domain-models.test.ts`

- [ ] **Step 1: 写领域类型测试或断言样例**

测试点：
- `Project` 具备 `base_work_dir` 与 `current_work_dir`
- `ConversationThread` 具备 `agent_kind` 与 `status`
- `AgentSessionBinding` 具备 `runtime_kind` 与 `resume_strategy`

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- domain-models.test.ts`
Expected: FAIL，提示模块或导出不存在

- [ ] **Step 3: 写最小领域类型定义**

要求：
- 与 `docs/discord-only-architecture-phase1.md` 中的数据模型一致
- 不添加文档里没有的新花样字段

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- domain-models.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/domain/project.ts discord-app/src/domain/thread.ts discord-app/src/domain/session-binding.ts discord-app/src/domain/runtime-state.ts discord-app/src/domain/last-turn.ts discord-app/test/domain-models.test.ts
git commit -m "feat: define discord-only domain models"
```

### Task 4: 实现最小持久化层

**Files:**
- Modify: `discord-app/src/storage/db.ts`
- Create: `discord-app/src/storage/repositories/projects-repo.ts`
- Create: `discord-app/src/storage/repositories/threads-repo.ts`
- Create: `discord-app/src/storage/repositories/session-bindings-repo.ts`
- Create: `discord-app/src/storage/repositories/runtime-state-repo.ts`
- Create: `discord-app/src/storage/repositories/last-turn-repo.ts`
- Test: `discord-app/test/storage-repositories.test.ts`

- [ ] **Step 1: 写存储层测试**

测试点：
- 能保存并读取 `Project`
- 能保存并读取 `ConversationThread`
- 能保存并读取 `AgentSessionBinding`
- 能更新 `RuntimeState`

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- storage-repositories.test.ts`
Expected: FAIL

- [ ] **Step 3: 选择并实现最小持久化方案**

实现要求：
- 优先 `SQLite`
- 若首轮实现成本过高，可先用一个带清晰仓储接口的文件存储实现，但接口必须为后续 SQLite 替换留好边界
- 提供初始化与迁移入口

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- storage-repositories.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/storage/db.ts discord-app/src/storage/repositories/projects-repo.ts discord-app/src/storage/repositories/threads-repo.ts discord-app/src/storage/repositories/session-bindings-repo.ts discord-app/src/storage/repositories/runtime-state-repo.ts discord-app/src/storage/repositories/last-turn-repo.ts discord-app/test/storage-repositories.test.ts
git commit -m "feat: add persistence repositories for discord-only phase 1"
```

## Chunk 3: Discord 基础接入与项目频道命令

### Task 5: 建立 Discord 客户端与命令注册

**Files:**
- Modify: `discord-app/src/discord/client.ts`
- Modify: `discord-app/src/discord/commands/register.ts`
- Create: `discord-app/src/discord/commands/session.ts`
- Create: `discord-app/src/discord/commands/project.ts`
- Test: `discord-app/test/discord-commands.test.ts`

- [ ] **Step 1: 写命令定义测试/快照**

测试点：
- 注册 `/session`
- 注册 `/project`
- 至少包含 `new`、`status` 子命令

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- discord-commands.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现基础 Discord 客户端与命令注册**

要求：
- 初始化 `discord.js` client
- 注册一阶段最小命令
- 支持可选 guild 级注册

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- discord-commands.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/discord/client.ts discord-app/src/discord/commands/register.ts discord-app/src/discord/commands/session.ts discord-app/src/discord/commands/project.ts discord-app/test/discord-commands.test.ts
git commit -m "feat: register discord-only phase 1 commands"
```

### Task 6: 实现“项目频道 = 项目”的最小入口

**Files:**
- Modify: `discord-app/src/app/bootstrap.ts`
- Create: `discord-app/src/app/router.ts`
- Create: `discord-app/src/app/orchestrator.ts`
- Modify: `discord-app/src/discord/commands/session.ts`
- Test: `discord-app/test/project-channel-routing.test.ts`

- [ ] **Step 1: 写路由测试**

测试点：
- 在项目频道里执行 `/session new` 时，能解析到目标项目
- 不在项目频道时，返回明确错误

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- project-channel-routing.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现最小项目频道路由**

要求：
- 根据 `channel_id` 查 `Project`
- 失败时给出用户可见提示
- 暂不处理线程内部消息

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- project-channel-routing.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/app/bootstrap.ts discord-app/src/app/router.ts discord-app/src/app/orchestrator.ts discord-app/src/discord/commands/session.ts discord-app/test/project-channel-routing.test.ts
git commit -m "feat: route session creation from project channels"
```

## Chunk 4: 线程 = 会话

### Task 7: 实现线程创建与线程记录写入

**Files:**
- Create: `discord-app/src/discord/threads/create-thread.ts`
- Create: `discord-app/src/discord/threads/naming.ts`
- Create: `discord-app/src/discord/ui/labels.ts`
- Create: `discord-app/src/discord/ui/colors.ts`
- Modify: `discord-app/src/app/orchestrator.ts`
- Test: `discord-app/test/thread-creation.test.ts`

- [ ] **Step 1: 写线程创建测试**

测试点：
- 能基于代理类型生成标题前缀
- 能创建线程记录
- 线程记录绑定正确的 `agent_kind`

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- thread-creation.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现线程创建逻辑**

要求：
- 线程标题格式与设计文档一致
- 写入 `ConversationThread`
- 初始化空的 `AgentSessionBinding` 与 `RuntimeState`

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- thread-creation.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/discord/threads/create-thread.ts discord-app/src/discord/threads/naming.ts discord-app/src/discord/ui/labels.ts discord-app/src/discord/ui/colors.ts discord-app/src/app/orchestrator.ts discord-app/test/thread-creation.test.ts
git commit -m "feat: create agent-bound conversation threads"
```

## Chunk 5: 会话层与线程忙碌控制

### Task 8: 实现线程会话映射与忙碌状态

**Files:**
- Modify: `discord-app/src/sessions/session-manager.ts`
- Create: `discord-app/src/sessions/thread-session-map.ts`
- Create: `discord-app/src/sessions/recovery.ts`
- Test: `discord-app/test/session-manager.test.ts`

- [ ] **Step 1: 写会话层测试**

测试点：
- 线程能取回自己的会话绑定
- 忙碌线程拒绝第二个同时输入
- 能更新最后一轮输入快照

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- session-manager.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小会话管理实现**

要求：
- 每线程同一时间只允许一个活跃回合
- 先不做复杂队列
- 保存 `LastTurnSnapshot`

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- session-manager.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/sessions/session-manager.ts discord-app/src/sessions/thread-session-map.ts discord-app/src/sessions/recovery.ts discord-app/test/session-manager.test.ts
git commit -m "feat: add thread session mapping and busy control"
```

## Chunk 6: 代理运行层接口与三代理骨架

### Task 9: 建立代理运行层统一接口

**Files:**
- Create: `discord-app/src/agents/types.ts`
- Create: `discord-app/src/agents/events.ts`
- Modify: `discord-app/src/agents/manager.ts`
- Create: `discord-app/src/agents/base/cli-agent.ts`
- Test: `discord-app/test/agent-types.test.ts`

- [ ] **Step 1: 写代理接口测试**

测试点：
- `AgentAdapter` 暴露统一入口
- `AgentSessionRuntime` 暴露 `send/cancel/close/events`
- 事件类型覆盖 `text/thinking/tool_use/result/error/session_init`

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- agent-types.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现统一接口与事件类型**

要求：
- 上层统一，底层运行模型不强行统一
- 为 `Claude` 的长驻进程型与 `Codex/Gemini` 的每轮恢复型留接口位

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- agent-types.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/agents/types.ts discord-app/src/agents/events.ts discord-app/src/agents/manager.ts discord-app/src/agents/base/cli-agent.ts discord-app/test/agent-types.test.ts
git commit -m "feat: define discord-only agent runtime interfaces"
```

### Task 10: 建立 Claude / Codex / Gemini 运行器骨架

**Files:**
- Create: `discord-app/src/agents/claude/claude-agent.ts`
- Create: `discord-app/src/agents/claude/claude-session.ts`
- Create: `discord-app/src/agents/codex/codex-agent.ts`
- Create: `discord-app/src/agents/codex/codex-session.ts`
- Create: `discord-app/src/agents/gemini/gemini-agent.ts`
- Create: `discord-app/src/agents/gemini/gemini-session.ts`
- Test: `discord-app/test/agent-runtime-skeleton.test.ts`

- [ ] **Step 1: 写代理骨架测试**

测试点：
- `Claude` 标记为长驻进程型
- `Codex` / `Gemini` 标记为每轮恢复型
- 缺少本地 CLI 时返回明确错误

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- agent-runtime-skeleton.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小代理骨架实现**

要求：
- 先不实现完整命令执行
- 先实现 availability check、基础配置与运行模型标记
- 文件注释中明确未来与当前 Go 仓库对应关系

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- agent-runtime-skeleton.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/agents/claude/claude-agent.ts discord-app/src/agents/claude/claude-session.ts discord-app/src/agents/codex/codex-agent.ts discord-app/src/agents/codex/codex-session.ts discord-app/src/agents/gemini/gemini-agent.ts discord-app/src/agents/gemini/gemini-session.ts discord-app/test/agent-runtime-skeleton.test.ts
git commit -m "feat: scaffold claude codex and gemini runtimes"
```

## Chunk 7: 首条真实消息链路

### Task 11: 打通线程内文本消息到代理事件流

**Files:**
- Create: `discord-app/src/discord/message-handler.ts`
- Modify: `discord-app/src/app/router.ts`
- Modify: `discord-app/src/app/orchestrator.ts`
- Modify: `discord-app/src/sessions/session-manager.ts`
- Test: `discord-app/test/thread-message-routing.test.ts`

- [ ] **Step 1: 写消息路由测试**

测试点：
- 线程内文本消息能路由到会话层
- 线程外普通消息不会误入会话执行
- 忙碌线程会返回明确提示

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- thread-message-routing.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现最小消息路由**

要求：
- 仅支持线程内文本消息
- 只打通到代理会话 `send` 调用
- 附件稍后接入

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- thread-message-routing.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/discord/message-handler.ts discord-app/src/app/router.ts discord-app/src/app/orchestrator.ts discord-app/src/sessions/session-manager.ts discord-app/test/thread-message-routing.test.ts
git commit -m "feat: route thread messages into agent sessions"
```

### Task 12: 实现流式预览消息更新器

**Files:**
- Create: `discord-app/src/discord/ui/messages.ts`
- Create: `discord-app/src/discord/ui/embeds.ts`
- Create: `discord-app/src/app/streaming.ts`
- Test: `discord-app/test/streaming-updates.test.ts`

- [ ] **Step 1: 写流式更新测试**

测试点：
- 首次发送创建主预览消息
- 后续事件更新同一条消息
- 完成后移除“处理中”状态
- 错误时更新为错误信息

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- streaming-updates.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现最小流式更新器**

要求：
- 借鉴 `references/agentcord/` 的消息编辑思路，但坚持线程模型
- 节流更新
- 记录 `last_preview_message_id`

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- streaming-updates.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/discord/ui/messages.ts discord-app/src/discord/ui/embeds.ts discord-app/src/app/streaming.ts discord-app/test/streaming-updates.test.ts
git commit -m "feat: add streaming preview updates for thread sessions"
```

## Chunk 8: 附件、恢复与最小验收

### Task 13: 接入图片与文件落盘

**Files:**
- Create: `discord-app/src/utils/files.ts`
- Modify: `discord-app/src/discord/message-handler.ts`
- Modify: `discord-app/src/agents/claude/claude-session.ts`
- Modify: `discord-app/src/agents/codex/codex-session.ts`
- Modify: `discord-app/src/agents/gemini/gemini-session.ts`
- Test: `discord-app/test/attachments.test.ts`

- [ ] **Step 1: 写附件测试**

测试点：
- 文件保存到工作目录附件区
- 图片按代理策略转换为本地引用
- 不把附件处理写进 Discord 层

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- attachments.test.ts`
Expected: FAIL

- [ ] **Step 3: 写最小附件实现**

要求：
- 文件和图片先落盘
- `Codex`、`Gemini`、`Claude` 的适配入口分开保留

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- attachments.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/utils/files.ts discord-app/src/discord/message-handler.ts discord-app/src/agents/claude/claude-session.ts discord-app/src/agents/codex/codex-session.ts discord-app/src/agents/gemini/gemini-session.ts discord-app/test/attachments.test.ts
git commit -m "feat: add attachment staging for local cli agents"
```

### Task 14: 实现启动恢复与中断状态标记

**Files:**
- Modify: `discord-app/src/app/bootstrap.ts`
- Modify: `discord-app/src/sessions/recovery.ts`
- Modify: `discord-app/src/storage/repositories/runtime-state-repo.ts`
- Test: `discord-app/test/recovery.test.ts`

- [ ] **Step 1: 写恢复测试**

测试点：
- 启动时能加载已存在项目、线程、会话绑定
- 处于执行中的线程会被标记为 `interrupted`
- 不会在启动时主动恢复所有代理进程

- [ ] **Step 2: 运行测试确认失败**

Run: `cd discord-app && npm test -- recovery.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现最小恢复逻辑**

要求：
- 恢复逻辑绑定，不恢复真实子进程
- 仅在下一次消息到来时懒恢复代理会话

- [ ] **Step 4: 运行测试确认通过**

Run: `cd discord-app && npm test -- recovery.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add discord-app/src/app/bootstrap.ts discord-app/src/sessions/recovery.ts discord-app/src/storage/repositories/runtime-state-repo.ts discord-app/test/recovery.test.ts
git commit -m "feat: restore logical thread bindings on startup"
```

### Task 15: 写第一阶段验收清单与开发说明

**Files:**
- Modify: `docs/discord-only-architecture-phase1.md`
- Modify: `docs/discord-only-roadmap.md`
- Create: `discord-app/README.md`

- [ ] **Step 1: 在新项目 README 中写运行与阶段边界说明**

必须覆盖：
- 这是 Discord-only 子项目
- 目前是一阶段骨架与闭环实现
- 参考文档位置

- [ ] **Step 2: 确认文档与实现计划一致**

检查点：
- 没有偷做二阶段功能
- 没有被 `references/agentcord/` 带偏到频道会话模型或 SDK 优先路线

- [ ] **Step 3: 提交**

```bash
git add docs/discord-only-architecture-phase1.md docs/discord-only-roadmap.md discord-app/README.md docs/plans/2026-03-25-discord-only-phase1-implementation-plan.md
git commit -m "docs: add discord-only phase 1 implementation plan"
```
