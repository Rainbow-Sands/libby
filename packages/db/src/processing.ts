import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { SessionArtifactKind, SessionArtifactRef, SessionArtifactWrite } from "./artifacts.ts";
import { db } from "./client.ts";
import { evaluateTranscriptionBarrier } from "./processing-state.ts";
import { processingRuns, sessionArtifacts, sessionSegments, sessions } from "./schema.ts";
import type { TranscriptSegment } from "./transcript.ts";

export interface AudioSegmentRef {
  segmentId: string;
  audioObjectKey: string;
  timestamp: string;
  userId: string;
  username?: string;
}

export interface CreateRecordingSessionInput {
  id: string;
  campaignId: string;
  guildId?: string;
  channelId: string;
  notificationChannelId?: string;
  sessionDir: string;
}

export async function createRecordingSession(input: CreateRecordingSessionInput): Promise<string> {
  const runId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(sessions).values({
      id: input.id,
      campaignId: input.campaignId,
      guildId: input.guildId,
      channelId: input.channelId,
      sessionDir: input.sessionDir,
      activeRunId: runId,
      status: "recording",
    });
    await tx.insert(processingRuns).values({
      id: runId,
      sessionId: input.id,
      kind: "recording",
      status: "recording",
      notificationChannelId: input.notificationChannelId,
      notificationStatus: input.notificationChannelId ? "pending" : null,
    });
  });
  return runId;
}

export interface RecoverableSession {
  id: string;
  channelId: string;
  sessionDir: string;
  runId: string;
  status: string;
}

export async function getRecoverableSessionsForGuild(
  guildId: string,
): Promise<RecoverableSession[]> {
  const rows = await db
    .select({
      id: sessions.id,
      channelId: sessions.channelId,
      sessionDir: sessions.sessionDir,
      runId: sessions.activeRunId,
      status: sessions.status,
    })
    .from(sessions)
    .where(and(eq(sessions.guildId, guildId), inArray(sessions.status, ["recording", "closing"])));

  return rows.filter((row): row is RecoverableSession => row.runId !== null);
}

export async function hasOpenRecordingForGuild(guildId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.guildId, guildId), inArray(sessions.status, ["recording", "closing"])))
    .limit(1);
  return row !== undefined;
}

export async function registerRecordingSegment(
  sessionId: string,
  runId: string,
  ref: AudioSegmentRef,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select({ status: sessions.status, activeRunId: sessions.activeRunId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .for("update");
    if (!session || session.status !== "recording" || session.activeRunId !== runId) {
      throw new Error(`Session ${sessionId} is no longer accepting audio segments`);
    }

    await tx
      .insert(sessionSegments)
      .values({
        sessionId,
        segmentId: ref.segmentId,
        audioObjectKey: ref.audioObjectKey,
        recordedAt: ref.timestamp,
        userId: ref.userId,
        username: ref.username,
        audioStatus: "recording",
        transcriptionRunId: runId,
      })
      .onConflictDoNothing();
  });
}

export async function markSegmentReady(
  sessionId: string,
  runId: string,
  segmentId: string,
): Promise<void> {
  await db
    .update(sessionSegments)
    .set({
      audioStatus: "ready",
      transcriptionStatus: "pending",
      transcript: null,
      error: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessionSegments.sessionId, sessionId),
        eq(sessionSegments.segmentId, segmentId),
        eq(sessionSegments.transcriptionRunId, runId),
      ),
    );
}

export async function markSegmentAudioFailed(
  sessionId: string,
  runId: string,
  segmentId: string,
  message: string,
): Promise<void> {
  await db
    .update(sessionSegments)
    .set({
      audioStatus: "failed",
      transcriptionStatus: "failed",
      error: message,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessionSegments.sessionId, sessionId),
        eq(sessionSegments.segmentId, segmentId),
        eq(sessionSegments.transcriptionRunId, runId),
      ),
    );
}

