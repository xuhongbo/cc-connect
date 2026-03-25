import { loadEnv, type AppConfig } from '../config/env.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { createDiscordClientContext, type DiscordClientContext } from '../discord/client.js';
import { registerCommands } from '../discord/commands/register.js';
import { createSessionManager, type SessionManager } from '../sessions/session-manager.js';
import { restoreStartupState, type StartupRecoveryState } from '../sessions/recovery.js';
import { createAgentsManager, type AgentsManager } from '../agents/manager.js';
import { openStorage, type StorageHandle } from '../storage/db.js';

export interface BootstrapOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  logger?: Logger;
}

export interface BootstrapResult {
  config: AppConfig;
  logger: Logger;
  discord: DiscordClientContext;
  sessions: SessionManager;
  agents: AgentsManager;
  storage: StorageHandle;
  recovery: StartupRecoveryState;
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<BootstrapResult> {
  const config = loadEnv(options.env);
  const logger = options.logger ?? createLogger(config.logLevel);
  const storage = await openStorage({ dataDir: config.dataDir });
  const discord = createDiscordClientContext(config, logger);
  const sessions = createSessionManager();
  const agents = createAgentsManager();
  const recovery = await restoreStartupState({ storage });

  for (const snapshot of recovery.lastTurns) {
    sessions.setLastTurnSnapshot(snapshot);
  }

  await registerCommands(discord);

  logger.info('boot ok', {
    guildId: config.discordGuildId,
    dataDir: config.dataDir,
    logLevel: config.logLevel,
    recoveredProjects: recovery.projects.length,
    recoveredThreads: recovery.threads.length,
    interruptedThreads: recovery.interruptedThreadRecordIds.length,
  });

  return { config, logger, discord, sessions, agents, storage, recovery };
}
