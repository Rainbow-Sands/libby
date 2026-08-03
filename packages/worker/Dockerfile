FROM node:24

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json ./packages/db/
COPY packages/storage/package.json ./packages/storage/
COPY packages/worker/package.json ./packages/worker/

RUN pnpm install --frozen-lockfile --filter @rainbot/worker...

COPY packages/db ./packages/db
COPY packages/storage ./packages/storage
COPY packages/worker ./packages/worker

ENTRYPOINT ["node", "packages/worker/src/worker.ts"]
