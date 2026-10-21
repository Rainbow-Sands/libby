# @rainbot/discord — AGENTS.md

The Discord bot: slash commands, voice recording, and crash recovery. See the
root `AGENTS.md` for workspace-wide conventions.

## Layout

- `index.ts` — entrypoint: register commands, start the bot, recover sessions.
- `discord.ts` — client setup, command registry, interaction routing.
- `commands/` — one module per slash command.
- `session.ts` — voice join, per-activation recording, workflow signalling.
- `recording.ts` — in-memory `activeSessions` map (keyed by guildId).
- `recovery.ts` — rejoin/resume running sessions after a restart.
- `reminders.ts` — polls for upcoming sessions and posts reminders.
- `env.ts` — asserts Discord and S3-compatible storage configuration.

## Commands

A command module is `{ data: SlashCommandBuilder, handler, autocomplete? }`.
To add one:

1. Create `commands/<name>.ts`.
2. Add it to the `commands` object in `discord.ts`. **The object key must equal
   the command's name** — routing does `commands[interaction.commandName]`. For
   hyphenated names use a quoted key, e.g. `"add-player": addPlayer`.
3. Commands **re-register on every startup** via `registerCommands()`; no manual
   deploy step.

Campaign selection uses the shared `commands/autocomplete.ts` helper; DM-only
management commands use `commands/guard.ts` (`requireDmOfCampaign`).

## Session reminders

`/reminder` records the channel it was run in (`campaign_reminders`, one row per
campaign) and replies with a link to the web app's schedule page, where the DM
sets the weekly day, time and time zone plus the recap rotation. The scheduler
claims each occurrence with a conditional update before posting, so a reminder
is sent at most once; an occurrence that started while the bot was down is
skipped rather than sent late. Claiming also assigns recap duty, and
`/skip-recapper` hands it to the next member in line.

## Recording

- Gateway intents: `Guilds` and `GuildVoiceStates` (voice state cache is how we
  find the caller's channel and resolve usernames).
- Each voice activation becomes one ogg/opus clip via **ffmpeg** and is uploaded
  to S3-compatible object storage. Recording starts in the receiver's "start"
  handler, which runs on the user's first packet before that packet reaches
  subscribers, so subscribe synchronously there: any `await` before
  `receiver.subscribe` loses the start of what was said. The clip is registered
  in Postgres alongside the recording, and a clip whose registration fails is
  deleted instead of uploaded.
- Marking an upload ready enqueues its pg-boss transcription job in the same
  transaction, so the worker can transcribe while the session is still active.
- Session shutdown first stops new activations, then finalizes all active
  receiver/decoder/ffmpeg pipelines before closing the durable session. The
  close transition and transcription barrier then enqueue post-session work
  when every activation is terminal. Keep this ordering so speech in progress
  during `/stop` or auto-end is retained.
- The transcript speaker label is the **account username** resolved from the
  guild member cache (`session.ts`), falling back to the user id. It is joined to
  campaign members by `userId` downstream, so keep the id flowing through.

## State & recovery

On startup, `recoverSessions()` queries Postgres for recording/closing sessions,
repairs clips interrupted by a crash, and either rejoins the voice channel or
finishes shutdown. Segment IDs must remain globally unique so a restarted bot
cannot overwrite clips from the previous process.
