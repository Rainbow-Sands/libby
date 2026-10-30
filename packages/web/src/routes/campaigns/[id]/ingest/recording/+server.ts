import { error, json } from "@sveltejs/kit";
import { createRoomRecordingSession, getCampaignAccess } from "@rainbot/db";
import { getAudioStorage, recordingObjectKey } from "@rainbot/storage";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import type { RequestHandler } from "./$types";

const AUDIO_EXTENSIONS = new Set([
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".mp4",
  ".oga",
  ".ogg",
  ".opus",
  ".wav",
  ".webm",
]);

// One recording of the whole table. The browser sends the file as the raw
// request body, so a long recording streams to the audio bucket without being
// held in memory; the details come in the query string.
export const POST: RequestHandler = async ({ request, params, locals, url }) => {
  if (!locals.user) throw error(401, "Please log in to upload a session.");
  const access = await getCampaignAccess(params.id, locals.user.id);
  if (!access.isMember) throw error(403, "You are not a member of this campaign.");

  const name = url.searchParams.get("name") ?? "";
  const extension = path.extname(name).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(extension)) {
    throw error(400, `${name || "That file"} is not a supported audio format.`);
  }
  const startedAt = new Date(url.searchParams.get("playedAt") ?? "");
  if (Number.isNaN(startedAt.getTime())) throw error(400, "Choose when the session was played.");
  const speakersParam = url.searchParams.get("speakers");
  const expectedSpeakers = speakersParam ? Number(speakersParam) : null;
  if (
    expectedSpeakers !== null &&
    (!Number.isInteger(expectedSpeakers) || expectedSpeakers < 1 || expectedSpeakers > 20)
  ) {
    throw error(400, "People talking must be a number from 1 to 20.");
  }
  if (!request.body) throw error(400, "The recording is empty.");

  const sessionId = `room-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const objectKey = recordingObjectKey(sessionId, name);
  await getAudioStorage().uploadStream(
    objectKey,
    Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]),
    request.headers.get("content-type") || "application/octet-stream",
  );
  await createRoomRecordingSession({
    id: sessionId,
    campaignId: params.id,
    startedAt,
    recordingObjectKey: objectKey,
    expectedSpeakers,
  });

  return json({ sessionId, url: `/campaigns/${params.id}/sessions/${sessionId}` });
};
