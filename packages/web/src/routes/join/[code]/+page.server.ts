import { error, fail, redirect } from "@sveltejs/kit";
import { getCampaignInvite, joinCampaign } from "@rainbot/db";
import { cleanName } from "$lib/server/campaign-access";
import type { Actions, PageServerLoad } from "./$types";

const EXPIRED = "This invite link no longer works. Ask your DM for a new one.";

export const load: PageServerLoad = async ({ params, locals }) => {
  const invite = await getCampaignInvite(params.code);
  if (!invite) throw error(404, EXPIRED);
  if (locals.user && invite.members.some((member) => member.id === locals.user!.id)) {
    throw redirect(303, `/campaigns/${invite.campaignId}`);
  }
  return {
    invite: {
      name: invite.name,
      dmName: invite.dmName,
      players: invite.members.filter((m) => m.role === "player").map((m) => m.username),
    },
  };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    if (!locals.user) throw error(401, "Sign in with Discord to join.");
    const invite = await getCampaignInvite(params.code);
    if (!invite) throw error(404, EXPIRED);

    const characterName = cleanName((await request.formData()).get("characterName"), 100);
    if (!characterName) {
      return fail(400, { message: "Enter your character's name, up to 100 characters." });
    }
    await joinCampaign(invite.campaignId, locals.user.id, characterName);
    throw redirect(303, `/campaigns/${invite.campaignId}`);
  },
};
