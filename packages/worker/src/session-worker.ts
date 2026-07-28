import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import {
  claimAggregationIfReady,
  claimProcessingRuns,
  completeProcessingRun,
  completeSegmentTranscription,
  failProcessingRun,
  failSegmentTranscription,
  getProcessingRun,
  getTranscriptSegments,
  listAudioPendingDeletion,
  listSegmentsForTranscription,
  markNotificationComplete,
  markNotificationFailed,
  markSegmentAudioDeleted,
  markTranscriptionProcessing,
  releaseProcessingRun,
  renewProcessingRunLease,
  storeAggregatedTranscript,
  storeRunRecap,
  storeRunSummary,
  storeRunTitle,
  type ProcessingRunData,
  type SegmentForTranscription,
  type Transcript,
} from "@rainbot/db";
import { postSessionLink } from "./notify.ts";
import { UnrecoverableTaskError } from "./errors.ts";
import { generateTitle, recap, summarize, transcribeSegment } from "./tasks.ts";
import { getAudioStorage } from "./storage.ts";

const WORKER_ID = `${hostname()}:${process.pid}:${randomUUID()}`;
const LEASE_MILLISECONDS = 5 * 60_000;
const HEARTBEAT_MILLISECONDS = 30_000;
const POLL_MILLISECONDS = positiveInteger("PROCESSING_POLL_MILLISECONDS", 2_000);
const PROCESSING_CONCURRENCY = positiveInteger("PROCESSING_CONCURRENCY", 2);
const TRANSCRIPTION_CONCURRENCY = positiveInteger("TRANSCRIPTION_CONCURRENCY", 4);
const MAX_ATTEMPTS = positiveInteger("PROCESSING_MAX_ATTEMPTS", 3);
const DELETE_AUDIO_AFTER_TRANSCRIPTION = process.env.DELETE_AUDIO_AFTER_TRANSCRIPTION === "true";

function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorMessage(error: Error): string {
  return error.stack || error.message;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function noCleanup(): Promise<void> {}

async function mapConcurrent<T>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (index < values.length) {
        const value = values[index++];
        if (value !== undefined) await operation(value);
      }
    }),
  );
}