export async function markSegmentDiscarded(
  sessionId: string,
  runId: string,
  segmentId: string,
  reason?: string,
): Promise<void> {
  await db
    .update(sessionSegments)
    .set({
      audioStatus: "discarded",
      transcriptionStatus: null,
      transcript: null,
      error: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessionSegments.sessionId, sessionId),
        eq(sessionSegments.segmentId, segmentId),
        eq(sessionSegments.transcriptionRunId, runId),
      ),
    );
}

export async function beginClosingSession(sessionId: string, runId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ status: "closing" })
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.activeRunId, runId),
        eq(sessions.status, "recording"),
      ),
    );
}

export async function finishClosingSession(sessionId: string, runId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({ status: "transcribing", endedAt: new Date() })
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.activeRunId, runId),
          eq(sessions.status, "closing"),
        ),
      );
    await tx
      .update(processingRuns)
      .set({ status: "transcribing", updatedAt: new Date() })
      .where(and(eq(processingRuns.id, runId), eq(processingRuns.status, "recording")));

    const [failedSegment] = await tx
      .select({ segmentId: sessionSegments.segmentId })
      .from(sessionSegments)
      .where(
        and(
          eq(sessionSegments.sessionId, sessionId),
          eq(sessionSegments.transcriptionRunId, runId),
          eq(sessionSegments.transcriptionStatus, "failed"),
        ),
      )
      .limit(1);
    if (failedSegment) {
      const message = `Transcription failed for segment ${failedSegment.segmentId}`;
      await tx
        .update(processingRuns)
        .set({
          status: "failed",
          error: message,
          updatedAt: new Date(),
          finishedAt: new Date(),
        })
        .where(eq(processingRuns.id, runId));
      await tx
        .update(sessions)
        .set({ status: "failed", activeRunId: null })
        .where(and(eq(sessions.id, sessionId), eq(sessions.activeRunId, runId)));
    }
  });
}

export interface SegmentForTranscription extends AudioSegmentRef {
  sessionId: string;
  runId: string;
}

export async function listSegmentsForTranscription(
  runId: string,
  limit = 200,
): Promise<SegmentForTranscription[]> {
  const rows = await db
    .select({
      sessionId: sessionSegments.sessionId,
      runId: sessionSegments.transcriptionRunId,
      segmentId: sessionSegments.segmentId,
      audioObjectKey: sessionSegments.audioObjectKey,
      timestamp: sessionSegments.recordedAt,
      userId: sessionSegments.userId,
      username: sessionSegments.username,
    })
    .from(sessionSegments)
    .where(
      and(
        eq(sessionSegments.transcriptionRunId, runId),
        eq(sessionSegments.audioStatus, "ready"),
        inArray(sessionSegments.transcriptionStatus, ["pending", "processing"]),
      ),
    )
    .orderBy(asc(sessionSegments.recordedAt), asc(sessionSegments.segmentId))
    .limit(limit);

  return rows
    .filter((row): row is typeof row & { runId: string } => row.runId !== null)
    .map((row) => ({
      sessionId: row.sessionId,
      runId: row.runId,
      segmentId: row.segmentId,
      audioObjectKey: row.audioObjectKey,
      timestamp: row.timestamp,
      userId: row.userId,
      ...(row.username ? { username: row.username } : {}),
    }));
}

export async function markSegmentAudioDeleted(sessionId: string, segmentId: string): Promise<void> {
  await db
    .update(sessionSegments)
    .set({ audioStatus: "deleted", updatedAt: new Date() })
    .where(and(eq(sessionSegments.sessionId, sessionId), eq(sessionSegments.segmentId, segmentId)));
}

export async function listAudioPendingDeletion(
  limit = 200,
): Promise<{ sessionId: string; segmentId: string; objectKey: string }[]> {
  return db
    .select({
      sessionId: sessionSegments.sessionId,
      segmentId: sessionSegments.segmentId,
      objectKey: sessionSegments.audioObjectKey,
    })
    .from(sessionSegments)
    .where(eq(sessionSegments.audioStatus, "deletion_pending"))
    .limit(limit);
}

