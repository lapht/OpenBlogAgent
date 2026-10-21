import { createHash, timingSafeEqual } from "node:crypto";

import type { FastifyRequest } from "fastify";

import { ApiError } from "../errors";

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

/** The key a request carries: `Authorization: Bearer <key>` or `X-API-Key`. */
function presentedKey(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (match) return match[1]!.trim();
  }
  const apiKey = request.headers["x-api-key"];
  return typeof apiKey === "string" ? apiKey : undefined;
}

/**
 * Builds the hook that guards the run endpoints. Without a configured key every request is
 * refused (503) rather than served open: these endpoints spend money and publish.
 */
export function createApiKeyGuard(apiKey: string | undefined) {
  const expected = apiKey ? digest(apiKey) : undefined;

  return async (request: FastifyRequest): Promise<void> => {
    if (!expected) {
      throw new ApiError(503, "api_disabled", "The API is disabled: OPENBLOG_API_KEY is not set");
    }
    const presented = presentedKey(request);
    // Equal-length digests keep the comparison constant time whatever the key length.
    if (!presented || !timingSafeEqual(digest(presented), expected)) {
      throw new ApiError(401, "unauthorized", "Missing or invalid API key", {
        "www-authenticate": "Bearer"
      });
    }
  };
}
