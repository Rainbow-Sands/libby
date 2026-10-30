import { error, redirect } from "@sveltejs/kit";
import {
  getCampaignAccess,
  getCampaignDetail,
  getWorldSummary,
  nameKey,
  type WorldPageKind,
} from "@rainbot/db";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, "/");

  const [access, campaign, world] = await Promise.all([
    getCampaignAccess(params.id, locals.user.id),
    getCampaignDetail(params.id),
    getWorldSummary(params.id),
  ]);
  if (!access.canAccess) throw error(403, "You cannot view this campaign.");
  if (!campaign) throw error(404, "Campaign not found.");
  const counts: Partial<Record<WorldPageKind, number>> = {};
  for (const page of world) counts[page.kind] = (counts[page.kind] ?? 0) + 1;
  const openQuests = world.filter(
    (page) => page.kind === "quest" && page.content.status !== "resolved",
  ).length;

  // A player's character page: the one tied to them, or one with their
  // character's name.
  const characters = world.filter((page) => page.kind === "character");
  const characterPages = Object.fromEntries(
    campaign.members.flatMap((member) => {
      const page =
        characters.find((candidate) => candidate.memberUserId === member.id) ??
        (member.characterName
          ? characters.find(
              (candidate) => nameKey(candidate.content.name) === nameKey(member.characterName!),
            )
          : undefined);
      return page ? [[member.id, { slug: page.slug, avatarId: page.avatarId }]] : [];
    }),
  );

  return {
    campaign,
    canIngest: access.isMember,
    // Matches requireCampaignManager: the DM or an application admin.
    canManage:
      access.isAdmin ||
      campaign.members.some((member) => member.role === "dm" && member.id === locals.user?.id),
    world: { total: world.length, counts, openQuests },
    characterPages,
  };
};
