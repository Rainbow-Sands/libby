# @rainbot/db — AGENTS.md

Drizzle ORM schema, Postgres client, and all shared queries. See the root
`AGENTS.md` for workspace-wide conventions.

## Layout

- `schema.ts` — table definitions; the single source of truth for the data model.
- `client.ts` — the `db` instance.
- `campaigns.ts` — campaign/member mutations.
- `sessions.ts` — session upserts + summary/recap/title/transcript writes.
- `queries.ts` — read queries used by web and Temporal.
- `transcript.ts` — the `Transcript`/`TranscriptSegment` JSON shape stored in
  `sessions.transcript`, plus `simplifyTranscript` (the LLM-facing formatting
  transform, shared by Temporal's `summarize` activity and web's chat context).
- `index.ts` — the package's **public API**. Export anything other packages need
  from here; consumers import from `@rainbot/db`, never deep paths.

## The client is lazily initialized — keep it that way

`client.ts` is a `Proxy` that defers reading `DATABASE_URL` until the first query.
This is deliberate: the web app imports `@rainbot/db` at build time, and reading
the env var at module load would break `vite build` (where `DATABASE_URL` is
absent). **Do not read `DATABASE_URL` at import time** or add top-level DB
connections.

## Migrations

Workflow after any change to `schema.ts`:

```sh
pnpm --filter @rainbot/db db:generate   # writes drizzle/NNNN_*.sql + updates meta/
pnpm --filter @rainbot/db db:migrate    # applies to the DB in DATABASE_URL
```

- Migrations are **forward-only and append-only**. Never edit or delete a
  migration that has been committed or applied — add a new one.
- `drizzle/meta/_journal.json` and the snapshot files must stay in sync with the
  `.sql` files. Let `drizzle-kit` manage them; don't hand-edit. (If you must
  discard an _uncommitted, never-applied_ migration, delete its `.sql` +
  snapshot and revert the journal entry, then regenerate.)
- In production, the `db-migrate` compose service runs `db:migrate` on deploy.

## Data model notes

- `sessions` holds `transcript`, `summary`, `recap`, and `title` as **nullable
  columns directly on the row** (not side tables) — they're 1:1 with a session
  and written independently as the pipeline produces them.
- `sessions.transcript` is `jsonb`, typed as `Transcript` (see `transcript.ts`):
  every recorded segment, lossless (timestamp, userId, username, text,
  whisper's own per-segment metadata). LLM-facing simplification (dropping
  timestamps, merging same-speaker turns, prepending the cast legend) happens
  in `simplifyTranscript`, not at write time — so improving that formatting
  later can be re-run over already-recorded sessions without re-transcribing.
  This is exactly what `simplifyTranscript` already does with Whisper's own
  `segments[]` (verbatim under `TranscriptSegment.whisper`): it explodes each
  Discord voice activation into finer-grained per-utterance timestamps
  (correcting for background noise keeping an activation open long after
  someone stopped talking) and drops individual sub-segments Whisper itself
  flags as noise — the pattern to extend for future formatting improvements.
  No backwards compatibility with the old plain-text format: the migration
  that introduced this column type cleared existing rows (`USING NULL`) rather
  than carrying a legacy-string code path — pre-production, nothing to keep.
- `campaign_members` has `role` (`dm` | `player`) and `characterName` (null for
  the DM). The cast legend and player management depend on these.
- Writes are idempotent upserts so Temporal activity retries are safe.
