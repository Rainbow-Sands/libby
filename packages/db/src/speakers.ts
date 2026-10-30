import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "./client.ts";
import { JOB_QUEUES, enqueueJob, enqueueJobs, startJobQueue } from "./jobs.ts";
import {
  campaignMembers,
  processingRuns,
  sessionSegments,
  sessionSpeakers,
  sessions,
} from "./schema.ts";
import { meanEmbedding } from "./speaker-turns.ts";
import { advanceTranscriptionBarrier } from "./transcription.ts";

export interface CreateRoomRecordingInput {
  id: string;
  campaignId: string;
  startedAt: Date;
  recordingObjectKey: string;
  expectedSpeakers: number | null;
}

// A room recording starts in "detecting": the session, its run and the
// speaker-detection job are written together, after the upload is saved.
export async function createRoomRecordingSession(input: CreateRoomRecordingInput): Promise<string> {
  await startJobQueue();
  const runId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(sessions).values({
      id: input.id,
      campaignId: input.campaignId,
      channelId: "upload",
      sessionDir: "",
      activeRunId: runId,
      status: "detecting",
      source: "room",
      recordingObjectKey: input.recordingObjectKey,
      expectedSpeakers: input.expectedSpeakers,
      startedAt: input.startedAt,
    });
    await tx.insert(processingRuns).values({
      id: runId,
      sessionId: input.id,
      kind: "recording",
      status: "detecting",
    });
    await enqueueJob(tx, JOB_QUEUES.detectSpeakers, { sessionId: input.id, runId }, runId);
  });
  return runId;
}

export interface SpeakerDetectionTarget {
  sessionId: string;
  runId: string;
  campaignId: string;
  startedAt: Date;
  recordingObjectKey: string;
  expectedSpeakers: number | null;
}

// The recording to detect speakers in, while the run is still waiting for it.
export async function getSpeakerDetectionTarget(
  sessionId: string,
  runId: string,
): Promise<SpeakerDetectionTarget | null> {
  const [row] = await db
    .select({
      campaignId: sessions.campaignId,
      startedAt: sessions.startedAt,
      recordingObjectKey: sessions.recordingObjectKey,
      expectedSpeakers: sessions.expectedSpeakers,
    })
    .from(sessions)
    .innerJoin(processingRuns, eq(processingRuns.id, sessions.activeRunId))
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.activeRunId, runId),
        eq(processingRuns.status, "detecting"),
      ),
    )
    .limit(1);
  if (!row?.recordingObjectKey) return null;
  return { sessionId, runId, ...row, recordingObjectKey: row.recordingObjectKey };
}

export interface DetectedSpeaker {
  label: string;
  position: number;
  talkSeconds: number;
  turns: [number, number][];
  samples: string[];
  embedding: number[] | null;
}

export interface DetectedClip {
  segmentId: string;
  audioObjectKey: string;
  timestamp: string;
  label: string;
  username: string;
}

// Records what speaker detection found and starts transcribing every clip, in
// one transaction, so a retried detection job either finds the run already
// moved on or starts from nothing.
export async function completeSpeakerDetection(
  sessionId: string,
  runId: string,
  speakers: DetectedSpeaker[],
  clips: DetectedClip[],
): Promise<boolean> {
  await startJobQueue();
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({ status: processingRuns.status })
      .from(processingRuns)
      .where(and(eq(processingRuns.id, runId), eq(processingRuns.sessionId, sessionId)))
      .for("update");
    if (run?.status !== "detecting") return false;

    await tx.delete(sessionSpeakers).where(eq(sessionSpeakers.sessionId, sessionId));
    if (speakers.length > 0) {
      await tx.insert(sessionSpeakers).values(
        speakers.map((speaker) => ({
          sessionId,
          label: speaker.label,
          position: speaker.position,
          talkSeconds: speaker.talkSeconds,
          turns: speaker.turns,
          samples: speaker.samples,
          embedding: speaker.embedding,
        })),
      );
    }

    const segments = clips.map((clip) => ({
      sessionId,
      segmentId: clip.segmentId,
      audioObjectKey: clip.audioObjectKey,
      recordedAt: clip.timestamp,
      userId: clip.label,
      username: clip.username,
      audioStatus: "ready" as const,
      transcriptionRunId: runId,
      transcriptionStatus: "pending" as const,
      transcriptionJobId: randomUUID(),
    }));
    for (let start = 0; start < segments.length; start += 500) {
      await tx
        .insert(sessionSegments)
        .values(segments.slice(start, start + 500))
        .onConflictDoNothing();
    }
    await enqueueJobs(
      tx,
      JOB_QUEUES.transcribeSegment,
      segments.map(({ segmentId, transcriptionJobId: jobId }) => ({
        id: jobId,
        data: { jobId, sessionId, runId, segmentId },
      })),
    );

    await tx
      .update(processingRuns)
      .set({ status: "transcribing", updatedAt: new Date() })
      .where(eq(processingRuns.id, runId));
    await tx
      .update(sessions)
      .set({
        status: "transcribing",
        endedAt: new Date(),
        // A recording with no voices in it has nobody to name.
        ...(speakers.length === 0 ? { speakersConfirmedAt: new Date() } : {}),
      })
      .where(eq(sessions.id, sessionId));
    await advanceTranscriptionBarrier(tx, runId);
    return true;
  });
}

