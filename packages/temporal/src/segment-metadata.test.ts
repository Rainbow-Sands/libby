import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Transcript } from "@rainbot/db";
import { loadSegmentMetadata, persistSegmentMetadata } from "./segment-metadata.ts";

const directories: string[] = [];

function temporarySessionDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "rainbot-segment-metadata-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("segment metadata", () => {
  it("loads a manifest when a failed session has no transcript", () => {
    const sessionDir = temporarySessionDir();
    persistSegmentMetadata(sessionDir, {
      segmentId: "recorded",
      audioFile: "clips/recorded.ogg",
      timestamp: "2026-07-25T12:00:00.000Z",
      userId: "user-1",
    });

    expect(loadSegmentMetadata(sessionDir, null)).toHaveLength(1);
  });

  it("uses persisted transcript segments for sessions recorded before manifests", () => {
    const transcript: Transcript = {
      version: 1,
      segments: [
        {
          segmentId: "existing",
          audioFile: "clips/existing.ogg",
          timestamp: "2026-07-25T12:00:00.000Z",
          userId: "user-1",
          username: "Alice",
          text: "Hello",
          noSpeechProb: 0.1,
          whisper: {},
        },
      ],
    };

    expect(loadSegmentMetadata(temporarySessionDir(), transcript)).toEqual([
      {
        segmentId: "existing",
        audioFile: "clips/existing.ogg",
        timestamp: "2026-07-25T12:00:00.000Z",
        userId: "user-1",
        username: "Alice",
      },
    ]);
  });

  it("includes manifest entries that were omitted from the transcript as noise", () => {
    const sessionDir = temporarySessionDir();
    const transcript: Transcript = {
      version: 1,
      segments: [
        {
          segmentId: "speech",
          audioFile: "clips/speech.ogg",
          timestamp: "2026-07-25T12:00:01.000Z",
          userId: "user-1",
          text: "Hello",
          noSpeechProb: 0.1,
          whisper: {},
        },
      ],
    };
    persistSegmentMetadata(sessionDir, {
      segmentId: "noise",
      audioFile: "clips/noise.ogg",
      timestamp: "2026-07-25T12:00:00.000Z",
      userId: "user-2",
    });

    expect(loadSegmentMetadata(sessionDir, transcript).map((segment) => segment.segmentId)).toEqual(
      ["noise", "speech"],
    );
  });
});
