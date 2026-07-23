import { error, redirect } from "@sveltejs/kit";
import { getCampaignDetail, isAdmin, isCampaignMember } from "@rainbot/db";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, "/");

  const [admin, campaignMembership] = await Promise.all([
    isAdmin(locals.user.id),
    isCampaignMember(params.id, locals.user.id),
  ]);
  if (!admin && !campaignMembership) throw error(403, "You cannot view this campaign.");

  const campaign = await getCampaignDetail(params.id);
  if (!campaign) throw error(404, "Campaign not found.");

  return { campaign, canIngest: campaignMembership };
};
