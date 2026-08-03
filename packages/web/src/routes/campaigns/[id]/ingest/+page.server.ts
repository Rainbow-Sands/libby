import { error, fail, redirect } from "@sveltejs/kit";
import { getCampaignAccess, getCampaignDetail } from "@rainbot/db";
import {
  beginSessionShutdown,
  completeAudioSegment,
  finishSessionShutdown,
  registerAudioSegment,
  startRecordingSession,
} from "@rainbot/worker";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Actions, PageServerLoad } from "./$types";

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

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, "/");

  const access = await getCampaignAccess(params.id, locals.user.id);
  if (!access.isMember) throw error(403, "You are not a member of this campaign.");

  const campaign = await getCampaignDetail(params.id);
  if (!campaign) throw error(404, "Campaign not found.");

  return { campaign };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    if (!locals.user) throw error(401, "Please log in to ingest audio.");

    const campaign = await getCampaignDetail(params.id);
    if (!campaign) throw error(404, "Campaign not found.");
    const member = campaign.members.some((m) => m.id === locals.user!.id);
    if (!member) throw error(403, "You are not a member of this campaign.");

    const formData = await request.formData();
    const files = formData.getAll("audio");
    const userIds = formData.getAll("userId");
    if (files.length === 0 || files.length !== userIds.length) {
      return fail(400, { message: "Add an audio file and speaker for every recording." });
    }

    const uploads: { file: File; userId: string; username: string }[] = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const userId = userIds[index];
      if (!(file instanceof File) || file.size === 0 || typeof userId !== "string") {
        return fail(400, {
          message: "Every recording must include a non-empty audio file and speaker.",
        });
      }

      const extension = path.extname(file.name).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(extension)) {
        return fail(400, {
          message: `${file.name || "That file"} is not a supported audio format.`,
        });
      }

      const speaker = campaign.members.find((campaignMember) => campaignMember.id === userId);
      if (!speaker) {
        return fail(400, { message: "Each recording's speaker must belong to this campaign." });
      }
      uploads.push({ file, userId, username: speaker.username });
    }

    const sessionId = `manual-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const sessionDir = await mkdtemp(path.join(tmpdir(), "rainbot-manual-"));
    try {
      const clipsDir = path.join(sessionDir, "clips");
      await mkdir(clipsDir, { recursive: true });

      const timestamp = new Date().toISOString();
      const segments = await Promise.all(
        uploads.map(async ({ file, userId, username }, index) => {
          const extension = path.extname(file.name).toLowerCase();
          const segmentId = `${index}-${randomUUID()}`;
          const audioFile = `clips/${segmentId}${extension}`;
          await pipeline(
            Readable.fromWeb(file.stream() as unknown as Parameters<typeof Readable.fromWeb>[0]),
            createWriteStream(path.join(sessionDir, audioFile)),
          );
          return { segmentId, audioFile, timestamp, userId, username };
        }),
      );

      const runId = await startRecordingSession({
        id: sessionId,
        channelId: "manual",
        campaignId: params.id,
        sessionDir,
      });

      await Promise.all(segments.map((segment) => registerAudioSegment(sessionId, runId, segment)));
      await beginSessionShutdown(sessionId, runId);
      const results = await Promise.allSettled(
        segments.map((segment) =>
          completeAudioSegment(sessionId, runId, path.join(sessionDir, segment.audioFile), segment),
        ),
      );
      await finishSessionShutdown(sessionId, runId);
      const failedUpload = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failedUpload) {
        throw failedUpload.reason;
      }
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }

    throw redirect(303, `/campaigns/${params.id}`);
  },
};