export async function failSpeakerDetection(
  sessionId: string,
  runId: string,
  message: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const failed = await tx
      .update(processingRuns)
      .set({ status: "failed", error: message, updatedAt: new Date(), finishedAt: new Date() })
      .where(and(eq(processingRuns.id, runId), eq(processingRuns.status, "detecting")))
      .returning({ id: processingRuns.id });
    if (failed.length === 0) return;
    await tx
      .update(sessions)
      .set({ status: "failed", activeRunId: null })
      .where(and(eq(sessions.id, sessionId), eq(sessions.activeRunId, runId)));
  });
}

export interface SessionSpeaker {
  label: string;
  position: number;
  talkSeconds: number;
  turns: [number, number][];
  samples: { segmentId: string; text: string | null }[];
  embedding: number[] | null;
  userId: string | null;
  guestName: string | null;
  ignored: boolean;
}

export interface SessionSpeakers {
  sessionId: string;
  status: string;
  confirmedAt: Date | null;
  speakers: SessionSpeaker[];
}

export async function getSessionSpeakers(sessionId: string): Promise<SessionSpeakers | null> {
  const [session] = await db
    .select({
      status: sessions.status,
      source: sessions.source,
      confirmedAt: sessions.speakersConfirmedAt,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (session?.source !== "room") return null;

  const rows = await db
    .select()
    .from(sessionSpeakers)
    .where(eq(sessionSpeakers.sessionId, sessionId))
    .orderBy(asc(sessionSpeakers.position));
  const sampleIds = rows.flatMap((row) => row.samples);
  const texts =
    sampleIds.length === 0
      ? []
      : await db
          .select({ segmentId: sessionSegments.segmentId, transcript: sessionSegments.transcript })
          .from(sessionSegments)
          .where(
            and(
              eq(sessionSegments.sessionId, sessionId),
              inArray(sessionSegments.segmentId, sampleIds),
            ),
          );
  const textById = new Map(texts.map((row) => [row.segmentId, row.transcript?.text ?? null]));

  return {
    sessionId,
    status: session.status,
    confirmedAt: session.confirmedAt,
    speakers: rows.map((row) => ({
      label: row.label,
      position: row.position,
      talkSeconds: row.talkSeconds,
      turns: row.turns,
      samples: row.samples.map((segmentId) => ({
        segmentId,
        text: textById.get(segmentId) ?? null,
      })),
      embedding: row.embedding,
      userId: row.userId,
      guestName: row.guestName,
      ignored: row.ignored,
    })),
  };
}

// Each member's voice, from every confirmed speaker that was them in this
// campaign's other sessions.
export async function getCampaignVoices(
  campaignId: string,
  exceptSessionId: string,
): Promise<Map<string, number[]>> {
  const rows = await db
    .select({ userId: sessionSpeakers.userId, embedding: sessionSpeakers.embedding })
    .from(sessionSpeakers)
    .innerJoin(sessions, eq(sessionSpeakers.sessionId, sessions.id))
    .innerJoin(
      campaignMembers,
      and(
        eq(campaignMembers.campaignId, sessions.campaignId),
        eq(campaignMembers.userId, sessionSpeakers.userId),
      ),
    )
    .where(
      and(
        eq(sessions.campaignId, campaignId),
        ne(sessions.id, exceptSessionId),
        isNotNull(sessions.speakersConfirmedAt),
        isNotNull(sessionSpeakers.embedding),
      ),
    );
  const byUser = new Map<string, number[][]>();
  for (const row of rows) {
    if (!row.userId || !row.embedding) continue;
    byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.embedding]);
  }
  const voices = new Map<string, number[]>();
  for (const [userId, embeddings] of byUser) {
    const voice = meanEmbedding(embeddings);
    if (voice) voices.set(userId, voice);
  }
  return voices;
}

export type SpeakerChoice =
  | { label: string; kind: "member"; userId: string }
  | { label: string; kind: "guest"; name: string }
  | { label: string; kind: "ignore" }
  | { label: string; kind: "unset" };

export type SaveSpeakersResult =
  | { status: "saved" }
  // runId is the run that was waiting on these names; null when the session
  // was already processed and needs startSpeakerReaggregation.
  | { status: "confirmed"; runId: string | null }
  | { status: "incomplete" }
  | { status: "not-found" };

