import { error, json } from "@sveltejs/kit";
import {
  clearWorldPageAvatar,
  getCampaignAccess,
  getWorldPageRef,
  setWorldPageAvatar,
} from "@rainbot/db";
import { avatarObjectKey, bytesContentHash, getArtifactStorage } from "@rainbot/storage";
import type { RequestEvent, RequestHandler } from "./$types";

// The browser crops and resizes before uploading, so a real avatar is far
// below this.
const MAX_BYTES = 2 * 1024 * 1024;

const FORMATS = {
  "image/webp": {
    extension: "webp",
    matches: (bytes: Uint8Array) => ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP",
  },
  "image/png": {
    extension: "png",
    matches: (bytes: Uint8Array) =>
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte),
  },
  "image/jpeg": {
    extension: "jpg",
    matches: (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
} as const;

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

// Every campaign member may change any page's avatar.
async function editablePage({ params, locals, request, url }: RequestEvent) {
  if (!locals.user) throw error(401, "Please log in to change avatars.");
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) throw error(403, "Cross-site requests are not allowed.");

  const access = await getCampaignAccess(params.id, locals.user.id);
  if (!access.canAccess) throw error(403, "You cannot edit this campaign.");

  const page = await getWorldPageRef(params.id, params.slug);
  if (!page) throw error(404, "There is no such page in this world.");
  return { page, userId: locals.user.id };
}

export const POST: RequestHandler = async (event) => {
  const { page, userId } = await editablePage(event);

  const contentType = event.request.headers.get("content-type")?.split(";")[0].trim() ?? "";
  const format = FORMATS[contentType as keyof typeof FORMATS];
  if (!format) throw error(415, "Avatars must be WebP, PNG or JPEG pictures.");

  const length = Number(event.request.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw error(413, "That picture is too large.");
  const bytes = new Uint8Array(await event.request.arrayBuffer());
  if (bytes.byteLength === 0) throw error(400, "The upload was empty.");
  if (bytes.byteLength > MAX_BYTES) throw error(413, "That picture is too large.");
  if (!format.matches(bytes)) throw error(415, "That file is not the picture it claims to be.");

  const sha256 = bytesContentHash(bytes);
  const storage = getArtifactStorage();
  const objectKey = avatarObjectKey(event.params.id, page.id, sha256, format.extension);
  await storage.uploadBytes(objectKey, bytes, contentType);
  const avatarId = await setWorldPageAvatar(
    page.id,
    { bucket: storage.bucket, objectKey, contentType, byteSize: bytes.byteLength, sha256 },
    userId,
  );
  return json({ avatarId });
};

// Removing an avatar only stops showing it; the image stays in storage.
export const DELETE: RequestHandler = async (event) => {
  const { page } = await editablePage(event);
  await clearWorldPageAvatar(page.id);
  return new Response(null, { status: 204 });
};
