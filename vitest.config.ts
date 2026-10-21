import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: { OPENBLOG_LOG_LEVEL: "fatal" },
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"]
    }
  }
});
