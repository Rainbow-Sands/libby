import { sql } from "drizzle-orm";
import { PgBoss, fromDrizzle, type DrizzleTransactionLike, type Queue } from "pg-boss";
import { pgConnectionString } from "./connection.ts";

export const JOB_QUEUES = {
  transcribeSegment: "transcribe-segment",
  transcribeSegmentDead: "transcribe-segment-dead",
  advanceProcessingRun: "advance-processing-run",
  advanceProcessingRunDead: "advance-processing-run-dead",
  backfillCampaignRecaps: "backfill-campaign-recaps",
  updateCampaignWorld: "update-campaign-world",
  linkCampaignRecaps: "link-campaign-recaps",
  detectSpeakers: "detect-speakers",
  detectSpeakersDead: "detect-speakers-dead",
} as const;

export interface DetectSpeakersJob {
  sessionId: string;
  runId: string;
}

export interface TranscribeSegmentJob {
  jobId: string;
  sessionId: string;
  runId: string;
  segmentId: string;
}

export interface AdvanceProcessingRunJob {
  runId: string;
}

export interface BackfillCampaignRecapsJob {
  campaignId: string;
}

export interface UpdateCampaignWorldJob {
  campaignId: string;
}

export interface LinkCampaignRecapsJob {
  campaignId: string;
}

interface StartJobQueueOptions {
  worker?: boolean;
}

function retryLimit(name: string, fallbackAttempts: number): number {
  const value = process.env[name];
  if (!value) return fallbackAttempts - 1;
  const attempts = Number(value);
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return attempts - 1;
}

// The transcription server may unload its model when idle, and reloading it can
// take minutes. Back off up to two minutes per retry so the first activations
// after a cold start outlast the reload (about 6.5 minutes across 8 attempts).
const TRANSCRIPTION_QUEUE_OPTIONS = {
  retryLimit: retryLimit("TRANSCRIPTION_MAX_ATTEMPTS", 8),
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 120,
  expireInSeconds: 24 * 60 * 60,
  heartbeatSeconds: 60,
  deadLetter: JOB_QUEUES.transcribeSegmentDead,
  notify: true,
} as const satisfies QueueDefinition;

const PROCESSING_QUEUE_OPTIONS = {
  retryLimit: retryLimit("PROCESSING_MAX_ATTEMPTS", 3),
  retryDelay: 5,
  retryBackoff: true,
  expireInSeconds: 24 * 60 * 60,
  heartbeatSeconds: 60,
  deadLetter: JOB_QUEUES.advanceProcessingRunDead,
  notify: true,
} as const satisfies QueueDefinition;

// One backfill job per campaign at a time: it re-enqueues itself until every
// session has a sectioned recap, so "stately" (one queued plus one active per
// campaign key) stops a second kick-off from running two chains in parallel.
const BACKFILL_QUEUE_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 15 * 60,
} as const satisfies QueueDefinition;

// World updates for a campaign must run one session at a time, oldest first,
// so the queue is "stately" per campaign like the recap backfill. Each job
// applies one session and re-enqueues itself while sessions remain.
const WORLD_QUEUE_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 30 * 60,
} as const satisfies QueueDefinition;

// Recap linking also runs one session at a time per campaign, re-enqueueing
// itself while recaps remain unlinked.
const LINK_QUEUE_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 15 * 60,
} as const satisfies QueueDefinition;

// Speaker detection reads a whole room recording, which can take a long time
// on a long session, so it gets few attempts and a long expiry.
const DETECT_SPEAKERS_QUEUE_OPTIONS = {
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: 12 * 60 * 60,
  heartbeatSeconds: 60,
  deadLetter: JOB_QUEUES.detectSpeakersDead,
  notify: true,
} as const satisfies QueueDefinition;

type QueueDefinition = Omit<Queue, "name" | "policy" | "partition">;

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;
let workerMode = false;

async function ensureQueue(
  instance: PgBoss,
  name: string,
  options: QueueDefinition = {},
  update = false,
  policy: Queue["policy"] = "standard",
): Promise<void> {
  await instance.createQueue(name, { policy, ...options });
  if (update && Object.keys(options).length > 0) await instance.updateQueue(name, options);
}

async function ensureQueues(instance: PgBoss): Promise<void> {
  await ensureQueue(instance, JOB_QUEUES.transcribeSegmentDead);
  await ensureQueue(instance, JOB_QUEUES.advanceProcessingRunDead);
  await ensureQueue(instance, JOB_QUEUES.detectSpeakersDead);
  await ensureQueue(instance, JOB_QUEUES.detectSpeakers, DETECT_SPEAKERS_QUEUE_OPTIONS, workerMode);
  await ensureQueue(
    instance,
    JOB_QUEUES.transcribeSegment,
    TRANSCRIPTION_QUEUE_OPTIONS,
    workerMode,
  );
  await ensureQueue(
    instance,
    JOB_QUEUES.advanceProcessingRun,
    PROCESSING_QUEUE_OPTIONS,
    workerMode,
  );
  await ensureQueue(
    instance,
    JOB_QUEUES.backfillCampaignRecaps,
    BACKFILL_QUEUE_OPTIONS,
    workerMode,
    "stately",
  );
  await ensureQueue(
    instance,
    JOB_QUEUES.updateCampaignWorld,
    WORLD_QUEUE_OPTIONS,
    workerMode,
    "stately",
  );
  await ensureQueue(
    instance,
    JOB_QUEUES.linkCampaignRecaps,
    LINK_QUEUE_OPTIONS,
    workerMode,
    "stately",
  );
}

