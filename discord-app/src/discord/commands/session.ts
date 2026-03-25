import { SlashCommandBuilder, type SlashCommandSubcommandBuilder } from 'discord.js';

export function buildSessionCommand() {
  return new SlashCommandBuilder()
    .setName('session')
    .setDescription('Manage Discord-only session threads')
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName('new')
        .setDescription('Create a new agent thread'),
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName('status')
        .setDescription('Show the current thread session status'),
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName('cancel')
        .setDescription('Cancel the current running turn'),
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName('retry')
        .setDescription('Retry the last user turn'),
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName('restart')
        .setDescription('Restart the bound agent session'),
    )
    .addSubcommand((subcommand: SlashCommandSubcommandBuilder) =>
      subcommand
        .setName('list')
        .setDescription('List known session threads for this project'),
    );
}
