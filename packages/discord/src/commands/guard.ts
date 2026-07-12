import type { ChatInputCommandInteraction } from "discord.js";
import { getCampaignMeta } from "@rainbot/db";

// Validates that the interaction targets a campaign in this guild that the
// caller is the DM of. On failure it replies with the reason and returns null;
// on success it returns the campaign metadata.
export async function requireDmOfCampaign(
  interaction: ChatInputCommandInteraction,
  campaignId: string,
): Promise<{ guildId: string; dmId: string | null } | null> {
  const meta = await getCampaignMeta(campaignId);
  if (!meta || meta.guildId !== interaction.guildId) {
    await interaction.reply("That campaign does not exist in this server.");
    return null;
  }
  if (meta.dmId !== interaction.user.id) {
    await interaction.reply("Only the campaign's DM can manage players.");
    return null;
  }
  return meta;
}
