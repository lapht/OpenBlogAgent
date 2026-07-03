import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildServer } from "../../apps/server/src/app";

describe("GET /health", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer({
      version: { name: "OpenBlogAgent", version: "0.1.0" }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns status ok", async () => {
    const response = await app.inject({
      method: "GET",
      path: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
