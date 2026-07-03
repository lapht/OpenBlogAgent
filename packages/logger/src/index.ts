import pino from "pino";

export interface ILogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

const pinoLogger = pino({
  level: process.env.OPENBLOG_LOG_LEVEL ?? "info"
});

export const logger: ILogger = {
  info: (message, context) => {
    pinoLogger.info(context ?? {}, message);
  },
  warn: (message, context) => {
    pinoLogger.warn(context ?? {}, message);
  },
  error: (message, context) => {
    pinoLogger.error(context ?? {}, message);
  },
  debug: (message, context) => {
    pinoLogger.debug(context ?? {}, message);
  }
};
