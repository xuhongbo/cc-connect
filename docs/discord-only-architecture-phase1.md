# Discord-only 一期架构设计

## 一期目标

一期只做一个目标：

> 把 `Discord` 项目频道、单代理线程、本地 `CLI` 会话、流式输出与恢复这条核心闭环做稳。

---

## 总体架构

一期采用**模块化单体**，而不是微服务。

整体分为 5 层：

```text
Discord Client
    ↓
Discord Application Layer
    ↓
Conversation / Session Layer
    ↓
Agent Runtime Layer
    ↓
Persistence Layer
```

### 模块职责

#### `discord`
负责：
- 登录与连接
- 项目频道识别
- 线程创建、回复、更新、归档
- 斜杠命令
- 按钮、下拉、弹窗
- 标签、颜色、嵌入消息

不负责：
- 代理命令拼装
- 会话恢复规则
- 本地状态持久化

#### `app`
负责：
- 从 `Discord` 事件进入业务编排
- 判断项目、线程、代理
- 决定是新会话还是恢复会话
- 驱动代理运行层
- 接收代理事件并回写到 `Discord`

#### `sessions`
负责：
- 线程和代理逻辑会话之间的映射
- 当前线程是否忙碌
- 最后一轮输入快照
- 重启后的逻辑恢复

#### `agents`
负责：
- `Claude` / `Codex` / `Gemini` 运行器
- 本地 `CLI` 启动与恢复
- 图片、文件注入
- 事件解析

#### `storage`
负责：
- 项目
- 线程
- 代理会话绑定
- 运行态快照
- 输入快照
- 基础消息日志

---

## 建议目录结构

```text
src/
  index.ts
  app/
    bootstrap.ts
    router.ts
    orchestrator.ts
    errors.ts

  discord/
    client.ts
    commands/
    interactions/
    threads/
    ui/

  sessions/
    session-manager.ts
    thread-session-map.ts
    session-state.ts
    recovery.ts

  agents/
    manager.ts
    types.ts
    events.ts
    base/
    claude/
    codex/
    gemini/

  storage/
    db.ts
    repositories/
    migrations/

  config/
    env.ts
    projects.ts

  utils/
    logger.ts
    files.ts
    paths.ts
```

---

## 固定交互模型

### 项目频道
项目频道负责：
- 创建新线程
- 查看项目状态
- 查看活跃会话入口

项目频道**不承载长对话**。

### 线程
线程是真正的工作会话空间：
- 用户在线程中发消息、图片、文件
- 线程只绑定一个代理
- 线程中的所有执行状态都与该代理绑定

---

## 核心数据模型

### `Project`

```text
Project
- id
- name
- guild_id
- channel_id
- channel_type
- base_work_dir
- current_work_dir
- default_agent
- default_model
- default_mode
- status
- created_at
- updated_at
```

### `ConversationThread`

```text
ConversationThread
- id
- project_id
- guild_id
- parent_channel_id
- thread_id
- thread_title
- thread_prefix
- agent_kind
- status
- discord_tag_ids
- owner_user_id
- created_from
- created_at
- updated_at
- archived_at
```

### `AgentSessionBinding`

```text
AgentSessionBinding
- id
- thread_record_id
- agent_kind
- agent_session_id
- runtime_kind
- resume_strategy
- cli_bin
- model
- mode
- reasoning_effort
- process_state
- last_seen_at
- created_at
- updated_at
```

### `RuntimeState`

```text
RuntimeState
- thread_record_id
- is_busy
- last_message_id
- last_preview_message_id
- last_error
- queued_message_count
- updated_at
```

### `LastTurnSnapshot`

```text
LastTurnSnapshot
- thread_record_id
- user_message_text
- attachment_refs
- sent_at
- agent_kind
- model
- mode
```

---

## 代理运行层设计

### 核心原则

- 继续直接驱动本地 `CLI`
- 统一上层接口，不统一底层运行模型
- 显式区分：
  - 长驻进程型
  - 每轮恢复型

### `Claude`

- 本地命令：`claude`
- 会话模型：长驻进程
- 关键特征：
  - 双向 `stdio`
  - 持续事件流
  - 权限请求可能发生在会话中

### `Codex`

- 本地命令：`codex`
- 会话模型：每轮重启
- 恢复方式：`resume <thread_id>`
- 特殊字段：`reasoning_effort`

### `Gemini`

