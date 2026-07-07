import { error, redirect } from "@sveltejs/kit";
import {
  getCampaignCast,
  getSessionDetail,
  isCampaignMember,
  simplifyTranscript,
} from "@rainbot/db";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, "/");

  const session = await getSessionDetail(params.sessionId);
  if (!session || session.campaignId !== params.id) {
    throw error(404, "Session not found.");
  }

  const member = await isCampaignMember(session.campaignId, locals.user.id);
  if (!member) throw error(403, "You are not a member of this campaign.");

  const transcriptText = session.transcript
    ? simplifyTranscript(
        session.transcript,
        await getCampaignCast(session.campaignId),
      )
    : null;

  return { session, transcriptText };
};
