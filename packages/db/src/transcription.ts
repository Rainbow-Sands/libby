import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "./client.ts";
import { evaluateTranscriptionBarrier } from "./processing-state.ts";
import { processingRuns, sessionSegments, sessions } from "./schema.ts";
import type { TranscriptSegment } from "./transcript.ts";
import type { AudioSegmentRef } from "./recording.ts";

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
): Promise<void> {
  await db
    .update(sessionSegments)
    .set({
      transcriptionStatus: "completed",
      transcript,
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
  await db
    .update(sessionSegments)
    .set({ transcriptionStatus: "failed", error: message, updatedAt: new Date() })
    .where(
      and(
        eq(sessionSegments.sessionId, sessionId),
        eq(sessionSegments.segmentId, segmentId),
        eq(sessionSegments.transcriptionRunId, runId),
      ),
    );
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
