# rainbot-sands

Discord bot that records tabletop RPG sessions, transcribes them with
whisper.cpp, and generates detailed records and recaps with local or cloud
language models. PostgreSQL owns the durable processing queue and pipeline
state, while S3-compatible object storage holds activation audio.

## Packages

| Package            | Description                                                           |
| ------------------ | --------------------------------------------------------------------- |
| `@rainbot/discord` | Discord bot — joins voice channels and records audio                  |
| `@rainbot/worker`  | Postgres worker — transcription, aggregation, inference, notification |
| `@rainbot/db`      | Drizzle schema, PostgreSQL client, and durable processing state       |
| `@rainbot/web`     | SvelteKit frontend                                                    |

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

Copy `.env.example` to `.env` and fill in the values.

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

| Variable                           | Used by              | Description                                                                                                         |
| ---------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`                    | discord, worker      | Bot token                                                                                                           |
| `DISCORD_APPLICATION_ID`           | discord              | Application ID                                                                                                      |
| `MEDIA_PATH`                       | discord, worker, web | Recorder scratch directory and legacy local-audio compatibility path                                                |
| `AUDIO_S3_ENDPOINT`                | discord, worker, web | Optional S3-compatible endpoint; omit for AWS S3                                                                    |
| `AUDIO_S3_REGION`                  | discord, worker, web | Object-storage region                                                                                               |
| `AUDIO_S3_BUCKET`                  | discord, worker, web | Private bucket containing activation audio                                                                          |
| `AUDIO_S3_ACCESS_KEY_ID`           | discord, worker, web | Optional static access key; omit with the secret to use the AWS credential provider chain                           |
| `AUDIO_S3_SECRET_ACCESS_KEY`       | discord, worker, web | Optional static secret key; must be set together with the access key                                                |
| `AUDIO_S3_FORCE_PATH_STYLE`        | discord, worker, web | Set to `true` for S3-compatible providers that require path-style requests                                          |
| `TRANSCRIPTION_URL`                | worker               | Complete transcription endpoint URL, such as `http://whisper-server:8080/inference`                                 |
| `TRANSCRIPTION_MODEL`              | worker               | Audio transcription model ID (default: `whisper-large-v3-turbo`)                                                    |
| `TRANSCRIPTION_CONCURRENCY`        | worker               | Maximum simultaneous transcription jobs (default: `4`)                                                              |
| `PROCESSING_CONCURRENCY`           | worker               | Maximum sessions processed concurrently by one worker (default: `2`)                                                |
| `PROCESSING_MAX_ATTEMPTS`          | worker               | Maximum attempts before a run or transcription permanently fails (default: `3`)                                     |
| `DELETE_AUDIO_AFTER_TRANSCRIPTION` | worker               | Set to `true` to delete each S3 object after its transcript is durable                                              |
| `SUMMARIZATION_PROVIDER`           | worker               | `local`, `openai`, or `anthropic` (default: `local`)                                                                |
| `SUMMARIZATION_API_KEY`            | worker               | API key; required for OpenAI and Anthropic, optional for local                                                      |
| `SUMMARIZATION_BASE_URL`           | worker               | Required full API root for local summarization; optional cloud API override                                         |
| `SUMMARIZATION_MODEL`              | worker               | Detailed-record, recap, and title model ID; required for cloud providers (local default: `qwen3.6-35b-a3b`)         |
| `SUMMARIZATION_REASONING_EFFORT`   | worker               | Optional cloud reasoning effort: `none`, `low`, `medium`, `high`, `xhigh`, or `max`; OpenAI also supports `minimal` |
| `SUMMARIZATION_THINKING_BUDGET`    | worker               | Local llama.cpp reasoning-token budget (default: `8192`)                                                            |
| `CHAT_PROVIDER`                    | web                  | `local`, `openai`, or `anthropic` (default: `local`)                                                                |
| `CHAT_API_KEY`                     | web                  | API key; required for OpenAI and Anthropic, optional for local                                                      |
| `CHAT_BASE_URL`                    | web                  | Required full API root for local chat; optional cloud API override                                                  |
| `CHAT_MODEL`                       | web                  | Session chat model ID; required for cloud providers (local default: `qwen3.6-35b-a3b`)                              |
| `CHAT_REASONING_EFFORT`            | web                  | Optional cloud reasoning effort: `none`, `low`, `medium`, `high`, `xhigh`, or `max`; OpenAI also supports `minimal` |
| `CHAT_THINKING_BUDGET`             | web                  | Local llama.cpp reasoning-token budget for session chat (default: `2048`)                                           |
| `BODY_SIZE_LIMIT`                  | web                  | Maximum manual-upload request size; defaults to `10G` in Docker Compose                                             |
| `DATABASE_URL`                     | db                   | PostgreSQL connection string                                                                                        |
| `WEB_URL`                          | worker               | Public web origin used for completed-session links (for example, `https://libby.bot`)                               |

For example, to run the post-session pipeline through Claude Sonnet:

```env
SUMMARIZATION_PROVIDER=anthropic
SUMMARIZATION_API_KEY=sk-ant-...
SUMMARIZATION_MODEL=claude-sonnet-5
SUMMARIZATION_REASONING_EFFORT=high
```

Chat uses a separate provider profile, so it can use a smaller or less expensive
model without changing the post-session pipeline:

```env
CHAT_PROVIDER=anthropic
CHAT_API_KEY=sk-ant-...
CHAT_MODEL=claude-haiku-4-5
```

For local inference, configure each service explicitly. These may point to the
same OpenAI-compatible server, but they are not coupled:

```env
TRANSCRIPTION_URL=http://whisper-server:8080/inference
```

Local LLM inference is configured separately and may use any OpenAI-compatible
server:

```env
SUMMARIZATION_PROVIDER=local
SUMMARIZATION_BASE_URL=http://llama-swap:8080/v1
CHAT_PROVIDER=local
CHAT_BASE_URL=http://llama-swap:8080/v1
```

Keep the audio bucket private. `DELETE_AUDIO_AFTER_TRANSCRIPTION=true` deletes
each activation after its transcript has been committed to Postgres. Configure
a bucket lifecycle expiration as a second, provider-enforced retention boundary;
the application stores stable object keys and does not depend on signed URLs.
Leave application deletion disabled while transcript regeneration is needed.

The detailed record is generated from the complete formatted transcript in one
request. Its output then feeds one recap request, and the recap feeds one title
request. There is no transcript chunking or context-size preflight.

Local thinking budgets are passed to llama.cpp as `thinking_budget_tokens`. Override a
budget with `0` to end thinking immediately, a positive integer to cap thinking
tokens, or `-1` for unrestricted thinking. Per-request budgets require a recent
llama.cpp build and are ignored when the server was started with a fixed
`--reasoning-budget`. A zero budget also passes
`chat_template_kwargs.enable_thinking=false`; positive and unrestricted budgets
pass `enable_thinking=true`. This makes Qwen's chat-template mode explicit on
every local request. OpenAI and Anthropic instead use
their corresponding `SUMMARIZATION_REASONING_EFFORT` or
`CHAT_REASONING_EFFORT` when set; Anthropic enables adaptive thinking for
non-`none` effort levels.
