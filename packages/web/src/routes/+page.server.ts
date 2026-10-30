import { redirect } from "@sveltejs/kit";
import { canCreateCampaigns, getCampaignSessionStats, getCampaignsForUser } from "@rainbot/db";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) return { campaigns: [], canCreate: false };
  const [campaigns, stats, canCreate] = await Promise.all([
    getCampaignsForUser(locals.user.id),
    getCampaignSessionStats(),
    canCreateCampaigns(locals.user.id),
  ]);
  // Someone in a single campaign has nothing to choose between, unless they
  // can start another one from here.
  if (campaigns.length === 1 && !canCreate) throw redirect(303, `/campaigns/${campaigns[0].id}`);
  return {
    canCreate,
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      sessionCount: stats.get(campaign.id)?.sessionCount ?? 0,
      lastPlayedAt: stats.get(campaign.id)?.lastPlayedAt ?? null,
    })),
  };
};
