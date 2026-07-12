import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { addCampaignMember } from "@rainbot/db";
import { campaignAutocomplete } from "./autocomplete.ts";
import { requireDmOfCampaign } from "./guard.ts";

export const addPlayer = {
  data: new SlashCommandBuilder()
    .setName("add-player")
    .setDescription("Add a player and their character to a campaign")
    .addStringOption((option) =>
      option
        .setName("campaign")
        .setDescription("Which campaign to add the player to")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addUserOption((option) =>
      option.setName("player").setDescription("The player to add").setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("character")
        .setDescription("The name of the player's character")
        .setRequired(true),
    ),
  autocomplete: campaignAutocomplete,
  handler: async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply("This command can only be used in a server.");
      return;
    }

    const campaignId = interaction.options.getString("campaign", true);
    const player = interaction.options.getUser("player", true);
    const characterName = interaction.options.getString("character", true);

    const meta = await requireDmOfCampaign(interaction, campaignId);
    if (!meta) return;

    if (player.id === meta.dmId) {
      await interaction.reply("The DM is already part of the campaign.");
      return;
    }

    try {
      await addCampaignMember({
        campaignId,
        user: { id: player.id, username: player.username },
        characterName,
      });
    } catch (err) {
      console.error("[add-player] failed to add player:", err);
      await interaction.reply("Failed to add the player.");
      return;
    }

    await interaction.reply(`Added <@${player.id}> to the campaign as **${characterName}**.`);
  },
};
