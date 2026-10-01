import { error, fail, redirect } from "@sveltejs/kit";
import {
  countFailedTranscriptions,
  formatTranscriptForDisplay,
  getCampaignAccess,
  getCampaignCast,
  getSessionDetail,
  isAdmin,
} from "@rainbot/db";
import { loadDetailedRecordArtifact, loadTranscriptArtifact } from "@rainbot/storage";
import {
  requestFailedTranscriptionRetry,
  requestInferenceRegeneration,
  requestTranscriptRegeneration,
} from "@rainbot/worker";
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

export const load: PageServerLoad = async ({ params, locals, url }) => {
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
        detailedRecord: null,
        transcript: null,
      },
      transcriptTurns: null,
      hasTranscript: Boolean(session.transcriptArtifact),
      canViewDetails: false,
      canRegenerate: false,
      failedTranscriptions: 0,
      preview,
    };
  }

  const access = await getCampaignAccess(session.campaignId, locals.user.id);
  if (!access.canAccess) throw error(403, "You cannot view this campaign.");

  const tab = url.searchParams.get("tab");
  const transcript =
    tab === "transcript" && session.transcriptArtifact
      ? await loadTranscriptArtifact(session.transcriptArtifact)
      : null;
  const detailedRecord =
    tab === "summary" && session.detailedRecordArtifact
      ? await loadDetailedRecordArtifact(session.detailedRecordArtifact)
      : null;
  const transcriptTurns = transcript
    ? formatTranscriptForDisplay(transcript, await getCampaignCast(session.campaignId))
    : null;

  return {
    session: { ...session, transcript, detailedRecord },
    transcriptTurns,
    hasTranscript: Boolean(session.transcriptArtifact),
    canViewDetails: true,
    canRegenerate: access.isAdmin,
    failedTranscriptions:
      access.isAdmin && session.status === "failed"
        ? await countFailedTranscriptions(session.id)
        : 0,
    preview,
  };
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
    if (!session.transcriptArtifact) {
      return fail(409, { message: "This session has no transcript to regenerate from." });
    }
    if (["recording", "transcribing", "summarizing"].includes(session.status)) {
      return fail(409, { message: "This session is already being processed." });
    }

    try {
      await requestInferenceRegeneration(session.id);
    } catch (err) {
      if (err instanceof Error && err.message.includes("already being processed")) {
        return fail(409, { message: "Regeneration is already running for this session." });
      }
      throw err;
    }

    throw redirect(
      303,
      `/campaigns/${params.id}/sessions/${params.sessionId}?tab=summary&regenerating=1`,
    );
  },
  regenerateTranscript: async ({ params, locals }) => {
    if (!locals.user) throw error(401, "Please log in to regenerate this transcript.");

    const session = await getSessionDetail(params.sessionId);
    if (!session || session.campaignId !== params.id) {
      throw error(404, "Session not found.");
    }

    if (!(await isAdmin(locals.user.id))) {
      throw error(403, "Only administrators can regenerate session transcripts.");
    }
    if (["recording", "transcribing", "summarizing"].includes(session.status)) {
      return fail(409, { message: "This session is already being processed." });
    }

    try {
      await requestTranscriptRegeneration(session.id);
    } catch (err) {
      if (err instanceof Error && err.message.includes("already being processed")) {
        return fail(409, { message: "Regeneration is already running for this session." });
      }
      throw err;
    }

    throw redirect(
      303,
      `/campaigns/${params.id}/sessions/${params.sessionId}?tab=transcript&regeneratingTranscript=1`,
    );
  },
  retryFailedTranscriptions: async ({ params, locals }) => {
    if (!locals.user) throw error(401, "Please log in to retry failed transcriptions.");

    const session = await getSessionDetail(params.sessionId);
    if (!session || session.campaignId !== params.id) {
      throw error(404, "Session not found.");
    }

    if (!(await isAdmin(locals.user.id))) {
      throw error(403, "Only administrators can retry failed transcriptions.");
    }
    if (session.status !== "failed") {
      return fail(409, { message: "Only failed sessions can retry failed transcriptions." });
    }

    try {
      await requestFailedTranscriptionRetry(session.id);
    } catch (err) {
      if (err instanceof Error && err.message.includes("already being processed")) {
        return fail(409, { message: "Regeneration is already running for this session." });
      }
      if (err instanceof Error && err.message.includes("no failed transcriptions")) {
        return fail(409, { message: "This session has no failed transcriptions to retry." });
      }
      if (err instanceof Error && err.message.includes("audio was never saved")) {
        return fail(409, {
          message: "Some clips failed before their audio was saved and cannot be retried.",
        });
      }
      throw err;
    }

    throw redirect(
      303,
      `/campaigns/${params.id}/sessions/${params.sessionId}?tab=transcript&regeneratingTranscript=1`,
    );
  },
};
