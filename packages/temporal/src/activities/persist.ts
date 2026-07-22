import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  upsertSession,
  setSessionStatus,
  setSessionTitle,
  saveTranscript,
  saveSummary,
  saveRecap,
  getSessionRegenerationInput,
  type UpsertSessionInput,
  type Transcript,
} from "@rainbot/db";

export async function recordSessionStart(input: UpsertSessionInput): Promise<void> {
  await upsertSession(input);
}

// endedAt is decided here (not in the workflow) so workflow code stays
// deterministic. Terminal states get an end timestamp.
export async function updateSessionStatus(sessionId: string, status: string): Promise<void> {
  const terminal = status === "done" || status === "failed";
  await setSessionStatus(sessionId, status, terminal ? new Date() : undefined);
}

export async function updateRegenerationStatus(sessionId: string, status: string): Promise<void> {
  // Regeneration should not replace the original session's endedAt timestamp.
  await setSessionStatus(sessionId, status);
}

export async function prepareSessionRegeneration(sessionId: string): Promise<{
  campaignId: string;
  sessionDir: string;
  transcriptKey: string;
}> {
  const session = await getSessionRegenerationInput(sessionId);
  if (!session) throw new Error(`Session ${sessionId} has no persisted transcript`);

  mkdirSync(session.sessionDir, { recursive: true });
  const transcriptKey = "transcript.json";
  writeFileSync(
    path.join(session.sessionDir, transcriptKey),
    JSON.stringify(session.transcript),
    "utf8",
  );
  return {
    campaignId: session.campaignId,
    sessionDir: session.sessionDir,
    transcriptKey,
  };
}

export async function persistTitle(
  sessionDir: string,
  sessionId: string,
  titleKey: string,
): Promise<void> {
  const p = path.join(sessionDir, titleKey);
  if (!existsSync(p)) return;
  const title = readFileSync(p, "utf8").trim();
  if (!title) return;
  await setSessionTitle(sessionId, title);
}

export async function persistTranscript(
  sessionDir: string,
  sessionId: string,
  transcriptKey: string,
): Promise<void> {
  const p = path.join(sessionDir, transcriptKey);
  if (!existsSync(p)) return;
  const transcript = JSON.parse(readFileSync(p, "utf8")) as Transcript;
  await saveTranscript(sessionId, transcript);
}

export async function persistSummary(
  sessionDir: string,
  sessionId: string,
  summaryKey: string,
): Promise<void> {
  const p = path.join(sessionDir, summaryKey);
  if (!existsSync(p)) return;
  await saveSummary(sessionId, readFileSync(p, "utf8"));
}

export async function persistRecap(
  sessionDir: string,
  sessionId: string,
  recapKey: string,
): Promise<void> {
  const p = path.join(sessionDir, recapKey);
  if (!existsSync(p)) return;
  await saveRecap(sessionId, readFileSync(p, "utf8"));
}
