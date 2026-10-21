import { getCampaignAccess, getCampaignName, listWorldSessions } from "@rainbot/db";
import type { LayoutServerLoad } from "./$types";

// The campaign's name, the session's number and its neighbours, for the page
// header. It runs alongside the page's own load, and only for members, since
// the neighbours' titles are not part of a session's public preview.
export const load: LayoutServerLoad = async ({ params, locals }) => {
  if (!locals.user) return { sequence: null };
  const [access, campaignName, sessions] = await Promise.all([
    getCampaignAccess(params.id, locals.user.id),
    getCampaignName(params.id),
    listWorldSessions(params.id),
  ]);
  const index = sessions.findIndex((session) => session.id === params.sessionId);
  if (!access.canAccess || !campaignName || index === -1) return { sequence: null };

  const neighbour = (offset: number) => {
    const session = sessions[index + offset];
    return session ? { id: session.id, number: session.number, title: session.title } : null;
  };
  return {
    sequence: {
      campaignName,
      number: sessions[index].number,
      previous: neighbour(-1),
      next: neighbour(1),
    },
  };
};
