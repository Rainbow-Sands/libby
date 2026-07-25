import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AudioSegmentRef as SegmentRef, Transcript } from "@rainbot/db";

const SEGMENT_METADATA_DIR = "segment-metadata";

function isSegmentRef(value: unknown): value is SegmentRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.segmentId === "string" &&
    typeof ref.audioFile === "string" &&
    typeof ref.timestamp === "string" &&
    typeof ref.userId === "string" &&
    (ref.username === undefined || typeof ref.username === "string")
  );
}

function transcriptSegmentRef(segment: Transcript["segments"][number]): SegmentRef {
  return {
    segmentId: segment.segmentId,
    audioFile: segment.audioFile,
    timestamp: segment.timestamp,
    userId: segment.userId,
    ...(segment.username ? { username: segment.username } : {}),
  };
}

export function persistSegmentMetadata(sessionDir: string, ref: SegmentRef): void {
  const metadataDir = path.join(sessionDir, SEGMENT_METADATA_DIR);
  mkdirSync(metadataDir, { recursive: true });
  const filename = `${encodeURIComponent(ref.segmentId)}.json`;
  writeFileSync(path.join(metadataDir, filename), JSON.stringify(ref), "utf8");
}

export function loadSegmentMetadata(
  sessionDir: string,
  transcript: Transcript | null,
): SegmentRef[] {
  // Persisted transcripts predate the complete audio manifest. Use their
  // segments as a fallback so existing sessions can still be re-transcribed.
  const refs = new Map(
    (transcript?.segments ?? []).map((segment) => [
      segment.segmentId,
      transcriptSegmentRef(segment),
    ]),
  );

  const metadataDir = path.join(sessionDir, SEGMENT_METADATA_DIR);
  if (existsSync(metadataDir)) {
    for (const filename of readdirSync(metadataDir)) {
      if (path.extname(filename) !== ".json") continue;
      const metadataPath = path.join(metadataDir, filename);
      const value: unknown = JSON.parse(readFileSync(metadataPath, "utf8"));
      if (!isSegmentRef(value)) {
        throw new Error(`Invalid segment metadata: ${filename}`);
      }
      refs.set(value.segmentId, value);
    }
  }

  return [...refs.values()].toSorted(
    (a, b) => a.timestamp.localeCompare(b.timestamp) || a.segmentId.localeCompare(b.segmentId),
  );
}
