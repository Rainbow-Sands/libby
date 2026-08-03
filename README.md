# rainbot-sands

Discord bot that records tabletop RPG sessions, transcribes them with
whisper.cpp, and generates detailed records and recaps with local or cloud
language models. PostgreSQL owns the durable processing queue and pipeline
state, while S3-compatible object storage holds activation audio and generated
session artifacts.

## Packages

| Package              | Description                                                           |
| -------------------- | --------------------------------------------------------------------- |
| `@rainbot/discord`   | Discord bot — joins voice channels and records audio                  |
| `@rainbot/knowledge` | DigitalOcean Knowledge Base retrieval and indexing                    |
| `@rainbot/storage`   | S3-compatible object access and artifact validation                   |
| `@rainbot/worker`    | Postgres worker — transcription, aggregation, inference, notification |
| `@rainbot/db`        | Drizzle schema, PostgreSQL client, and durable processing state       |
| `@rainbot/web`       | SvelteKit frontend                                                    |

## Requirements

- Node.js 24
- pnpm
- ffmpeg (for the Discord bot)
- PostgreSQL
- S3-compatible object storage
- whisper.cpp server
- A local or cloud language model provider

## Setup

```sh
pnpm install
```

Create a root `.env` and fill in the values needed by the services you run.

Run database migrations:

```sh
pnpm --filter @rainbot/db db:migrate
```

## Development

```sh
pnpm --filter @rainbot/discord dev
pnpm --filter @rainbot/worker dev
pnpm --filter @rainbot/web dev
```

## Environment variables

Service names below match `docker-compose.yml`; `db-migrate` is the
`@rainbot/db` migration image.

### Core and authentication

| Variable                                            | Used by                          | Description                                                                      |
| --------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | postgres, Docker Compose         | Creates PostgreSQL and constructs container `DATABASE_URL` values                |
| `DATABASE_URL`                                      | db-migrate, discord, worker, web | PostgreSQL connection string                                                     |
| `DISCORD_TOKEN`                                     | discord, worker                  | Bot token; worker uses it to post completed-session links                        |
| `DISCORD_APPLICATION_ID`                            | discord, web                     | Discord application ID for commands and OAuth                                    |
| `DISCORD_CLIENT_SECRET`                             | web                              | Discord OAuth client secret                                                      |
| `SESSION_SECRET`                                    | web                              | Secret used to sign login sessions                                               |
| `ORIGIN`                                            | web, Docker Compose              | Public web origin; Compose also passes it to worker as `WEB_URL`                 |
| `WEB_URL`                                           | worker                           | Public web origin used in completed-session links; required when running locally |
| `BODY_SIZE_LIMIT`                                   | web                              | Maximum manual-upload request size; Compose defaults it to `10G`                 |

### Audio and processing

| Variable                           | Used by              | Description                                                                        |
| ---------------------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| `S3_ACCESS_KEY_ID`                 | discord, worker, web | Optional static access key; omit both credentials to use the AWS provider chain    |
| `S3_BUCKET_ARTIFACT`               | worker, web          | Private bucket for durable transcripts and detailed records                        |
| `S3_BUCKET_AUDIO`                  | discord, worker, web | Private, short-lived activation-audio bucket; web uses it for manual uploads       |
| `S3_ENDPOINT`                      | discord, worker, web | Optional shared S3-compatible endpoint; omit for AWS S3                            |
| `S3_FORCE_PATH_STYLE`              | discord, worker, web | Set to `true` when the storage provider requires path-style requests               |
| `S3_REGION`                        | discord, worker, web | Object-storage region                                                              |
| `S3_SECRET_ACCESS_KEY`             | discord, worker, web | Optional static secret; must be set with the access key                            |
| `TRANSCRIPTION_URL`                | worker               | Complete transcription endpoint, such as `http://whisper-server:8080/inference`    |
| `TRANSCRIPTION_MODEL`              | worker               | Transcription model ID (default: `whisper-large-v3-turbo`)                         |
| `TRANSCRIPTION_CONCURRENCY`        | worker               | Simultaneous activation transcriptions (default: `4`)                              |
| `PROCESSING_CONCURRENCY`           | worker               | Sessions processed concurrently by one worker (default: `2`)                       |
| `PROCESSING_POLL_MILLISECONDS`     | worker               | Delay between Postgres queue polls (default: `2000`)                               |
| `PROCESSING_MAX_ATTEMPTS`          | worker               | Maximum attempts for a session or activation before failure (default: `3`)         |
| `DELETE_AUDIO_AFTER_TRANSCRIPTION` | worker               | Set to `true` to delete audio after its transcript is committed (default: `false`) |

### Language-model inference

