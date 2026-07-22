import { error } from "@sveltejs/kit";
import {
  getCampaignCast,
  getSessionDetail,
  isCampaignMember,
  simplifyTranscript,
} from "@rainbot/db";
import type { PageServerLoad } from "./$types";

function recapExcerpt(recap: string | null): string {
  if (!recap) return "A tabletop adventure recorded and remembered by Libby.";

  const plainText = recap
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[*_~`>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plainText.length <= 280) return plainText;
  return `${plainText.slice(0, 279).trimEnd()}…`;
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const session = await getSessionDetail(params.sessionId);
  if (!session || session.campaignId !== params.id) {
    throw error(404, "Session not found.");
  }

  const preview = {
    title: session.title ?? "Session recap",
    description: recapExcerpt(session.recap),
  };

  if (!locals.user) {
    return {
      session: {
        id: session.id,
        campaignId: session.campaignId,
        title: session.title,
        status: session.status,
        startedAt: session.startedAt,
        recap: null,
        summary: null,
        transcript: null,
      },
      transcriptText: null,
      canViewDetails: false,
      preview,
    };
  }

  const member = await isCampaignMember(session.campaignId, locals.user.id);
  if (!member) throw error(403, "You are not a member of this campaign.");

  const transcriptText = session.transcript
    ? simplifyTranscript(session.transcript, await getCampaignCast(session.campaignId))
    : null;

  return { session, transcriptText, canViewDetails: true, preview };
};
