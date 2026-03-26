import { describe, expect, it, vi } from 'vitest';
import { GatewayIntentBits } from 'discord.js';

import { createDiscordClient } from '../src/discord/client.js';
import { buildCommandDefinitions } from '../src/discord/commands/register.js';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import { handleProjectCommand } from '../src/discord/commands/handlers/project-handler.js';
import { handleSessionCommand } from '../src/discord/commands/handlers/session-handler.js';

describe('discord client', () => {
  it('creates a client with guild and message intents', () => {
    const config = loadEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'client',
    });

    const client = createDiscordClient(config, createLogger('info'));

    expect(client.options.intents).toBeDefined();
    const intents = client.options.intents;
    expect(Number(intents)).toBe(GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages | GatewayIntentBits.MessageContent);
  });
});

describe('command definitions', () => {
  it('builds session and project commands with required subcommands', () => {
    const commands = buildCommandDefinitions();
    const asJson = commands.map((command) => command.toJSON());

    const session = asJson.find((command) => command.name === 'session');
    const project = asJson.find((command) => command.name === 'project');

    expect(session).toBeDefined();
    expect(project).toBeDefined();
    expect(session?.options?.map((option: { name: string }) => option.name)).toEqual(
      expect.arrayContaining(['new', 'status', 'cancel', 'retry', 'restart', 'list']),
    );
    const sessionNew = (session?.options ?? []).find((option: any) => option.name === 'new') as { options?: Array<{ name: string }> } | undefined;
    expect(sessionNew?.options?.map((option: { name: string }) => option.name)).toEqual(
      expect.arrayContaining(['agent', 'title']),
    );
    expect(project?.options?.map((option: { name: string }) => option.name)).toEqual(
      expect.arrayContaining(['status']),
    );
  });
});

describe('command handlers', () => {
  it('replies with project status when the channel is bound to a project', async () => {
    const project = {
      name: 'Demo',
      defaultAgent: 'claude',
      currentWorkDir: '/workspace',
    };
    const app = {
      repos: {
        projects: {
          getByChannelId: vi.fn(async () => project),
        },
      },
    } as any;
    const interaction = {
      channelId: 'project-channel',
      options: {
        getSubcommand: () => 'status',
      },
    } as any;
    const replyOnce = vi.fn(async () => {});

    await handleProjectCommand({ app, interaction, replyOnce });

    expect(replyOnce).toHaveBeenCalledWith('项目：Demo\n默认代理：claude\n目录：/workspace');
  });

  it('replies that the project channel is missing when no project is found', async () => {
    const app = {
      repos: {
        projects: {
          getByChannelId: vi.fn(async () => null),
        },
      },
    } as any;
    const interaction = {
      channelId: 'project-channel',
      options: {
        getSubcommand: () => 'status',
      },
    } as any;
    const replyOnce = vi.fn(async () => {});

    await handleProjectCommand({ app, interaction, replyOnce });

    expect(replyOnce).toHaveBeenCalledWith('当前频道尚未配置为项目频道');
  });

  it('reports a missing session when the thread is unknown', async () => {
    const app = {
      repos: {
        threads: {
          getByThreadId: vi.fn(async () => null),
        },
      },
    } as any;
    const replyOnce = vi.fn(async () => {});
    await handleSessionCommand({
      app,
      permissionActions: { cancelThread: vi.fn(async () => {}) } as any,
      interaction: {
        channelId: 'thread-1',
        options: {
          getSubcommand: () => 'status',
        },
      } as any,
      replyOnce,
    });

    expect(replyOnce).toHaveBeenCalledWith('当前线程未绑定会话');
  });

  it('invokes permission cancellation when the cancel subcommand is used', async () => {
    const record = { id: 'thread-42' };
    const cancelThread = vi.fn(async () => {});
    const app = {
      repos: {
        threads: {
          getByThreadId: vi.fn(async () => record),
        },
      },
    } as any;
    const replyOnce = vi.fn(async () => {});

    await handleSessionCommand({
      app,
      permissionActions: { cancelThread } as any,
      interaction: {
        channelId: 'thread-42',
        options: {
          getSubcommand: () => 'cancel',
        },
      } as any,
      replyOnce,
    });

    expect(cancelThread).toHaveBeenCalledWith(record.id);
    expect(replyOnce).toHaveBeenCalledWith('已发送取消请求');
  });
});
