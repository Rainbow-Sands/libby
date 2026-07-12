# rainbot-sands

Discord bot that records tabletop RPG sessions, transcribes them with whisper.cpp, and generates summaries and recaps with llama.cpp. Built on Temporal for durable workflow orchestration.

## Packages

| Package             | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| `@rainbot/discord`  | Discord bot — joins voice channels, records audio, triggers workflows |
| `@rainbot/temporal` | Temporal workers — transcription, aggregation, summarization, recap   |
| `@rainbot/db`       | Drizzle schema and PostgreSQL client                                  |
| `@rainbot/web`      | SvelteKit frontend                                                    |

## Requirements

- Node.js 24
- pnpm
- ffmpeg (for the Discord bot)
- PostgreSQL
- Temporal server
- whisper.cpp server
- llama.cpp server

## Setup

```sh
pnpm install
```

Copy `.env.example` to `.env` and fill in the values.

Register Temporal search attributes (once per namespace):

```sh
temporal operator search-attribute create --namespace rainbot --name GuildId --type Keyword
temporal operator search-attribute create --namespace rainbot --name ChannelId --type Keyword
temporal operator search-attribute create --namespace rainbot --name SegmentCount --type Int
```

Run database migrations:

```sh
pnpm --filter @rainbot/db db:migrate
```

## Development

```sh
pnpm dev:discord   # Discord bot
pnpm dev:temporal  # Temporal worker
pnpm dev:web       # SvelteKit frontend
```

## Environment variables

| Variable                 | Used by                | Description                                                                                                                                                   |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`          | discord                | Bot token                                                                                                                                                     |
| `DISCORD_APPLICATION_ID` | discord                | Application ID                                                                                                                                                |
| `MEDIA_PATH`             | discord, temporal, web | Directory for audio clips, imported files, and transcripts                                                                                                    |
| `TEMPORAL_URL`           | discord, temporal, web | Temporal server address (e.g. `localhost:7233`)                                                                                                               |
| `INFERENCE_URL`          | temporal, web          | Shared llama-swap base URL; the app requests `whisper-large-v3-turbo` for transcription, `qwen3.6-35b-a3b` for summary/recap/title, and `qwen3.5-9b` for chat |
| `BODY_SIZE_LIMIT`        | web                    | Maximum manual-upload request size; defaults to `10G` in Docker Compose                                                                                      |
| `DATABASE_URL`           | db                     | PostgreSQL connection string                                                                                                                                  |