export async function markTranscriptionProcessing(
  runId: string,
  sessionId: string,
  segmentId: string,
): Promise<boolean> {
  const rows = await db
    .update(sessionSegments)
    .set({ transcriptionStatus: "processing", error: null, updatedAt: new Date() })
    .where(
      and(
        eq(sessionSegments.sessionId, sessionId),
        eq(sessionSegments.segmentId, segmentId),
        eq(sessionSegments.transcriptionRunId, runId),
        inArray(sessionSegments.transcriptionStatus, ["pending", "processing"]),
      ),
    )
    .returning({ segmentId: sessionSegments.segmentId });
  return rows.length > 0;
}

export async function completeSegmentTranscription(
  runId: string,
  sessionId: string,
  segmentId: string,
  transcript: TranscriptSegment | null,
  deleteAudio = false,
): Promise<void> {
  await db
    .update(sessionSegments)
    .set({
      transcriptionStatus: "completed",
      transcript,
      ...(deleteAudio ? { audioStatus: "deletion_pending" } : {}),
      error: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessionSegments.sessionId, sessionId),
        eq(sessionSegments.segmentId, segmentId),
        eq(sessionSegments.transcriptionRunId, runId),
      ),
    );
}

export async function failSegmentTranscription(
  runId: string,
  sessionId: string,
  segmentId: string,
  message: string,
): Promise<void> {
  const [updated] = await db
    .update(sessionSegments)
    .set({ transcriptionStatus: "failed", error: message, updatedAt: new Date() })
    .where(
      and(
        eq(sessionSegments.sessionId, sessionId),
        eq(sessionSegments.segmentId, segmentId),
        eq(sessionSegments.transcriptionRunId, runId),
      ),
    )
    .returning({ segmentId: sessionSegments.segmentId });
  if (!updated) return;
}

export async function claimAggregationIfReady(runId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({ sessionId: processingRuns.sessionId, status: processingRuns.status })
      .from(processingRuns)
      .where(eq(processingRuns.id, runId))
      .for("update");
    if (!run || run.status !== "transcribing") return false;

    const segments = await tx
      .select({
        audioStatus: sessionSegments.audioStatus,
        transcriptionRunId: sessionSegments.transcriptionRunId,
        transcriptionStatus: sessionSegments.transcriptionStatus,
      })
      .from(sessionSegments)
      .where(eq(sessionSegments.sessionId, run.sessionId));

    const barrier = evaluateTranscriptionBarrier(runId, segments);
    if (barrier === "failed") {
      const message = "One or more transcription jobs failed";
      await tx
        .update(processingRuns)
        .set({
          status: "failed",
          error: message,
          updatedAt: new Date(),
          finishedAt: new Date(),
        })
        .where(eq(processingRuns.id, runId));
      await tx
        .update(sessions)
        .set({ status: "failed", activeRunId: null })
        .where(and(eq(sessions.id, run.sessionId), eq(sessions.activeRunId, runId)));
      return false;
    }

    if (barrier === "waiting") return false;

    const claimed = await tx
      .update(processingRuns)
      .set({ status: "aggregating", updatedAt: new Date() })
      .where(and(eq(processingRuns.id, runId), eq(processingRuns.status, "transcribing")))
      .returning({ id: processingRuns.id });
    return claimed.length > 0;
  });
}

