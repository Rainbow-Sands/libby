import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "./client.ts";
import { evaluateTranscriptionBarrier } from "./processing-state.ts";
import { processingRuns, sessionSegments, sessions } from "./schema.ts";
import type { Transcript, TranscriptSegment } from "./transcript.ts";

export interface AudioSegmentRef {
  segmentId: string;
  audioFile: string;
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
  guildId: string;
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
      guildId: sessions.guildId,
      channelId: sessions.channelId,
      sessionDir: sessions.sessionDir,
      runId: sessions.activeRunId,
      status: sessions.status,
    })
    .from(sessions)
    .where(and(eq(sessions.guildId, guildId), inArray(sessions.status, ["recording", "closing"])));

  return rows.filter(
    (row): row is RecoverableSession => row.guildId !== null && row.runId !== null,
  );
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
        audioFile: ref.audioFile,
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
  sessionDir: string;
}

export async function getSegmentForTranscription(
  runId: string,
  sessionId: string,
  segmentId: string,
): Promise<SegmentForTranscription | null> {
  const [row] = await db
    .select({
      sessionId: sessionSegments.sessionId,
      runId: sessionSegments.transcriptionRunId,
      segmentId: sessionSegments.segmentId,
      audioFile: sessionSegments.audioFile,
      timestamp: sessionSegments.recordedAt,
      userId: sessionSegments.userId,
      username: sessionSegments.username,
      sessionDir: sessions.sessionDir,
      audioStatus: sessionSegments.audioStatus,
      transcriptionStatus: sessionSegments.transcriptionStatus,
    })
    .from(sessionSegments)
    .innerJoin(sessions, eq(sessionSegments.sessionId, sessions.id))
    .where(
      and(
        eq(sessionSegments.sessionId, sessionId),
        eq(sessionSegments.segmentId, segmentId),
        eq(sessionSegments.transcriptionRunId, runId),
      ),
    )
    .limit(1);

  if (
    !row ||
    row.runId === null ||
    row.audioStatus !== "ready" ||
    !["pending", "processing"].includes(row.transcriptionStatus ?? "")
  ) {
    return null;
  }
  return {
    sessionId: row.sessionId,
    runId: row.runId,
    segmentId: row.segmentId,
    audioFile: row.audioFile,
    timestamp: row.timestamp,
    userId: row.userId,
    ...(row.username ? { username: row.username } : {}),
    sessionDir: row.sessionDir,
  };
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

  const [run] = await db
    .select({ status: processingRuns.status })
    .from(processingRuns)
    .where(eq(processingRuns.id, runId))
    .limit(1);
  // A bad activation should not stop an otherwise healthy live recording.
  // Session shutdown observes the failed row and marks the run failed then.
  if (run?.status !== "recording") await failProcessingRun(runId, message);
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
  sessionDir: string;
  kind: string;
  status: string;
  transcript: Transcript | null;
  summary: string | null;
  recap: string | null;
  title: string | null;
  notificationChannelId: string | null;
  notificationStatus: string | null;
}

export async function getProcessingRun(runId: string): Promise<ProcessingRunData | null> {
  const [run] = await db
    .select({
      id: processingRuns.id,
      sessionId: processingRuns.sessionId,
      campaignId: sessions.campaignId,
      sessionDir: sessions.sessionDir,
      kind: processingRuns.kind,
      status: processingRuns.status,
      transcript: processingRuns.transcript,
      summary: processingRuns.summary,
      recap: processingRuns.recap,
      title: processingRuns.title,
      notificationChannelId: processingRuns.notificationChannelId,
      notificationStatus: processingRuns.notificationStatus,
    })
    .from(processingRuns)
    .innerJoin(sessions, eq(processingRuns.sessionId, sessions.id))
    .where(eq(processingRuns.id, runId))
    .limit(1);
  return run ?? null;
}

export async function storeAggregatedTranscript(
  runId: string,
  transcript: Transcript,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(processingRuns)
      .set({ transcript, status: "summarizing", updatedAt: new Date() })
      .where(and(eq(processingRuns.id, runId), eq(processingRuns.status, "aggregating")))
      .returning({ sessionId: processingRuns.sessionId });
    if (!updated[0]) return false;
    await tx
      .update(sessions)
      .set({ status: "summarizing" })
      .where(and(eq(sessions.id, updated[0].sessionId), eq(sessions.activeRunId, runId)));
    return true;
  });
}

