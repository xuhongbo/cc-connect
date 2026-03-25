# Discord-Only Docs Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已确认的 Discord-only 重构方向正式落盘到 `AGENTS.md` 与 `docs/`，形成长期目标、一期开发边界、路线图和代理运行约束。

**Architecture:** 先补齐文档体系，再让后续实现围绕同一套目标推进。文档分为五层：开发总约束、长期愿景、一期架构、阶段路线图、代理运行差异说明，避免后续开发偏离方向。

**Tech Stack:** Markdown、仓库现有 `AGENTS.md`、`docs/`

---

## Chunk 1: 文档结构与命名

### Task 1: 确认落盘路径与文档职责

**Files:**
- Modify: `AGENTS.md`
- Create: `docs/discord-only-vision.md`
- Create: `docs/discord-only-architecture-phase1.md`
- Create: `docs/discord-only-roadmap.md`
- Create: `docs/discord-only-agent-runtime-notes.md`
- Create: `docs/discord-only-agentcord-comparison.md`
- Create: `references/agentcord/REFERENCE_NOTES.md`

- [ ] **Step 1: 检查现有文档目录与命名风格**

Run: `find docs -maxdepth 2 -type f | sort | sed -n '1,220p'`
Expected: 看到现有 `docs/` 与 `docs/plans/` 结构，确认新文档可直接放入 `docs/`

- [ ] **Step 2: 明确每份新文档的职责边界**

结果要求：
- `AGENTS.md`：分支级总约束
- `docs/discord-only-vision.md`：长期产品目标
- `docs/discord-only-architecture-phase1.md`：一期工程架构
- `docs/discord-only-roadmap.md`：阶段路线图
- `docs/discord-only-agent-runtime-notes.md`：代理运行差异与约束

- [ ] **Step 3: 提交前自检文档职责没有重叠失控**

检查点：
- 愿景文档讲“为什么”
- 架构文档讲“怎么做”
- 路线图讲“先后顺序”
- 代理说明讲“哪些差异不能抹平”

## Chunk 2: 长期愿景与一期架构

### Task 2: 写长期产品愿景文档

**Files:**
- Create: `docs/discord-only-vision.md`

- [ ] **Step 1: 写入问题背景与目标产品定义**

必须覆盖：
- 为什么不再做多平台
- 为什么频道=项目、线程=会话
- 为什么一个线程只绑定一个代理
- 为什么保留本地 CLI 驱动

- [ ] **Step 2: 写入明确的不做项**

必须覆盖：
- 不做多平台兼容
- 不在一期做语音、定时任务、管理后台等

- [ ] **Step 3: 自检与已确认设计一致**

检查点：
- 没有把 Discord 写回“仅仅一个平台适配器”
- 没有把代理层写成统一云端网关

### Task 3: 写一期架构文档

**Files:**
- Create: `docs/discord-only-architecture-phase1.md`

- [ ] **Step 1: 写模块化单体架构**

必须覆盖：
- `discord`
- `app`
- `sessions`
- `agents`
- `storage`

- [ ] **Step 2: 写核心数据模型**

必须覆盖：
- `Project`
- `ConversationThread`
- `AgentSessionBinding`
- `RuntimeState`
- `LastTurnSnapshot`

- [ ] **Step 3: 写消息流、流式回复、恢复机制**

必须覆盖：
- 项目频道创建线程
- 线程内消息驱动代理
- 一条主预览消息持续编辑
- 重启后懒恢复代理会话

## Chunk 3: 路线图与代理运行说明

### Task 4: 写阶段路线图文档

**Files:**
- Create: `docs/discord-only-roadmap.md`

- [ ] **Step 1: 写 Phase 1 到 Phase 4**

必须覆盖：
- Phase 1：核心闭环
- Phase 2：管理能力增强
- Phase 3：自动化
- Phase 4：管理后台与扩展

- [ ] **Step 2: 为每个阶段写完成定义与不做项**

检查点：
- 第一阶段边界要严格
- 后续阶段目标要清晰可追踪

### Task 5: 写代理运行说明文档

**Files:**
- Create: `docs/discord-only-agent-runtime-notes.md`

- [ ] **Step 1: 写 Claude / Codex / Gemini 差异**

必须覆盖：
- Claude 长驻进程
- Codex 每轮恢复
- Gemini 每轮恢复

- [ ] **Step 2: 写附件注入、恢复、超时与错误处理约束**

必须覆盖：
- 图片/文件先落盘
- 会话 id 单独持久化
- 恢复失败时的降级动作

## Chunk 4: 更新 AGENTS.md

### Task 6: 在 AGENTS.md 增加 Discord-only 分支约束

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: 增加 Discord-only reboot 章节**

必须覆盖：
- 分支定位
- 固定产品模型
- 代理运行原则
- Phase 1 范围
- 明确不做项

- [ ] **Step 2: 加入文档引用**

必须列出：
- `docs/discord-only-vision.md`
- `docs/discord-only-architecture-phase1.md`
- `docs/discord-only-roadmap.md`
- `docs/discord-only-agent-runtime-notes.md`

## Chunk 5: 收尾校对

### Task 7: 校对与一致性检查

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/discord-only-vision.md`
- Modify: `docs/discord-only-architecture-phase1.md`
- Modify: `docs/discord-only-roadmap.md`
- Modify: `docs/discord-only-agent-runtime-notes.md`

- [ ] **Step 1: 通读全部新文档**

Run: `sed -n '1,260p' AGENTS.md && printf '\n---\n' && for f in docs/discord-only-vision.md docs/discord-only-architecture-phase1.md docs/discord-only-roadmap.md docs/discord-only-agent-runtime-notes.md; do echo "### $f"; sed -n '1,260p' "$f"; echo; done`
Expected: 内容完整、相互不冲突

- [ ] **Step 2: 检查长期目标与一期边界是否混淆**

检查点：
- 一期只做核心闭环
- 长期路线单独放在 roadmap

- [ ] **Step 3: 提交**

```bash
git add AGENTS.md docs/plans/2026-03-25-discord-only-docs-plan.md docs/discord-only-vision.md docs/discord-only-architecture-phase1.md docs/discord-only-roadmap.md docs/discord-only-agent-runtime-notes.md
git commit -m "docs: define discord-only reboot vision and phase 1 architecture"
```
