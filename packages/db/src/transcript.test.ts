import { describe, expect, it } from "vitest";
import {
  formatTranscriptForInference,
  pageTranscriptLines,
  transcriptLineKey,
  transcriptLineStats,
  transcriptLines,
  transcriptTableStats,
  type Transcript,
  type TranscriptLine,
  type TranscriptSegment,
} from "./transcript.ts";

function makeSegment(overrides: Partial<TranscriptSegment>): TranscriptSegment {
  return {
    segmentId: "0000",
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

describe("transcriptLines", () => {
  it("orders utterances by when they were said, across clips", () => {
    // Alice's clip stays open while Bob answers in the middle of it.
    const alice = makeSegment({
      segmentId: "a",
      userId: "user-a",
      username: "Alice",
      timestamp: "2026-01-01T00:00:00.000Z",
      whisper: {
        segments: [
          { start: 0, text: " A ", no_speech_prob: 0.1 },
          { start: 5, text: "C", no_speech_prob: 0.1 },
        ],
      },
    });
    const bob = makeSegment({
      segmentId: "b",
      userId: "user-b",
      username: "Bob",
      timestamp: "2026-01-01T00:00:03.000Z",
      whisper: { segments: [{ start: 0, text: "B", no_speech_prob: 0.1 }] },
    });

    const result = transcriptLines(
      [alice, bob],
      [{ userId: "user-a", username: "Alice", characterName: "Thorin" }],
    );

    expect(result.map((line) => [line.speaker, line.text, line.timestamp])).toEqual([
      ["Alice", "A", "2026-01-01T00:00:00.000Z"],
      ["Bob", "B", "2026-01-01T00:00:03.000Z"],
      ["Alice", "C", "2026-01-01T00:00:05.000Z"],
    ]);
    expect(result[0]).toMatchObject({ id: "a:0000", characterName: "Thorin" });
    expect(result[1].characterName).toBeNull();
  });

  it("falls back to the whole clip and drops empty text", () => {
    const whole = makeSegment({ segmentId: "a", text: " whole clip " });
    const empty = makeSegment({
      segmentId: "b",
      whisper: { segments: [{ start: 0, text: "  ", no_speech_prob: 0.1 }] },
    });

    expect(transcriptLines([whole, empty], []).map((line) => line.text)).toEqual(["whole clip"]);
  });

  it("counts turns and speakers, keeping same-named users apart", () => {
    const first = makeSegment({ segmentId: "a", userId: "user-a", username: "Player" });
    const second = makeSegment({
      segmentId: "b",
      userId: "user-b",
      username: "Player",
      timestamp: "2026-01-01T00:00:01.000Z",
    });
    const third = makeSegment({
      segmentId: "c",
      userId: "user-b",
      username: "Player",
      timestamp: "2026-01-01T00:00:02.000Z",
    });

    expect(transcriptLineStats(transcriptLines([first, second, third], []))).toEqual({
      turns: 2,
      speakers: [
        { userId: "user-a", speaker: "Player" },
        { userId: "user-b", speaker: "Player" },
      ],
    });
  });
});

const texts = (page: { lines: TranscriptLine[] }) => page.lines.map((line) => line.text);

describe("pageTranscriptLines", () => {
  // One line every 10 seconds, two speakers taking turns.
  const lines: TranscriptLine[] = Array.from({ length: 10 }, (_, index) => ({
    id: `s${index}:0000`,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index * 10)).toISOString(),
    userId: `user-${index % 2}`,
    speaker: "Alice",
    characterName: null,
    text: `line ${index}`,
  }));

  it("pages from the start and from the end", () => {
    expect(pageTranscriptLines(lines, {}, 3)).toMatchObject({ hasBefore: false, hasAfter: true });
    expect(texts(pageTranscriptLines(lines, {}, 3))).toEqual(["line 0", "line 1", "line 2"]);
    const end = pageTranscriptLines(lines, { end: true }, 3);
    expect(texts(end)).toEqual(["line 7", "line 8", "line 9"]);
    expect(end).toMatchObject({ hasBefore: true, hasAfter: false });
  });

  it("pages before and after a line's key", () => {
    const key = transcriptLineKey(lines[5]);
    expect(texts(pageTranscriptLines(lines, { before: key }, 3))).toEqual([
      "line 2",
      "line 3",
      "line 4",
    ]);
    expect(texts(pageTranscriptLines(lines, { after: key }, 3))).toEqual([
      "line 6",
      "line 7",
      "line 8",
    ]);
    expect(pageTranscriptLines(lines, { before: transcriptLineKey(lines[1]) }, 3)).toMatchObject({
      hasBefore: false,
      hasAfter: true,
    });
  });

  it("starts a window at the beginning of a speaker's turn", () => {
    const turns = lines.map((line, index) => ({
      ...line,
      userId: index < 5 ? "user-1" : "user-2",
    }));
    const end = pageTranscriptLines(turns, { end: true }, 7);
    expect(texts(end)[0]).toBe("line 0");
    expect(end).toMatchObject({ hasBefore: false, hasAfter: false });
    expect(texts(pageTranscriptLines(turns, { before: transcriptLineKey(turns[5]) }, 2))).toEqual([
      "line 0",
      "line 1",
      "line 2",
      "line 3",
      "line 4",
    ]);
  });

  it("opens around a cited moment with some context before it", () => {
    // 47 seconds in falls within line 4 (40s).
    const page = pageTranscriptLines(lines, { atSeconds: 47 }, 4);
    expect(texts(page)).toEqual(["line 3", "line 4", "line 5", "line 6"]);
    expect(page).toMatchObject({ hasBefore: true, hasAfter: true });
  });
});

