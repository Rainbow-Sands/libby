import type { SessionDetail, Transcript } from "@rainbot/db";
import { artifactContentHash, getArtifactStorage } from "@rainbot/worker";

export async function loadSessionTranscript(session: SessionDetail): Promise<Transcript | null> {
  if (!session.transcriptArtifact) return null;
  const body = await getArtifactStorage().downloadText(
    session.transcriptArtifact.objectKey,
    session.transcriptArtifact.bucket,
  );
  if (artifactContentHash(body) !== session.transcriptArtifact.sha256) {
    throw new Error(`Session ${session.id} has a corrupt transcript artifact`);
  }
  const value: unknown = JSON.parse(body);
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    !("segments" in value) ||
    !Array.isArray(value.segments)
  ) {
    throw new Error(`Session ${session.id} has an invalid transcript artifact`);
  }
  return value as Transcript;
}

export async function loadSessionDetailedRecord(session: SessionDetail): Promise<string | null> {
  if (!session.detailedRecordArtifact) return null;
  const body = await getArtifactStorage().downloadText(
    session.detailedRecordArtifact.objectKey,
    session.detailedRecordArtifact.bucket,
  );
  if (artifactContentHash(body) !== session.detailedRecordArtifact.sha256) {
    throw new Error(`Session ${session.id} has a corrupt detailed record artifact`);
  }
  return body;
}
