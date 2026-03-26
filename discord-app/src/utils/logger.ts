import type { LogLevel } from '../config/env.js';

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export function createLogger(level: LogLevel): Logger {
  return {
    info(message, meta) {
      if (shouldLog(level, 'info')) {
        console.log(message, meta ?? {});
      }
    },
    error(message, meta) {
      if (shouldLog(level, 'error')) {
        console.error(message, meta ?? {});
      }
    },
  };
}

function shouldLog(current: LogLevel, target: LogLevel): boolean {
  const ranks: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };
  return ranks[target] >= ranks[current];
}
