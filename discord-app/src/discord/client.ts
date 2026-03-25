import { Client, GatewayIntentBits } from 'discord.js';
import type { AppConfig } from '../config/env.js';
import type { Logger } from '../utils/logger.js';

export interface DiscordClientContext {
  client: Client;
  config: AppConfig;
  logger: Logger;
}

export function createDiscordClient(config: AppConfig, _logger: Logger): Client {
  return new Client({
    intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages | GatewayIntentBits.MessageContent,
  });
}

export function createDiscordClientContext(config: AppConfig, logger: Logger): DiscordClientContext {
  return {
    client: createDiscordClient(config, logger),
    config,
    logger,
  };
}
