import { error, json } from "@sveltejs/kit";
import { getCampaignAccess, getSessionDetail, searchTranscriptLines } from "@rainbot/db";
import { sessionTranscriptLines } from "$lib/server/transcript-lines";
import type { TranscriptSearchResponse } from "$lib/transcript";
import type { RequestHandler } from "./$types";

// More matches than anyone steps through; the count still reports them all.
const MATCH_LIMIT = 1000;
const MAX_QUERY_LENGTH = 200;

// Every line of the session containing `q`, so the find bar can count and
// step through matches outside the loaded window.
export const GET: RequestHandler = async ({ params, locals, url }) => {
  if (!locals.user) throw error(401, "Please log in to search this transcript.");

  const query = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const [session, access] = await Promise.all([
    getSessionDetail(params.sessionId),
    getCampaignAccess(params.id, locals.user.id),
  ]);
  if (!session || session.campaignId !== params.id) throw error(404, "Session not found.");
  if (!access.canAccess) throw error(403, "You cannot view this campaign.");

  const { lines } = await sessionTranscriptLines(session);
  const { matches, total } = searchTranscriptLines(lines, query, MATCH_LIMIT);
  return json({ query, matches, total } satisfies TranscriptSearchResponse);
};
