import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type VoiceBasedChannel,
} from "discord.js";
import { getTemporalClient, sessionWorkflow } from "@rainbot/temporal";
import { getCampaignsForGuild } from "@rainbot/db";
import { getActiveSession } from "../recording.ts";
import { attachRecordingSession } from "../session.ts";
import { campaignAutocomplete } from "./autocomplete.ts";
import { MEDIA_PATH } from "../env.ts";
import type { SessionInput } from "@rainbot/temporal";
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

    if (getActiveSession(guildId)) {
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

    const client = await getTemporalClient();
    const workflowHandle = await client.workflow.start(sessionWorkflow, {
      taskQueue: "rainbot",
      workflowId: `session:${guildId}:${channelId}:${sessionId}`,
      args: [
        {
          guildId,
          channelId,
          campaignId,
          sessionId,
          sessionDir,
        } satisfies SessionInput,
      ],
    });

    attachRecordingSession(
      interaction.client,
      voiceChannel,
      workflowHandle,
      guildId,
      channelId,
      sessionId,
      sessionDir,
    );

    await interaction.reply(
      `Joined **${voiceChannel.name}** and started recording. Session \`${sessionId}\`.`,
    );
  },
};
