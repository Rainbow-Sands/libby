# rainbot-sands

Discord bot that records tabletop RPG sessions, transcribes them with whisper.cpp, and generates detailed records and recaps with local or cloud language models. Built on Temporal for durable workflow orchestration.

## Packages

| Package             | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| `@rainbot/discord`  | Discord bot — joins voice channels, records audio, triggers workflows |
| `@rainbot/temporal` | Temporal workers — transcription, detailed records, recaps, titles    |
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

| Variable                         | Used by                | Description                                                                                                         |
| -------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`                  | discord, temporal      | Bot token                                                                                                           |
| `DISCORD_APPLICATION_ID`         | discord                | Application ID                                                                                                      |
| `MEDIA_PATH`                     | discord, temporal, web | Directory for audio clips, imported files, and transcripts                                                          |
| `TEMPORAL_URL`                   | discord, temporal, web | Temporal server address (e.g. `localhost:7233`)                                                                     |
| `TRANSCRIPTION_URL`              | temporal               | Complete transcription endpoint URL, such as `http://whisper-server:8080/inference`                                 |
| `TRANSCRIPTION_MODEL`            | temporal               | Audio transcription model ID (default: `whisper-large-v3-turbo`)                                                    |
| `SUMMARIZATION_PROVIDER`         | temporal               | `local`, `openai`, or `anthropic` (default: `local`)                                                                |
| `SUMMARIZATION_API_KEY`          | temporal               | API key; required for OpenAI and Anthropic, optional for local                                                      |
| `SUMMARIZATION_BASE_URL`         | temporal               | Required full API root for local summarization; optional cloud API override                                         |
| `SUMMARIZATION_MODEL`            | temporal               | Detailed-record, recap, and title model ID; required for cloud providers (local default: `qwen3.6-35b-a3b`)         |
| `SUMMARIZATION_REASONING_EFFORT` | temporal               | Optional cloud reasoning effort: `none`, `low`, `medium`, `high`, `xhigh`, or `max`; OpenAI also supports `minimal` |
| `SUMMARIZATION_THINKING_BUDGET`  | temporal               | Local llama.cpp reasoning-token budget (default: `8192`)                                                            |
| `CHAT_PROVIDER`                  | web                    | `local`, `openai`, or `anthropic` (default: `local`)                                                                |
| `CHAT_API_KEY`                   | web                    | API key; required for OpenAI and Anthropic, optional for local                                                      |
| `CHAT_BASE_URL`                  | web                    | Required full API root for local chat; optional cloud API override                                                  |
| `CHAT_MODEL`                     | web                    | Session chat model ID; required for cloud providers (local default: `qwen3.6-35b-a3b`)                              |
| `CHAT_REASONING_EFFORT`          | web                    | Optional cloud reasoning effort: `none`, `low`, `medium`, `high`, `xhigh`, or `max`; OpenAI also supports `minimal` |
| `CHAT_THINKING_BUDGET`           | web                    | Local llama.cpp reasoning-token budget for session chat (default: `2048`)                                           |
| `BODY_SIZE_LIMIT`                | web                    | Maximum manual-upload request size; defaults to `10G` in Docker Compose                                             |
| `DATABASE_URL`                   | db                     | PostgreSQL connection string                                                                                        |
| `WEB_URL`                        | temporal               | Public web origin used for completed-session links (for example, `https://libby.bot`)                               |

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
