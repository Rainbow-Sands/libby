import { error, redirect } from "@sveltejs/kit";
import {
  getCampaignAccess,
  getCampaignDetail,
  getWorldState,
  nameKey,
  type WorldPageKind,
} from "@rainbot/db";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, "/");

  const access = await getCampaignAccess(params.id, locals.user.id);
  if (!access.canAccess) throw error(403, "You cannot view this campaign.");

  const campaign = await getCampaignDetail(params.id);
  if (!campaign) throw error(404, "Campaign not found.");

  const world = await getWorldState(params.id);
  const counts: Partial<Record<WorldPageKind, number>> = {};
  for (const page of world) counts[page.kind] = (counts[page.kind] ?? 0) + 1;
  const openQuests = world.filter(
    (page) =>
      page.kind === "quest" && !["resolved", "abandoned"].includes(page.content.status ?? ""),
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
    world: { total: world.length, counts, openQuests },
    characterPages,
  };
};
