FROM node:24 AS builder

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/temporal/package.json ./packages/temporal/
COPY packages/web/package.json ./packages/web/

RUN pnpm install --frozen-lockfile --filter @rainbot/web...

COPY packages/db ./packages/db
COPY packages/temporal ./packages/temporal
COPY packages/web ./packages/web

RUN pnpm --filter @rainbot/web build

# adapter-node leaves the app's runtime dependencies (svelte, @sveltejs/kit,
# marked, drizzle-orm, postgres) as bare imports in the per-route server chunks,
# so they must be present in node_modules at runtime. `pnpm deploy` produces a
# self-contained, portable node_modules with only the production dependencies.
RUN pnpm --filter @rainbot/web deploy --prod --legacy /app/deploy

FROM node:24-slim AS runner
WORKDIR /app
# SvelteKit's Node adapter defaults request bodies to 512 KB. Manual session
# ingestion uploads multi-hour recordings, so provide a safe operational
# default that deployments may override.
ENV NODE_ENV=production BODY_SIZE_LIMIT=10G
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/packages/web/build ./
EXPOSE 3000
CMD ["node", "index.js"]
