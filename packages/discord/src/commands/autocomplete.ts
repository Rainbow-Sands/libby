import type { AutocompleteInteraction } from "discord.js";
import { getCampaignsForGuild } from "@rainbot/db";

// Shared autocomplete for the `campaign` option used by /start, /add-player and
// /remove-player: matches the guild's campaigns against what the user has typed.
export async function campaignAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused().toLowerCase();
  const campaigns = await getCampaignsForGuild(interaction.guildId);
  await interaction.respond(
    campaigns
      .filter((c) => c.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((c) => ({ name: c.name, value: c.id })),
  );
}