export function startJobQueue(options: StartJobQueueOptions = {}): Promise<PgBoss> {
  if (starting) {
    if (options.worker && !workerMode) {
      throw new Error("The pg-boss client was already started without worker supervision");
    }
    return starting;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing required environment variable: DATABASE_URL");

  workerMode = options.worker ?? false;
  boss = new PgBoss({
    connectionString: pgConnectionString(connectionString),
    migrate: false,
    schedule: false,
    supervise: workerMode,
    useListenNotify: workerMode,
    max: workerMode ? 10 : 2,
  });
  boss.on("error", (error) => console.error("[pg-boss]", error));
  boss.on("warning", (warning) => console.warn("[pg-boss]", warning));

  starting = (async () => {
    await boss?.start();
    if (!boss) throw new Error("The pg-boss client stopped while it was starting");
    await ensureQueues(boss);
    return boss;
  })().catch((error) => {
    boss = null;
    starting = null;
    workerMode = false;
    throw error;
  });

  return starting;
}

export async function stopJobQueue(): Promise<void> {
  if (!starting) return;
  const instance = await starting;
  await instance.stop({ graceful: true });
  boss = null;
  starting = null;
  workerMode = false;
}

export async function enqueueJob(
  tx: DrizzleTransactionLike,
  name: typeof JOB_QUEUES.transcribeSegment,
  data: TranscribeSegmentJob,
  id: string,
): Promise<void>;
export async function enqueueJob(
  tx: DrizzleTransactionLike,
  name: typeof JOB_QUEUES.advanceProcessingRun,
  data: AdvanceProcessingRunJob,
  id: string,
): Promise<void>;
export async function enqueueJob(
  tx: DrizzleTransactionLike,
  name: typeof JOB_QUEUES.detectSpeakers,
  data: DetectSpeakersJob,
  id: string,
): Promise<void>;
export async function enqueueJob(
  tx: DrizzleTransactionLike,
  name: string,
  data: object,
  id: string,
): Promise<void> {
  const instance = await startJobQueue();
  const jobId = await instance.send(name, data, { id, db: fromDrizzle(tx, sql) });
  if (jobId !== null && jobId !== id) {
    throw new Error(`pg-boss returned unexpected job id ${jobId} for ${id}`);
  }
}

// Many jobs in one statement, for loops that would otherwise enqueue one at a
// time. A job whose id already exists is skipped, as with enqueueJob.
export async function enqueueJobs(
  tx: DrizzleTransactionLike,
  name: typeof JOB_QUEUES.transcribeSegment,
  jobs: { id: string; data: TranscribeSegmentJob }[],
): Promise<void>;
export async function enqueueJobs(
  tx: DrizzleTransactionLike,
  name: typeof JOB_QUEUES.advanceProcessingRun,
  jobs: { id: string; data: AdvanceProcessingRunJob }[],
): Promise<void>;
export async function enqueueJobs(
  tx: DrizzleTransactionLike,
  name: typeof JOB_QUEUES.detectSpeakers,
  jobs: { id: string; data: DetectSpeakersJob }[],
): Promise<void>;
export async function enqueueJobs(
  tx: DrizzleTransactionLike,
  name: string,
  jobs: { id: string; data: object }[],
): Promise<void> {
  if (jobs.length === 0) return;
  const instance = await startJobQueue();
  await instance.insert(name, jobs, { db: fromDrizzle(tx, sql) });
}

// Backfill jobs are not tied to application rows, so they are sent outside a
// transaction and deduplicated per campaign by the queue policy instead.
export async function enqueueCampaignBackfill(
  data: BackfillCampaignRecapsJob,
  startAfterSeconds = 0,
): Promise<string | null> {
  const instance = await startJobQueue();
  return instance.send(JOB_QUEUES.backfillCampaignRecaps, data, {
    singletonKey: data.campaignId,
    startAfter: startAfterSeconds,
  });
}

export async function enqueueWorldUpdate(
  data: UpdateCampaignWorldJob,
  startAfterSeconds = 0,
): Promise<string | null> {
  const instance = await startJobQueue();
  return instance.send(JOB_QUEUES.updateCampaignWorld, data, {
    singletonKey: data.campaignId,
    startAfter: startAfterSeconds,
  });
}

export async function enqueueRecapLinks(
  data: LinkCampaignRecapsJob,
  startAfterSeconds = 0,
): Promise<string | null> {
  const instance = await startJobQueue();
  return instance.send(JOB_QUEUES.linkCampaignRecaps, data, {
    singletonKey: data.campaignId,
    startAfter: startAfterSeconds,
  });
}
