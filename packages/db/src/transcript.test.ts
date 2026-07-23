import { describe, expect, it } from "vitest";
import {
  formatTranscriptForDisplay,
  simplifyTranscript,
  type Transcript,
  type TranscriptSegment,
} from "./transcript.ts";

function makeSegment(overrides: Partial<TranscriptSegment>): TranscriptSegment {
  return {
    segmentId: "0000",
    audioFile: "clips/0000.ogg",
    timestamp: "2026-01-01T00:00:00.000Z",
    userId: "user-1",
    username: "Alice",
    text: "fallback text",
    noSpeechProb: 0.1,
    whisper: null,
    ...overrides,
  };
}

function transcriptOf(...segments: TranscriptSegment[]): Transcript {
  return { version: 1, segments };
}

describe("formatTranscriptForDisplay", () => {
  it("returns chronologically ordered turns with timestamps and character names", () => {
    const alice = makeSegment({
      segmentId: "a",
      userId: "user-a",
      username: "Alice",
      timestamp: "2026-01-01T00:00:00.000Z",
      whisper: { segments: [{ start: 8, text: "Alice's words", no_speech_prob: 0.1 }] },
    });
    const bob = makeSegment({
      segmentId: "b",
      userId: "user-b",
      username: "Bob",
      timestamp: "2026-01-01T00:00:02.000Z",
      whisper: { segments: [{ start: 0, text: "Bob's words", no_speech_prob: 0.1 }] },
    });

    const result = formatTranscriptForDisplay(transcriptOf(alice, bob), [
      { userId: "user-a", username: "Alice", characterName: "Thorin" },
    ]);

    expect(result).toEqual([
      {
        timestamp: "2026-01-01T00:00:02.000Z",
        userId: "user-b",
        speaker: "Bob",
        characterName: null,
        text: "Bob's words",
      },
      {
        timestamp: "2026-01-01T00:00:08.000Z",
        userId: "user-a",
        speaker: "Alice",
        characterName: "Thorin",
        text: "Alice's words",
      },
    ]);
  });

  it("groups consecutive utterances by user while preserving the first timestamp", () => {
    const segment = makeSegment({
      timestamp: "2026-01-01T00:00:00.000Z",
      whisper: {
        segments: [
          { start: 2, text: " first part ", no_speech_prob: 0.1 },
          { start: 5, text: "second part", no_speech_prob: 0.1 },
        ],
      },
    });

    expect(formatTranscriptForDisplay(transcriptOf(segment), [])).toEqual([
      {
        timestamp: "2026-01-01T00:00:02.000Z",
        userId: "user-1",
        speaker: "Alice",
        characterName: null,
        text: "first part second part",
      },
    ]);
  });

  it("keeps adjacent users separate even when their display names match", () => {
    const first = makeSegment({
      segmentId: "a",
      userId: "user-a",
      username: "Player",
      whisper: { segments: [{ start: 0, text: "one", no_speech_prob: 0.1 }] },
    });
    const second = makeSegment({
      segmentId: "b",
      userId: "user-b",
      username: "Player",
      timestamp: "2026-01-01T00:00:01.000Z",
      whisper: { segments: [{ start: 0, text: "two", no_speech_prob: 0.1 }] },
    });

    expect(formatTranscriptForDisplay(transcriptOf(first, second), [])).toHaveLength(2);
  });
});

