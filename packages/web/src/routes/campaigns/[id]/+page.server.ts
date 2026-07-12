import { error, redirect } from "@sveltejs/kit";
import { getCampaignDetail, isCampaignMember } from "@rainbot/db";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, "/");

  const campaignMembership = await isCampaignMember(params.id, locals.user.id);
  if (!campaignMembership) throw error(403, "You are not a member of this campaign.");

  const campaign = await getCampaignDetail(params.id);
  if (!campaign) throw error(404, "Campaign not found.");

  return { campaign };
};
