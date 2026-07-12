import { error, fail, redirect } from "@sveltejs/kit";
import { getCampaignDetail, isCampaignMember } from "@rainbot/db";
import {
  getTemporalClient,
  segmentRecorded,
  sessionEnded,
  sessionWorkflow,
} from "@rainbot/temporal";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MEDIA_PATH } from "$lib/server/env";
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

  const member = await isCampaignMember(params.id, locals.user.id);
  if (!member) throw error(403, "You are not a member of this campaign.");

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

      const speaker = campaign.members.find((member) => member.id === userId);
      if (!speaker) {
        return fail(400, { message: "Each recording's speaker must belong to this campaign." });
      }
      uploads.push({ file, userId, username: speaker.username });
    }

    const sessionId = `manual-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const sessionDir = path.join(MEDIA_PATH, "manual", sessionId);
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

    const client = await getTemporalClient();
    const workflow = await client.workflow.start(sessionWorkflow, {
      taskQueue: "rainbot",
      workflowId: `manual:${params.id}:${sessionId}`,
      args: [
        {
          guildId: "manual",
          channelId: "manual",
          campaignId: params.id,
          sessionId,
          sessionDir,
        },
      ],
    });

    await Promise.all(segments.map((segment) => workflow.signal(segmentRecorded, segment)));
    await workflow.signal(sessionEnded);

    throw redirect(303, `/campaigns/${params.id}`);
  },
};
