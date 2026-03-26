import { SlashCommandBuilder, type SlashCommandSubcommandBuilder } from 'discord.js';

export function buildProjectCommand() {
  return new SlashCommandBuilder()
    .setName('project')
    .setDescription('Inspect project channel state')
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName('status')
        .setDescription('Show the current project channel status'),
    );
}

export { handleProjectCommand } from './handlers/project-handler.js';
export type { ProjectCommandHandlerContext } from './handlers/project-handler.js';
