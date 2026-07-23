import { error, fail, redirect } from "@sveltejs/kit";
import {
  formatTranscriptForDisplay,
  getCampaignCast,
  getSessionDetail,
  isAdmin,
  isCampaignMember,
} from "@rainbot/db";
import { getTemporalClient, regenerateSessionWorkflow } from "@rainbot/temporal";
import type { Actions, PageServerLoad } from "./$types";

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
      transcriptTurns: null,
      canViewDetails: false,
      canRegenerate: false,
      preview,
    };
  }

  const [admin, member] = await Promise.all([
    isAdmin(locals.user.id),
    isCampaignMember(session.campaignId, locals.user.id),
  ]);
  if (!admin && !member) throw error(403, "You cannot view this campaign.");

  const transcriptTurns = session.transcript
    ? formatTranscriptForDisplay(session.transcript, await getCampaignCast(session.campaignId))
    : null;

  return { session, transcriptTurns, canViewDetails: true, canRegenerate: admin, preview };
};

export const actions: Actions = {
  regenerate: async ({ params, locals }) => {
    if (!locals.user) throw error(401, "Please log in to regenerate this session.");

    const session = await getSessionDetail(params.sessionId);
    if (!session || session.campaignId !== params.id) {
      throw error(404, "Session not found.");
    }

    if (!(await isAdmin(locals.user.id))) {
      throw error(403, "Only administrators can regenerate session inference.");
    }
    if (!session.transcript) {
      return fail(409, { message: "This session has no transcript to regenerate from." });
    }
    if (["recording", "transcribing", "summarizing"].includes(session.status)) {
      return fail(409, { message: "This session is already being processed." });
    }

    try {
      const client = await getTemporalClient();
      await client.workflow.start(regenerateSessionWorkflow, {
        taskQueue: "rainbot",
        workflowId: `regenerate:${session.id}`,
        workflowIdReusePolicy: "ALLOW_DUPLICATE",
        args: [{ sessionId: session.id }],
      });
    } catch (err) {
      if (err instanceof Error && err.name === "WorkflowExecutionAlreadyStartedError") {
        return fail(409, { message: "Regeneration is already running for this session." });
      }
      throw err;
    }

    throw redirect(
      303,
      `/campaigns/${params.id}/sessions/${params.sessionId}?tab=summary&regenerating=1`,
    );
  },
};
