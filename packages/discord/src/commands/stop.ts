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

    const { segmentCount, sessionDir } = session;
    await session.end();

    await interaction.reply(
      `Recording stopped. ${segmentCount} segment(s) recorded. Transcript and recap will be saved to \`${sessionDir}\`.`,
    );
  },
};