describe("simplifyTranscript", () => {
  it("orders utterances by when they were actually said, not by activation start", () => {
    // Alice's activation starts first (T0) but her real speech, per Whisper,
    // happens 8s in. Bob's activation starts 2s later but he speaks immediately.
    // A naive per-activation-timestamp sort would put Alice first; the fix
    // must put Bob first since his utterance's absolute time is earlier.
    const alice = makeSegment({
      segmentId: "a",
      userId: "user-a",
      username: "Alice",
      timestamp: "2026-01-01T00:00:00.000Z",
      whisper: { segments: [{ start: 8, text: "Alice's real words", no_speech_prob: 0.1 }] },
    });
    const bob = makeSegment({
      segmentId: "b",
      userId: "user-b",
      username: "Bob",
      timestamp: "2026-01-01T00:00:02.000Z",
      whisper: { segments: [{ start: 0, text: "Bob's words", no_speech_prob: 0.1 }] },
    });

    const result = simplifyTranscript(transcriptOf(alice, bob), []);

    expect(result.indexOf("Bob: Bob's words")).toBeLessThan(
      result.indexOf("Alice: Alice's real words"),
    );
  });

  it("drops individual sub-segments whose own no_speech_prob says it's noise", () => {
    const segment = makeSegment({
      whisper: {
        segments: [
          { start: 0, text: "hello there", no_speech_prob: 0.1 },
          { start: 5, text: "[background noise]", no_speech_prob: 0.95 },
        ],
      },
    });

    const result = simplifyTranscript(transcriptOf(segment), []);

    expect(result).toContain("hello there");
    expect(result).not.toContain("[background noise]");
  });

  it("still merges consecutive same-speaker utterances onto one line", () => {
    const segment = makeSegment({
      whisper: {
        segments: [
          { start: 0, text: "first part", no_speech_prob: 0.1 },
          { start: 3, text: "second part", no_speech_prob: 0.1 },
        ],
      },
    });

    const result = simplifyTranscript(transcriptOf(segment), []);

    expect(result).toContain("Alice: first part second part");
    expect(result.match(/Alice:/g)).toHaveLength(1);
  });

  it("falls back to the whole-clip text when whisper.segments is missing", () => {
    const segment = makeSegment({
      text: "fallback whole clip text",
      whisper: { text: "fallback whole clip text" },
    });

    const result = simplifyTranscript(transcriptOf(segment), []);

    expect(result).toContain("Alice: fallback whole clip text");
  });

  it("falls back to the whole-clip text when whisper.segments is empty", () => {
    const segment = makeSegment({
      text: "fallback whole clip text",
      whisper: { segments: [] },
    });

    const result = simplifyTranscript(transcriptOf(segment), []);

    expect(result).toContain("Alice: fallback whole clip text");
  });

  it.each([
    ["null", null],
    ["a string", "garbage"],
    ["segments not an array", { segments: "nope" }],
  ])("falls back without throwing when whisper is malformed (%s)", (_label, whisper) => {
    const segment = makeSegment({ text: "fallback whole clip text", whisper });

    expect(() => simplifyTranscript(transcriptOf(segment), [])).not.toThrow();
    const result = simplifyTranscript(transcriptOf(segment), []);
    expect(result).toContain("Alice: fallback whole clip text");
  });

  it("drops individual malformed sub-segments while keeping well-formed siblings", () => {
    const segment = makeSegment({
      whisper: {
        segments: [
          { start: 1, text: "good", no_speech_prob: 0.1 },
          { text: "bad, missing start", no_speech_prob: 0.1 },
        ],
      },
    });

    const result = simplifyTranscript(transcriptOf(segment), []);

    expect(result).toContain("good");
    expect(result).not.toContain("bad, missing start");
  });

  it("contributes no lines when every sub-segment is noise (not a fallback to top-level text)", () => {
    const noisy = makeSegment({
      text: "should never appear",
      whisper: {
        segments: [
          { start: 0, text: "noise1", no_speech_prob: 0.9 },
          { start: 1, text: "noise2", no_speech_prob: 0.99 },
        ],
      },
    });
    const normal = makeSegment({
      segmentId: "normal",
      userId: "user-b",
      username: "Bob",
      timestamp: "2026-01-01T00:00:05.000Z",
      whisper: { segments: [{ start: 0, text: "the only real line", no_speech_prob: 0.1 }] },
    });

    const result = simplifyTranscript(transcriptOf(noisy, normal), []);

    expect(result).not.toContain("should never appear");
    expect(result).toContain("Bob: the only real line");
  });

  it("still prepends the cast legend, derived from the finer-grained utterances", () => {
    const segment = makeSegment({
      userId: "user-a",
      username: "Alice",
      whisper: { segments: [{ start: 0, text: "hello", no_speech_prob: 0.1 }] },
    });

    const result = simplifyTranscript(transcriptOf(segment), [
      { userId: "user-a", username: "Alice", characterName: "Thorin" },
    ]);

    expect(result).toContain("Cast — the players and the characters they play:");
    expect(result).toContain("- Alice plays Thorin");
    expect(result.indexOf("Cast —")).toBeLessThan(result.indexOf("Alice: hello"));
  });
});
