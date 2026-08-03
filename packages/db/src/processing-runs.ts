import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { SessionArtifactRef, SessionArtifactWrite } from "./artifacts.ts";
import { db } from "./client.ts";
import type {
  KnowledgeSyncStatus,
  NotificationStatus,
  ProcessingRunKind,
  ProcessingRunStatus,
} from "./domain.ts";
import { processingRuns, sessionArtifacts, sessionSegments, sessions } from "./schema.ts";

function toArtifactRef(
  artifact: typeof sessionArtifacts.$inferSelect | undefined,
): SessionArtifactRef | null {
  if (!artifact) return null;
  return {
    id: artifact.id,
    kind: artifact.kind,
    bucket: artifact.bucket,
    objectKey: artifact.objectKey,
    contentType: artifact.contentType,
    formatVersion: artifact.formatVersion,
    byteSize: artifact.byteSize,
    sha256: artifact.sha256,
  };
}

export interface ProcessingRunData {
  id: string;
  sessionId: string;
  campaignId: string;
  kind: ProcessingRunKind;
  status: ProcessingRunStatus;
  sourceTranscriptArtifact: SessionArtifactRef | null;
  generatedTranscriptArtifact: SessionArtifactRef | null;
  generatedDetailedRecordArtifact: SessionArtifactRef | null;
  recap: string | null;
  title: string | null;
  notificationChannelId: string | null;
  notificationStatus: NotificationStatus | null;
  knowledgeSyncStatus: KnowledgeSyncStatus | null;
  knowledgeSyncError: string | null;
  startedAt: Date;
  attemptCount: number;
}

export async function getProcessingRun(runId: string): Promise<ProcessingRunData | null> {
  const [run] = await db
    .select({
      id: processingRuns.id,
      sessionId: processingRuns.sessionId,
      campaignId: sessions.campaignId,
      kind: processingRuns.kind,
      status: processingRuns.status,
      sourceTranscriptArtifactId: processingRuns.sourceTranscriptArtifactId,
      recap: processingRuns.recap,
      title: processingRuns.title,
      notificationChannelId: processingRuns.notificationChannelId,
      notificationStatus: processingRuns.notificationStatus,
      knowledgeSyncStatus: processingRuns.knowledgeSyncStatus,
      knowledgeSyncError: processingRuns.knowledgeSyncError,
      startedAt: sessions.startedAt,
      attemptCount: processingRuns.attemptCount,
    })
    .from(processingRuns)
    .innerJoin(sessions, eq(processingRuns.sessionId, sessions.id))
    .where(eq(processingRuns.id, runId))
    .limit(1);
  if (!run) return null;

  const artifactPredicate = run.sourceTranscriptArtifactId
    ? or(
        eq(sessionArtifacts.generatedByRunId, run.id),
        eq(sessionArtifacts.id, run.sourceTranscriptArtifactId),
      )
    : eq(sessionArtifacts.generatedByRunId, run.id);
  const artifacts = await db.select().from(sessionArtifacts).where(artifactPredicate);

  return {
    id: run.id,
    sessionId: run.sessionId,
    campaignId: run.campaignId,
    kind: run.kind,
    status: run.status,
    sourceTranscriptArtifact: toArtifactRef(
      artifacts.find((artifact) => artifact.id === run.sourceTranscriptArtifactId),
    ),
    generatedTranscriptArtifact: toArtifactRef(
      artifacts.find(
        (artifact) => artifact.generatedByRunId === run.id && artifact.kind === "transcript",
      ),
    ),
    generatedDetailedRecordArtifact: toArtifactRef(
      artifacts.find(
        (artifact) => artifact.generatedByRunId === run.id && artifact.kind === "detailed_record",
      ),
    ),
    recap: run.recap,
    title: run.title,
    notificationChannelId: run.notificationChannelId,
    notificationStatus: run.notificationStatus,
    knowledgeSyncStatus: run.knowledgeSyncStatus,
    knowledgeSyncError: run.knowledgeSyncError,
    startedAt: run.startedAt,
    attemptCount: run.attemptCount,
  };
}

const RUNNABLE_STATUSES = [
  "transcribing",
  "aggregating",
  "summarizing",
  "recapping",
  "titling",
  "done",
] as const satisfies readonly ProcessingRunStatus[];

