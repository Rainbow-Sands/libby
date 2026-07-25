import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import type { RunJob, TranscriptionJob } from "./types.ts";

export const QUEUES = {
  transcription: "rainbot-transcription",
  aggregation: "rainbot-aggregation",
  summarization: "rainbot-summarization",
  recap: "rainbot-recap",
  title: "rainbot-title",
  notification: "rainbot-notification",
} as const;

let connection: IORedis | null = null;
const queues = new Map<string, Queue>();

export function redisConnection(): IORedis {
  if (!connection) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("Missing required environment variable: REDIS_URL");
    connection = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return connection;
}

function queue(name: string): Queue {
  let instance = queues.get(name);
  if (!instance) {
    instance = new Queue(name, {
      connection: redisConnection(),
      defaultJobOptions: {
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    });
    queues.set(name, instance);
  }
  return instance;
}

function runJobOptions(jobId: string, attempts = 3): JobsOptions {
  return {
    jobId,
    attempts,
    backoff: { type: "exponential", delay: 5_000 },
  };
}

export async function enqueueTranscription(input: TranscriptionJob): Promise<void> {
  await queue(QUEUES.transcription).add(
    "transcribe",
    input,
    runJobOptions(`${input.runId}-${input.segmentId}`),
  );
}

export async function enqueueTranscriptions(inputs: TranscriptionJob[]): Promise<void> {
  const transcriptionQueue = queue(QUEUES.transcription);
  for (let index = 0; index < inputs.length; index += 500) {
    await transcriptionQueue.addBulk(
      inputs.slice(index, index + 500).map((input) => ({
        name: "transcribe",
        data: input,
        opts: runJobOptions(`${input.runId}-${input.segmentId}`),
      })),
    );
  }
}

export async function enqueueAggregation(runId: string): Promise<void> {
  await queue(QUEUES.aggregation).add(
    "aggregate",
    { runId } satisfies RunJob,
    runJobOptions(runId),
  );
}

export async function enqueueSummarization(runId: string): Promise<void> {
  await queue(QUEUES.summarization).add(
    "summarize",
    { runId } satisfies RunJob,
    runJobOptions(runId),
  );
}

export async function enqueueRecap(runId: string): Promise<void> {
  await queue(QUEUES.recap).add("recap", { runId } satisfies RunJob, runJobOptions(runId));
}

export async function enqueueTitle(runId: string): Promise<void> {
  await queue(QUEUES.title).add("title", { runId } satisfies RunJob, runJobOptions(runId));
}

export async function enqueueNotification(runId: string): Promise<void> {
  await queue(QUEUES.notification).add(
    "notify",
    { runId } satisfies RunJob,
    runJobOptions(runId, 5),
  );
}

export async function closeProducerQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((instance) => instance.close()));
  queues.clear();
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
