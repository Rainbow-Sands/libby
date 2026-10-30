import {
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getUnlinkedCampaignsForDm, linkCampaignToGuild } from "@rainbot/db";
import { WEB_URL } from "../env.ts";

// Campaigns are created in the web app. This attaches one to the server it is
// run in, so /start, /reminder and the player commands can find it.
export const linkCampaign = {
  data: new SlashCommandBuilder()
    .setName("link-campaign")
    .setDescription("Link a campaign you run in the Libby web app to this server")
    .addStringOption((option) =>
      option
        .setName("campaign")
        .setDescription("Which of your campaigns to link")
        .setRequired(true)
        .setAutocomplete(true),
    ),
  autocomplete: async (interaction: AutocompleteInteraction) => {
    const focused = interaction.options.getFocused().toLowerCase();
    const campaigns = await getUnlinkedCampaignsForDm(interaction.user.id);
    await interaction.respond(
      campaigns
        .filter((c) => c.name.toLowerCase().includes(focused))
        .slice(0, 25)
        .map((c) => ({ name: c.name, value: c.id })),
    );
  },
  handler: async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply("This command can only be used in a server.");
      return;
    }

    const campaignId = interaction.options.getString("campaign", true);
    const linkable = await getUnlinkedCampaignsForDm(interaction.user.id);
    const campaign = linkable.find((c) => c.id === campaignId);
    if (!campaign) {
      await interaction.reply({
        content:
          linkable.length === 0
            ? `You have no campaigns waiting to be linked. Create one at ${WEB_URL}, then run this again.`
            : "Pick one of your campaigns from the list.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let result;
    try {
      result = await linkCampaignToGuild(campaignId, interaction.user.id, {
        id: interaction.guildId,
        name: interaction.guild.name,
      });
    } catch (err) {
      console.error("[link-campaign] failed to link campaign:", err);
      await interaction.reply("Failed to link the campaign.");
      return;
    }

    if (result !== "linked") {
      await interaction.reply({
        content:
          result === "already-linked"
            ? "That campaign is already linked to a server."
            : "Only the campaign's DM can link it.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply(
      `Linked **${campaign.name}** to this server. ` +
        "Use `/start` to record a session and `/reminder` to post session reminders here.",
    );
  },
};
