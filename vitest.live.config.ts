import { defineConfig } from "vitest/config";

// Opt-in smoke tests against real services (`npm run test:live`). Kept out of `vitest.config.ts`
// (so `npm test` and coverage never touch the network): files are `*.live.ts`, not `*.test.ts`.
export default defineConfig({
  test: {
    environment: "node",
    env: { OPENBLOG_LOG_LEVEL: "fatal" },
    include: ["tests/live/**/*.live.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000
  }
});