export async function getTranscriptSegments(runId: string): Promise<TranscriptSegment[]> {
  const rows = await db
    .select({ transcript: sessionSegments.transcript })
    .from(sessionSegments)
    .where(
      and(
        eq(sessionSegments.transcriptionRunId, runId),
        eq(sessionSegments.transcriptionStatus, "completed"),
      ),
    );
  return rows
    .map((row) => row.transcript)
    .filter((segment): segment is TranscriptSegment => segment !== null)
    .toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export interface ProcessingRunData {
  id: string;
  sessionId: string;
  campaignId: string;
  status: string;
  transcriptArtifact: SessionArtifactRef | null;
  detailedRecordArtifact: SessionArtifactRef | null;
  recap: string | null;
  title: string | null;
  notificationChannelId: string | null;
  notificationStatus: string | null;
  attemptCount: number;
}

export async function getProcessingRun(runId: string): Promise<ProcessingRunData | null> {
  const [run] = await db
    .select({
      id: processingRuns.id,
      sessionId: processingRuns.sessionId,
      campaignId: sessions.campaignId,
      status: processingRuns.status,
      transcriptArtifactId: processingRuns.transcriptArtifactId,
      detailedRecordArtifactId: processingRuns.detailedRecordArtifactId,
      recap: processingRuns.recap,
      title: processingRuns.title,
      notificationChannelId: processingRuns.notificationChannelId,
      notificationStatus: processingRuns.notificationStatus,
      attemptCount: processingRuns.attemptCount,
    })
    .from(processingRuns)
    .innerJoin(sessions, eq(processingRuns.sessionId, sessions.id))
    .where(eq(processingRuns.id, runId))
    .limit(1);
  if (!run) return null;

  const artifactIds = [run.transcriptArtifactId, run.detailedRecordArtifactId].filter(
    (id): id is string => id !== null,
  );
  const artifacts =
    artifactIds.length > 0
      ? await db.select().from(sessionArtifacts).where(inArray(sessionArtifacts.id, artifactIds))
      : [];
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const toRef = (id: string | null): SessionArtifactRef | null => {
    const artifact = id ? byId.get(id) : undefined;
    if (!artifact) return null;
    return {
      id: artifact.id,
      kind: artifact.kind as SessionArtifactKind,
      bucket: artifact.bucket,
      objectKey: artifact.objectKey,
      contentType: artifact.contentType,
      formatVersion: artifact.formatVersion,
      byteSize: artifact.byteSize,
      sha256: artifact.sha256,
    };
  };

  return {
    id: run.id,
    sessionId: run.sessionId,
    campaignId: run.campaignId,
    status: run.status,
    transcriptArtifact: toRef(run.transcriptArtifactId),
    detailedRecordArtifact: toRef(run.detailedRecordArtifactId),
    recap: run.recap,
    title: run.title,
    notificationChannelId: run.notificationChannelId,
    notificationStatus: run.notificationStatus,
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
] as const;

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

    const [stored] = await tx
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
      })
      .returning({ id: sessionArtifacts.id });
    if (!stored) return false;

    const updated = await tx
      .update(processingRuns)
      .set({
        transcriptArtifactId: stored.id,
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

    const [stored] = await tx
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
      })
      .returning({ id: sessionArtifacts.id });
    if (!stored) return false;

    const rows = await tx
      .update(processingRuns)
      .set({
        detailedRecordArtifactId: stored.id,
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

export async function completeProcessingRun(runId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({
        sessionId: processingRuns.sessionId,
        status: processingRuns.status,
        transcriptArtifactId: processingRuns.transcriptArtifactId,
        detailedRecordArtifactId: processingRuns.detailedRecordArtifactId,
        recap: processingRuns.recap,
        title: processingRuns.title,
      })
      .from(processingRuns)
      .where(eq(processingRuns.id, runId))
      .for("update");
    if (!run || !["aggregating", "summarizing", "titling"].includes(run.status)) return false;

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

    const currentArtifactIds = [run.transcriptArtifactId, run.detailedRecordArtifactId].filter(
      (id): id is string => id !== null,
    );
    if (currentArtifactIds.length > 0) {
      const kinds = await tx
        .select({ kind: sessionArtifacts.kind })
        .from(sessionArtifacts)
        .where(
          and(
            inArray(sessionArtifacts.id, currentArtifactIds),
            eq(sessionArtifacts.sessionId, run.sessionId),
          ),
        );
      if (kinds.length > 0) {
        await tx
          .update(sessionArtifacts)
          .set({ isCurrent: false })
          .where(
            and(
              eq(sessionArtifacts.sessionId, run.sessionId),
              inArray(
                sessionArtifacts.kind,
                kinds.map(({ kind }) => kind),
              ),
            ),
          );
        await tx
          .update(sessionArtifacts)
          .set({ isCurrent: true })
          .where(
            and(
              inArray(sessionArtifacts.id, currentArtifactIds),
              eq(sessionArtifacts.sessionId, run.sessionId),
            ),
          );
      }
    }

    await tx
      .update(processingRuns)
      .set({
        status: "done",
        updatedAt: new Date(),
        finishedAt: new Date(),
      })
      .where(eq(processingRuns.id, runId));
    return true;
  });
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
      transcriptArtifactId: transcriptArtifact.id,
    });
    await tx
      .update(sessions)
      .set({ activeRunId: runId, status: "summarizing" })
      .where(eq(sessions.id, sessionId));
  });
  return runId;
}

