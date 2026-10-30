import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  completeSpeakerDetection,
  getSpeakerDetectionTarget,
  pickSamples,
  planClips,
  speakerLabel,
  speakerTimeline,
  type DetectSpeakersJob,
  type DetectedClip,
  type DetectedSpeaker,
  type DetectedTurn,
  type PlannedClip,
} from "@rainbot/db";
import {
  audioObjectKey,
  getArtifactStorage,
  getAudioStorage,
  speakerSampleObjectKey,
} from "@rainbot/storage";
import { UnrecoverableTaskError } from "./errors.ts";

const run = promisify(execFile);
const CUT_CONCURRENCY = 4;

interface DiarizationResult {
  duration: number;
  speakers: { label: string; embedding: number[] | null }[];
  turns: DetectedTurn[];
}

function diarizationUrl(): string {
  const url = process.env.DIARIZATION_URL;
  if (!url) throw new UnrecoverableTaskError("DIARIZATION_URL is not configured");
  return url.replace(/\/+$/, "");
}

// Long recordings take a long time to diarize, longer than fetch waits for
// response headers, so the request goes through node:http with no timeout.
async function diarize(
  wavPath: string,
  expectedSpeakers: number | null,
  signal?: AbortSignal,
): Promise<DiarizationResult> {
  const url = new URL(`${diarizationUrl()}/diarize`);
  if (expectedSpeakers) {
    // A player may stay quiet, or someone may pass through the room.
    url.searchParams.set("min_speakers", String(Math.max(1, expectedSpeakers - 1)));
    url.searchParams.set("max_speakers", String(expectedSpeakers + 2));
  }
  const { size } = await stat(wavPath);
  const client = url.protocol === "https:" ? https : http;

  const body = await new Promise<string>((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "audio/wav", "Content-Length": size },
        signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = response.statusCode ?? 0;
          if (status >= 200 && status < 300) resolve(text);
          else if (status >= 400 && status < 500) {
            reject(new UnrecoverableTaskError(`Speaker detection refused the audio: ${text}`));
          } else reject(new Error(`Speaker detection failed with ${status}: ${text}`));
        });
      },
    );
    request.setTimeout(0);
    request.on("error", reject);
    createReadStream(wavPath).on("error", reject).pipe(request);
  });
  return JSON.parse(body) as DiarizationResult;
}

async function ffmpeg(args: string[]): Promise<void> {
  try {
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new UnrecoverableTaskError(`ffmpeg failed: ${stderr || String(error)}`);
  }
}

async function forEachLimit<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await task(items[next++]);
    }),
  );
}

interface NamedClip extends PlannedClip {
  segmentId: string;
}

// Finds who spoke when in a room recording, cuts the recording into one clip
// per turn and hands the clips to the usual transcription jobs. Every upload
// is keyed by the clip's position, so a retry overwrites its own clips and the
// final database write happens once.
export async function detectSpeakers(job: DetectSpeakersJob, signal?: AbortSignal): Promise<void> {
  const target = await getSpeakerDetectionTarget(job.sessionId, job.runId);
  if (!target) return;

  const directory = await mkdtemp(path.join(tmpdir(), "rainbot-room-"));
  try {
    const original = path.join(
      directory,
      `original${path.extname(target.recordingObjectKey) || ".audio"}`,
    );
    await getAudioStorage().downloadFile(target.recordingObjectKey, original);
    const wav = path.join(directory, "audio.wav");
    await ffmpeg(["-i", original, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
    await rm(original);

    const started = Date.now();
    const result = await diarize(wav, target.expectedSpeakers, signal);
    console.log(
      `[speakers] session ${target.sessionId}: ${result.speakers.length} speakers, ` +
        `${result.turns.length} turns in ${Math.round((Date.now() - started) / 1000)}s`,
    );

    const clips: NamedClip[] = planClips(result.turns).map((clip, index) => ({
      ...clip,
      segmentId: `turn-${String(index + 1).padStart(5, "0")}`,
    }));

    // Speakers are numbered by how much they talked, so Speaker 1 is
    // usually the GM.
    const talk = new Map<string, number>();
    for (const clip of clips) {
      talk.set(clip.speaker, (talk.get(clip.speaker) ?? 0) + clip.end - clip.start);
    }
    const ranked = [...talk.entries()].toSorted((a, b) => b[1] - a[1]);
    const embeddings = new Map(result.speakers.map((s) => [s.label, s.embedding]));
    const labels = new Map(ranked.map(([speaker], index) => [speaker, speakerLabel(index + 1)]));

    const speakers: DetectedSpeaker[] = ranked.map(([speaker, seconds], index) => {
      const own = clips.filter((clip) => clip.speaker === speaker);
      return {
        label: speakerLabel(index + 1),
        position: index + 1,
        talkSeconds: Math.round(seconds),
        turns: speakerTimeline(own),
        samples: pickSamples(own).map((clip) => clip.segmentId),
        embedding: embeddings.get(speaker) ?? null,
      };
    });
    const samples = new Set(speakers.flatMap((speaker) => speaker.samples));

    const detected: DetectedClip[] = [];
    await forEachLimit(clips, CUT_CONCURRENCY, async (clip) => {
      signal?.throwIfAborted();
      const file = path.join(directory, `${clip.segmentId}.ogg`);
      await ffmpeg([
        "-ss",
        String(clip.start),
        "-to",
        String(clip.end),
        "-i",
        wav,
        "-c:a",
        "libopus",
        "-b:a",
        "32k",
        file,
      ]);
      const objectKey = audioObjectKey(target.sessionId, clip.segmentId, file);
      await getAudioStorage().uploadFile(objectKey, file, "audio/ogg");
      // The audio bucket forgets clips after a while; samples stay for the
      // Who's who page.
      if (samples.has(clip.segmentId)) {
        await getArtifactStorage().uploadFile(
          speakerSampleObjectKey(target.campaignId, target.sessionId, clip.segmentId),
          file,
          "audio/ogg",
        );
      }
      await rm(file);
      const position = ranked.findIndex(([speaker]) => speaker === clip.speaker) + 1;
      detected.push({
        segmentId: clip.segmentId,
        audioObjectKey: objectKey,
        timestamp: new Date(target.startedAt.getTime() + clip.start * 1000).toISOString(),
        label: labels.get(clip.speaker) ?? speakerLabel(position),
        username: `Speaker ${position}`,
      });
    });

    detected.sort((a, b) => a.segmentId.localeCompare(b.segmentId));
    await completeSpeakerDetection(target.sessionId, target.runId, speakers, detected);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
