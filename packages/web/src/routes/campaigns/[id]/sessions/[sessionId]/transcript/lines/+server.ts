import { error, json } from "@sveltejs/kit";
import {
  getCampaignAccess,
  getCampaignCast,
  getSessionDetail,
  pageTranscriptLines,
  type TranscriptLineQuery,
} from "@rainbot/db";
import {
  sessionTranscriptLines,
  statsWithCharacters,
  withCharacters,
} from "$lib/server/transcript-lines";
import type { RequestHandler } from "./$types";

const PAGE_SIZE = 150;

function lineQuery(params: URLSearchParams): TranscriptLineQuery {
  const before = params.get("before");
  if (before) return { before };
  const after = params.get("after");
  if (after) return { after };
  const at = Number(params.get("at"));
  if (params.has("at") && Number.isFinite(at) && at >= 0) return { atSeconds: at };
  if (params.has("end")) return { end: true };
  return {};
}

// One page of a session's transcript lines, plus what the page needs to keep
// paging and, for a live session, to pick up the event stream.
export const GET: RequestHandler = async ({ params, locals, url }) => {
  if (!locals.user) throw error(401, "Please log in to view this transcript.");

  const [session, access, cast] = await Promise.all([
    getSessionDetail(params.sessionId),
    getCampaignAccess(params.id, locals.user.id),
    getCampaignCast(params.id),
  ]);
  if (!session || session.campaignId !== params.id) throw error(404, "Session not found.");
  if (!access.canAccess) throw error(403, "You cannot view this campaign.");

  const { lines, live, cursor } = await sessionTranscriptLines(session);
  const page = pageTranscriptLines(lines, lineQuery(url.searchParams), PAGE_SIZE);

  return json({
    ...page,
    lines: withCharacters(page.lines, cast),
    stats: statsWithCharacters(lines, cast),
    startedAt: lines[0]?.timestamp ?? null,
    live,
    cursor: cursor?.toISOString() ?? null,
  });
};