- 本地命令：`gemini`
- 会话模型：每轮重启
- 恢复方式：`--resume <chat_id>`
- 必须保留超时控制

---

## 附件处理约束

### 文件

用户上传的文件必须先落盘，再把本地路径传递给代理。

建议目录：

```text
<work_dir>/.discord-agent/files/
```

### 图片

按代理策略处理：

- `Codex`：落盘后通过 `--image`
- `Gemini`：落临时文件后引用
- `Claude`：按其会话输入格式接入

核心原则：

> 附件二进制处理只能发生在代理运行层或其共享工具层，不能散落在 Discord 交互层。

---

## 消息流设计

### 路径 1：项目频道创建线程

1. 用户在项目频道发起 `/session new`
2. 系统识别当前项目
3. 选择代理
4. 创建线程
5. 写入线程记录和空的会话绑定
6. 在线程内发送首条状态消息

### 路径 2：在线程中工作

1. 用户在线程发消息、图片或文件
2. 系统根据 `thread_id` 找到线程记录
3. 找到会话绑定
4. 获取或恢复运行时会话
5. 附件落盘
6. 发送给代理
7. 流式输出回写到当前线程

### 路径 3：异常后重开

用户可执行：

- `/session retry`
- `/session restart`
- `/session cancel`

---

## 流式输出策略

一期固定采用：

- 一条主预览消息
- 持续编辑
- 完成后更新成最终内容

### 推荐节流策略

- 时间阈值：约 `1~2` 秒
- 文本阈值：约 `20~40` 个字符

### 错误时

主预览消息直接更新为错误信息，不再额外制造多条噪音消息。

---

## 持久化与恢复策略

### 启动时恢复什么

- 项目
- 线程
- 会话绑定
- 运行态快照
- 最后一轮输入快照

### 启动时不恢复什么

- 不主动重启所有代理子进程
- 不尝试继续编辑旧流式消息

### 正确恢复方式

> 启动时恢复逻辑绑定；真正的代理恢复，在下一次线程消息到来时懒执行。

### 当前一期实现边界

当前 `discord-app/` 子项目仍按一期最小闭环推进：

- 已落地的重点是线程创建、基础路由、代理骨架、流式预览、附件落盘与启动时逻辑恢复
- 不提前实现二期的项目管理面板、线程发现、项目高级控制
- 不把本地 `CLI` 运行层替换成统一 `SDK` 或云端网关

---

## 线程状态机

一期至少支持：

- `idle`
- `active`
- `error`
- `archived`
- `interrupted`

### 状态流转

- 新线程 → `idle`
- 开始执行 → `active`
- 正常结束 → `idle`
- 异常失败 → `error`
- 重启中断 → `interrupted`
- 手动或自动归档 → `archived`

---

## 一期命令范围

### 项目频道

- `/session new`
- `/session list`
- `/project status`

### 线程内

- `/session status`
- `/session cancel`
- `/session retry`
- `/session restart`
- `/agent model`
- `/agent mode`

---

## 一期明确不做

- 语音
- 定时任务
- 心跳
- 多机器人中继
- Web 管理后台
- 外部管理 API
- 多平台兼容
- 复杂权限系统

---

## 参考实现与已拒绝方案

仓库中已引入参考代码：

```text
references/agentcord/
```

对应决策文档：

- `docs/discord-only-agentcord-comparison.md`

### 明确吸收的内容

- `Node + Discord.js` 工程组织经验
- 流式消息编辑模式
- 会话持久化与恢复意识
- 代理事件翻译层设计

### 明确不采用的内容

- 分类 = 项目、频道 = 会话
- `tmux` 作为核心会话原语
- 第一阶段全面切换到代理 SDK

### 当前阶段决策

一期仍然固定采用：

- 频道 = 项目
- 线程 = 会话
- 一个线程 = 一个代理
- `Claude` / `Codex` / `Gemini` 继续走本地 `CLI`

---

## 一期完成定义

一期只有在同时满足以下条件时才算完成：

1. 可以从项目频道创建 `Claude` / `Codex` / `Gemini` 线程
2. 线程里文本、图片、文件输入稳定可用
3. 代理回复可以流式显示
4. 重启后线程与代理会话绑定不丢
5. `Codex` / `Gemini` 可恢复续聊
6. `Claude` 可通过会话标识恢复
7. 取消、重试、重开命令可用
8. 错误可以明确反馈到线程