export async function getAudioSegmentRefs(sessionId: string): Promise<AudioSegmentRef[]> {
  return db
    .select({
      segmentId: sessionSegments.segmentId,
      audioObjectKey: sessionSegments.audioObjectKey,
      timestamp: sessionSegments.recordedAt,
      userId: sessionSegments.userId,
      username: sessionSegments.username,
    })
    .from(sessionSegments)
    .where(and(eq(sessionSegments.sessionId, sessionId), eq(sessionSegments.audioStatus, "ready")))
    .then((rows) =>
      rows.map((row) => ({
        segmentId: row.segmentId,
        audioObjectKey: row.audioObjectKey,
        timestamp: row.timestamp,
        userId: row.userId,
        ...(row.username ? { username: row.username } : {}),
      })),
    );
}

export async function getAudioSegmentsForRecovery(sessionId: string): Promise<
  (AudioSegmentRef & {
    audioStatus: string;
    runId: string | null;
  })[]
> {
  const rows = await db
    .select({
      segmentId: sessionSegments.segmentId,
      audioObjectKey: sessionSegments.audioObjectKey,
      timestamp: sessionSegments.recordedAt,
      userId: sessionSegments.userId,
      username: sessionSegments.username,
      audioStatus: sessionSegments.audioStatus,
      runId: sessionSegments.transcriptionRunId,
    })
    .from(sessionSegments)
    .where(
      and(
        eq(sessionSegments.sessionId, sessionId),
        inArray(sessionSegments.audioStatus, ["recording", "ready"]),
      ),
    );
  return rows.map((row) => ({
    segmentId: row.segmentId,
    audioObjectKey: row.audioObjectKey,
    timestamp: row.timestamp,
    userId: row.userId,
    ...(row.username ? { username: row.username } : {}),
    audioStatus: row.audioStatus,
    runId: row.runId,
  }));
}

export async function startTranscriptRegeneration(
  sessionId: string,
  refs: AudioSegmentRef[],
): Promise<string> {
  const runId = randomUUID();
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ activeRunId: sessions.activeRunId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .for("update");
    if (!session) throw new Error(`Session ${sessionId} was not found`);
    if (session.activeRunId) throw new Error(`Session ${sessionId} is already being processed`);
    if (refs.length === 0) throw new Error(`Session ${sessionId} has no recorded audio metadata`);

    await tx.insert(processingRuns).values({
      id: runId,
      sessionId,
      kind: "retranscription",
      status: "transcribing",
    });

    for (const ref of refs) {
      await tx
        .insert(sessionSegments)
        .values({
          sessionId,
          segmentId: ref.segmentId,
          audioObjectKey: ref.audioObjectKey,
          recordedAt: ref.timestamp,
          userId: ref.userId,
          username: ref.username,
          audioStatus: "ready",
          transcriptionRunId: runId,
          transcriptionStatus: "pending",
        })
        .onConflictDoUpdate({
          target: [sessionSegments.sessionId, sessionSegments.segmentId],
          set: {
            audioObjectKey: ref.audioObjectKey,
            recordedAt: ref.timestamp,
            userId: ref.userId,
            username: ref.username,
            audioStatus: "ready",
            transcriptionRunId: runId,
            transcriptionStatus: "pending",
            transcript: null,
            error: null,
            updatedAt: new Date(),
          },
        });
    }

    await tx
      .update(sessions)
      .set({ activeRunId: runId, status: "transcribing" })
      .where(eq(sessions.id, sessionId));
    return runId;
  });
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
