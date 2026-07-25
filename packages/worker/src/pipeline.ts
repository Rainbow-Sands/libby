import {
  beginClosingSession,
  claimAggregationIfReady,
  createRecordingSession,
  finishClosingSession,
  getAudioSegmentRefs,
  getTranscriptRegenerationInput,
  markSegmentDiscarded,
  markSegmentReady,
  registerRecordingSegment,
  startInferenceRegeneration,
  startTranscriptRegeneration,
  type AudioSegmentRef,
  type CreateRecordingSessionInput,
} from "@rainbot/db";
import { loadSegmentMetadata, persistSegmentMetadata } from "./segment-metadata.ts";
import {
  enqueueAggregation,
  enqueueSummarization,
  enqueueTranscription,
  enqueueTranscriptions,
} from "./queues.ts";

async function publish(description: string, operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    // Postgres already contains enough state for worker reconciliation to
    // publish this job later. Do not turn a brief Redis outage into lost audio
    // or a misleading failed upload.
    console.error(`[queue] ${description} will be retried by reconciliation:`, error);
  }
}

export async function startRecordingSession(input: CreateRecordingSessionInput): Promise<string> {
  return createRecordingSession(input);
}

export async function registerAudioSegment(
  sessionId: string,
  runId: string,
  sessionDir: string,
  ref: AudioSegmentRef,
): Promise<void> {
  await registerRecordingSegment(sessionId, runId, ref);
  try {
    persistSegmentMetadata(sessionDir, ref);
  } catch (error) {
    // The DB row is authoritative; this sidecar only supports older sessions
    // and manual filesystem inspection.
    console.error(`[segment] could not write compatibility metadata for ${ref.segmentId}:`, error);
  }
}

export async function completeAudioSegment(
  sessionId: string,
  runId: string,
  segmentId: string,
): Promise<void> {
  await markSegmentReady(sessionId, runId, segmentId);
  await publish(`transcription ${runId}/${segmentId}`, () =>
    enqueueTranscription({ runId, sessionId, segmentId }),
  );
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
  await scheduleAggregationIfReady(runId);
}

export async function scheduleAggregationIfReady(runId: string): Promise<boolean> {
  const claimed = await claimAggregationIfReady(runId);
  if (claimed) await publish(`aggregation ${runId}`, () => enqueueAggregation(runId));
  return claimed;
}

export async function requestInferenceRegeneration(sessionId: string): Promise<string> {
  const runId = await startInferenceRegeneration(sessionId);
  await publish(`summarization ${runId}`, () => enqueueSummarization(runId));
  return runId;
}

export async function requestTranscriptRegeneration(sessionId: string): Promise<string> {
  let refs = await getAudioSegmentRefs(sessionId);
  if (refs.length === 0) {
    const session = await getTranscriptRegenerationInput(sessionId);
    if (!session) throw new Error(`Session ${sessionId} was not found`);
    refs = loadSegmentMetadata(session.sessionDir, session.transcript);
  }

  const { runId, segmentIds } = await startTranscriptRegeneration(sessionId, refs);
  await publish(`retranscription ${runId}`, () =>
    enqueueTranscriptions(segmentIds.map((segmentId) => ({ runId, sessionId, segmentId }))),
  );
  await scheduleAggregationIfReady(runId);
  return runId;
}
