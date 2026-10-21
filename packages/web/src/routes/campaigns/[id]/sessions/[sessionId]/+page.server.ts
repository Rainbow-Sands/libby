import { error, fail, redirect } from "@sveltejs/kit";
import {
  countFailedTranscriptions,
  countSessionWorldChanges,
  formatTranscriptForDisplay,
  getCampaignAccess,
  getCampaignCast,
  getSessionDetail,
  getSessionWorldChanges,
  getWorldSummary,
  isAdmin,
} from "@rainbot/db";
import { loadTranscriptArtifact } from "@rainbot/storage";
import {
  requestFailedTranscriptionRetry,
  requestInferenceRegeneration,
  requestTranscriptRegeneration,
} from "@rainbot/worker";
import { toWorldLinkPages } from "$lib/server/world";
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
  // Each tab is its own load, so only the open tab's data is read. Everything
  // that does not depend on the session row loads alongside it; nothing is
  // returned unless the session and access checks pass.
  const user = locals.user;
  const tab = url.searchParams.get("tab");
  const [session, access, worldPages, worldChanges, worldChangeCount, cast] = await Promise.all([
    getSessionDetail(params.sessionId),
    user ? getCampaignAccess(params.id, user.id) : null,
    // Only the recap tab links names to pages.
    user && tab !== "transcript" && tab !== "world"
      ? getWorldSummary(params.id, { throughSession: params.sessionId })
      : [],
    user && tab === "world" ? getSessionWorldChanges(params.sessionId) : null,
    user ? countSessionWorldChanges(params.sessionId) : null,
    user && tab === "transcript" ? getCampaignCast(params.id) : null,
  ]);
  if (!session || session.campaignId !== params.id) {
    throw error(404, "Session not found.");
  }

  const preview = {
    title: session.title ?? "Session recap",
    description: recapExcerpt(session.recap),
  };

  if (!access) {
    return {
      session: {
        id: session.id,
        campaignId: session.campaignId,
        title: session.title,
        status: session.status,
        startedAt: session.startedAt,
        recap: null,
        recapSections: null,
        transcript: null,
      },
      transcriptTurns: null,
      world: null,
      worldChanges: null,
      worldChangeCount: null,
      hasTranscript: Boolean(session.transcriptArtifact),
      canViewDetails: false,
      canRegenerate: false,
      failedTranscriptions: 0,
      preview,
    };
  }
  if (!access.canAccess) throw error(403, "You cannot view this campaign.");

  const [transcript, failedTranscriptions] = await Promise.all([
    tab === "transcript" && session.transcriptArtifact
      ? loadTranscriptArtifact(session.transcriptArtifact)
      : null,
    access.isAdmin && session.status === "failed" ? countFailedTranscriptions(session.id) : 0,
  ]);
  const transcriptTurns = transcript && cast ? formatTranscriptForDisplay(transcript, cast) : null;

  return {
    session: { ...session, transcript },
    transcriptTurns,
    world: {
      campaignId: session.campaignId,
      asOf: session.id,
      pages: toWorldLinkPages(worldPages),
    },
    worldChanges,
    worldChangeCount,
    hasTranscript: Boolean(session.transcriptArtifact),
    canViewDetails: true,
    canRegenerate: access.isAdmin,
    failedTranscriptions,
    preview,
  };
};

export const actions: Actions = {
  regenerate: async ({ params, locals }) => {
    if (!locals.user) throw error(401, "Please log in to regenerate this session.");

    const [session, admin] = await Promise.all([
      getSessionDetail(params.sessionId),
      isAdmin(locals.user.id),
    ]);
    if (!session || session.campaignId !== params.id) {
      throw error(404, "Session not found.");
    }

    if (!admin) {
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
      `/campaigns/${params.id}/sessions/${params.sessionId}?tab=recap&regenerating=1`,
    );
  },
  regenerateTranscript: async ({ params, locals }) => {
    if (!locals.user) throw error(401, "Please log in to regenerate this transcript.");

    const [session, admin] = await Promise.all([
      getSessionDetail(params.sessionId),
      isAdmin(locals.user.id),
    ]);
    if (!session || session.campaignId !== params.id) {
      throw error(404, "Session not found.");
    }

    if (!admin) {
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

    const [session, admin] = await Promise.all([
      getSessionDetail(params.sessionId),
      isAdmin(locals.user.id),
    ]);
    if (!session || session.campaignId !== params.id) {
      throw error(404, "Session not found.");
    }

    if (!admin) {
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
