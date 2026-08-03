FROM node:24


# python3/make/g++ are for @discordjs/opus's native build: no prebuilt binary
# covers this Node ABI yet, so its postinstall falls back to compiling
# libopus from source (bundled in the package, no system libopus needed).
RUN apt-get update && apt-get install -y ffmpeg python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json ./packages/db/
COPY packages/storage/package.json ./packages/storage/
COPY packages/worker/package.json ./packages/worker/
COPY packages/discord/package.json ./packages/discord/

RUN pnpm install --frozen-lockfile --filter @rainbot/discord...

COPY packages/db ./packages/db
COPY packages/storage ./packages/storage
COPY packages/worker ./packages/worker
COPY packages/discord ./packages/discord

ENTRYPOINT ["node", "packages/discord/src/index.ts"]
