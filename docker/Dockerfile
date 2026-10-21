# Production image of the OpenBlogAgent CLI (see ADR-022). Build context: the repository root.
# Debian (glibc) rather than Alpine: better-sqlite3 ships prebuilt binaries for it, so no compiler is needed.

FROM node:20-bookworm-slim AS build
WORKDIR /app
ENV HUSKY=0
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci
RUN npm run build
# Drops dev dependencies but keeps the workspace links (node_modules/@openblog/* -> packages/*).
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    OPENBLOG_MEMORY_DB_PATH=/app/data/openblog-memory.db \
    OPENBLOG_OUTPUT_DIR=/app/output/articles
# The workspace links point into apps/ and packages/, so both trees (with their dist folders) must ship.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
RUN mkdir -p /app/data /app/output/articles && chown -R node:node /app/data /app/output
USER node
VOLUME ["/app/data", "/app/output"]
# No HEALTHCHECK: the CLI runs once and exits. A server container would use apps/server/dist/main.js.
ENTRYPOINT ["node", "apps/cli/dist/index.js"]
