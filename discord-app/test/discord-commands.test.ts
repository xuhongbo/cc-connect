import { describe, expect, it } from 'vitest';
import { GatewayIntentBits } from 'discord.js';

import { createDiscordClient } from '../src/discord/client.js';
import { buildCommandDefinitions } from '../src/discord/commands/register.js';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';

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
