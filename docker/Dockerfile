FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm install

FROM deps AS build
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
EXPOSE 3000
CMD ["node", "apps/server/dist/main.js"]
