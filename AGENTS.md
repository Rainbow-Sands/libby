# AGENTS.md

Guidance for AI agents working in this repository. Package-specific notes live in
each `packages/*/AGENTS.md`.

## What this is

**rainbot-sands** is a Discord bot that records tabletop RPG sessions, transcribes
them with whisper.cpp, and generates summaries/recaps/titles with llama.cpp,
orchestrated durably through Temporal. A SvelteKit web app displays the results.

## Architecture / data flow

```
Discord voice ──/start──▶ Temporal workflow (session.ts)
   │  per voice-activation                │
   │  ogg/opus clip + segmentRecorded ────▶ transcribe (whisper.cpp)  [parallel]
   │                                       ▼
   └──/stop or empty channel──▶ aggregate ▶ summarize ▶ recap ▶ title (llama.cpp)
                                            ▼
                                   persist to Postgres ──▶ SvelteKit web app
```

- The **discord** bot records audio and signals the workflow; it holds no
  durable state (recovers by querying Temporal on startup).
- The **temporal** workers own the pipeline. Workflows orchestrate; activities do
  all the I/O (whisper, llama, DB, filesystem).
- The **db** package is the single source of truth for the schema and all queries.
- The **web** app is read-only over the same database.

## Monorepo layout

pnpm workspace; packages depend on each other via `workspace:*`.

| Package | Role |
|---|---|
| `@rainbot/db` | Drizzle schema + Postgres client + queries |
| `@rainbot/discord` | Discord bot, voice recording, session recovery |
| `@rainbot/temporal` | Temporal workers: transcribe / aggregate / summarize / recap / persist |
| `@rainbot/web` | SvelteKit frontend (Discord OAuth) |

## Runtime & tooling — read before writing code

- **Node.js 24 runs TypeScript natively.** There is **no build step** for `db`,
  `discord`, and `temporal` — `node` executes `.ts` files directly. Do not add
  tsx/ts-node/esbuild for these.
- **Imports must use explicit `.ts` extensions** (`./env.ts`, `../types.ts`).
  This is required by the bundler-style resolution; omitting it breaks at runtime.
- **Lint/format is oxc, not eslint/prettier:** `pnpm lint`, `pnpm lint:fix`,
  `pnpm format`, `pnpm format:fix`.
- **Typecheck a package:** `pnpm --filter @rainbot/<pkg> exec tsc --noEmit`.
  The web app uses `pnpm --filter @rainbot/web check` (svelte-check) instead.
- Match the surrounding code style; strict TS is on across the workspace.

## Common commands

```sh
pnpm install
pnpm dev                              # run all package dev scripts (recursive)
pnpm --filter @rainbot/discord dev    # one service (node --env-file --watch)
pnpm --filter @rainbot/temporal dev
pnpm --filter @rainbot/web dev
pnpm --filter @rainbot/db db:generate # after editing schema.ts
pnpm --filter @rainbot/db db:migrate
```

## Environment

One **root `.env`** holds all dev variables. Dev scripts load it with
`node --env-file=../../.env`; the web app's `vite.config.ts` and drizzle config
call `loadEnvFile` on it. Each service asserts its own required vars at import
time (see each package's `env.ts` / `lib/server/env.ts`) — follow that pattern
when adding a variable. The full table is in `README.md`.

## Deployment

`docker-compose.yml` runs everything from prebuilt GHCR images. The
`.github/workflows/deploy.yml` matrix builds one image per package. Two one-shot
services gate startup: `db-migrate` (runs Drizzle migrations) and
`temporal-setup` (creates the namespace + registers search attributes). External
dependencies: PostgreSQL, Temporal, whisper.cpp server, llama.cpp server, and
ffmpeg (in the discord image).

## Cross-cutting conventions

- **Idempotency:** DB writes are upserts and the workflow tolerates restarts —
  keep new work recovery-safe.
- **Don't commit secrets.** `.env` and `media/` are gitignored.
- **Only commit/push when asked.** If asked, branch off `main` first.
