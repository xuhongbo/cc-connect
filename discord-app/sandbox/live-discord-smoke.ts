import 'dotenv/config';

import { ChannelType } from 'discord.js';

import { loadEnv } from '../src/config/env.js';
import { createDiscordClient } from '../src/discord/client.js';
import { createLogger } from '../src/utils/logger.js';

async function main() {
  const config = loadEnv(process.env);
  const logger = createLogger(config.logLevel);
  const client = createDiscordClient(config, logger);

  await client.login(config.discordToken);

  try {
    console.log('已登录 Discord');
    console.log(`bot 用户: ${client.user?.tag ?? 'unknown'}`);
    console.log(`client id: ${config.discordClientId}`);

    if (!config.discordGuildId) {
      console.log('未配置 DISCORD_GUILD_ID，跳过 guild 级检查');
      return;
    }

    const guild = await client.guilds.fetch(config.discordGuildId);
    console.log(`guild: ${guild.name} (${guild.id})`);

    const channels = await guild.channels.fetch();
    const visibleChannels = channels
      .filter((channel) => Boolean(channel))
      .map((channel) => channel!)
      .sort((a, b) => a.rawPosition - b.rawPosition);

    console.log('可见频道：');
    for (const channel of visibleChannels.slice(0, 20)) {
      console.log(`- ${channel.name} [${channel.type}] (${channel.id})`);
    }

    const testChannelId = process.env.DISCORD_TEST_CHANNEL_ID?.trim() ?? '';
    if (!testChannelId) {
      console.log('未配置 DISCORD_TEST_CHANNEL_ID，跳过频道级联调');
      return;
    }

    const rawChannel = await client.channels.fetch(testChannelId);
    if (!rawChannel) {
      throw new Error(`找不到测试频道：${testChannelId}`);
    }

    console.log(`测试频道: ${rawChannel.id} (${rawChannel.type})`);

    const shouldCreateThread = ['1', 'true', 'yes'].includes(
      (process.env.DISCORD_SMOKE_CREATE_THREAD ?? '').trim().toLowerCase(),
    );

    if (!shouldCreateThread) {
      console.log('未开启线程创建冒烟，结束');
      return;
    }

    if (rawChannel.type !== ChannelType.GuildText && rawChannel.type !== ChannelType.GuildAnnouncement) {
      throw new Error('当前测试频道不支持文本线程创建，请使用普通文本频道');
    }

    const thread = await rawChannel.threads.create({
      name: `smoke-${Date.now()}`,
      autoArchiveDuration: 60,
      reason: 'cc-connect discord smoke test',
    });

    console.log(`已创建线程: ${thread.name} (${thread.id})`);

    await thread.send('cc-connect smoke test');
    console.log('已在线程内发送测试消息');

    await thread.setArchived(true, 'cc-connect discord smoke test cleanup');
    console.log('已归档测试线程');
  } finally {
    await client.destroy();
  }
}

main().catch((error) => {
  console.error('Discord 冒烟测试失败');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
