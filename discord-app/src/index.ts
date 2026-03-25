import { bootstrap } from './app/bootstrap.js';
import { registerCommands } from './discord/commands/register.js';
import { bindDiscordInteractionHandlers } from './discord/client.js';
import { createPermissionActions } from './discord/interactions/permission-actions.js';

void (async () => {
  const app = await bootstrap();
  const permissionActions = createPermissionActions(app.orchestrator);

  bindDiscordInteractionHandlers(app.discord, {
    onInteractionCreate: async (interaction: any) => {
      if (interaction?.isButton?.()) {
        const handled = await permissionActions.handlePermission(interaction.customId);
        if (handled && interaction.reply) {
          await interaction.reply({ content: '已处理权限响应', ephemeral: true });
        }
        return;
      }

      if (interaction?.isChatInputCommand?.()) {
        if (interaction.commandName === 'session') {
          const subcommand = interaction.options?.getSubcommand?.();
          if (subcommand === 'cancel') {
            const threadRecordId = interaction.channelId;
            await permissionActions.cancelThread(threadRecordId);
            if (interaction.reply) {
              await interaction.reply({ content: '已发送取消请求', ephemeral: true });
            }
          }
        }
      }
    },
  });

  await registerCommands(app.discord, { publish: true });
  await app.discord.client.login(app.config.discordToken);
  app.logger.info('discord client logged in', {
    guildId: app.config.discordGuildId,
  });
})();
