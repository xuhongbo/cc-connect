# discord-app

`discord-app/` 是仓库里的 Discord-only 子项目。

它承载 reboot 分支的一期实现，目标是把下面这条最小闭环先跑通并保持边界清晰：

> 项目频道 → 单代理线程 → 本地 CLI 会话 → 流式回复 → 持久化与重启后逻辑恢复

## 当前阶段

当前实现定位为**一期骨架 + 最小闭环**：

- 仅面向 Discord
- 仅覆盖 `Claude`、`Codex`、`Gemini` 三类本地 CLI 代理
- 支持文本、图片、文件输入的最小接线
- 支持线程级会话绑定、流式预览更新、基础持久化与启动恢复
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
