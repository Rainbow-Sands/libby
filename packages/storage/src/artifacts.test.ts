import { describe, expect, it } from "vitest";
import type { SessionArtifactRef } from "@rainbot/db";
import {
  ArtifactIntegrityError,
  loadDetailedRecordArtifact,
  loadTranscriptArtifact,
  type ArtifactTextReader,
} from "./artifacts.ts";
import { artifactContentHash } from "./object-storage.ts";

const transcriptBody = JSON.stringify({
  version: 1,
  segments: [
    {
      segmentId: "segment-1",
      timestamp: "2026-08-02T12:00:00.000Z",
      userId: "user-1",
      username: "Player",
      text: "Hello",
      noSpeechProb: 0.01,
      whisper: { segments: [] },
    },
  ],
});

function artifact(kind: SessionArtifactRef["kind"], body: string): SessionArtifactRef {
  return {
    id: "artifact-1",
    kind,
    bucket: "artifacts",
    objectKey: "artifact-key",
    contentType: kind === "transcript" ? "application/json" : "text/markdown",
    formatVersion: 1,
    byteSize: Buffer.byteLength(body),
    sha256: artifactContentHash(body),
  };
}

function reader(body: string): ArtifactTextReader {
  return { downloadText: async () => body };
}

describe("artifact loading", () => {
  it("downloads, verifies, and validates transcripts", async () => {
    await expect(
      loadTranscriptArtifact(artifact("transcript", transcriptBody), reader(transcriptBody)),
    ).resolves.toMatchObject({ version: 1, segments: [{ text: "Hello" }] });
  });

  it("rejects content whose checksum does not match its metadata", async () => {
    await expect(
      loadTranscriptArtifact(artifact("transcript", transcriptBody), reader("tampered")),
    ).rejects.toBeInstanceOf(ArtifactIntegrityError);
  });

  it("rejects structurally invalid transcript JSON", async () => {
    const body = JSON.stringify({ version: 1, segments: [{ text: "missing metadata" }] });
    await expect(
      loadTranscriptArtifact(artifact("transcript", body), reader(body)),
    ).rejects.toThrow(/invalid transcript/);
  });

  it("rejects artifacts of the wrong kind", async () => {
    await expect(
      loadTranscriptArtifact(artifact("detailed_record", transcriptBody), reader(transcriptBody)),
    ).rejects.toThrow(/not a transcript/);
  });

  it("loads detailed records through the same integrity check", async () => {
    const body = "# Detailed record";
    await expect(
      loadDetailedRecordArtifact(artifact("detailed_record", body), reader(body)),
    ).resolves.toBe(body);
  });
});
