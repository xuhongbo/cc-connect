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
