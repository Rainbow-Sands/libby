# @rainbot/temporal — AGENTS.md

Temporal workers and the session pipeline. See the root `AGENTS.md` for
workspace-wide conventions.

## Layout

- `worker.ts` — process entrypoint; starts the workers.
- `workflows/session.ts` — the durable session workflow (orchestration only).
- `activities/transcribe.ts` — whisper transcription, transcript aggregation,
  and the detailed-record/recap/title calls.
- `activities/persist.ts` — writes pipeline output to Postgres via `@rainbot/db`.
- `prompts.ts` / `text.ts` — LLM system prompts and response cleanup.
- `summarization-inference.ts` — local/OpenAI/Anthropic provider configuration.
- `scripts/test-summarize.ts` — standalone detailed-record pipeline harness.
- `client.ts`, `types.ts`, `env.ts`, `index.ts`.

## worker.ts must actually start the workers

The Docker entrypoint just executes `worker.ts`, so the file must **call
`startWorker()` at module top level**. If it only exports the function, the
process exits immediately and (under `restart: unless-stopped`) silently
loops "Restarting" with no logs. Don't remove that top-level call.

## Workflow determinism — the cardinal rule

`workflows/session.ts` runs in Temporal's deterministic sandbox. **No I/O, no
`Date.now()`/random, no DB, no llama/whisper, no `fs`, no env reads inside
workflow code.** Every side effect goes through an activity via
`proxyActivities`. The workflow imports activities as `import type` only, so the
activities' real dependencies (`@rainbot/db`, `node:fs`, `fetch`) never enter the
workflow bundle — keep it that way.

## Workers & task queues (all in `worker.ts`)

| Queue                   | Activities                                           |
| ----------------------- | ---------------------------------------------------- |
| `rainbot`               | session and regeneration workflows                   |
| `rainbot-transcription` | transcription, persistence, regeneration preparation |
| `rainbot-summarization` | `summarize`, `recap`, `generateTitle`                |

Workflow behaviour: parallel per-segment transcription; 1-hour idle timeout;
`continueAsNew` at 500 segments; status transitions persisted through activities.
The regeneration workflow rebuilds `transcript.json` from the lossless database
copy, then replaces only the detailed record, recap, and title.

## Search attributes

`GuildId`, `ChannelId`, `SegmentCount` must exist in the namespace (registered by
the `temporal-setup` compose service / README commands). **`Status` is reserved
by Temporal** — don't add it as a custom search attribute; recovery filters on
the built-in `ExecutionStatus` instead.

## Prompts & the test harness

- `prompts.ts` and `text.ts` (fence-strip, title normalize) are the **single
  source of truth** shared by the activities and `scripts/test-summarize.ts`.
  Don't re-inline prompt strings in the activities.
- Iterate on prompts/models without recording a session:
  `pnpm --filter @rainbot/temporal test:summarize <transcript.txt>`. The harness
  uses the same provider configuration and inference code as the activities.

## Transcript format

`aggregateTranscript` no longer simplifies anything — it just collects every
segment's raw data (timestamp, userId, username, text, whisper's own
per-segment metadata) into `transcript.json`, sorted by timestamp, and that's
exactly what gets persisted to `sessions.transcript` (jsonb). Formatting for
detailed-record inference — retaining utterance timestamps and speaker
boundaries and prepending the cast legend (`- <name> plays <character>`) —
happens **inside `summarize`**, via `formatTranscriptForInference` from
`@rainbot/db`. Keeping the DB copy lossless means improvements to that
formatting can be re-run over already-recorded sessions later without
re-transcribing. The complete formatted transcript is sent in one detailed-record
request; there is no chunking or context-size preflight. `env.ts` asserts
`TEMPORAL_URL` and `TRANSCRIPTION_BASE_URL`. `SUMMARIZATION_PROVIDER` selects `local`,
`openai`, or `anthropic`; the cloud providers require `SUMMARIZATION_API_KEY` and
`SUMMARIZATION_MODEL`. Local summarization requires `SUMMARIZATION_BASE_URL` and
defaults to model `qwen3.6-35b-a3b` with an `8192`-token llama.cpp thinking budget.
`SUMMARIZATION_REASONING_EFFORT` configures cloud reasoning when set. Generated
output uses the provider or model's native limit.
