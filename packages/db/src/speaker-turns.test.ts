import { describe, expect, it } from "vitest";
import {
  applySpeakerAssignments,
  matchVoice,
  meanEmbedding,
  pickSamples,
  planClips,
  speakerTimeline,
} from "./speaker-turns.ts";
import type { TranscriptSegment } from "./transcript.ts";

describe("planClips", () => {
  it("joins a speaker's turns across short pauses", () => {
    const clips = planClips([
      { start: 0, end: 2, speaker: "A" },
      { start: 2.5, end: 4, speaker: "A" },
      { start: 6, end: 8, speaker: "A" },
    ]);
    expect(clips).toEqual([
      { speaker: "A", start: 0, end: 4 },
      { speaker: "A", start: 6, end: 8 },
    ]);
  });

  it("starts a new clip when the speaker changes", () => {
    const clips = planClips([
      { start: 0, end: 2, speaker: "A" },
      { start: 2.2, end: 3, speaker: "B" },
      { start: 3.1, end: 5, speaker: "A" },
    ]);
    expect(clips.map((clip) => clip.speaker)).toEqual(["A", "B", "A"]);
  });

  it("splits long stretches into equal clips no longer than the limit", () => {
    const clips = planClips([{ start: 10, end: 80, speaker: "A" }], { maxLength: 30 });
    expect(clips).toHaveLength(3);
    expect(clips[0].start).toBe(10);
    expect(clips.at(-1)?.end).toBe(80);
    expect(clips.every((clip) => clip.end - clip.start <= 30)).toBe(true);
  });

  it("drops fragments too short to transcribe", () => {
    expect(planClips([{ start: 0, end: 0.3, speaker: "A" }])).toEqual([]);
  });
});

describe("speakerTimeline", () => {
  it("bridges short pauses", () => {
    expect(
      speakerTimeline([
        { speaker: "A", start: 0, end: 5 },
        { speaker: "A", start: 10, end: 15 },
        { speaker: "A", start: 100, end: 110 },
      ]),
    ).toEqual([
      [0, 15],
      [100, 110],
    ]);
  });
});

describe("pickSamples", () => {
  it("draws samples from different parts of the session", () => {
    const clips = Array.from({ length: 30 }, (_, index) => ({
      speaker: "A",
      start: index * 60,
      end: index * 60 + 3 + (index % 5),
    }));
    const samples = pickSamples(clips);
    expect(samples).toHaveLength(3);
    expect(samples[0].start).toBeLessThan(600);
    expect(samples[2].start).toBeGreaterThanOrEqual(1200);
  });

  it("falls back to short clips when that is all a speaker has", () => {
    const clips = [{ speaker: "A", start: 0, end: 1 }];
    expect(pickSamples(clips)).toEqual(clips);
  });
});

describe("matchVoice", () => {
  const voices = new Map([
    ["mara", meanEmbedding([[1, 0, 0]])!],
    ["jonah", meanEmbedding([[0, 1, 0]])!],
  ]);

  it("suggests the closest voice", () => {
    expect(matchVoice([0.9, 0.1, 0], voices)?.userId).toBe("mara");
  });

  it("suggests nobody when no voice is close", () => {
    expect(matchVoice([0, 0, 1], voices)).toBeNull();
    expect(matchVoice(null, voices)).toBeNull();
  });
});

function segment(segmentId: string, userId: string): TranscriptSegment {
  return {
    segmentId,
    timestamp: "2026-10-28T22:00:00.000Z",
    userId,
    username: "Speaker",
    text: "Hello",
    noSpeechProb: 0,
    whisper: null,
  };
}

describe("applySpeakerAssignments", () => {
  it("names members and guests and drops ignored voices", () => {
    const named = applySpeakerAssignments(
      [segment("a", "speaker:1"), segment("b", "speaker:2"), segment("c", "speaker:3")],
      [
        { label: "speaker:1", userId: "100", username: "Daniel", guestName: null, ignored: false },
        { label: "speaker:2", userId: null, username: null, guestName: "Ali", ignored: false },
        { label: "speaker:3", userId: null, username: null, guestName: null, ignored: true },
      ],
    );
    expect(named.map((s) => [s.segmentId, s.userId, s.username])).toEqual([
      ["a", "100", "Daniel"],
      ["b", "guest:ali", "Ali"],
    ]);
  });

  it("leaves clips from other sources alone", () => {
    const clip = segment("a", "100");
    expect(applySpeakerAssignments([clip], [])).toEqual([clip]);
  });
});