export async function storeRunSummary(runId: string, summary: string): Promise<boolean> {
  const rows = await db
    .update(processingRuns)
    .set({ summary, status: "recapping", updatedAt: new Date() })
    .where(and(eq(processingRuns.id, runId), eq(processingRuns.status, "summarizing")))
    .returning({ id: processingRuns.id });
  return rows.length > 0;
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
      .select()
      .from(processingRuns)
      .where(eq(processingRuns.id, runId))
      .for("update");
    if (!run || !["aggregating", "summarizing", "titling"].includes(run.status)) return false;

    const updated = await tx
      .update(sessions)
      .set({
        transcript: run.transcript,
        summary: run.summary,
        recap: run.recap,
        title: run.title,
        status: "done",
        activeRunId: null,
      })
      .where(and(eq(sessions.id, run.sessionId), eq(sessions.activeRunId, runId)))
      .returning({ id: sessions.id });
    if (!updated[0]) return false;

    await tx
      .update(processingRuns)
      .set({ status: "done", updatedAt: new Date(), finishedAt: new Date() })
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
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .for("update");
    if (!session) throw new Error(`Session ${sessionId} was not found`);
    if (session.activeRunId) throw new Error(`Session ${sessionId} is already being processed`);
    if (!session.transcript) throw new Error(`Session ${sessionId} has no transcript`);

    await tx.insert(processingRuns).values({
      id: runId,
      sessionId,
      kind: "inference",
      status: "summarizing",
      transcript: session.transcript,
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
      audioFile: sessionSegments.audioFile,
      timestamp: sessionSegments.recordedAt,
      userId: sessionSegments.userId,
      username: sessionSegments.username,
    })
    .from(sessionSegments)
    .where(
      and(
        eq(sessionSegments.sessionId, sessionId),
        inArray(sessionSegments.audioStatus, ["recording", "ready"]),
      ),
    )
    .then((rows) =>
      rows.map((row) => ({
        segmentId: row.segmentId,
        audioFile: row.audioFile,
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
    transcriptionStatus: string | null;
  })[]
> {
  const rows = await db
    .select({
      segmentId: sessionSegments.segmentId,
      audioFile: sessionSegments.audioFile,
      timestamp: sessionSegments.recordedAt,
      userId: sessionSegments.userId,
      username: sessionSegments.username,
      audioStatus: sessionSegments.audioStatus,
      runId: sessionSegments.transcriptionRunId,
      transcriptionStatus: sessionSegments.transcriptionStatus,
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
    audioFile: row.audioFile,
    timestamp: row.timestamp,
    userId: row.userId,
    ...(row.username ? { username: row.username } : {}),
    audioStatus: row.audioStatus,
    runId: row.runId,
    transcriptionStatus: row.transcriptionStatus,
  }));
}

export async function startTranscriptRegeneration(
  sessionId: string,
  refs: AudioSegmentRef[],
): Promise<{ runId: string; segmentIds: string[] }> {
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
          audioFile: ref.audioFile,
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
            audioFile: ref.audioFile,
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
    return { runId, segmentIds: refs.map((ref) => ref.segmentId) };
  });
}

export async function listPendingTranscriptions(): Promise<
  { runId: string; sessionId: string; segmentId: string }[]
> {
  const rows = await db
    .select({
      runId: sessionSegments.transcriptionRunId,
      sessionId: sessionSegments.sessionId,
      segmentId: sessionSegments.segmentId,
    })
    .from(sessionSegments)
    .innerJoin(processingRuns, eq(sessionSegments.transcriptionRunId, processingRuns.id))
    .where(
      and(
        inArray(sessionSegments.transcriptionStatus, ["pending", "processing"]),
        inArray(processingRuns.status, ["recording", "transcribing"]),
      ),
    );
  return rows.filter(
    (row): row is { runId: string; sessionId: string; segmentId: string } => row.runId !== null,
  );
}

export async function listInterruptedSegments(): Promise<
  {
    runId: string;
    sessionId: string;
    segmentId: string;
    sessionDir: string;
    audioFile: string;
  }[]
> {
  const rows = await db
    .select({
      runId: sessionSegments.transcriptionRunId,
      sessionId: sessionSegments.sessionId,
      segmentId: sessionSegments.segmentId,
      sessionDir: sessions.sessionDir,
      audioFile: sessionSegments.audioFile,
    })
    .from(sessionSegments)
    .innerJoin(sessions, eq(sessionSegments.sessionId, sessions.id))
    .innerJoin(processingRuns, eq(sessionSegments.transcriptionRunId, processingRuns.id))
    .where(
      and(
        eq(sessions.status, "transcribing"),
        eq(processingRuns.status, "transcribing"),
        eq(sessionSegments.audioStatus, "recording"),
      ),
    );
  return rows.filter(
    (
      row,
    ): row is {
      runId: string;
      sessionId: string;
      segmentId: string;
      sessionDir: string;
      audioFile: string;
    } => row.runId !== null,
  );
}

export async function listRunsToReconcile(): Promise<
  { id: string; status: string; notificationStatus: string | null }[]
> {
  return db
    .select({
      id: processingRuns.id,
      status: processingRuns.status,
      notificationStatus: processingRuns.notificationStatus,
    })
    .from(processingRuns)
    .where(
      inArray(processingRuns.status, [
        "transcribing",
        "aggregating",
        "summarizing",
        "recapping",
        "titling",
        "done",
      ]),
    );
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