describe("formatTranscriptForInference", () => {
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

    const result = formatTranscriptForInference(transcriptOf(alice, bob), []);

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

    const result = formatTranscriptForInference(transcriptOf(segment), []);

    expect(result).toContain("hello there");
    expect(result).not.toContain("[background noise]");
  });

  it("preserves utterance boundaries with minute markers instead of timestamps", () => {
    const segment = makeSegment({
      whisper: {
        segments: [
          { start: 0, text: "first part", no_speech_prob: 0.1 },
          { start: 3, text: "second part", no_speech_prob: 0.1 },
        ],
      },
    });

    const result = formatTranscriptForInference(transcriptOf(segment), []);

    expect(result).toBe("[0:00:00]\nAlice: first part\nAlice: second part\n");
    expect(result).not.toContain(segment.timestamp);
  });

  it("falls back to the whole-clip text when whisper.segments is missing", () => {
    const segment = makeSegment({
      text: "fallback whole clip text",
      whisper: { text: "fallback whole clip text" },
    });

    const result = formatTranscriptForInference(transcriptOf(segment), []);

    expect(result).toContain("Alice: fallback whole clip text");
  });

  it("falls back to the whole-clip text when whisper.segments is empty", () => {
    const segment = makeSegment({
      text: "fallback whole clip text",
      whisper: { segments: [] },
    });

    const result = formatTranscriptForInference(transcriptOf(segment), []);

    expect(result).toContain("Alice: fallback whole clip text");
  });

  it.each([
    ["null", null],
    ["a string", "garbage"],
    ["segments not an array", { segments: "nope" }],
  ])("falls back without throwing when whisper is malformed (%s)", (_label, whisper) => {
    const segment = makeSegment({ text: "fallback whole clip text", whisper });

    expect(() => formatTranscriptForInference(transcriptOf(segment), [])).not.toThrow();
    const result = formatTranscriptForInference(transcriptOf(segment), []);
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

    const result = formatTranscriptForInference(transcriptOf(segment), []);

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

    const result = formatTranscriptForInference(transcriptOf(noisy, normal), []);

    expect(result).not.toContain("should never appear");
    expect(result).toContain("Bob: the only real line");
  });

  it("opens each new elapsed minute with a marker", () => {
    const early = makeSegment({
      timestamp: "2026-01-01T00:00:00.000Z",
      whisper: {
        segments: [
          { start: 0, text: "opening", no_speech_prob: 0.1 },
          { start: 30, text: "same minute", no_speech_prob: 0.1 },
        ],
      },
    });
    const late = makeSegment({
      segmentId: "late",
      timestamp: "2026-01-01T01:02:10.000Z",
      whisper: { segments: [{ start: 5, text: "much later", no_speech_prob: 0.1 }] },
    });

    const result = formatTranscriptForInference(transcriptOf(early, late), []);

    expect(result).toBe(
      "[0:00:00]\nAlice: opening\nAlice: same minute\n[1:02:00]\nAlice: much later\n",
    );
  });

  it("prepends the cast legend, derived from the finer-grained utterances", () => {
    const segment = makeSegment({
      userId: "user-a",
      username: "Alice",
      whisper: { segments: [{ start: 0, text: "hello", no_speech_prob: 0.1 }] },
    });

    const result = formatTranscriptForInference(transcriptOf(segment), [
      { userId: "user-a", username: "Alice", characterName: "Thorin" },
    ]);

    expect(result).toContain("Cast — the players and the characters they play:");
    expect(result).toContain("- Alice plays Thorin");
    expect(result.indexOf("Cast —")).toBeLessThan(result.indexOf("Alice: hello"));
  });
});

describe("transcriptTableStats", () => {
  it("measures duration and words per speaker, most talkative first", () => {
    const alice = makeSegment({
      userId: "user-a",
      username: "Alice",
      timestamp: "2026-01-01T00:00:00.000Z",
      whisper: { segments: [{ start: 0, text: "one two", no_speech_prob: 0.1 }] },
    });
    const bob = makeSegment({
      segmentId: "b",
      userId: "user-b",
      username: "Bob",
      timestamp: "2026-01-01T00:10:00.000Z",
      whisper: { segments: [{ start: 0, text: "three four five", no_speech_prob: 0.1 }] },
    });

    expect(
      transcriptTableStats(transcriptOf(alice, bob), [
        { userId: "user-a", username: "Alice", characterName: "Thorin" },
      ]),
    ).toEqual({
      durationSeconds: 600,
      speakers: [
        { userId: "user-b", name: "Bob", characterName: null, words: 3 },
        { userId: "user-a", name: "Alice", characterName: "Thorin", words: 2 },
      ],
    });
  });
});
