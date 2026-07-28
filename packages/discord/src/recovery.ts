import type { Client, VoiceBasedChannel } from "discord.js";
import { getAudioSegmentsForRecovery, getRecoverableSessionsForGuild } from "@rainbot/db";
import {
  beginSessionShutdown,
  completeAudioSegment,
  discardAudioSegment,
  finishSessionShutdown,
} from "@rainbot/worker";
import { attachRecordingSession, hasMeaningfulAudio } from "./session.ts";
import { rm } from "node:fs/promises";
import path from "node:path";

async function recoverSegments(
  sessionId: string,
  runId: string,
  sessionDir: string,
): Promise<number> {
  const segments = await getAudioSegmentsForRecovery(sessionId);
  for (const segment of segments) {
    if (segment.runId !== runId) continue;
    if (segment.audioStatus === "ready") {
      continue;
    }

    const audioPath = path.join(sessionDir, segment.audioFile);
    if (hasMeaningfulAudio(audioPath)) {
      await completeAudioSegment(sessionId, runId, audioPath, segment);
    } else {
      await discardAudioSegment(
        sessionId,
        runId,
        segment.segmentId,
        "Recording was interrupted before a usable clip was written",
      );
    }
  }
  return segments.length;
}

async function closeRecoveredSession(
  sessionId: string,
  runId: string,
  status: string,
  sessionDir: string,
): Promise<void> {
  if (status === "recording") await beginSessionShutdown(sessionId, runId);
  try {
    await finishSessionShutdown(sessionId, runId);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
}

export async function recoverSessions(bot: Client): Promise<void> {
  console.log("Recovering active sessions from Postgres.");

  for (const [guildId, guild] of bot.guilds.cache) {
    for (const session of await getRecoverableSessionsForGuild(guildId)) {
      const segmentCount = await recoverSegments(session.id, session.runId, session.sessionDir);

      if (session.status === "closing") {
        console.log(`[recovery] completing shutdown for session ${session.id}`);
        await closeRecoveredSession(session.id, session.runId, session.status, session.sessionDir);
        continue;
      }

      const channel = guild.channels.cache.get(session.channelId);
      if (!channel?.isVoiceBased()) {
        console.log(`[recovery] channel ${session.channelId} not found, ending session`);
        await closeRecoveredSession(session.id, session.runId, session.status, session.sessionDir);
        continue;
      }

      const voiceChannel = channel as VoiceBasedChannel;
      const humanCount = [...voiceChannel.members.values()].filter(
        (member) => !member.user.bot,
      ).length;
      if (humanCount === 0) {
        console.log(`[recovery] channel empty for session ${session.id}, ending session`);
        await closeRecoveredSession(session.id, session.runId, session.status, session.sessionDir);
        continue;
      }

      console.log(`[recovery] resuming session ${session.id} in guild ${guildId}`);
      attachRecordingSession(
        bot,
        voiceChannel,
        guildId,
        session.channelId,
        session.id,
        session.runId,
        session.sessionDir,
        segmentCount,
      );
    }
  }
}