| Variable                         | Used by | Description                                                                                         |
| -------------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `SUMMARIZATION_PROVIDER`         | worker  | Detailed record, recap, and title provider: `local`, `openai`, or `anthropic` (default: `local`)    |
| `SUMMARIZATION_API_KEY`          | worker  | Required for OpenAI and Anthropic; optional for local                                               |
| `SUMMARIZATION_BASE_URL`         | worker  | Required for local; optional OpenAI or Anthropic endpoint override                                  |
| `SUMMARIZATION_MODEL`            | worker  | Required for cloud providers; local default: `qwen3.6-35b-a3b`                                      |
| `SUMMARIZATION_REASONING_EFFORT` | worker  | Optional cloud effort: `none`, `low`, `medium`, `high`, `xhigh`, or `max`; `minimal` is OpenAI-only |
| `SUMMARIZATION_THINKING_BUDGET`  | worker  | Local llama.cpp reasoning budget (default: `8192`)                                                  |
| `CHAT_PROVIDER`                  | web     | Session-chat provider: `local`, `openai`, or `anthropic` (default: `local`)                         |
| `CHAT_API_KEY`                   | web     | Required for OpenAI and Anthropic; optional for local                                               |
| `CHAT_BASE_URL`                  | web     | Required for local; optional OpenAI or Anthropic endpoint override                                  |
| `CHAT_MODEL`                     | web     | Required for cloud providers; local default: `qwen3.6-35b-a3b`                                      |
| `CHAT_REASONING_EFFORT`          | web     | Optional cloud effort: `none`, `low`, `medium`, `high`, `xhigh`, or `max`; `minimal` is OpenAI-only |
| `CHAT_THINKING_BUDGET`           | web     | Local llama.cpp reasoning budget (default: `2048`)                                                  |

### Campaign knowledge retrieval

| Variable                | Used by     | Description                                                                           |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------- |
| `RAG_PROVIDER`          | worker, web | Campaign retrieval provider: `none` (default) or `digitalocean`                       |
| `RAG_API_KEY`           | worker, web | DigitalOcean token used to create indexing jobs and retrieve Knowledge Base results   |
| `RAG_KNOWLEDGE_BASE_ID` | worker, web | DigitalOcean Knowledge Base UUID                                                      |
| `RAG_OBJECT_PREFIX`     | worker, web | Artifact-bucket folder selected as the Knowledge Base data source (default: `rag`)    |
| `RAG_RETRIEVAL_ALPHA`   | web         | Hybrid retrieval balance from keyword `0` to semantic `1` (default: `0.6`)            |
| `RAG_RETRIEVAL_RESULTS` | web         | Maximum retrieved chunks supplied to campaign chat, from `1` to `100` (default: `12`) |

Keep both buckets private. Transcript and detailed-record objects share the
artifact bucket under separate session/run prefixes; recap and title stay in
Postgres for fast page listings and URL previews. `DELETE_AUDIO_AFTER_TRANSCRIPTION=true`
deletes each activation after its transcript checkpoint has been committed to
Postgres; those checkpoints are cleared once the aggregate transcript artifact
is durable. Configure an audio-bucket lifecycle expiration as a second,
provider-enforced retention boundary;
the application stores stable object keys and does not depend on signed URLs.
Leave application deletion disabled while transcript regeneration is needed.
Recorder and manual-upload scratch files use each service's local temporary
directory and are removed after upload; no shared filesystem is required.
The web service needs artifact read access; the worker needs read/write access.

Summarization and chat use independent provider profiles. Local thinking budgets
accept `0` to disable thinking, a positive token limit, or `-1` for unlimited.
Cloud providers use their corresponding reasoning-effort setting.

When `RAG_PROVIDER=digitalocean`, configure the Knowledge Base to ingest the
`RAG_OBJECT_PREFIX` folder in `S3_BUCKET_ARTIFACT`. The worker writes one stable
Markdown projection per session beneath that folder and requests re-indexing
after a newly generated detailed record becomes current. Retrieval is always
filtered to the authorized campaign's object-key prefix. Canonical transcript
and detailed-record artifacts remain unchanged, so the managed index can be
rebuilt or replaced.

For a new Knowledge Base, first set `RAG_OBJECT_PREFIX` and run the sync command
with `RAG_PROVIDER` unset. This populates the folder so it can be selected as a
Spaces data source. After creating the Knowledge Base, configure the remaining
RAG variables and run the command again to request indexing:

```sh
pnpm --filter @rainbot/worker sync:knowledge
```

In Docker Compose, run the same one-off task from the worker image:

```sh
docker compose run --rm --entrypoint node worker packages/worker/src/scripts/sync-knowledge.ts
```
