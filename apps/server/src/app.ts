import swagger from "@fastify/swagger";
import fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import type { Application } from "@openblog/app";
import { getPinoLogger, logger } from "@openblog/logger";
import { DEFAULT_REQUEST_ID_HEADER, OPENBLOG_NAME } from "@openblog/shared";

import { registerCors } from "./plugins/cors";
import { registerErrorHandler } from "./plugins/error-handler";
import { registerHealthRoute } from "./routes/health";
import { registerRunRoutes } from "./routes/runs";
import { registerTopicRoutes } from "./routes/topics";
import { registerVersionRoute, type VersionPayload } from "./routes/version";
import { RunQueue } from "./run-queue";

declare module "fastify" {
  interface FastifyInstance {
    application?: Application;
  }
}

export interface BuildServerOptions {
  version?: VersionPayload;
  /** Application built by `createApplication`; disposed when the server closes. */
  application?: Application;
  /** Key the run endpoints require. Without it they answer 503 instead of running open. */
  apiKey?: string;
  /** Origins allowed to call the server from a browser; none by default. */
  corsOrigins?: string[];
  /** Runs executed at once, and runs allowed to wait for a free slot. */
  queue?: { concurrency?: number; maxQueued?: number };
}

export const buildServer = async (options?: BuildServerOptions): Promise<FastifyInstance> => {
  const app = fastify({
    // The shared logger: same redaction and destination as the CLI.
    loggerInstance: getPinoLogger() as FastifyBaseLogger,
    requestIdHeader: DEFAULT_REQUEST_ID_HEADER,
    genReqId: () => randomUUID(),
    // Reject unknown body fields instead of silently dropping them (Fastify's default).
    ajv: { customOptions: { removeAdditional: false } }
  });

  const { application } = options ?? {};
  const version = options?.version ?? { name: OPENBLOG_NAME, version: "0.1.0" };
  const queue = new RunQueue({
    concurrency: options?.queue?.concurrency ?? 1,
    maxQueued: options?.queue?.maxQueued ?? 10,
    onError: (error) => app.log.error({ err: error }, "Background run failed")
  });

  if (application) {
    app.decorate("application", application);
  }
  // Runs in progress finish before the application (and its store) is disposed.
  app.addHook("onClose", async () => {
    await queue.close();
    await application?.dispose();
  });

  registerErrorHandler(app);
  await registerCors(app, options?.corsOrigins);

  await app.register(swagger, {
    openapi: {
      info: {
        title: "OpenBlogAgent API",
        description: "Start, inspect, resume and approve article runs; curate the topic backlog.",
        version: version.version
      },
      components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer" } } },
      security: [{ apiKey: [] }]
    }
  });

  registerHealthRoute(app);
  registerVersionRoute(app, version);

  if (application) {
    // Encapsulated so the API key guard covers the run routes only, not /health or /version.
    await app.register(async (scope) =>
      registerRunRoutes(scope, { application, queue, apiKey: options?.apiKey })
    );
    await app.register(async (scope) =>
      registerTopicRoutes(scope, { application, apiKey: options?.apiKey })
    );
  }

  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  logger.debug("Server instance created");

  return app;
};
