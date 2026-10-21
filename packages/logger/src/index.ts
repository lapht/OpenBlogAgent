import { AsyncLocalStorage } from "node:async_hooks";

import pino, { type DestinationStream, type Logger as PinoLogger } from "pino";

export interface ILogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

const scope = new AsyncLocalStorage<Record<string, unknown>>();

/**
 * Runs `fn` with extra fields (`workflowId`, `step`, `attempt`, ...) that every log line written
 * inside it carries, including lines from code that only knows the shared logger (providers).
 */
export function withLogContext<T>(bindings: Record<string, unknown>, fn: () => T): T {
  return scope.run({ ...scope.getStore(), ...bindings }, fn);
}

/** The fields of the run in progress, or none outside one. */
export function currentLogContext(): Record<string, unknown> {
  return { ...scope.getStore() };
}

/** Wraps any logger so its lines carry the current log context. */
export function withScope(base: ILogger): ILogger {
  const merge = (context?: Record<string, unknown>) => ({ ...scope.getStore(), ...context });
  return {
    info: (message, context) => base.info(message, merge(context)),
    warn: (message, context) => base.warn(message, merge(context)),
    error: (message, context) => base.error(message, merge(context)),
    debug: (message, context) => base.debug(message, merge(context))
  };
}

const SECRET_KEYS = [
  "apiKey",
  "api_key",
  "authorization",
  "Authorization",
  "password",
  "applicationPassword",
  "secret",
  "token",
  "accessToken",
  "headers",
  "OPENROUTER_API_KEY",
  "OPENBLOG_WORDPRESS_APPLICATION_PASSWORD"
];

/** Secret-bearing keys at the top level and up to two levels down. Request headers are never logged. */
export const REDACT_PATHS = SECRET_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]);

export interface CreateLoggerOptions {
  level?: string;
  /** Where lines go; stderr by default so stdout carries only a command's result. */
  destination?: DestinationStream;
  /** Human-readable output through pino-pretty (development). */
  pretty?: boolean;
}

/** The underlying pino instance, with redaction and request serializers that omit headers. */
export function createPinoLogger(options: CreateLoggerOptions = {}): PinoLogger {
  const base = {
    level: options.level ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    serializers: {
      err: pino.stdSerializers.err,
      req: (request: { method?: string; url?: string; id?: string }) => ({
        method: request.method,
        url: request.url,
        id: request.id
      }),
      res: (response: { statusCode?: number }) => ({ statusCode: response.statusCode })
    }
  };

  if (options.destination) {
    return pino(base, options.destination);
  }
  if (options.pretty) {
    try {
      return pino(
        base,
        pino.transport({ target: "pino-pretty", options: { destination: 2, colorize: true } })
      );
    } catch {
      // pino-pretty is a convenience; fall back to JSON rather than lose logging.
    }
  }
  return pino(base, pino.destination(2));
}

export function createLogger(options: CreateLoggerOptions = {}): ILogger {
  return withScope(adapt(createPinoLogger(options)));
}

function adapt(instance: PinoLogger): ILogger {
  return {
    info: (message, context) => instance.info(context ?? {}, message),
    warn: (message, context) => instance.warn(context ?? {}, message),
    error: (message, context) => instance.error(context ?? {}, message),
    debug: (message, context) => instance.debug(context ?? {}, message)
  };
}

let shared: { pino: PinoLogger; logger: ILogger } | undefined;

/** Built on first use, so `.env` is loaded by then (OPENBLOG_LOG_LEVEL, OPENBLOG_LOG_PRETTY). */
function sharedInstance() {
  if (!shared) {
    const instance = createPinoLogger({
      level: process.env.OPENBLOG_LOG_LEVEL ?? "info",
      pretty: process.env.OPENBLOG_LOG_PRETTY?.toLowerCase() === "true"
    });
    shared = { pino: instance, logger: withScope(adapt(instance)) };
  }
  return shared;
}

/** The pino instance behind `logger`, for frameworks that want one (Fastify). */
export function getPinoLogger(): PinoLogger {
  return sharedInstance().pino;
}

export const logger: ILogger = {
  info: (message, context) => sharedInstance().logger.info(message, context),
  warn: (message, context) => sharedInstance().logger.warn(message, context),
  error: (message, context) => sharedInstance().logger.error(message, context),
  debug: (message, context) => sharedInstance().logger.debug(message, context)
};
