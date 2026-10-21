import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  JOB_QUEUES,
  claimAggregationIfReady,
  enqueueCampaignBackfill,
  enqueueWorldUpdate,
  markWorldUpdateSkipped,
  nextBackfillStep,
  nextWorldStep,
  recordWorldUpdate,
  recordWorldUpdateFailure,
  startInferenceRegeneration,
  claimSegmentForTranscription,
  completeProcessingRun,
  completeSegmentTranscription,
  failProcessingRun,
  failSegmentTranscription,
  getProcessingRun,
  getTranscriptSegments,
  markNotificationComplete,
  markNotificationFailed,
  reconcilePendingJobs,
  startJobQueue,
  stopJobQueue,
  storeAggregatedTranscript,
  storeRunLedger,
  storeRunRecap,
  storeRunTitle,
  type AdvanceProcessingRunJob,
  type BackfillCampaignRecapsJob,
  type ProcessingRunData,
  type SessionArtifactKind,
  type SessionLedger,
  type SegmentForTranscription,
  type Transcript,
  type TranscribeSegmentJob,
  type UpdateCampaignWorldJob,
} from "@rainbot/db";
import {
  ArtifactIntegrityError,
  artifactContentHash,
  artifactObjectKey,
  getArtifactStorage,
  getAudioStorage,
  loadSessionLedgerArtifact,
  loadTranscriptArtifact,
} from "@rainbot/storage";
import { UnrecoverableTaskError } from "./errors.ts";
import { postSessionLink } from "./notify.ts";
import { generateTitle, recap, summarize, transcribeSegment, updateWorld } from "./tasks.ts";

const PROCESSING_CONCURRENCY = positiveInteger("PROCESSING_CONCURRENCY", 2);
const TRANSCRIPTION_CONCURRENCY = positiveInteger("TRANSCRIPTION_CONCURRENCY", 4);

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

async function noCleanup(): Promise<void> {}

async function uploadSessionArtifact(
  campaignId: string,
  sessionId: string,
  runId: string,
  kind: SessionArtifactKind,
  body: string,
  contentType: string,
) {
  return getArtifactStorage().uploadArtifact(
    artifactObjectKey(campaignId, sessionId, runId, kind, artifactContentHash(body)),
    body,
    contentType,
  );
}

