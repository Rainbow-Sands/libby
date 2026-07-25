import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type VoiceBasedChannel,
} from "discord.js";
import { getCampaignsForGuild, hasOpenRecordingForGuild } from "@rainbot/db";
import { startRecordingSession } from "@rainbot/worker";
import { getActiveSession } from "../recording.ts";
import { attachRecordingSession } from "../session.ts";
import { campaignAutocomplete } from "./autocomplete.ts";
import { MEDIA_PATH } from "../env.ts";
import path from "path";

export const start = {
  data: new SlashCommandBuilder()
    .setName("start")
    .setDescription("Join your voice channel and start recording")
    .addStringOption((option) =>
      option
        .setName("campaign")
        .setDescription("Which campaign this session belongs to")
        .setRequired(true)
        .setAutocomplete(true),
    ),
  autocomplete: campaignAutocomplete,
  handler: async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply("This command can only be used in a server.");
      return;
    }

    const guildId = interaction.guildId;

    if (getActiveSession(guildId) || (await hasOpenRecordingForGuild(guildId))) {
      await interaction.reply("A recording is already in progress. Use `/stop` to stop it first.");
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply("This command can only be used in a server the bot has joined.");
      return;
    }

    const campaignId = interaction.options.getString("campaign", true);
    const guildCampaigns = await getCampaignsForGuild(guildId);
    if (!guildCampaigns.some((c) => c.id === campaignId)) {
      await interaction.reply("That campaign does not exist in this server.");
      return;
    }

    const voiceChannelId = guild.voiceStates.cache.get(interaction.user.id)?.channelId;
    if (!voiceChannelId) {
      await interaction.reply("You must be in a voice channel to use this command.");
      return;
    }

    const voiceChannel = guild.channels.cache.get(voiceChannelId) as VoiceBasedChannel | null;
    if (!voiceChannel) {
      await interaction.reply("Could not resolve the voice channel.");
      return;
    }

    const channelId = voiceChannel.id;
    const sessionId = Date.now().toString();
    const sessionDir = path.join(MEDIA_PATH, guildId, sessionId);

    const runId = await startRecordingSession({
      id: sessionId,
      guildId,
      channelId,
      notificationChannelId: interaction.channelId,
      campaignId,
      sessionDir,
    });

    attachRecordingSession(
      interaction.client,
      voiceChannel,
      guildId,
      channelId,
      sessionId,
      runId,
      sessionDir,
    );

    await interaction.reply(
      `Joined **${voiceChannel.name}** and started recording. Session \`${sessionId}\`.`,
    );
  },
};
