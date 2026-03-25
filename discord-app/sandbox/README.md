# sandbox

这个目录用于放和真实 Discord 环境联调的脚本。

## 用途

这里的脚本不参与正式产品逻辑，只用于：

- 验证 bot 是否能成功登录
- 验证是否能看到目标 guild / channel
- 验证命令发布与线程创建权限
- 做最小真实环境冒烟测试

## 已有脚本

### `live-discord-smoke.ts`

用当前 `.env` 直接做真实 Discord 冒烟检查。

运行：

```bash
cd discord-app
npm run smoke:discord
```

可选环境变量：

- `DISCORD_TEST_CHANNEL_ID`
  - 指定后会额外检查这个频道是否可访问
- `DISCORD_SMOKE_CREATE_THREAD`
  - 设为 `true` / `1` 时，会在测试频道里创建一个临时线程

## 注意

- 这些脚本会连接真实 Discord，不是单元测试
- 如果开启线程创建测试，请确保 bot 有线程相关权限
- 脚本默认尽量只做只读检查；只有显式开启时才会创建线程
