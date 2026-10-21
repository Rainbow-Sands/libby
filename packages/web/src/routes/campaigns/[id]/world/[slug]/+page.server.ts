import { error, redirect } from "@sveltejs/kit";
import {
  getCampaignAccess,
  getCampaignDetail,
  getWorldPage,
  getWorldSummary,
  listWorldSessions,
} from "@rainbot/db";
import { toWorldLinkPages } from "$lib/server/world";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw redirect(303, "/");

  const [access, campaign, worldSessions] = await Promise.all([
    getCampaignAccess(params.id, locals.user.id),
    getCampaignDetail(params.id),
    listWorldSessions(params.id),
  ]);
  if (!access.canAccess) throw error(403, "You cannot view this campaign.");
  if (!campaign) throw error(404, "Campaign not found.");

  const requested = url.searchParams.get("asOf");
  const asOf = worldSessions.find((session) => session.id === requested) ?? null;
  const bound = asOf?.startedAt ?? null;
  const world = await getWorldSummary(params.id, bound ? { through: bound } : {});
  const detail = await getWorldPage(params.id, params.slug, bound, world);
  if (!detail) throw error(404, "There is no such page in this world.");
  const player = detail.memberUserId
    ? campaign.members.find((member) => member.id === detail.memberUserId)
    : undefined;

  return {
    campaign: { id: campaign.id, name: campaign.name },
    page: detail,
    asOf: asOf?.id ?? null,
    sessions: worldSessions.map(({ id, title, number }) => ({ id, title, number })),
    player: player?.username ?? null,
    world: {
      campaignId: campaign.id,
      asOf: asOf?.id ?? null,
      pages: toWorldLinkPages(world),
    },
  };
};
