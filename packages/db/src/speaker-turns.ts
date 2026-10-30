import type { TranscriptSegment } from "./transcript.ts";

// One stretch of speech that speaker detection gave to one voice, in seconds
// from the start of the recording.
export interface DetectedTurn {
  start: number;
  end: number;
  speaker: string;
}

// One clip to cut from a room recording and transcribe on its own.
export interface PlannedClip {
  speaker: string;
  start: number;
  end: number;
}

export interface ClipPlanOptions {
  // Turns of one speaker this close together share a clip.
  maxGap: number;
  // Whisper does best on short clips; longer stretches are split.
  maxLength: number;
  // Shorter clips are mostly coughs and crosstalk.
  minLength: number;
}

const CLIP_DEFAULTS: ClipPlanOptions = { maxGap: 1, maxLength: 30, minLength: 0.6 };

export function planClips(
  turns: DetectedTurn[],
  options: Partial<ClipPlanOptions> = {},
): PlannedClip[] {
  const { maxGap, maxLength, minLength } = { ...CLIP_DEFAULTS, ...options };
  const merged: PlannedClip[] = [];
  for (const turn of turns.toSorted((a, b) => a.start - b.start)) {
    if (turn.end <= turn.start) continue;
    const last = merged.at(-1);
    if (
      last &&
      last.speaker === turn.speaker &&
      turn.start - last.end <= maxGap &&
      turn.end - last.start <= maxLength
    ) {
      last.end = Math.max(last.end, turn.end);
    } else {
      merged.push({ speaker: turn.speaker, start: turn.start, end: turn.end });
    }
  }

  return merged.flatMap((clip) => {
    const length = clip.end - clip.start;
    if (length < minLength) return [];
    const pieces = Math.ceil(length / maxLength);
    const step = length / pieces;
    return Array.from({ length: pieces }, (_, index) => ({
      speaker: clip.speaker,
      start: round(clip.start + index * step),
      end: round(index === pieces - 1 ? clip.end : clip.start + (index + 1) * step),
    }));
  });
}

function round(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}

// Where a speaker talked, coarsened for the Who's who timeline: pauses under
// `gap` seconds are bridged.
export function speakerTimeline(clips: PlannedClip[], gap = 20): [number, number][] {
  const spans: [number, number][] = [];
  for (const clip of clips.toSorted((a, b) => a.start - b.start)) {
    const last = spans.at(-1);
    if (last && clip.start - last[1] <= gap) last[1] = Math.max(last[1], clip.end);
    else spans.push([clip.start, clip.end]);
  }
  return spans.map(([start, end]) => [Math.round(start), Math.round(end)]);
}

// Up to `count` clips to play back for a speaker: ones long enough to
// recognize a voice, drawn from different parts of the session.
export function pickSamples<T extends PlannedClip>(clips: T[], count = 3): T[] {
  const usable = clips.filter((clip) => clip.end - clip.start >= 3);
  const pool = usable.length > 0 ? usable : clips;
  if (pool.length <= count) return pool.toSorted((a, b) => a.start - b.start);

  const ordered = pool.toSorted((a, b) => a.start - b.start);
  const picks: T[] = [];
  for (let part = 0; part < count; part++) {
    const slice = ordered.slice(
      Math.floor((part * ordered.length) / count),
      Math.floor(((part + 1) * ordered.length) / count),
    );
    // The longest clip in this part of the session, capped so a sample stays
    // short to listen to.
    const best = slice.toSorted(
      (a, b) => Math.min(b.end - b.start, 15) - Math.min(a.end - a.start, 15),
    )[0];
    if (best) picks.push(best);
  }
  return picks;
}

export function normalize(vector: number[]): number[] {
  const length = Math.hypot(...vector);
  return length > 0 ? vector.map((value) => value / length) : vector;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const [x, y] = [normalize(a), normalize(b)];
  return x.reduce((sum, value, index) => sum + value * y[index], 0);
}

// A member's voice: the average direction of every confirmed speaker that was
// them.
export function meanEmbedding(embeddings: number[][]): number[] | null {
  const usable = embeddings.filter((embedding) => embedding.length > 0);
  if (usable.length === 0) return null;
  const sum = Array.from({ length: usable[0].length }, () => 0);
  for (const embedding of usable) {
    if (embedding.length !== sum.length) continue;
    normalize(embedding).forEach((value, index) => (sum[index] += value));
  }
  return normalize(sum);
}

// How alike two voices must sound before Libby suggests a match.
export const VOICE_MATCH_THRESHOLD = 0.5;

export function matchVoice(
  embedding: number[] | null,
  voices: Map<string, number[]>,
): { userId: string; score: number } | null {
  if (!embedding) return null;
  let best: { userId: string; score: number } | null = null;
  for (const [userId, voice] of voices) {
    const score = cosineSimilarity(embedding, voice);
    if (score >= VOICE_MATCH_THRESHOLD && (!best || score > best.score)) best = { userId, score };
  }
  return best;
}

export const SPEAKER_LABEL_PREFIX = "speaker:";

export function speakerLabel(position: number): string {
  return `${SPEAKER_LABEL_PREFIX}${position}`;
}

export interface SpeakerAssignment {
  label: string;
  userId: string | null;
  username: string | null;
  guestName: string | null;
  ignored: boolean;
}

// Puts confirmed names on a room recording's clips: a member's id and name, a
// guest's name, or nothing for voices that are not part of the game.
export function applySpeakerAssignments(
  segments: TranscriptSegment[],
  speakers: SpeakerAssignment[],
): TranscriptSegment[] {
  const byLabel = new Map(speakers.map((speaker) => [speaker.label, speaker]));
  return segments.flatMap((segment) => {
    const speaker = byLabel.get(segment.userId);
    if (!speaker) return [segment];
    if (speaker.ignored) return [];
    if (speaker.userId) {
      return [{ ...segment, userId: speaker.userId, username: speaker.username ?? undefined }];
    }
    if (speaker.guestName) {
      // Guests have no account; one id per name keeps them apart in the
      // transcript.
      const guestId = `guest:${speaker.guestName.toLowerCase()}`.slice(0, 20);
      return [{ ...segment, userId: guestId, username: speaker.guestName }];
    }
    return [segment];
  });
}
