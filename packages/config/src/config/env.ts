import dotenv from "dotenv";

import { envSchema, type EnvSchema } from "./schema";

dotenv.config();

export const loadEnv = (input: NodeJS.ProcessEnv = process.env): EnvSchema => {
  const parsed = envSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }

  return parsed.data;
};
