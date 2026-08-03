import { unlink } from "node:fs/promises";
import path from "node:path";
import {
  beginClosingSession,
  createRecordingSession,
  finishClosingSession,
  getAudioSegmentRefs,
  markSegmentAudioFailed,
  markSegmentDiscarded,
  markSegmentReady,
  registerRecordingSegment,
  startInferenceRegeneration,
  startTranscriptRegeneration,
  type CreateRecordingSessionInput,
} from "@rainbot/db";
import { audioObjectKey, getAudioStorage } from "./storage.ts";
import type { SegmentRef } from "./types.ts";

function audioMimeType(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".webm":
      return "audio/webm";
    case ".flac":
      return "audio/flac";
    default:
      return "audio/ogg";
  }
}

async function uploadWithRetry(
  objectKey: string,
  localPath: string,
  contentType: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await getAudioStorage().uploadFile(objectKey, localPath, contentType);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}

export async function startRecordingSession(input: CreateRecordingSessionInput): Promise<string> {
  return createRecordingSession(input);
}

export async function registerAudioSegment(
  sessionId: string,
  runId: string,
  ref: SegmentRef,
): Promise<void> {
  await registerRecordingSegment(sessionId, runId, {
    segmentId: ref.segmentId,
    audioObjectKey: audioObjectKey(sessionId, ref.segmentId, ref.audioFile),
    timestamp: ref.timestamp,
    userId: ref.userId,
    username: ref.username,
  });
}

export async function completeAudioSegment(
  sessionId: string,
  runId: string,
  localPath: string,
  ref: SegmentRef,
): Promise<void> {
  const objectKey = audioObjectKey(sessionId, ref.segmentId, ref.audioFile);

  try {
    await uploadWithRetry(objectKey, localPath, audioMimeType(ref.audioFile));
    await markSegmentReady(sessionId, runId, ref.segmentId);
    await unlink(localPath).catch(() => undefined);
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    await markSegmentAudioFailed(sessionId, runId, ref.segmentId, message);
    throw error;
  }
}

export async function discardAudioSegment(
  sessionId: string,
  runId: string,
  segmentId: string,
  reason?: string,
): Promise<void> {
  await markSegmentDiscarded(sessionId, runId, segmentId, reason);
}

export async function beginSessionShutdown(sessionId: string, runId: string): Promise<void> {
  await beginClosingSession(sessionId, runId);
}

export async function finishSessionShutdown(sessionId: string, runId: string): Promise<void> {
  await finishClosingSession(sessionId, runId);
}

export async function requestInferenceRegeneration(sessionId: string): Promise<string> {
  return startInferenceRegeneration(sessionId);
}

export async function requestTranscriptRegeneration(sessionId: string): Promise<string> {
  const refs = await getAudioSegmentRefs(sessionId);
  const { runId } = await startTranscriptRegeneration(sessionId, refs);
  return runId;
}
