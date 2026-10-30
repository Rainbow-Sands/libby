import { error } from "@sveltejs/kit";
import { getCampaignAccess, getSessionDetail, isSpeakerSample } from "@rainbot/db";
import { getArtifactStorage, speakerSampleObjectKey } from "@rainbot/storage";
import type { RequestHandler } from "./$types";

// A short sample of one speaker's voice, from the private artifact bucket.
// Only clips chosen as samples are served, and only to campaign members.
export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, "Please log in to play samples.");
  const [access, session, sample] = await Promise.all([
    getCampaignAccess(params.id, locals.user.id),
    getSessionDetail(params.sessionId),
    isSpeakerSample(params.sessionId, params.segmentId),
  ]);
  if (!access.canAccess) throw error(403, "You cannot view this campaign.");
  if (session?.campaignId !== params.id || !sample) throw error(404, "Sample not found.");

  const bytes = await getArtifactStorage().downloadBytes(
    speakerSampleObjectKey(params.id, params.sessionId, params.segmentId),
  );
  return new Response(bytes, {
    headers: {
      "content-type": "audio/ogg",
      "content-length": String(bytes.byteLength),
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
};
