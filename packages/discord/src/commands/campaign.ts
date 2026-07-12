import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { createCampaign } from "@rainbot/db";

export const campaign = {
  data: new SlashCommandBuilder()
    .setName("campaign")
    .setDescription("Create a new campaign (you become the DM)")
    .addStringOption((option) =>
      option.setName("name").setDescription("The name of the campaign").setRequired(true),
    ),
  handler: async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply("This command can only be used in a server.");
      return;
    }

    const name = interaction.options.getString("name", true);

    try {
      await createCampaign({
        guildId: interaction.guildId,
        guildName: interaction.guild.name,
        name,
        dm: {
          id: interaction.user.id,
          username: interaction.user.username,
        },
      });
    } catch (err) {
      console.error("[campaign] failed to create campaign:", err);
      await interaction.reply("Failed to create the campaign.");
      return;
    }

    await interaction.reply(
      `Created campaign **${name}**.\nDM: <@${interaction.user.id}>\n` +
        "Add players with `/add-player`.",
    );
  },
};
