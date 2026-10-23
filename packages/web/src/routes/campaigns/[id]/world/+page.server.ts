import { error, redirect } from "@sveltejs/kit";
import {
  getCampaignAccess,
  getCampaignDetail,
  getWorldSummary,
  listWorldSessions,
  pageNames,
  summaryLine,
} from "@rainbot/db";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, "/");

  const [access, campaign, world, worldSessions] = await Promise.all([
    getCampaignAccess(params.id, locals.user.id),
    getCampaignDetail(params.id),
    getWorldSummary(params.id),
    listWorldSessions(params.id),
  ]);
  if (!access.canAccess) throw error(403, "You cannot view this campaign.");
  if (!campaign) throw error(404, "Campaign not found.");
  const numbers = new Map(worldSessions.map((session) => [session.id, session.number]));
  const latest = Math.max(0, ...world.map((page) => numbers.get(page.revisionSessionId) ?? 0));

  return {
    campaign: { id: campaign.id, name: campaign.name },
    latestSession: latest || null,
    pages: world.map((page) => ({
      slug: page.slug,
      kind: page.kind,
      name: page.content.name,
      // Searched, never linked, so references count too.
      names: [...pageNames(page.content), ...page.content.references],
      line: summaryLine(page.content.summary),
      status: page.content.status,
      avatarId: page.avatarId,
      created: page.createdInSessionId === page.revisionSessionId,
      changedIn: numbers.get(page.revisionSessionId) ?? null,
    })),
  };
};
