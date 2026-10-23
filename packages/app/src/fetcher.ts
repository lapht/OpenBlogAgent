import type { EnvSchema } from "@openblog/config";
import { createContentFetcher, type ContentFetcher } from "@openblog/research";

/** The content fetcher that research features share, built from the `OPENBLOG_FETCH_*` settings. */
export function createContentFetcherFromConfig(config: EnvSchema): ContentFetcher {
  return createContentFetcher({
    allowPrivate: config.OPENBLOG_FETCH_ALLOW_PRIVATE,
    allowedHosts: config.OPENBLOG_FETCH_ALLOWED_HOSTS?.split(","),
    timeoutMs: config.OPENBLOG_FETCH_TIMEOUT_MS,
    maxBytes: config.OPENBLOG_FETCH_MAX_BYTES,
    maxRedirects: config.OPENBLOG_FETCH_MAX_REDIRECTS,
    userAgent: config.OPENBLOG_FETCH_USER_AGENT
  });
}
