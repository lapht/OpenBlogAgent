import fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import type { Application } from "@openblog/app";
import { getPinoLogger, logger } from "@openblog/logger";
import { DEFAULT_REQUEST_ID_HEADER, OPENBLOG_NAME } from "@openblog/shared";

import { registerCors } from "./plugins/cors";
import { registerErrorHandler } from "./plugins/error-handler";
import { registerHealthRoute } from "./routes/health";
import { registerVersionRoute, type VersionPayload } from "./routes/version";

declare module "fastify" {
  interface FastifyInstance {
    application?: Application;
  }
}

export interface BuildServerOptions {
  version?: VersionPayload;
  /** Application built by `createApplication`; disposed when the server closes. */
  application?: Application;
}

export const buildServer = async (options?: BuildServerOptions): Promise<FastifyInstance> => {
  const app = fastify({
    // The shared logger: same redaction and destination as the CLI.
    loggerInstance: getPinoLogger() as FastifyBaseLogger,
    requestIdHeader: DEFAULT_REQUEST_ID_HEADER,
    genReqId: () => randomUUID()
  });

  if (options?.application) {
    const { application } = options;
    app.decorate("application", application);
    app.addHook("onClose", async () => application.dispose());
  }

  registerErrorHandler(app);
  await registerCors(app);

  registerHealthRoute(app);
  registerVersionRoute(app, options?.version ?? { name: OPENBLOG_NAME, version: "0.1.0" });

  logger.debug("Server instance created");

  return app;
};