// Saves who each speaker is. Confirming needs every speaker named; it lets a
// waiting run aggregate, or, for a session already summarized, asks the
// caller to re-aggregate it.
export async function saveSpeakerAssignments(
  sessionId: string,
  choices: SpeakerChoice[],
  confirm: boolean,
): Promise<SaveSpeakersResult> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ source: sessions.source, activeRunId: sessions.activeRunId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .for("update");
    if (session?.source !== "room") return { status: "not-found" };

    const labels = await tx
      .select({ label: sessionSpeakers.label })
      .from(sessionSpeakers)
      .where(eq(sessionSpeakers.sessionId, sessionId));
    const known = new Set(labels.map((row) => row.label));
    const byLabel = new Map(choices.filter((c) => known.has(c.label)).map((c) => [c.label, c]));
    if (confirm && [...known].some((label) => (byLabel.get(label)?.kind ?? "unset") === "unset")) {
      return { status: "incomplete" };
    }

    for (const choice of byLabel.values()) {
      await tx
        .update(sessionSpeakers)
        .set({
          userId: choice.kind === "member" ? choice.userId : null,
          guestName: choice.kind === "guest" ? choice.name : null,
          ignored: choice.kind === "ignore",
          updatedAt: new Date(),
        })
        .where(
          and(eq(sessionSpeakers.sessionId, sessionId), eq(sessionSpeakers.label, choice.label)),
        );
    }
    if (!confirm) return { status: "saved" };

    await tx
      .update(sessions)
      .set({ speakersConfirmedAt: new Date() })
      .where(eq(sessions.id, sessionId));
    // A run that finished transcribing while it waited for names moves on now.
    if (session.activeRunId) await advanceTranscriptionBarrier(tx, session.activeRunId);
    return { status: "confirmed", runId: session.activeRunId };
  });
}

// Puts confirmed names on a session that already went through the pipeline:
// a new run takes over every transcribed clip and aggregates again, so the
// transcript and recap are rebuilt with the names without re-transcribing.
export async function startSpeakerReaggregation(sessionId: string): Promise<string> {
  await startJobQueue();
  const runId = randomUUID();
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ activeRunId: sessions.activeRunId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .for("update");
    if (!session) throw new Error(`Session ${sessionId} was not found`);
    if (session.activeRunId) throw new Error(`Session ${sessionId} is already being processed`);

    await tx.insert(processingRuns).values({
      id: runId,
      sessionId,
      kind: "retranscription",
      status: "transcribing",
    });
    await tx
      .update(sessionSegments)
      .set({ transcriptionRunId: runId, updatedAt: new Date() })
      .where(
        and(
          eq(sessionSegments.sessionId, sessionId),
          eq(sessionSegments.audioStatus, "ready"),
          eq(sessionSegments.transcriptionStatus, "completed"),
        ),
      );
    await tx
      .update(sessions)
      .set({ activeRunId: runId, status: "transcribing" })
      .where(eq(sessions.id, sessionId));
    await advanceTranscriptionBarrier(tx, runId);
    return runId;
  });
}

// Whether a segment id is one of a session's speaker samples, so only those
// clips can be played back from the artifact bucket.
export async function isSpeakerSample(sessionId: string, segmentId: string): Promise<boolean> {
  const [row] = await db
    .select({ label: sessionSpeakers.label })
    .from(sessionSpeakers)
    .where(
      and(eq(sessionSpeakers.sessionId, sessionId), sql`${sessionSpeakers.samples} ? ${segmentId}`),
    )
    .limit(1);
  return row !== undefined;
}

export interface RoomProgress {
  status: string;
  speakers: number;
  turns: number;
  transcribed: number;
  speakersConfirmed: boolean;
  error: string | null;
}

// How far a room recording has come, for the steps on its session page.
export async function getRoomProgress(sessionId: string): Promise<RoomProgress | null> {
  const [session] = await db
    .select({
      status: sessions.status,
      source: sessions.source,
      activeRunId: sessions.activeRunId,
      confirmedAt: sessions.speakersConfirmedAt,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (session?.source !== "room") return null;

  const [[speakers], [turns], [failure]] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessionSpeakers)
      .where(eq(sessionSpeakers.sessionId, sessionId)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        transcribed: sql<number>`count(*) filter (where ${sessionSegments.transcriptionStatus} = 'completed')::int`,
      })
      .from(sessionSegments)
      .where(eq(sessionSegments.sessionId, sessionId)),
    session.status === "failed"
      ? db
          .select({ error: processingRuns.error })
          .from(processingRuns)
          .where(eq(processingRuns.sessionId, sessionId))
          .orderBy(desc(processingRuns.createdAt))
          .limit(1)
      : [],
  ]);
  return {
    status: session.status,
    speakers: speakers?.count ?? 0,
    turns: turns?.total ?? 0,
    transcribed: turns?.transcribed ?? 0,
    speakersConfirmed: session.confirmedAt !== null,
    error: failure?.error ?? null,
  };
}
