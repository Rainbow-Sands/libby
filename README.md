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
| `INFERENCE_URL`          | temporal, web          | Shared OpenAI-compatible inference server base URL                                                                                                             |
| `TRANSCRIPTION_MODEL`    | temporal               | Audio transcription model ID (default: `whisper-large-v3-turbo`)                                                                                               |
| `SUMMARIZATION_MODEL`    | temporal               | Summary, recap, and title model ID (default: `qwen3.6-35b-a3b`)                                                                                                |
| `SUMMARIZATION_THINKING_BUDGET` | temporal        | llama.cpp reasoning-token budget for summary, recap, and title (default: `8192`)                                                                                |
| `CHAT_MODEL`             | web                    | Session chat model ID (default: `qwen3.6-35b-a3b`)                                                                                                             |
| `CHAT_THINKING_BUDGET`   | web                    | llama.cpp reasoning-token budget for session chat (default: `2048`)                                                                                            |
| `BODY_SIZE_LIMIT`        | web                    | Maximum manual-upload request size; defaults to `10G` in Docker Compose                                                                                      |
| `DATABASE_URL`           | db                     | PostgreSQL connection string                                                                                                                                  |

Thinking budgets are passed to llama.cpp as `thinking_budget_tokens`. Override a
budget with `0` to end thinking immediately, a positive integer to cap thinking
tokens, or `-1` for unrestricted thinking. Per-request budgets require a recent
llama.cpp build and are ignored when the server was started with a fixed
`--reasoning-budget`. A zero budget also passes
`chat_template_kwargs.enable_thinking=false` so Qwen's chat template disables
thinking rather than merely limiting its output.
