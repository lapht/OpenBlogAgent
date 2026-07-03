import fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import { logger } from "@openblog/logger";
import { DEFAULT_REQUEST_ID_HEADER, OPENBLOG_NAME } from "@openblog/shared";

import { registerCors } from "./plugins/cors";
import { registerErrorHandler } from "./plugins/error-handler";
import { registerHealthRoute } from "./routes/health";
import { registerVersionRoute, type VersionPayload } from "./routes/version";

export interface BuildServerOptions {
  version?: VersionPayload;
}

export const buildServer = async (options?: BuildServerOptions): Promise<FastifyInstance> => {
  const app = fastify({
    logger: true,
    requestIdHeader: DEFAULT_REQUEST_ID_HEADER,
    genReqId: () => randomUUID()
  });

  registerErrorHandler(app);
  await registerCors(app);

  registerHealthRoute(app);
  registerVersionRoute(app, options?.version ?? { name: OPENBLOG_NAME, version: "0.1.0" });

  logger.debug("Server instance created");

  return app;
};
