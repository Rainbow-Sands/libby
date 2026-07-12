import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { removeCampaignMember } from "@rainbot/db";
import { campaignAutocomplete } from "./autocomplete.ts";
import { requireDmOfCampaign } from "./guard.ts";

export const removePlayer = {
  data: new SlashCommandBuilder()
    .setName("remove-player")
    .setDescription("Remove a player from a campaign")
    .addStringOption((option) =>
      option
        .setName("campaign")
        .setDescription("Which campaign to remove the player from")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addUserOption((option) =>
      option.setName("player").setDescription("The player to remove").setRequired(true),
    ),
  autocomplete: campaignAutocomplete,
  handler: async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply("This command can only be used in a server.");
      return;
    }

    const campaignId = interaction.options.getString("campaign", true);
    const player = interaction.options.getUser("player", true);

    const meta = await requireDmOfCampaign(interaction, campaignId);
    if (!meta) return;

    let removed: boolean;
    try {
      removed = await removeCampaignMember(campaignId, player.id);
    } catch (err) {
      console.error("[remove-player] failed to remove player:", err);
      await interaction.reply("Failed to remove the player.");
      return;
    }

    if (!removed) {
      await interaction.reply("That user isn't a player in this campaign.");
      return;
    }

    await interaction.reply(`Removed <@${player.id}> from the campaign.`);
  },
};
