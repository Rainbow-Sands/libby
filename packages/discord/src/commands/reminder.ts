import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { setCampaignReminderChannel } from "@rainbot/db";
import { WEB_URL } from "../env.ts";
import { campaignAutocomplete } from "./autocomplete.ts";
import { requireDmOfCampaign } from "./guard.ts";

export const reminder = {
  data: new SlashCommandBuilder()
    .setName("reminder")
    .setDescription("Post session reminders in this channel and set the session schedule")
    .addStringOption((option) =>
      option
        .setName("campaign")
        .setDescription("Which campaign to set the session reminder for")
        .setRequired(true)
        .setAutocomplete(true),
    ),
  autocomplete: campaignAutocomplete,
  handler: async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply("This command can only be used in a server.");
      return;
    }

    const campaignId = interaction.options.getString("campaign", true);
    const meta = await requireDmOfCampaign(interaction, campaignId, "set session reminders");
    if (!meta) return;

    const channel = interaction.channel;
    try {
      await setCampaignReminderChannel({
        campaignId,
        channelId: interaction.channelId,
        channelName: channel && "name" in channel ? channel.name : null,
      });
    } catch (err) {
      console.error("[reminder] failed to save reminder channel:", err);
      await interaction.reply("Failed to save the reminder channel.");
      return;
    }

    const scheduleUrl = `${WEB_URL.replace(/\/$/, "")}/campaigns/${encodeURIComponent(campaignId)}/schedule`;
    await interaction.reply({
      content:
        "Session reminders for this campaign will be posted in this channel. " +
        "Set the session day and time on the web:",
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel("Set session time")
            .setURL(scheduleUrl),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