export async function claimProcessingRuns(
  workerId: string,
  limit: number,
  leaseMilliseconds: number,
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const candidates = await tx
      .select({ id: processingRuns.id })
      .from(processingRuns)
      .where(
        and(
          inArray(processingRuns.status, [...RUNNABLE_STATUSES]),
          or(
            notInArray(processingRuns.status, ["done"]),
            eq(processingRuns.notificationStatus, "pending"),
            eq(processingRuns.knowledgeSyncStatus, "pending"),
          ),
          lt(processingRuns.availableAt, new Date(now.getTime() + 1)),
          or(isNull(processingRuns.leaseExpiresAt), lt(processingRuns.leaseExpiresAt, now)),
        ),
      )
      .orderBy(asc(processingRuns.availableAt), asc(processingRuns.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });

    if (candidates.length === 0) return [];
    const ids = candidates.map((candidate) => candidate.id);
    await tx
      .update(processingRuns)
      .set({
        lockedBy: workerId,
        leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds),
        attemptCount: sql`${processingRuns.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(inArray(processingRuns.id, ids));
    return ids;
  });
}

export async function renewProcessingRunLease(
  runId: string,
  workerId: string,
  leaseMilliseconds: number,
): Promise<boolean> {
  const rows = await db
    .update(processingRuns)
    .set({
      leaseExpiresAt: new Date(Date.now() + leaseMilliseconds),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(processingRuns.id, runId),
        eq(processingRuns.lockedBy, workerId),
        notInArray(processingRuns.status, ["done", "failed"]),
      ),
    )
    .returning({ id: processingRuns.id });
  return rows.length > 0;
}

export async function releaseProcessingRun(
  runId: string,
  workerId: string,
  retryDelayMilliseconds = 0,
  error?: string,
): Promise<void> {
  await db
    .update(processingRuns)
    .set({
      lockedBy: null,
      leaseExpiresAt: null,
      availableAt: new Date(Date.now() + retryDelayMilliseconds),
      ...(error ? { error } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(processingRuns.id, runId), eq(processingRuns.lockedBy, workerId)));
}

export async function storeAggregatedTranscript(
  runId: string,
  artifact: SessionArtifactWrite,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({ sessionId: processingRuns.sessionId, status: processingRuns.status })
      .from(processingRuns)
      .where(eq(processingRuns.id, runId))
      .for("update");
    if (!run || run.status !== "aggregating") return false;

    await tx
      .insert(sessionArtifacts)
      .values({
        sessionId: run.sessionId,
        generatedByRunId: runId,
        kind: "transcript",
        ...artifact,
      })
      .onConflictDoUpdate({
        target: [sessionArtifacts.generatedByRunId, sessionArtifacts.kind],
        set: artifact,
      });

    const updated = await tx
      .update(processingRuns)
      .set({
        status: "summarizing",
        updatedAt: new Date(),
      })
      .where(and(eq(processingRuns.id, runId), eq(processingRuns.status, "aggregating")))
      .returning({ sessionId: processingRuns.sessionId });
    if (!updated[0]) return false;
    await tx
      .update(sessionSegments)
      .set({ transcript: null, updatedAt: new Date() })
      .where(eq(sessionSegments.transcriptionRunId, runId));
    await tx
      .update(sessions)
      .set({ status: "summarizing" })
      .where(and(eq(sessions.id, updated[0].sessionId), eq(sessions.activeRunId, runId)));
    return true;
  });
}

export async function storeRunDetailedRecord(
  runId: string,
  artifact: SessionArtifactWrite,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({ sessionId: processingRuns.sessionId, status: processingRuns.status })
      .from(processingRuns)
      .where(eq(processingRuns.id, runId))
      .for("update");
    if (!run || run.status !== "summarizing") return false;

    await tx
      .insert(sessionArtifacts)
      .values({
        sessionId: run.sessionId,
        generatedByRunId: runId,
        kind: "detailed_record",
        ...artifact,
      })
      .onConflictDoUpdate({
        target: [sessionArtifacts.generatedByRunId, sessionArtifacts.kind],
        set: artifact,
      });

    const rows = await tx
      .update(processingRuns)
      .set({
        status: "recapping",
        updatedAt: new Date(),
      })
      .where(and(eq(processingRuns.id, runId), eq(processingRuns.status, "summarizing")))
      .returning({ id: processingRuns.id });
    return rows.length > 0;
  });
}

export async function storeRunRecap(runId: string, recap: string): Promise<boolean> {
  const rows = await db
    .update(processingRuns)
    .set({ recap, status: "titling", updatedAt: new Date() })
    .where(and(eq(processingRuns.id, runId), eq(processingRuns.status, "recapping")))
    .returning({ id: processingRuns.id });
  return rows.length > 0;
}

export async function storeRunTitle(runId: string, title: string): Promise<boolean> {
  const rows = await db
    .update(processingRuns)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(processingRuns.id, runId), eq(processingRuns.status, "titling")))
    .returning({ id: processingRuns.id });
  return rows.length > 0;
}

export async function completeProcessingRun(
  runId: string,
  queueKnowledgeSync = false,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({
        sessionId: processingRuns.sessionId,
        status: processingRuns.status,
        recap: processingRuns.recap,
        title: processingRuns.title,
      })
      .from(processingRuns)
      .where(eq(processingRuns.id, runId))
      .for("update");
    if (!run || !["aggregating", "summarizing", "titling"].includes(run.status)) return false;

    const generatedArtifacts = await tx
      .select({ kind: sessionArtifacts.kind })
      .from(sessionArtifacts)
      .where(
        and(
          eq(sessionArtifacts.generatedByRunId, runId),
          eq(sessionArtifacts.sessionId, run.sessionId),
        ),
      );

    const updated = await tx
      .update(sessions)
      .set({
        recap: run.recap,
        title: run.title,
        status: "done",
        activeRunId: null,
      })
      .where(and(eq(sessions.id, run.sessionId), eq(sessions.activeRunId, runId)))
      .returning({ id: sessions.id });
    if (!updated[0]) return false;

    if (generatedArtifacts.length > 0) {
      await tx
        .update(sessionArtifacts)
        .set({ isCurrent: false })
        .where(
          and(
            eq(sessionArtifacts.sessionId, run.sessionId),
            inArray(
              sessionArtifacts.kind,
              generatedArtifacts.map(({ kind }) => kind),
            ),
          ),
        );
      await tx
        .update(sessionArtifacts)
        .set({ isCurrent: true })
        .where(
          and(
            eq(sessionArtifacts.generatedByRunId, runId),
            eq(sessionArtifacts.sessionId, run.sessionId),
          ),
        );
    }

    await tx
      .update(processingRuns)
      .set({
        status: "done",
        knowledgeSyncStatus:
          queueKnowledgeSync && generatedArtifacts.some(({ kind }) => kind === "detailed_record")
            ? "pending"
            : null,
        knowledgeSyncError: null,
        updatedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(eq(processingRuns.id, runId));
    return true;
  });
}

export async function markKnowledgeSyncComplete(runId: string): Promise<void> {
  await db
    .update(processingRuns)
    .set({ knowledgeSyncStatus: "completed", knowledgeSyncError: null, updatedAt: new Date() })
    .where(and(eq(processingRuns.id, runId), eq(processingRuns.knowledgeSyncStatus, "pending")));
}

export async function markKnowledgeSyncFailed(runId: string, error: string): Promise<void> {
  await db
    .update(processingRuns)
    .set({ knowledgeSyncStatus: "failed", knowledgeSyncError: error, updatedAt: new Date() })
    .where(and(eq(processingRuns.id, runId), eq(processingRuns.knowledgeSyncStatus, "pending")));
}

export async function failProcessingRun(runId: string, message: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [run] = await tx
      .update(processingRuns)
      .set({ status: "failed", error: message, updatedAt: new Date(), finishedAt: new Date() })
      .where(
        and(eq(processingRuns.id, runId), notInArray(processingRuns.status, ["done", "failed"])),
      )
      .returning({ sessionId: processingRuns.sessionId });
    if (!run) return;
    await tx
      .update(sessions)
      .set({ status: "failed", activeRunId: null })
      .where(and(eq(sessions.id, run.sessionId), eq(sessions.activeRunId, runId)));
  });
}

export async function startInferenceRegeneration(sessionId: string): Promise<string> {
  const runId = randomUUID();
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select({ activeRunId: sessions.activeRunId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .for("update");
    if (!session) throw new Error(`Session ${sessionId} was not found`);
    if (session.activeRunId) throw new Error(`Session ${sessionId} is already being processed`);
    const [transcriptArtifact] = await tx
      .select({ id: sessionArtifacts.id })
      .from(sessionArtifacts)
      .where(
        and(
          eq(sessionArtifacts.sessionId, sessionId),
          eq(sessionArtifacts.kind, "transcript"),
          eq(sessionArtifacts.isCurrent, true),
        ),
      )
      .limit(1);
    if (!transcriptArtifact) throw new Error(`Session ${sessionId} has no transcript`);

    await tx.insert(processingRuns).values({
      id: runId,
      sessionId,
      kind: "inference",
      status: "summarizing",
      sourceTranscriptArtifactId: transcriptArtifact.id,
    });
    await tx
      .update(sessions)
      .set({ activeRunId: runId, status: "summarizing" })
      .where(eq(sessions.id, sessionId));
  });
  return runId;
}
export async function markNotificationComplete(runId: string): Promise<void> {
  await db
    .update(processingRuns)
    .set({ notificationStatus: "completed", updatedAt: new Date() })
    .where(eq(processingRuns.id, runId));
}

export async function markNotificationFailed(runId: string, message: string): Promise<void> {
  await db
    .update(processingRuns)
    .set({ notificationStatus: "failed", error: message, updatedAt: new Date() })
    .where(eq(processingRuns.id, runId));
}
