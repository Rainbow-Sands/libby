import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import {
  getCampaignAccess,
  getCampaignMeta,
  getCampaignRemindersForChannel,
  skipCampaignRecapper,
} from "@rainbot/db";
import { campaignAutocomplete } from "./autocomplete.ts";

export const skipRecapper = {
  data: new SlashCommandBuilder()
    .setName("skip-recapper")
    .setDescription("Skip this session's recapper; whoever recapped least recently takes over")
    .addStringOption((option) =>
      option
        .setName("campaign")
        .setDescription("Which campaign (defaults to the one reminding this channel)")
        .setAutocomplete(true),
    ),
  autocomplete: campaignAutocomplete,
  handler: async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply("This command can only be used in a server.");
      return;
    }

    let campaignId = interaction.options.getString("campaign");
    if (!campaignId) {
      const reminders = await getCampaignRemindersForChannel(interaction.channelId);
      if (reminders.length !== 1) {
        await interaction.reply({
          content:
            reminders.length === 0
              ? "No campaign posts reminders in this channel. Pick the campaign to skip."
              : "Several campaigns post reminders in this channel. Pick the campaign to skip.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      campaignId = reminders[0].campaignId;
    }

    const meta = await getCampaignMeta(campaignId);
    if (!meta || meta.guildId !== interaction.guildId) {
      await interaction.reply("That campaign does not exist in this server.");
      return;
    }
    const access = await getCampaignAccess(campaignId, interaction.user.id);
    if (!access.isMember) {
      await interaction.reply({
        content: "Only members of the campaign can skip its recapper.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let result;
    try {
      result = await skipCampaignRecapper(campaignId);
    } catch (err) {
      console.error("[skip-recapper] failed to skip recapper:", err);
      await interaction.reply("Failed to skip the recapper.");
      return;
    }

    if (result.status === "no-recapper") {
      await interaction.reply({
        content:
          "Nobody is on recap duty yet. A recapper is picked when the session reminder goes out.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const skipped = `<@${result.skippedUserId}>`;
    if (!result.recapUserId) {
      await interaction.reply({
        content: `Skipped ${skipped}. Nobody else in the rotation is left to recap this session.`,
        allowedMentions: { parse: [] },
      });
      return;
    }

    await interaction.reply({
      content:
        `Skipped ${skipped} for this session's recap. <@${result.recapUserId}> is on recap duty. ` +
        `${skipped} is first in line next session.`,
      allowedMentions: { users: [result.recapUserId] },
    });
  },
};
