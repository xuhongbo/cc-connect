export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppConfig {
  discordToken: string;
  discordClientId: string;
  discordGuildId: string;
  dataDir: string;
  logLevel: LogLevel;
}

export function loadEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): AppConfig {
  const discordToken = env.DISCORD_TOKEN?.trim() ?? '';
  if (!discordToken) {
    throw new Error('DISCORD_TOKEN is required');
  }

  const discordClientId = env.DISCORD_CLIENT_ID?.trim() ?? '';
  if (!discordClientId) {
    throw new Error('DISCORD_CLIENT_ID is required');
  }

  const logLevel = normalizeLogLevel(env.LOG_LEVEL);

  return {
    discordToken,
    discordClientId,
    discordGuildId: env.DISCORD_GUILD_ID?.trim() ?? '',
    dataDir: env.DATA_DIR?.trim() || '.data',
    logLevel,
  };
}

function normalizeLogLevel(value: string | undefined): LogLevel {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'debug':
      return 'debug';
    case 'warn':
      return 'warn';
    case 'error':
      return 'error';
    default:
      return 'info';
  }
}
