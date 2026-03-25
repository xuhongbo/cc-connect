# agentcord 参考说明

这个目录保存了上游仓库 `agentcord` 的本地参考副本，目的是：

- 研究 `Node + Discord.js` 的组织方式
- 研究流式消息编辑与交互组件
- 研究会话持久化与恢复思路
- 研究代理事件翻译方式

## 重要说明

这个目录**不是**当前项目目标架构的一部分。

请不要把以下内容直接当作我们的最终实现方向：

- 分类 = 项目
- 频道 = 会话
- `tmux` 作为核心会话原语
- 第一阶段全面切换为 SDK 驱动

## 正确使用方式

在引用本目录代码前，请先阅读：

- `docs/discord-only-agentcord-comparison.md`
- `docs/discord-only-architecture-phase1.md`

只有在不违背当前项目固定目标的前提下，才可以选择性借鉴实现细节。
