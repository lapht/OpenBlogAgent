import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

/** Allows only the listed origins; with none, no CORS headers are sent and browsers block cross-origin calls. */
export const registerCors = async (app: FastifyInstance, origins: string[] = []): Promise<void> => {
  await app.register(cors, {
    origin: origins.length > 0 ? origins : false
  });
};
