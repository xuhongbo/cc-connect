import 'dotenv/config';
import { bootstrap } from './app/bootstrap.js';
import { registerCommands } from './discord/commands/register.js';
import { bindDiscordInteractionHandlers } from './discord/client.js';
import { handleProjectCommand } from './discord/commands/project.js';
import { handleSessionCommand } from './discord/commands/session.js';
import {
  buildPermissionActionRow,
  buildPermissionResolvedText,
  createPermissionActions,
} from './discord/interactions/permission-actions.js';
import { handleThreadMessage } from './discord/message-handler.js';
import { buildRuntimeErrorText } from './discord/ui/embeds.js';
import { createStreamingPreview } from './app/streaming.js';
import type { AttachmentRef } from './domain/last-turn.js';
import type { Project } from './domain/project.js';
import { buildPermissionStatusMessage } from './discord/ui/messages.js';

void (async () => {
  const app = await bootstrap();
  const permissionActions = createPermissionActions(app.orchestrator);

  bindDiscordInteractionHandlers(app.discord, {
    onInteractionCreate: async (interaction: any) => {
      if (interaction?.isButton?.()) {
        const action = await permissionActions.handlePermission(interaction.customId);
        if (action) {
          const currentContent = String(interaction.message?.content ?? '');
          const toolName = currentContent.replace(/^等待权限确认：/, '') || '工具调用';
          if (interaction.update) {
            await interaction.update({
              content: buildPermissionResolvedText(toolName, action.decision),
              components: [
                buildPermissionActionRow(action.threadRecordId, action.requestId, { disabled: true }),
              ],
            });
          } else if (interaction.reply) {
            await interaction.reply({ content: '已处理权限响应', ephemeral: true });
          }
        }
        return;
      }

      if (interaction?.isChatInputCommand?.()) {
        if (interaction.commandName === 'project') {
          await handleProjectCommand({
            app,
            interaction,
            replyOnce: (content) => replyOnce(interaction, content),
          });
          return;
        }

        if (interaction.commandName === 'session') {
          await handleSessionCommand({
            app,
            permissionActions,
            interaction,
            replyOnce: (content) => replyOnce(interaction, content),
          });
          return;
        }
      }
    },
  });

  app.discord.client.on('messageCreate', async (message: any) => {
    if (message?.author?.bot) {
      return;
    }
    const thread = await app.repos.threads.getByThreadId(message.channelId);
    if (!thread) {
      return;
    }
    const project = await app.repos.projects.getById(thread.projectId);
    if (!project) {
      return;
    }

    const { files, images } = await resolveMessageAttachments(message);
    try {
      let previewStarted = false;
      const preview = createStreamingPreview({
        create: async (content) => {
          const sent = await message.reply?.(content);
          const messageId = sent?.id ?? `${message.channelId}:${Date.now()}`;
          const runtimeState = await app.repos.runtimeStates.getByThreadRecordId(thread.id);
          if (runtimeState) {
            await app.repos.runtimeStates.upsert({
              ...runtimeState,
              lastPreviewMessageId: messageId,
              updatedAt: new Date().toISOString(),
            });
          }
          return {
            messageId,
            content,
          };
        },
        update: async (messageId, content) => {
          const existing = await message.channel?.messages?.fetch?.(messageId).catch(() => null);
          await existing?.edit?.(content);
        },
        throttleMs: 0,
      });

      const result = await handleThreadMessage({
        threadId: message.channelId,
        text: message.content ?? '',
        project,
        workDir: project.currentWorkDir || project.baseWorkDir,
        files,
        images,
        threadsRepo: app.repos.threads,
        bindingsRepo: app.repos.bindings,
        agents: app.agents,
        sessions: app.sessions,
        eventPump: app.eventPump,
        onRuntimeEvent: async (threadRecordId, event) => {
          if (!previewStarted) {
            await preview.start('处理中');
            previewStarted = true;
          }

          if (event.kind === 'permission_request') {
            await message.channel?.send?.({
              content: buildPermissionStatusMessage(event.toolName),
              components: [
                buildPermissionActionRow(threadRecordId, event.requestId),
              ],
            });
          }

          await preview.applyEvent(event);
        },
      });

      if (!result.accepted && result.reason) {
        await message.reply?.(result.reason);
      }
    } catch (error) {
      await message.reply?.(buildRuntimeErrorText(error instanceof Error ? error.message : 'unknown error'));
    }
  });

  await registerCommands(app.discord, { publish: true });
  await app.discord.client.login(app.config.discordToken);
  app.logger.info('discord client logged in', {
    guildId: app.config.discordGuildId,
  });
})();

async function replyOnce(interaction: any, content: string): Promise<void> {
  if (interaction?.replied || interaction?.deferred) {
    await interaction.followUp?.({ content, ephemeral: true });
    return;
  }
  await interaction.reply?.({ content, ephemeral: true });
}

async function resolveMessageAttachments(message: any): Promise<{
  files: Array<{ fileName: string; data: Uint8Array }>;
  images: Array<{ fileName: string; data: Uint8Array; mimeType: string }>;
}> {
  const files: Array<{ fileName: string; data: Uint8Array }> = [];
  const images: Array<{ fileName: string; data: Uint8Array; mimeType: string }> = [];

  const attachments = Array.from(message.attachments?.values?.() ?? []) as Array<{
    url?: string;
    name?: string;
    contentType?: string | null;
  }>;
  for (const attachment of attachments) {
    if (!attachment.url || !attachment.name) {
      continue;
    }
    const response = await fetch(attachment.url);
    const data = new Uint8Array(await response.arrayBuffer());
    if (String(attachment.contentType || '').startsWith('image/')) {
      images.push({
        fileName: attachment.name,
        data,
        mimeType: attachment.contentType || 'image/png',
      });
    } else {
      files.push({
        fileName: attachment.name,
        data,
      });
    }
  }

  return { files, images };
}

function attachmentRefsToRuntimeInput(attachmentRefs: AttachmentRef[]) {
  return {
    files: attachmentRefs
      .filter((ref) => ref.kind === 'file')
      .map((ref) => ({ name: ref.name, originalName: ref.originalName, path: ref.path })),
    images: attachmentRefs
      .filter((ref) => ref.kind === 'image')
      .map((ref) => ({
        name: ref.name,
        originalName: ref.originalName,
        path: ref.path,
        mimeType: ref.mimeType || 'image/png',
      })),
  };
}
