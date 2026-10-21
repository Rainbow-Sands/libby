# @rainbot/db — AGENTS.md

Drizzle ORM schema, Postgres client, and all shared queries. See the root
`AGENTS.md` for workspace-wide conventions.

## Layout

- `schema.ts` — table definitions; the single source of truth for the data model.
- `client.ts` — the `db` instance.
- `domain.ts` — shared literal values and types for persisted roles and states.
- `campaigns.ts` — campaign/member mutations.
- `queries.ts` — read queries used by web and workers.
  `getCampaignAccess` resolves admin/member access in one database query.
- `recording.ts` — recording lifecycle, clip registration, and crash recovery.
- `transcription.ts` — segment transcription checkpoints and aggregation barrier.
- `processing-runs.ts` — inference state, publication, and queue reconciliation.
- `jobs.ts` — lazy pg-boss lifecycle, queue definitions, and transactional sends.
- `artifacts.ts` — shared metadata types for durable session objects.
- `session-notes.ts` — zod schemas and types for the session ledger and the
  sectioned recap, shared by the worker (structured output) and readers.
- `backfill.ts` — picks the next session a campaign recap backfill should
  regenerate.
- `world.ts` — the world wiki's page kinds and content shape, the zod schema
  for a session's world update, and `planWorldUpdate`, the pure function
  that turns one update into page revisions.
- `world-links.ts` — name matching and text linking. Free of database
  imports and exported as `@rainbot/db/world-links` so browser code can use it.
- `world-store.ts` — world reads (snapshots as of a session, page detail,
  a session's changes), the ordered world update step, and avatars.
- `transcript.ts` — the `Transcript`/`TranscriptSegment` JSON shape stored in
  transcript artifacts, plus display and inference formatting transforms.
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
- In production, the `db-migrate` compose service runs `db:migrate` on deploy;
  this applies both Drizzle application migrations and pg-boss schema migrations.

## Data model notes

- `session_artifacts` stores versioned S3 object metadata for transcripts and
  session ledgers (JSON typed as `SessionLedger`). Sessions processed before
  the ledger keep their markdown `detailed_record` artifacts, which chat still
  reads. `is_current` is switched atomically when a processing run
  publishes, so failed regeneration leaves old results intact. Recap/title stay
  on `sessions` for fast listings and previews: `recap_sections` holds the
  structured `SessionRecap` and `recap` its markdown rendering (or a free-form
  recap from before recaps were sectioned).
- A transcript artifact is JSON typed as `Transcript` (see `transcript.ts`):
  every recorded segment, lossless (timestamp, userId, username, text,
  whisper's own per-segment metadata). LLM-facing formatting prepends the cast
  legend and replaces per-line timestamps with an elapsed `[h:mm:ss]` marker
  each minute, which the model cites and the recap links back to. It happens in
  `formatTranscriptForInference`, not at write time — so improving that
  formatting later can be re-run over already-recorded sessions without
  re-transcribing. Both it and the display-oriented
  `formatTranscriptForDisplay` use Whisper's own `segments[]` (verbatim under
  `TranscriptSegment.whisper`) to explode each Discord voice activation into
  finer-grained per-utterance timestamps, which preserve chronological ordering
  despite background noise keeping an activation open long after someone
  stopped talking. Both formats drop individual sub-segments Whisper itself
  flags as noise — the pattern to extend for future formatting improvements.
- `campaign_members` has `role` (`dm` | `player`) and `characterName` (null for
  the DM). The cast legend and player management depend on these.
- The world wiki: `world_pages` holds a page's stable identity (slug, kind,
  avatar, the player whose character it is). Its content lives in immutable
  `world_page_revisions`, one per page per session that changed it, holding
  the whole `WorldPageContent` (facts with session citations, aliases,
  summary). The page "as of session N" is its newest revision from a session
  that started at or before N. `world_updates` records each session's update
  and its report (possible duplicates, name corrections); sessions are applied
  oldest first. `world_page_moments` copies recap epic moments onto the pages
  of those who feature in them. `world_page_avatars` keeps every uploaded
  avatar; removing one only clears `world_pages.avatar_id`.
- `users.is_admin` grants application-wide visibility into every campaign and
  is managed manually.
- A ready audio segment and its `transcribe-segment` job are committed in the
  same transaction. Completing the last segment after session close advances
  the run and enqueues its `advance-processing-run` job atomically.
- Processing writes use conditional transitions so expired or redelivered
  pg-boss jobs are safe.
