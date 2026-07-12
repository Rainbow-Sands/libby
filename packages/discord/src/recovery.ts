import type { Client, VoiceBasedChannel } from "discord.js";
import { getTemporalClient, sessionEnded } from "@rainbot/temporal";
import { attachRecordingSession } from "./session.ts";
import { MEDIA_PATH } from "./env.ts";
import path from "path";

export async function recoverSessions(bot: Client): Promise<void> {
  console.log("Recovering any active sessions.");
  const temporalClient = await getTemporalClient();

  for (const [guildId, guild] of bot.guilds.cache) {
    const iter = temporalClient.workflow.list({
      query: `GuildId = "${guildId}" AND ExecutionStatus = "Running"`,
    });

    for await (const workflow of iter) {
      // workflowId format: "session:{guildId}:{channelId}:{sessionId}"
      const parts = workflow.workflowId.split(":");
      if (parts.length !== 4 || parts[0] !== "session") continue;

      const [, , channelId, sessionId] = parts;
      const handle = temporalClient.workflow.getHandle(workflow.workflowId);
      const sessionDir = path.join(MEDIA_PATH, guildId, sessionId);

      const channel = guild.channels.cache.get(channelId);
      if (!channel?.isVoiceBased()) {
        console.log(`[recovery] channel ${channelId} not found, ending workflow`);
        await handle.signal(sessionEnded).catch(() => {});
        continue;
      }

      const voiceChannel = channel as VoiceBasedChannel;
      const humanCount = [...voiceChannel.members.values()].filter((m) => !m.user.bot).length;

      if (humanCount === 0) {
        console.log(`[recovery] channel empty for session ${sessionId}, ending workflow`);
        await handle.signal(sessionEnded).catch(() => {});
        continue;
      }

      console.log(`[recovery] resuming session ${sessionId} in guild ${guildId}`);
      attachRecordingSession(bot, voiceChannel, handle, guildId, channelId, sessionId, sessionDir);
    }
  }
}
