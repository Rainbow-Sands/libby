import { redirect } from "@sveltejs/kit";
import { getCampaignSessionStats, getCampaignsForUser } from "@rainbot/db";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) return { campaigns: [] };
  const [campaigns, stats] = await Promise.all([
    getCampaignsForUser(locals.user.id),
    getCampaignSessionStats(),
  ]);
  // Someone in a single campaign has nothing to choose between.
  if (campaigns.length === 1) throw redirect(303, `/campaigns/${campaigns[0].id}`);
  return {
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      sessionCount: stats.get(campaign.id)?.sessionCount ?? 0,
      lastPlayedAt: stats.get(campaign.id)?.lastPlayedAt ?? null,
    })),
  };
};
