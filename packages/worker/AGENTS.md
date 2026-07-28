# @rainbot/worker — AGENTS.md

Postgres-backed session processing and shared audio-storage operations. See the
root `AGENTS.md` for workspace-wide conventions.

## Layout

- `worker.ts` — process entrypoint and graceful shutdown.
- `session-worker.ts` — claims leased processing runs and advances every stage.
- `pipeline.ts` — public recording/regeneration transitions used by Discord/web.
- `storage.ts` — S3-compatible activation upload/download/delete operations.
- `tasks.ts` — whisper and inference calls.
- `prompts.ts` / `text.ts` — shared prompts and response cleanup.
- `summarization-inference.ts` — local/OpenAI/Anthropic provider configuration.
- `segment-metadata.ts` — legacy filesystem manifest compatibility.
- `scripts/test-summarize.ts` — standalone detailed-record pipeline harness.

## Durable state

Postgres is both the queue and the source of truth:

- `sessions.active_run_id` identifies the only run allowed to replace a session.
- `processing_runs` holds leases and intermediate transcript/report/recap/title output.
- `session_segments` is the audio manifest and per-activation transcription checkpoint.
- Workers claim whole sessions, then process activation rows with bounded concurrency.
- Never hold a database transaction open while calling Whisper or an LLM.
- A lease may expire and duplicate work may occur. Keep transitions idempotent
  and reject stale run IDs.

New activation audio uses private S3-compatible storage. Existing
`audio_storage = 'local'` rows remain readable from `MEDIA_PATH` during
migration. Store object keys in Postgres, never expiring signed URLs.

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