async function materializeAudio(
  segment: SegmentForTranscription,
): Promise<{ audioPath: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(path.join(tmpdir(), "rainbot-audio-"));
  const extension = path.extname(segment.audioObjectKey) || ".ogg";
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

async function transcribeOne(
  jobId: string,
  payload: TranscribeSegmentJob,
  signal?: AbortSignal,
): Promise<void> {
  if (payload.jobId !== jobId) {
    throw new UnrecoverableTaskError(`Transcription job id mismatch: ${jobId}`);
  }
  const segment = await claimSegmentForTranscription(
    jobId,
    payload.runId,
    payload.sessionId,
    payload.segmentId,
  );
  if (!segment) return;

  let cleanup: () => Promise<void> = noCleanup;
  try {
    const materialized = await materializeAudio(segment);
    cleanup = materialized.cleanup;
    const transcript = await transcribeSegment(materialized.audioPath, segment, signal);
    await completeSegmentTranscription(
      jobId,
      segment.runId,
      segment.sessionId,
      segment.segmentId,
      transcript,
    );
  } catch (error) {
    const failure = asError(error);
    if (failure instanceof UnrecoverableTaskError) {
      await failSegmentTranscription(
        jobId,
        segment.runId,
        segment.sessionId,
        segment.segmentId,
        errorMessage(failure),
      );
      return;
    }
    throw failure;
  } finally {
    await cleanup();
  }
}

async function aggregateRun(run: ProcessingRunData): Promise<void> {
  const transcript: Transcript = {
    version: 1,
    segments: await getTranscriptSegments(run.id),
  };
  const artifact = await uploadSessionArtifact(
    run.campaignId,
    run.sessionId,
    run.id,
    "transcript",
    JSON.stringify(transcript),
    "application/json",
  );
  if (!(await storeAggregatedTranscript(run.id, artifact))) return;
  if (transcript.segments.length === 0 && (await completeProcessingRun(run.id))) {
    await enqueueWorldUpdate({ campaignId: run.campaignId });
  }
}

async function readTranscript(run: ProcessingRunData): Promise<Transcript> {
  const artifact =
    run.kind === "inference" ? run.sourceTranscriptArtifact : run.generatedTranscriptArtifact;
  if (!artifact) throw new UnrecoverableTaskError(`Run ${run.id} has no transcript artifact`);
  return loadTranscriptArtifact(artifact);
}

async function readLedger(run: ProcessingRunData): Promise<SessionLedger> {
  if (!run.generatedLedgerArtifact) {
    throw new UnrecoverableTaskError(`Run ${run.id} has no session ledger artifact`);
  }
  return loadSessionLedgerArtifact(run.generatedLedgerArtifact);
}

async function processCurrentStage(run: ProcessingRunData): Promise<void> {
  switch (run.status) {
    case "transcribing":
      await claimAggregationIfReady(run.id);
      return;
    case "aggregating":
      await aggregateRun(run);
      return;
    case "summarizing": {
      const ledger = await summarize(await readTranscript(run), run.campaignId, run.sessionId);
      const artifact = await uploadSessionArtifact(
        run.campaignId,
        run.sessionId,
        run.id,
        "session_ledger",
        JSON.stringify(ledger),
        "application/json",
      );
      await storeRunLedger(run.id, artifact);
      return;
    }
    case "recapping": {
      const [transcript, ledger] = await Promise.all([readTranscript(run), readLedger(run)]);
      const result = await recap(transcript, ledger, run.campaignId, run.sessionId);
      await storeRunRecap(run.id, result.markdown, result.recap);
      return;
    }
    case "titling":
      if (!run.recap) throw new UnrecoverableTaskError(`Run ${run.id} has no recap`);
      if (
        (await storeRunTitle(run.id, await generateTitle(run.recap))) &&
        (await completeProcessingRun(run.id))
      ) {
        await enqueueWorldUpdate({ campaignId: run.campaignId });
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

async function processRun(payload: AdvanceProcessingRunJob): Promise<void> {
  try {
    while (true) {
      const run = await getProcessingRun(payload.runId);
      if (!run || run.status === "failed") return;
      if (run.status === "transcribing") {
        await claimAggregationIfReady(run.id);
        return;
      }
      await processCurrentStage(run);
      if (run.status === "done") return;
    }
  } catch (error) {
    const failure = asError(error);
    if (failure instanceof UnrecoverableTaskError || failure instanceof ArtifactIntegrityError) {
      await failProcessingRun(payload.runId, errorMessage(failure));
      return;
    }
    throw failure;
  }
}

// How long a backfill waits between checks on the session it started.
const BACKFILL_POLL_SECONDS = 60;

// One step of a campaign backfill: start regenerating the oldest session that
// lacks a sectioned recap, then check back later. Each regeneration is an
// ordinary inference run, so it reuses every idempotency rule of the pipeline.
async function backfillCampaignStep(payload: BackfillCampaignRecapsJob): Promise<void> {
  const step = await nextBackfillStep(payload.campaignId);
  if (step.kind === "finished") {
    console.log(`[backfill] campaign ${payload.campaignId} has no sessions left to backfill`);
    // The world waits for older sessions' ledgers, so it resumes from here.
    await enqueueWorldUpdate(payload);
    return;
  }
  if (step.kind === "world") {
    // The world chain may have stopped at a session that needed a recap;
    // the queue keeps one per campaign, so this never runs two.
    await enqueueWorldUpdate(payload);
  }
  if (step.kind === "next") {
    try {
      await startInferenceRegeneration(step.sessionId);
      console.log(`[backfill] campaign ${payload.campaignId}: regenerating ${step.sessionId}`);
    } catch (error) {
      // Another run claimed the session first; check again on the next poll.
      if (!(error instanceof Error && error.message.includes("already being processed"))) {
        throw error;
      }
    }
  }
  await enqueueCampaignBackfill(payload, BACKFILL_POLL_SECONDS);
}

// A failed world update is retried a few times, then the world moves on
// without that session rather than stalling the campaign.
const WORLD_UPDATE_ATTEMPTS = 3;

// One step of a campaign's world: apply the oldest finished session the world
// has not seen, then continue with the next. A live session finishing, or a
// recap backfill completing, starts the chain.
async function updateCampaignWorldStep(payload: UpdateCampaignWorldJob): Promise<void> {
  const step = await nextWorldStep(payload.campaignId);
  switch (step.kind) {
    case "finished":
      return;
    case "waiting":
      await enqueueWorldUpdate(payload, BACKFILL_POLL_SECONDS);
      return;
    case "needs-recap":
      console.log(
        `[world] campaign ${payload.campaignId}: session ${step.sessionId} has no ledger yet; ` +
          "run the recap backfill to continue the world",
      );
      return;
    case "skip":
      await markWorldUpdateSkipped(payload.campaignId, step.sessionId);
      await enqueueWorldUpdate(payload);
      return;
    case "next":
      try {
        const ledger = await loadSessionLedgerArtifact(step.ledgerArtifact);
        const { update, cast } = await updateWorld(payload.campaignId, ledger, step.recapSections);
        await recordWorldUpdate(
          payload.campaignId,
          step.sessionId,
          update,
          step.recapSections ?? { epicMoments: [], openThreads: [], newFaces: [] },
          cast,
        );
        console.log(
          `[world] campaign ${payload.campaignId}: applied ${step.sessionId} (${update.pages.length} pages)`,
        );
      } catch (error) {
        const failure = asError(error);
        const unrecoverable =
          failure instanceof UnrecoverableTaskError || failure instanceof ArtifactIntegrityError;
        const status = await recordWorldUpdateFailure(
          payload.campaignId,
          step.sessionId,
          errorMessage(failure),
          unrecoverable ? 1 : WORLD_UPDATE_ATTEMPTS,
        );
        console.error(`[world] session ${step.sessionId} failed (${status}):`, failure);
        await enqueueWorldUpdate(payload, status === "pending" ? BACKFILL_POLL_SECONDS : 0);
        return;
      }
      await enqueueWorldUpdate(payload);
      return;
  }
}

function abortPromise(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

export async function runSessionWorker(signal: AbortSignal): Promise<void> {
  const boss = await startJobQueue({ worker: true });

  await boss.work<TranscribeSegmentJob>(
    JOB_QUEUES.transcribeSegment,
    {
      batchSize: TRANSCRIPTION_CONCURRENCY,
      burstWhenBatchFull: true,
      perJobResults: true,
    },
    async (jobs) => {
      return Promise.all(
        jobs.map(async (job) => {
          try {
            await transcribeOne(job.id, job.data, job.signal);
            return { id: job.id, status: "completed" as const };
          } catch (error) {
            return { id: job.id, status: "failed" as const, output: errorMessage(asError(error)) };
          }
        }),
      );
    },
  );
  await boss.work<AdvanceProcessingRunJob>(
    JOB_QUEUES.advanceProcessingRun,
    { localConcurrency: PROCESSING_CONCURRENCY },
    async ([job]) => {
      if (job) await processRun(job.data);
    },
  );
  await boss.work<BackfillCampaignRecapsJob>(JOB_QUEUES.backfillCampaignRecaps, async ([job]) => {
    if (job) await backfillCampaignStep(job.data);
  });
  await boss.work<UpdateCampaignWorldJob>(JOB_QUEUES.updateCampaignWorld, async ([job]) => {
    if (job) await updateCampaignWorldStep(job.data);
  });
  await boss.work<TranscribeSegmentJob>(JOB_QUEUES.transcribeSegmentDead, async ([job]) => {
    if (!job) return;
    await failSegmentTranscription(
      job.data.jobId,
      job.data.runId,
      job.data.sessionId,
      job.data.segmentId,
      "Transcription exhausted its retry limit",
    );
  });
  await boss.work<AdvanceProcessingRunJob>(JOB_QUEUES.advanceProcessingRunDead, async ([job]) => {
    if (job) await failProcessingRun(job.data.runId, "Processing exhausted its retry limit");
  });

  await reconcilePendingJobs();
  console.log("[worker] pg-boss workers started");
  await abortPromise(signal);
  await stopJobQueue();
  console.log("[worker] pg-boss workers stopped");
}
