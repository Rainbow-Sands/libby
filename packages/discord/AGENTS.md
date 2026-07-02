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
- `env.ts` — asserts `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `MEDIA_PATH`.

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

## Recording

- Gateway intents: `Guilds` and `GuildVoiceStates` (voice state cache is how we
  find the caller's channel and resolve usernames).
- Each voice activation becomes one ogg/opus clip via **ffmpeg** (required at
  runtime), then signals `segmentRecorded` to the workflow.
- The transcript speaker label is the **account username** resolved from the
  guild member cache (`session.ts`), falling back to the user id. It is joined to
  campaign members by `userId` downstream, so keep the id flowing through.

## State & recovery

There is **no on-disk session state** — the bot is horizontally scalable. On
startup, `recoverSessions()` queries Temporal for running workflows in each guild
and either rejoins the voice channel or signals the workflow to end. Keep session
state in the `activeSessions` map + Temporal, not on the filesystem.
