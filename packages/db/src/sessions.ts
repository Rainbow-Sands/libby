import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { sessions } from "./schema.ts";
import type { Transcript } from "./transcript.ts";

export interface UpsertSessionInput {
  id: string;
  campaignId: string;
  channelId: string;
  sessionDir: string;
  workflowId: string;
}

export async function upsertSession(input: UpsertSessionInput): Promise<void> {
  await db
    .insert(sessions)
    .values({
      id: input.id,
      campaignId: input.campaignId,
      channelId: input.channelId,
      sessionDir: input.sessionDir,
      workflowId: input.workflowId,
      status: "recording",
    })
    .onConflictDoUpdate({
      target: sessions.id,
      set: {
        campaignId: input.campaignId,
        channelId: input.channelId,
        sessionDir: input.sessionDir,
        workflowId: input.workflowId,
      },
    });
}

export async function setSessionStatus(
  sessionId: string,
  status: string,
  endedAt?: Date
): Promise<void> {
  await db
    .update(sessions)
    .set({ status, ...(endedAt ? { endedAt } : {}) })
    .where(eq(sessions.id, sessionId));
}

export async function setSessionTitle(
  sessionId: string,
  title: string
): Promise<void> {
  await db
    .update(sessions)
    .set({ title })
    .where(eq(sessions.id, sessionId));
}

export async function saveTranscript(
  sessionId: string,
  transcript: Transcript
): Promise<void> {
  await db
    .update(sessions)
    .set({ transcript })
    .where(eq(sessions.id, sessionId));
}

export async function saveSummary(
  sessionId: string,
  summary: string
): Promise<void> {
  await db
    .update(sessions)
    .set({ summary })
    .where(eq(sessions.id, sessionId));
}

export async function saveRecap(
  sessionId: string,
  recap: string
): Promise<void> {
  await db
    .update(sessions)
    .set({ recap })
    .where(eq(sessions.id, sessionId));
}
