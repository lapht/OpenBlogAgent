import { loadEnv } from "@openblog/config";

import { buildServer } from "./app";

const bootstrap = async (): Promise<void> => {
  const env = loadEnv();

  const app = await buildServer({
    version: {
      name: env.OPENBLOG_APP_NAME,
      version: process.env.npm_package_version ?? "0.1.0"
    }
  });

  await app.listen({
    host: "0.0.0.0",
    port: env.OPENBLOG_PORT
  });
};

void bootstrap();
