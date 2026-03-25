import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { DiscordClientContext } from '../client.js';
import { buildProjectCommand } from './project.js';
import { buildSessionCommand } from './session.js';

export function buildCommandDefinitions() {
  return [buildSessionCommand(), buildProjectCommand()];
}

export async function registerCommands(_context: DiscordClientContext): Promise<RESTPostAPIChatInputApplicationCommandsJSONBody[]> {
  return buildCommandDefinitions().map((command) => command.toJSON());
}
