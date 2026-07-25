import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  completeProcessingRun,
  completeSegmentTranscription,
  failProcessingRun,
  failSegmentTranscription,
  getProcessingRun,
  getSegmentForTranscription,
  getTranscriptSegments,
  markNotificationComplete,
  markNotificationFailed,
  markTranscriptionProcessing,
  storeAggregatedTranscript,
  storeRunRecap,
  storeRunSummary,
  storeRunTitle,
  type Transcript,
} from "@rainbot/db";
import { Job, UnrecoverableError, Worker } from "bullmq";
import { postSessionLink } from "./notify.ts";
import {
  enqueueNotification,
  enqueueRecap,
  enqueueSummarization,
  enqueueTitle,
  QUEUES,
  redisConnection,
} from "./queues.ts";
import { scheduleAggregationIfReady } from "./pipeline.ts";
import { generateTitle, recap, summarize, transcribeSegment } from "./tasks.ts";
import type { RunJob, TranscriptionJob } from "./types.ts";

const TRANSCRIPTION_CONCURRENCY = positiveInteger("TRANSCRIPTION_CONCURRENCY", 4);
const SUMMARIZATION_CONCURRENCY = positiveInteger("SUMMARIZATION_CONCURRENCY", 2);

function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function errorMessage(error: Error): string {
  return error.stack || error.message;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function willNotRetry(job: Job, error: Error): boolean {
  return error instanceof UnrecoverableError || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

function isFinalFailure(job: Job | undefined, error: Error): boolean {
  if (error instanceof UnrecoverableError) return true;
  if (!job) return true;
  return job.attemptsMade >= (job.opts.attempts ?? 1);
}

function handleRunFailure(worker: Worker<RunJob>): void {
  worker.on("failed", (job, error) => {
    if (!isFinalFailure(job, error) || !job) return;
    void failProcessingRun(job.data.runId, errorMessage(error)).catch((failure) => {
      console.error("[worker] could not persist run failure:", failure);
    });
  });
}

export function createWorkers(): Worker[] {
  const transcription = new Worker<TranscriptionJob>(
    QUEUES.transcription,
    async (job) => {
      try {
        const { runId, sessionId, segmentId } = job.data;
        const segment = await getSegmentForTranscription(runId, sessionId, segmentId);
        if (!segment) return { skipped: true };
        if (!(await markTranscriptionProcessing(runId, sessionId, segmentId))) {
          return { skipped: true };
        }

        const result = await transcribeSegment(segment.sessionDir, segment);
        await completeSegmentTranscription(runId, sessionId, segmentId, result);
        await scheduleAggregationIfReady(runId);
        return { speech: result !== null };
      } catch (error) {
        const failure = asError(error);
        if (willNotRetry(job, failure)) {
          await failSegmentTranscription(
            job.data.runId,
            job.data.sessionId,
            job.data.segmentId,
            errorMessage(failure),
          );
        }
        throw error;
      }
    },
    { connection: redisConnection(), concurrency: TRANSCRIPTION_CONCURRENCY },
  );
  transcription.on("failed", (job, error) => {
    if (!isFinalFailure(job, error) || !job) return;
    void failSegmentTranscription(
      job.data.runId,
      job.data.sessionId,
      job.data.segmentId,
      errorMessage(error),
    ).catch((failure) => {
      console.error("[worker] could not persist transcription failure:", failure);
    });
  });

  const aggregation = new Worker<RunJob>(
    QUEUES.aggregation,
    async (job) => {
      try {
        const run = await getProcessingRun(job.data.runId);
        if (!run || run.status !== "aggregating") return { skipped: true };

        const transcript: Transcript = {
          version: 1,
          segments: await getTranscriptSegments(run.id),
        };
        mkdirSync(run.sessionDir, { recursive: true });
        writeFileSync(
          path.join(run.sessionDir, "transcript.json"),
          JSON.stringify(transcript),
          "utf8",
        );

        if (!(await storeAggregatedTranscript(run.id, transcript))) return { skipped: true };
        if (transcript.segments.length === 0) {
          await completeProcessingRun(run.id);
          await enqueueNotification(run.id);
          return { segments: 0 };
        }

        await enqueueSummarization(run.id);
        return { segments: transcript.segments.length };
      } catch (error) {
        const failure = asError(error);
        if (willNotRetry(job, failure)) {
          await failProcessingRun(job.data.runId, errorMessage(failure));
        }
        throw error;
      }
    },
    { connection: redisConnection(), concurrency: 2 },
  );
  handleRunFailure(aggregation);

  const summarization = new Worker<RunJob>(
    QUEUES.summarization,
    async (job) => {
      try {
        const run = await getProcessingRun(job.data.runId);
        if (!run || run.status !== "summarizing") return { skipped: true };
        if (!run.transcript) throw new UnrecoverableError(`Run ${run.id} has no transcript`);

        const summary = await summarize(run.transcript, run.campaignId);
        if (await storeRunSummary(run.id, summary)) await enqueueRecap(run.id);
        return { characters: summary.length };
      } catch (error) {
        const failure = asError(error);
        if (willNotRetry(job, failure)) {
          await failProcessingRun(job.data.runId, errorMessage(failure));
        }
        throw error;
      }
    },
    { connection: redisConnection(), concurrency: SUMMARIZATION_CONCURRENCY },
  );
  handleRunFailure(summarization);

  const recapWorker = new Worker<RunJob>(
    QUEUES.recap,
    async (job) => {
      try {
        const run = await getProcessingRun(job.data.runId);
        if (!run || run.status !== "recapping") return { skipped: true };
        if (!run.summary) throw new UnrecoverableError(`Run ${run.id} has no detailed record`);

        const result = await recap(run.summary);
        if (await storeRunRecap(run.id, result)) await enqueueTitle(run.id);
        return { characters: result.length };
      } catch (error) {
        const failure = asError(error);
        if (willNotRetry(job, failure)) {
          await failProcessingRun(job.data.runId, errorMessage(failure));
        }
        throw error;
      }
    },
    { connection: redisConnection(), concurrency: SUMMARIZATION_CONCURRENCY },
  );
  handleRunFailure(recapWorker);

  const title = new Worker<RunJob>(
    QUEUES.title,
    async (job) => {
      try {
        const run = await getProcessingRun(job.data.runId);
        if (!run || run.status !== "titling") return { skipped: true };
        if (!run.recap) throw new UnrecoverableError(`Run ${run.id} has no recap`);

        const result = await generateTitle(run.recap);
        if (await storeRunTitle(run.id, result)) {
          await completeProcessingRun(run.id);
          await enqueueNotification(run.id);
        }
        return { title: result };
      } catch (error) {
        const failure = asError(error);
        if (willNotRetry(job, failure)) {
          await failProcessingRun(job.data.runId, errorMessage(failure));
        }
        throw error;
      }
    },
    { connection: redisConnection(), concurrency: SUMMARIZATION_CONCURRENCY },
  );
  handleRunFailure(title);

  const notification = new Worker<RunJob>(
    QUEUES.notification,
    async (job) => {
      try {
        const run = await getProcessingRun(job.data.runId);
        if (
          !run ||
          run.status !== "done" ||
          run.notificationStatus !== "pending" ||
          !run.notificationChannelId
        ) {
          return { skipped: true };
        }

        await postSessionLink({
          channelId: run.notificationChannelId,
          campaignId: run.campaignId,
          sessionId: run.sessionId,
        });
        await markNotificationComplete(run.id);
        return { notified: true };
      } catch (error) {
        const failure = asError(error);
        if (willNotRetry(job, failure)) {
          await markNotificationFailed(job.data.runId, errorMessage(failure));
        }
        throw error;
      }
    },
    { connection: redisConnection(), concurrency: 4 },
  );
  notification.on("failed", (job, error) => {
    if (!isFinalFailure(job, error) || !job) return;
    void markNotificationFailed(job.data.runId, errorMessage(error)).catch((failure) => {
      console.error("[worker] could not persist notification failure:", failure);
    });
  });

  return [transcription, aggregation, summarization, recapWorker, title, notification];
}