async function materializeAudio(
  segment: SegmentForTranscription,
): Promise<{ audioPath: string; cleanup: () => Promise<void> }> {
  if (segment.audioStorage !== "s3") {
    throw new UnrecoverableTaskError(
      `Segment ${segment.segmentId} is not stored in S3-compatible object storage`,
    );
  }

  if (!segment.audioObjectKey) {
    throw new UnrecoverableTaskError(`Segment ${segment.segmentId} has no audio object key`);
  }
  const directory = await mkdtemp(path.join(tmpdir(), "rainbot-audio-"));
  const extension = path.extname(segment.audioFile) || ".ogg";
  const audioPath = path.join(directory, `${segment.segmentId}${extension}`);
  try {
    await getAudioStorage().downloadFile(segment.audioObjectKey, audioPath);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    audioPath,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function transcribeOne(segment: SegmentForTranscription): Promise<void> {
  if (!(await markTranscriptionProcessing(segment.runId, segment.sessionId, segment.segmentId))) {
    return;
  }

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let cleanup: () => Promise<void> = noCleanup;
    try {
      const materialized = await materializeAudio(segment);
      cleanup = materialized.cleanup;
      const transcript = await transcribeSegment(materialized.audioPath, segment);
      await completeSegmentTranscription(
        segment.runId,
        segment.sessionId,
        segment.segmentId,
        transcript,
        DELETE_AUDIO_AFTER_TRANSCRIPTION && segment.audioStorage === "s3",
      );
      return;
    } catch (error) {
      lastError = asError(error);
      if (lastError instanceof UnrecoverableTaskError || attempt === MAX_ATTEMPTS) break;
      await wait(2_000 * 2 ** (attempt - 1));
    } finally {
      await cleanup();
    }
  }

  await failSegmentTranscription(
    segment.runId,
    segment.sessionId,
    segment.segmentId,
    errorMessage(lastError ?? new Error("Transcription failed")),
  );
}

async function transcribeRun(runId: string): Promise<void> {
  while (true) {
    const segments = await listSegmentsForTranscription(runId);
    if (segments.length === 0) {
      await claimAggregationIfReady(runId);
      return;
    }
    await mapConcurrent(segments, TRANSCRIPTION_CONCURRENCY, transcribeOne);
  }
}

async function aggregateRun(run: ProcessingRunData): Promise<void> {
  const transcript: Transcript = {
    version: 1,
    segments: await getTranscriptSegments(run.id),
  };
  if (!(await storeAggregatedTranscript(run.id, transcript))) return;
  if (transcript.segments.length === 0) await completeProcessingRun(run.id);
}

async function processCurrentStage(run: ProcessingRunData): Promise<void> {
  switch (run.status) {
    case "transcribing":
      await transcribeRun(run.id);
      return;
    case "aggregating":
      await aggregateRun(run);
      return;
    case "summarizing": {
      if (!run.transcript) throw new UnrecoverableTaskError(`Run ${run.id} has no transcript`);
      await storeRunSummary(run.id, await summarize(run.transcript, run.campaignId));
      return;
    }
    case "recapping":
      if (!run.summary) {
        throw new UnrecoverableTaskError(`Run ${run.id} has no detailed record`);
      }
      await storeRunRecap(run.id, await recap(run.summary));
      return;
    case "titling":
      if (!run.recap) throw new UnrecoverableTaskError(`Run ${run.id} has no recap`);
      if (await storeRunTitle(run.id, await generateTitle(run.recap))) {
        await completeProcessingRun(run.id);
      }
      return;
    case "done":
      if (run.notificationStatus === "pending" && run.notificationChannelId) {
        try {
          await postSessionLink({
            channelId: run.notificationChannelId,
            campaignId: run.campaignId,
            sessionId: run.sessionId,
          });
          await markNotificationComplete(run.id);
        } catch (error) {
          await markNotificationFailed(run.id, errorMessage(asError(error)));
        }
      }
      return;
  }
}

async function processRun(runId: string): Promise<void> {
  const heartbeat = setInterval(() => {
    void renewProcessingRunLease(runId, WORKER_ID, LEASE_MILLISECONDS).catch((error) => {
      console.error(`[worker] could not renew lease for ${runId}:`, error);
    });
  }, HEARTBEAT_MILLISECONDS);

  try {
    while (true) {
      const run = await getProcessingRun(runId);
      if (!run || ["failed"].includes(run.status)) break;
      await processCurrentStage(run);
      if (run.status === "done") break;
    }
    await releaseProcessingRun(runId, WORKER_ID);
  } catch (error) {
    const failure = asError(error);
    const run = await getProcessingRun(runId);
    if (failure instanceof UnrecoverableTaskError || (run?.attemptCount ?? 0) >= MAX_ATTEMPTS) {
      await failProcessingRun(runId, errorMessage(failure));
    } else {
      await releaseProcessingRun(runId, WORKER_ID, 5_000, errorMessage(failure));
    }
  } finally {
    clearInterval(heartbeat);
  }
}

export async function deletePendingAudio(): Promise<void> {
  if (!DELETE_AUDIO_AFTER_TRANSCRIPTION) return;
  for (const audio of await listAudioPendingDeletion()) {
    try {
      await getAudioStorage().delete(audio.objectKey);
      await markSegmentAudioDeleted(audio.sessionId, audio.segmentId);
    } catch (error) {
      console.error(`[audio] could not delete ${audio.objectKey}:`, error);
    }
  }
}

export async function runSessionWorker(signal: AbortSignal): Promise<void> {
  console.log(`[worker] Postgres session worker ${WORKER_ID} started`);
  const active = new Set<Promise<void>>();

  while (!signal.aborted) {
    await deletePendingAudio();
    const capacity = PROCESSING_CONCURRENCY - active.size;
    if (capacity > 0) {
      const runIds = await claimProcessingRuns(WORKER_ID, capacity, LEASE_MILLISECONDS);
      for (const runId of runIds) {
        const processing = processRun(runId).finally(() => active.delete(processing));
        active.add(processing);
      }
    }
    if (active.size === 0) {
      await Promise.race([wait(POLL_MILLISECONDS), abortPromise(signal)]);
    } else {
      await Promise.race([...active, wait(POLL_MILLISECONDS), abortPromise(signal)]);
    }
  }

  await Promise.allSettled(active);
  console.log("[worker] Postgres session worker stopped");
}

function abortPromise(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}
