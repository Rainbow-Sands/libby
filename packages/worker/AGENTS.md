# @rainbot/worker — AGENTS.md

pg-boss-backed session processing. See the root `AGENTS.md` for workspace-wide
conventions.

## Layout

- `worker.ts` — process entrypoint and graceful shutdown.
- `session-worker.ts` — registers pg-boss handlers for segment and run jobs.
- `pipeline.ts` — public recording/regeneration transitions used by Discord/web.
- `tasks.ts` — whisper and inference calls.
- `prompts.ts` / `text.ts` — shared prompts and response cleanup.
- `summarization-inference.ts` — local/OpenAI/Anthropic provider configuration.
- `scripts/evaluate-inference.ts` — standalone ledger/recap/title pipeline harness.
- `scripts/backfill-recaps.ts` — queues a campaign recap backfill.

## Durable state

pg-boss provides the queue in PostgreSQL; application tables remain the source
of truth for workflow state:

- `sessions.active_run_id` identifies the only run allowed to replace a session.
- `processing_runs` holds an inference run's source transcript reference and
  small recap/title output. Generated artifacts identify their run through
  `session_artifacts.generated_by_run_id`.
- `session_artifacts` holds immutable transcript/session-ledger object metadata.
- `session_segments` is the audio manifest and per-activation transcription checkpoint.
- Each ready activation has one `transcribe-segment` job. The closing barrier
  creates one `advance-processing-run` job after every activation is terminal.
- Queue messages carry stable application IDs; handlers still claim conditional
  application state before making an external request.
- Never hold a database transaction open while calling Whisper or an LLM.
- A job may expire, retry, or be redelivered. Keep transitions idempotent and
  reject stale run IDs.

Activation audio and durable session artifacts use `@rainbot/storage` with
separate private buckets. Workers never depend on a shared filesystem. Store
stable object keys in Postgres, never expiring signed URLs.

## Prompts and inference

`prompts.ts` and `text.ts` are the single source of truth shared by workers and
the standalone test harness:

```sh
pnpm --filter @rainbot/worker eval:inference <transcript.txt> [previous-recap.md]
```

A run moves through three inference stages, each one call:

1. `summarizing` writes the **session ledger**: a structured extraction
   (events, entities, loot, threads, quotes, rulings, where the party left off)
   stored as a JSON artifact. It is the factual source for the recap and chat;
   nobody reads it directly.
2. `recapping` reads the ledger, the transcript, and the previous finished
   session's notes (`getPreviousSessionNotes`) and writes the sectioned recap.
   Open threads carry forward from session to session through those notes.
3. `titling` titles the markdown rendering of the recap.

The ledger and recap use AI SDK structured output with the zod schemas in
`@rainbot/db`'s `session-notes.ts`.

### Recap backfill

Sessions processed before sectioned recaps can be regenerated campaign by
campaign:

```sh
pnpm --filter @rainbot/worker backfill:recaps <campaign-id> [...]   # or --all
node src/scripts/backfill-recaps.ts --all                           # in the worker container
```

This only enqueues a `backfill-campaign-recaps` job (a `stately` queue keyed
by campaign, so repeating it is harmless). The worker starts an ordinary
inference regeneration for the oldest `done` session without
`recap_sections`, then re-checks every minute, waiting while any session in
the campaign is processing. Oldest first matters because each recap reads the
previous session's open threads. A session whose regeneration fails becomes
`failed` and is skipped.

`TRANSCRIPTION_URL` is the complete whisper request URL.
`SUMMARIZATION_PROVIDER` selects `local`, `openai`, or `anthropic`; cloud
providers require `SUMMARIZATION_API_KEY` and `SUMMARIZATION_MODEL`. Local
summarization requires `SUMMARIZATION_BASE_URL`.
