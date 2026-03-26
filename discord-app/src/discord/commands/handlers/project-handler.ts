import type { ChatInputCommandInteraction } from 'discord.js';
import type { BootstrapResult } from '../../../app/bootstrap.js';

export interface ProjectCommandHandlerContext {
  app: BootstrapResult;
  interaction: ChatInputCommandInteraction;
  replyOnce: (content: string) => Promise<void>;
}

export async function handleProjectCommand(context: ProjectCommandHandlerContext): Promise<void> {
  const { app, interaction, replyOnce } = context;
  const subcommand = interaction.options?.getSubcommand?.();
  if (subcommand !== 'status') {
    return;
  }

  const project = await app.repos.projects.getByChannelId(interaction.channelId);
  const text = project
    ? [`项目：${project.name}`, `默认代理：${project.defaultAgent}`, `目录：${project.currentWorkDir}`].join('\n')
    : '当前频道尚未配置为项目频道';
  await replyOnce(text);
}
