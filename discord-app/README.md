# discord-app

`discord-app/` 是仓库里的 Discord-only 子项目。

它承载 reboot 分支的一期实现，目标是把下面这条最小闭环先跑通并保持边界清晰：

> 项目频道 → 单代理线程 → 本地 CLI 会话 → 流式回复 → 持久化与重启后逻辑恢复

## 当前阶段

当前实现定位为**一期核心闭环 + 运行时整合版**：

- 仅面向 Discord
- 仅覆盖 `Claude`、`Codex`、`Gemini` 三类本地 CLI 代理
- 支持文本、图片、文件输入
- 支持线程级会话绑定、运行时事件流、权限审批回路、基础流式预览
- 支持基础持久化、启动恢复与运行时状态同步
- 明确保留各代理不同的运行模型，不把它们抹平成统一云端接口

当前不包含这些二期及后续能力：

- 项目管理面板
- 活跃线程发现与高级筛选
- 定时任务、心跳、自动化轮询
- 管理后台或外部管理接口
- 多平台兼容层

## 本地运行

### 1. 安装依赖

```bash
cd discord-app
npm install
```

### 2. 配置环境变量

复制示例文件：

```bash
cp .env.example .env
```

至少配置：

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`

可选配置：

- `DISCORD_GUILD_ID`
- `DATA_DIR`
- `LOG_LEVEL`

### 3. 常用命令

```bash
npm run dev
npm run build
npm run typecheck
npm test
```

## 参考文档

本子项目的设计边界以仓库根目录文档为准：

- `docs/discord-only-vision.md`
- `docs/discord-only-architecture-phase1.md`
- `docs/discord-only-roadmap.md`
- `docs/discord-only-agent-runtime-notes.md`
- `docs/discord-only-agentcord-comparison.md`
- `docs/plans/2026-03-25-discord-only-phase1-implementation-plan.md`

## 说明

- `references/agentcord/` 只用于学习 Discord.js 组织方式、消息更新模式和持久化思路。
- 本子项目不采用“频道 = 会话”的模型。
- 启动时只恢复逻辑绑定，不会主动重启所有代理进程；真实代理恢复在下一次线程消息到来时懒执行。
- 当前已落地三类本地 CLI 运行时核心文件：
  - `Claude`：长驻进程 + `stdio` + 权限回写
  - `Codex`：每轮子进程 + `resume <thread_id>`
  - `Gemini`：每轮子进程 + `--resume <chat_id>`
- 当前共享附件目录为：
  - `.cc-connect/attachments/`
  - `.cc-connect/images/`


## 真实 Discord 联调

如果 `.env` 已配置好 Discord 凭据，可直接运行：

```bash
cd discord-app
npm run smoke:discord
```

如果还要验证线程创建权限：

```bash
DISCORD_TEST_CHANNEL_ID=<文本频道ID> DISCORD_SMOKE_CREATE_THREAD=true npm run smoke:discord
```

当前已验证 bot 侧可完成：登录、列出频道、读取已注册命令、检查测试频道关键权限、创建测试线程、在线程发消息、归档线程。
