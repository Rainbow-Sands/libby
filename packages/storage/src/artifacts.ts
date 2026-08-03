import { parseTranscript, type SessionArtifactRef, type Transcript } from "@rainbot/db";
import { artifactContentHash, getArtifactStorage } from "./object-storage.ts";

export interface ArtifactTextReader {
  downloadText(objectKey: string, bucket?: string): Promise<string>;
}

export class ArtifactIntegrityError extends Error {
  override readonly name = "ArtifactIntegrityError";
}

export async function loadArtifactText(
  artifact: SessionArtifactRef,
  storage: ArtifactTextReader = getArtifactStorage(),
): Promise<string> {
  const body = await storage.downloadText(artifact.objectKey, artifact.bucket);
  if (artifactContentHash(body) !== artifact.sha256) {
    throw new ArtifactIntegrityError(`Artifact ${artifact.id} failed checksum validation`);
  }
  return body;
}

export async function loadTranscriptArtifact(
  artifact: SessionArtifactRef,
  storage?: ArtifactTextReader,
): Promise<Transcript> {
  if (artifact.kind !== "transcript") {
    throw new ArtifactIntegrityError(`Artifact ${artifact.id} is not a transcript`);
  }
  const body = await loadArtifactText(artifact, storage);
  try {
    return parseTranscript(JSON.parse(body));
  } catch (error) {
    throw new ArtifactIntegrityError(`Artifact ${artifact.id} contains an invalid transcript`, {
      cause: error,
    });
  }
}

export async function loadDetailedRecordArtifact(
  artifact: SessionArtifactRef,
  storage?: ArtifactTextReader,
): Promise<string> {
  if (artifact.kind !== "detailed_record") {
    throw new ArtifactIntegrityError(`Artifact ${artifact.id} is not a detailed record`);
  }
  return loadArtifactText(artifact, storage);
}
