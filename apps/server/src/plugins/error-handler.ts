import type { FastifyInstance } from "fastify";

import { ApiError } from "../errors";

export const registerErrorHandler = (app: FastifyInstance): void => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      void reply
        .headers(error.headers)
        .status(error.statusCode)
        .send({ error: error.message, code: error.code });
      return;
    }

    // Fastify's own client errors (schema validation, malformed JSON, ...) are safe to show.
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      void reply.status(status).send({
        error: (error as Error).message,
        code: (error as { code?: string }).code ?? "bad_request"
      });
      return;
    }

    request.log.error({ err: error }, "Unhandled request error");

    void reply.status(500).send({
      error: "Internal Server Error"
    });
  });
};
