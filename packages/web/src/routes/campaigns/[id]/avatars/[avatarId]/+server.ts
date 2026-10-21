import { error } from "@sveltejs/kit";
import { getCampaignAccess, getWorldAvatar } from "@rainbot/db";
import { getArtifactStorage } from "@rainbot/storage";
import type { RequestHandler } from "./$types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Avatars live in the private artifact bucket and are served through the app,
// so only campaign members can see them. Each id names one immutable image.
export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, "Please log in to view avatars.");
  if (!UUID.test(params.avatarId)) throw error(404, "Avatar not found.");

  const [access, avatar] = await Promise.all([
    getCampaignAccess(params.id, locals.user.id),
    getWorldAvatar(params.id, params.avatarId),
  ]);
  if (!access.canAccess) throw error(403, "You cannot view this campaign.");
  if (!avatar) throw error(404, "Avatar not found.");

  const bytes = await getArtifactStorage().downloadBytes(avatar.objectKey, avatar.bucket);
  return new Response(bytes, {
    headers: {
      "content-type": avatar.contentType,
      "content-length": String(bytes.byteLength),
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
};
