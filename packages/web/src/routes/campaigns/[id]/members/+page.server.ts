import { error, fail, redirect } from "@sveltejs/kit";
import {
  ensureCampaignInviteCode,
  getCampaignDetail,
  removeCampaignMember,
  resetCampaignInviteCode,
  setCharacterName,
} from "@rainbot/db";
import { cleanName, requireCampaignManager } from "$lib/server/campaign-access";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/auth/login?returnTo=${encodeURIComponent(url.pathname)}`);
  }
  const [, campaign, inviteCode] = await Promise.all([
    requireCampaignManager(params.id, locals.user.id),
    getCampaignDetail(params.id),
    ensureCampaignInviteCode(params.id),
  ]);
  if (!campaign) throw error(404, "Campaign not found.");

  return {
    campaign: { id: campaign.id, name: campaign.name },
    // The DM first, then players in the order they joined.
    members: campaign.members.toSorted((a, b) => Number(b.role === "dm") - Number(a.role === "dm")),
    inviteUrl: inviteCode ? `${url.origin}/join/${inviteCode}` : null,
  };
};

async function requireManager(params: { id: string }, user: App.Locals["user"]) {
  if (!user) throw error(401, "Please log in to manage members.");
  await requireCampaignManager(params.id, user.id);
}

export const actions: Actions = {
  character: async ({ request, params, locals }) => {
    await requireManager(params, locals.user);
    const formData = await request.formData();
    const userId = String(formData.get("userId") ?? "");
    const characterName = cleanName(formData.get("characterName"), 100);
    if (!characterName) {
      return fail(400, { userId, message: "Enter a character name of up to 100 characters." });
    }
    if (!(await setCharacterName(params.id, userId, characterName))) {
      return fail(404, { userId, message: "That player is not in this campaign." });
    }
    return { saved: userId };
  },
  remove: async ({ request, params, locals }) => {
    await requireManager(params, locals.user);
    const userId = String((await request.formData()).get("userId") ?? "");
    if (!(await removeCampaignMember(params.id, userId))) {
      return fail(404, { userId, message: "That player is not in this campaign." });
    }
    return { removed: true };
  },
  resetInvite: async ({ params, locals }) => {
    await requireManager(params, locals.user);
    await resetCampaignInviteCode(params.id);
    return { reset: true };
  },
};
