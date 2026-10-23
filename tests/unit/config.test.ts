import { describe, expect, it } from "vitest";

import { loadEnv } from "../../packages/config/src/config/env";

describe("loadEnv", () => {
  it("applies defaults when nothing is set", () => {
    const env = loadEnv({});

    expect(env.OPENBLOG_APP_NAME).toBe("OpenBlogAgent");
    expect(env.OPENBLOG_ENV).toBe("development");
    expect(env.OPENBLOG_PORT).toBe(3000);
    expect(env.OPENBLOG_LOG_LEVEL).toBe("info");
    expect(env.OPENBLOG_TAXONOMY_ALLOW_CREATE).toBe(false);
  });

  it.each([
    [undefined, false],
    ["false", false],
    ["FALSE", false],
    ["true", true],
    [" True ", true]
  ])("parses OPENBLOG_TAXONOMY_ALLOW_CREATE=%s as %s", (raw, expected) => {
    const input = raw === undefined ? {} : { OPENBLOG_TAXONOMY_ALLOW_CREATE: raw };

    expect(loadEnv(input).OPENBLOG_TAXONOMY_ALLOW_CREATE).toBe(expected);
  });

  it("rejects non-boolean values for boolean variables", () => {
    expect(() => loadEnv({ OPENBLOG_TAXONOMY_ALLOW_CREATE: "yes" })).toThrow(
      /OPENBLOG_TAXONOMY_ALLOW_CREATE/
    );
  });

  it("reads OpenRouter, Ollama and memory DB settings", () => {
    const env = loadEnv({
      OPENROUTER_API_KEY: "k",
      OPENROUTER_MODEL: "m",
      OLLAMA_BASE_URL: "http://localhost:1",
      OPENBLOG_MEMORY_DB_PATH: "/tmp/x.db"
    });

    expect(env.OPENROUTER_API_KEY).toBe("k");
    expect(env.OPENROUTER_MODEL).toBe("m");
    expect(env.OLLAMA_BASE_URL).toBe("http://localhost:1");
    expect(env.OPENBLOG_MEMORY_DB_PATH).toBe("/tmp/x.db");
  });

  it("treats empty strings as unset for optional variables", () => {
    expect(loadEnv({ OPENROUTER_API_KEY: "" }).OPENROUTER_API_KEY).toBeUndefined();
  });

  it.each([
    [{ OPENBLOG_ENV: "staging" }, "OPENBLOG_ENV"],
    [{ OPENBLOG_LOG_LEVEL: "loud" }, "OPENBLOG_LOG_LEVEL"],
    [{ OPENBLOG_PORT: "abc" }, "OPENBLOG_PORT"],
    [{ OPENBLOG_WORDPRESS_STATUS: "secret-value-123" }, "OPENBLOG_WORDPRESS_STATUS"]
  ])("names the offending variable for %j", (input, name) => {
    expect(() => loadEnv(input)).toThrow(name);
  });

  it("does not print received values in validation errors", () => {
    let message = "";
    try {
      loadEnv({ OPENBLOG_WORDPRESS_STATUS: "secret-value-123", OPENBLOG_PORT: "secret-port" });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("OPENBLOG_WORDPRESS_STATUS");
    expect(message).not.toContain("secret-value-123");
    expect(message).not.toContain("secret-port");
  });
  it("defaults the content language to en and accepts a language code", () => {
    expect(loadEnv({}).OPENBLOG_CONTENT_LANGUAGE).toBe("en");
    expect(loadEnv({ OPENBLOG_CONTENT_LANGUAGE: "it" }).OPENBLOG_CONTENT_LANGUAGE).toBe("it");
    expect(loadEnv({ OPENBLOG_CONTENT_LANGUAGE: "pt-BR" }).OPENBLOG_CONTENT_LANGUAGE).toBe("pt-BR");
    expect(loadEnv({ OPENBLOG_CONTENT_LANGUAGE: "" }).OPENBLOG_CONTENT_LANGUAGE).toBe("en");
  });

  it("rejects an invalid content language", () => {
    expect(() => loadEnv({ OPENBLOG_CONTENT_LANGUAGE: "italian please" })).toThrow(
      /OPENBLOG_CONTENT_LANGUAGE/
    );
  });
});
