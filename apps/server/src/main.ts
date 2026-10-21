import { createApplication } from "@openblog/app";
import { loadEnv } from "@openblog/config";

import { buildServer } from "./app";

const bootstrap = async (): Promise<void> => {
  const env = loadEnv();
  // The same wiring the CLI uses, so a run over HTTP behaves like one from the command line.
  const application = await createApplication(env);

  const app = await buildServer({
    application,
    apiKey: env.OPENBLOG_API_KEY,
    corsOrigins: env.OPENBLOG_CORS_ORIGINS?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    queue: { concurrency: env.OPENBLOG_API_CONCURRENCY, maxQueued: env.OPENBLOG_API_QUEUE_SIZE },
    version: {
      name: env.OPENBLOG_APP_NAME,
      version: process.env.npm_package_version ?? "0.1.0"
    }
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void app.close().then(() => process.exit(0)));
  }

  await app.listen({
    host: "0.0.0.0",
    port: env.OPENBLOG_PORT
  });
};

void bootstrap();
