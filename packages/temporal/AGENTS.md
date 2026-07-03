# @rainbot/temporal — AGENTS.md

Temporal workers and the session pipeline. See the root `AGENTS.md` for
workspace-wide conventions.

## Layout

- `worker.ts` — process entrypoint; starts the workers.
- `workflows/session.ts` — the durable session workflow (orchestration only).
- `activities/transcribe.ts` — whisper transcription, transcript aggregation +
  cast legend, and the llama summarize/recap/title calls.
- `activities/persist.ts` — writes pipeline output to Postgres via `@rainbot/db`.
- `prompts.ts` / `text.ts` — LLM system prompts and response cleanup.
- `scripts/test-summarize.ts` — standalone summarization harness.
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

| Queue | Activities |
|---|---|
| `rainbot` | the workflow |
| `rainbot-transcription` | `transcribeSegment`, `aggregateTranscript`, all `persist*` |
| `rainbot-summarization` | `summarize`, `recap`, `generateTitle` |

Workflow behaviour: parallel per-segment transcription; 1-hour idle timeout;
`continueAsNew` at 500 segments; status transitions persisted through activities.

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
  `pnpm --filter @rainbot/temporal test:summarize <transcript.txt>`. Swapping the
  llama model is a llama.cpp concern — everything here just talks to
  `INFERENCE_SUMMARIZE_URL`.

## Transcript format

`aggregateTranscript` produces `transcript.txt`: a **cast legend** (`- <name>
plays <character>`) followed by the body, timestamps dropped, consecutive
same-speaker turns merged. `env.ts` asserts `TEMPORAL_URL`,
`INFERENCE_TRANSCRIBE_URL`, `INFERENCE_SUMMARIZE_URL`.
