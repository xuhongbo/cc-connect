import { spawnSync } from 'node:child_process';

import { loadEnv, type AppConfig } from '../config/env.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { createDiscordClientContext, type DiscordClientContext } from '../discord/client.js';
import { registerCommands } from '../discord/commands/register.js';
import { createOrchestrator, type Orchestrator } from './orchestrator.js';
import { createRuntimeEventPump, type RuntimeEventPump } from './runtime-event-pump.js';
import { createSessionManager, type SessionManager } from '../sessions/session-manager.js';
import { restoreStartupState, type StartupRecoveryState } from '../sessions/recovery.js';
import { createAgentsManager, type AgentsManager } from '../agents/manager.js';
import { openStorage, type StorageHandle } from '../storage/db.js';
import { createProjectsRepo } from '../storage/repositories/projects-repo.js';
import { createThreadsRepo } from '../storage/repositories/threads-repo.js';
import { createSessionBindingsRepo } from '../storage/repositories/session-bindings-repo.js';
import { createRuntimeStateRepo } from '../storage/repositories/runtime-state-repo.js';
import { createClaudeAdapter } from '../agents/claude/claude-agent.js';
import { createCodexAdapter } from '../agents/codex/codex-agent.js';
import { createGeminiAdapter } from '../agents/gemini/gemini-agent.js';

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
  orchestrator: Orchestrator;
  eventPump: RuntimeEventPump;
  repos: {
    projects: ReturnType<typeof createProjectsRepo>;
    threads: ReturnType<typeof createThreadsRepo>;
    bindings: ReturnType<typeof createSessionBindingsRepo>;
    runtimeStates: ReturnType<typeof createRuntimeStateRepo>;
  };
  recovery: StartupRecoveryState;
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<BootstrapResult> {
  const config = loadEnv(options.env);
  const logger = options.logger ?? createLogger(config.logLevel);
  const storage = await openStorage({ dataDir: config.dataDir });
  const discord = createDiscordClientContext(config, logger);
  const sessions = createSessionManager();
  const agents = createAgentsManager();
  const repos = {
    projects: createProjectsRepo(storage),
    threads: createThreadsRepo(storage),
    bindings: createSessionBindingsRepo(storage),
    runtimeStates: createRuntimeStateRepo(storage),
  };
  const orchestrator = createOrchestrator({
    threadsRepo: repos.threads,
    bindingsRepo: repos.bindings,
    runtimeStateRepo: repos.runtimeStates,
    sessions,
  });
  const eventPump = createRuntimeEventPump(sessions, {
    onEvent: (threadRecordId, event) => orchestrator.syncRuntimeEvent(threadRecordId, event),
  });
  const recovery = await restoreStartupState({ storage });

  for (const snapshot of recovery.lastTurns) {
    sessions.setLastTurnSnapshot(snapshot);
  }

  const hasBinary = (name: string): Promise<boolean> =>
    Promise.resolve(
      spawnSync('zsh', ['-lc', `command -v ${shellEscape(name)} >/dev/null 2>&1`], {
        stdio: 'ignore',
      }).status === 0,
    );

  agents.register(createClaudeAdapter({ hasBinary }));
  agents.register(createCodexAdapter({ hasBinary }));
  agents.register(createGeminiAdapter({ hasBinary, timeoutMs: 30_000 }));

  await registerCommands(discord);

  logger.info('boot ok', {
    guildId: config.discordGuildId,
    dataDir: config.dataDir,
    logLevel: config.logLevel,
    recoveredProjects: recovery.projects.length,
    recoveredThreads: recovery.threads.length,
    interruptedThreads: recovery.interruptedThreadRecordIds.length,
  });

  return { config, logger, discord, sessions, agents, storage, orchestrator, eventPump, repos, recovery };
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
