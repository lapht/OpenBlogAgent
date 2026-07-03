import type { FastifyInstance } from "fastify";

export const registerErrorHandler = (app: FastifyInstance): void => {
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Unhandled request error");

    void reply.status(500).send({
      error: "Internal Server Error"
    });
  });
};
