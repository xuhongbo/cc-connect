import { REST, Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { DiscordClientContext } from '../client.js';
import { buildProjectCommand } from './project.js';
import { buildSessionCommand } from './session.js';

export function buildCommandDefinitions() {
  return [buildSessionCommand(), buildProjectCommand()];
}

export async function registerCommands(
  context: DiscordClientContext,
  options: { publish?: boolean } = {},
): Promise<RESTPostAPIChatInputApplicationCommandsJSONBody[]> {
  const definitions = buildCommandDefinitions().map((command) => command.toJSON());

  if (!options.publish) {
    return definitions;
  }

  const rest = new REST({ version: '10' }).setToken(context.config.discordToken);
  if (context.config.discordGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(context.config.discordClientId, context.config.discordGuildId),
      { body: definitions },
    );
  } else {
    await rest.put(
      Routes.applicationCommands(context.config.discordClientId),
      { body: definitions },
    );
  }

  return definitions;
}
