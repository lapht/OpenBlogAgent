import pino from "pino";

export interface ILogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

// Logs go to stderr so that stdout carries only a command's result (`--json`).
const pinoLogger = pino({ level: process.env.OPENBLOG_LOG_LEVEL ?? "info" }, pino.destination(2));

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
