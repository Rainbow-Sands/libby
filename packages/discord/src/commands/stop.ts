import { SlashCommandBuilder, type CommandInteraction } from "discord.js";
import { getActiveSession } from "../recording.ts";

export const stop = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop recording and start transcription"),
  handler: async (interaction: CommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply("This command can only be used in a server.");
      return;
    }

    const session = getActiveSession(interaction.guildId);
    if (!session) {
      await interaction.reply("No recording is currently in progress.");
      return;
    }

    // Finalizing clips can take longer than Discord's 3-second window to reply.
    await interaction.deferReply();
    const { segmentCount } = session;
    try {
      await session.end();
    } catch (error) {
      console.error(`[stop] could not end session in ${interaction.guildId}:`, error);
      await interaction.editReply(
        "Something went wrong while stopping the recording. Libby will finish it the next time it restarts.",
      );
      return;
    }

    await interaction.editReply(
      `Recording stopped. ${segmentCount} segment(s) recorded. Transcription and recap generation have started.`,
    );
  },
};
