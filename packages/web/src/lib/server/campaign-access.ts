import { error } from "@sveltejs/kit";
import { getCampaignAccess, getCampaignMeta } from "@rainbot/db";

// Only the campaign's DM (or an application admin) manages a campaign: its
// details, members, invite link, and schedule.
export async function requireCampaignManager(campaignId: string, userId: string): Promise<void> {
  const [meta, access] = await Promise.all([
    getCampaignMeta(campaignId),
    getCampaignAccess(campaignId, userId),
  ]);
  if (!meta) throw error(404, "Campaign not found.");
  if (meta.dmId !== userId && !access.isAdmin) {
    throw error(403, "Only the campaign's DM can manage it.");
  }
}

// Campaign and character names are free text with the same limits the
// database enforces.
export function cleanName(value: FormDataEntryValue | null, maxLength: number): string | null {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return name && name.length <= maxLength ? name : null;
}
