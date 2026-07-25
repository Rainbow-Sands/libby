# @rainbot/worker — AGENTS.md

BullMQ producers and workers for the session pipeline. See the root `AGENTS.md`
for workspace-wide conventions.

## Layout

- `worker.ts` — process entrypoint; starts all workers and periodic reconciliation.
- `workers.ts` — one BullMQ worker per job type.
- `queues.ts` — queue names, Redis connection, stable job IDs, and producers.
- `pipeline.ts` — public recording/regeneration transitions used by Discord/web.
- `tasks.ts` — whisper and inference calls.
- `prompts.ts` / `text.ts` — shared prompts and response cleanup.
- `summarization-inference.ts` — local/OpenAI/Anthropic provider configuration.
- `segment-metadata.ts` — legacy filesystem manifest compatibility.
- `scripts/test-summarize.ts` — standalone detailed-record pipeline harness.

## Durable state

Postgres, not Redis, is the source of truth:

- `sessions.active_run_id` identifies the only run allowed to replace a session.
- `processing_runs` holds intermediate transcript/report/recap/title output.
- `session_segments` permanently records audio metadata and current
  transcription state.
- Aggregation is claimed with a conditional transaction only after recording is
  closed and every ready segment for the active run is completed.

Jobs carry IDs only. Keep large transcript and inference output in Postgres or
media storage. Every processor must tolerate duplicate execution and must reject
stale run IDs.

## Queues and recovery

Queues are deliberately separated by job type: transcription, aggregation,
summarization, recap, title, and notification. A successful worker persists its
output before enqueueing the next stage. `worker.ts` reconciles DB state back
into BullMQ at startup and every minute, closing the DB/Redis crash window.

Use stable job IDs. Do not include `:` in BullMQ job IDs.

## Prompts and inference

`prompts.ts` and `text.ts` are the single source of truth shared by workers and
the standalone test harness:

```sh
pnpm --filter @rainbot/worker test:summarize <transcript.txt>
```

`TRANSCRIPTION_URL` is the complete whisper request URL.
`SUMMARIZATION_PROVIDER` selects `local`, `openai`, or `anthropic`; cloud
providers require `SUMMARIZATION_API_KEY` and `SUMMARIZATION_MODEL`. Local
summarization requires `SUMMARIZATION_BASE_URL`.
