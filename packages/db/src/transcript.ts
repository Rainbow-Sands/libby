import { formatElapsed, type TableStats } from "./session-notes.ts";

// One recorded audio clip, transcribed. We keep everything the transcription
// server gave us (under `whisper`) alongside the fields the pipeline actually
// uses, so future formatting improvements can re-derive better output from the
// same recordings without re-transcribing.
export interface TranscriptSegment {
  segmentId: string;
  timestamp: string; // ISO, when the speaker started talking
  userId: string;
  username?: string;
  text: string;
  noSpeechProb: number;
  whisper: unknown; // raw response from the transcription server for this clip
}

export interface Transcript {
  version: 1;
  segments: TranscriptSegment[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTranscriptSegment(value: unknown): value is TranscriptSegment {
  if (!isRecord(value)) return false;
  return (
    typeof value.segmentId === "string" &&
    typeof value.timestamp === "string" &&
    !Number.isNaN(Date.parse(value.timestamp)) &&
    typeof value.userId === "string" &&
    (value.username === undefined || typeof value.username === "string") &&
    typeof value.text === "string" &&
    typeof value.noSpeechProb === "number" &&
    Number.isFinite(value.noSpeechProb) &&
    "whisper" in value
  );
}

export function parseTranscript(value: unknown): Transcript {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.segments)) {
    throw new TypeError("Invalid transcript");
  }
  const segments = value.segments.map((segment) => {
    if (!isTranscriptSegment(segment)) throw new TypeError("Invalid transcript");
    return segment;
  });
  return { version: 1, segments };
}

interface CastMember {
  userId: string;
  username: string;
  characterName: string;
}

// Whisper's own per-clip utterance segmentation, already stored verbatim
// under TranscriptSegment.whisper. Duck-typed since that field is `unknown` —
// @rainbot/db stays decoupled from the worker's whisper.cpp response type.
interface WhisperSubSegment {
  start: number; // seconds, relative to the clip
  text: string;
  no_speech_prob: number;
  avg_logprob?: number;
}

interface WhisperVerboseJson {
  segments: WhisperSubSegment[];
}

// Duplicated from packages/worker/src/tasks.ts so @rainbot/db does not depend
// on worker internals.
const NO_SPEECH_THRESHOLD = 0.6;
const LOGPROB_THRESHOLD = -1;

// A single spoken utterance with its own timestamp, finer-grained than a
// TranscriptSegment (one per Discord voice activation, which can span many
// utterances — or long stretches of background-noise silence — at once).
interface Utterance {
  timestamp: string;
  userId: string;
  username?: string;
  text: string;
}

function isWhisperSubSegment(value: unknown): value is WhisperSubSegment {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.start === "number" &&
    typeof v.text === "string" &&
    typeof v.no_speech_prob === "number" &&
    (v.avg_logprob === undefined || typeof v.avg_logprob === "number")
  );
}

// Returns null when there's nothing usable to explode a segment into, so the
// caller can fall back to treating the whole clip as one utterance.
function extractWhisperSubSegments(whisper: unknown): WhisperSubSegment[] | null {
  if (typeof whisper !== "object" || whisper === null) return null;
  const segments = (whisper as Partial<WhisperVerboseJson>).segments;
  if (!Array.isArray(segments)) return null;

  const valid = segments.filter(isWhisperSubSegment);
  return valid.length > 0 ? valid : null;
}

// A Discord voice activation can run long past when someone actually stopped
// talking (background noise keeps VAD open), so anchoring all of its text to
// one timestamp can put it out of order relative to other speakers. Whisper
// already segments a clip into individual utterances with their own in-clip
// offsets — explode each TranscriptSegment into one Utterance per Whisper
// sub-segment. Whisper treats a sub-segment as silence only when no-speech
// probability is high and decoded-token confidence is low; using no_speech_prob
// alone can discard confidently decoded speech. Sorting then reflects when
// things were actually said, not when the mic opened.
function explodeSegment(segment: TranscriptSegment): Utterance[] {
  const subSegments = extractWhisperSubSegments(segment.whisper);
  if (subSegments === null) {
    return [
      {
        timestamp: segment.timestamp,
        userId: segment.userId,
        username: segment.username,
        text: segment.text,
      },
    ];
  }

  const baseMs = new Date(segment.timestamp).getTime();
  const baseValid = !Number.isNaN(baseMs);

  return subSegments
    .filter(
      (s) =>
        s.no_speech_prob <= NO_SPEECH_THRESHOLD ||
        (s.avg_logprob !== undefined && s.avg_logprob >= LOGPROB_THRESHOLD),
    )
    .map((s) => ({
      timestamp: baseValid ? new Date(baseMs + s.start * 1000).toISOString() : segment.timestamp,
      userId: segment.userId,
      username: segment.username,
      text: s.text,
    }));
}

// One utterance as the transcript page shows it. `id` is stable across the
// live view and the finished transcript (clip id plus the Whisper sub-segment
// position), so lines can be merged and deduplicated as they stream in.
export interface TranscriptLine {
  id: string;
  timestamp: string;
  userId: string;
  speaker: string;
  characterName: string | null;
  text: string;
}

export interface TranscriptLineStats {
  turns: number;
  // Everyone who spoke, in order of first line.
  speakers: { userId: string; speaker: string }[];
}

// Orders lines by when they were said; the id breaks ties so the order (and
// so paging by sort key) is total.
export function transcriptLineKey(line: Pick<TranscriptLine, "timestamp" | "id">): string {
  return `${line.timestamp}|${line.id}`;
}

export function compareTranscriptLines(
  a: Pick<TranscriptLine, "timestamp" | "id">,
  b: Pick<TranscriptLine, "timestamp" | "id">,
): number {
  return transcriptLineKey(a).localeCompare(transcriptLineKey(b));
}

// Every non-empty utterance in the clips, in spoken order, labelled with the
// speaker's username and character.
export function transcriptLines(
  segments: TranscriptSegment[],
  cast: CastMember[],
): TranscriptLine[] {
  const characterByUserId = new Map(cast.map((member) => [member.userId, member.characterName]));
  return segments
    .flatMap((segment) =>
      explodeSegment(segment).map((utterance, index) => ({
        id: `${segment.segmentId}:${String(index).padStart(4, "0")}`,
        timestamp: utterance.timestamp,
        userId: utterance.userId,
        speaker: utterance.username ?? utterance.userId,
        characterName: characterByUserId.get(utterance.userId) ?? null,
        text: utterance.text.trim(),
      })),
    )
    .filter((line) => line.text)
    .toSorted(compareTranscriptLines);
}

// Speaker turns (consecutive lines from one person) and who spoke.
export function transcriptLineStats(lines: TranscriptLine[]): TranscriptLineStats {
  let turns = 0;
  let previous: string | null = null;
  const speakers = new Map<string, string>();
  for (const line of lines) {
    if (line.userId !== previous) turns++;
    previous = line.userId;
    if (!speakers.has(line.userId)) speakers.set(line.userId, line.speaker);
  }
  return {
    turns,
    speakers: [...speakers].map(([userId, speaker]) => ({ userId, speaker })),
  };
}

export type TranscriptLineQuery =
  | { before: string }
  | { after: string }
  | { atSeconds: number }
  | { around: string }
  | { end: true }
  | Record<string, never>;

export interface TranscriptLinePage {
  lines: TranscriptLine[];
  hasBefore: boolean;
  hasAfter: boolean;
}

// First index whose key is greater than `key` (or, with `inclusive`, at least `key`).
function boundary(lines: TranscriptLine[], key: string, inclusive: boolean): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const compared = transcriptLineKey(lines[mid]).localeCompare(key);
    if (compared < 0 || (!inclusive && compared === 0)) low = mid + 1;
    else high = mid;
  }
  return low;
}

// Windows start at the beginning of a speaker's turn, so a page loaded above
// the current one never splits the turn the reader is looking at.
function turnStart(lines: TranscriptLine[], index: number): number {
  let start = index;
  while (start > 0 && lines[start - 1].userId === lines[start].userId) start--;
  return start;
}

// One window of a sorted transcript: the start (no query), the end, the
// lines just before or after a sort key, or the stretch around an elapsed
// time (seconds since the first line, as recap and world citations use) or
// a line's sort key, with a little context before the cited line.
export function pageTranscriptLines(
  lines: TranscriptLine[],
  query: TranscriptLineQuery,
  limit: number,
): TranscriptLinePage {
  let from = 0;
  if ("before" in query) {
    const to = boundary(lines, query.before, true);
    from = turnStart(lines, Math.max(0, to - limit));
    return { lines: lines.slice(from, to), hasBefore: from > 0, hasAfter: to < lines.length };
  }
  if ("after" in query) from = boundary(lines, query.after, false);
  else if ("end" in query) from = turnStart(lines, Math.max(0, lines.length - limit));
  else if ("atSeconds" in query && lines.length > 0) {
    const targetMs = new Date(lines[0].timestamp).getTime() + query.atSeconds * 1000;
    const cited = lines.findLastIndex((line) => new Date(line.timestamp).getTime() <= targetMs);
    from = turnStart(lines, Math.max(0, cited - Math.floor(limit / 4)));
  } else if ("around" in query) {
    const cited = boundary(lines, query.around, true);
    from = turnStart(lines, Math.max(0, cited - Math.floor(limit / 4)));
  }
  const to = "end" in query ? lines.length : Math.min(lines.length, from + limit);
  return { lines: lines.slice(from, to), hasBefore: from > 0, hasAfter: to < lines.length };
}

function elapsedSeconds(lines: TranscriptLine[], line: TranscriptLine): number {
  const ms = new Date(line.timestamp).getTime() - new Date(lines[0].timestamp).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
}

export interface TranscriptSearchMatch {
  // The matching line's sort key (transcriptLineKey).
  key: string;
  // Seconds since the session's first line.
  seconds: number;
}

// Lines whose text contains `query`, ignoring case, in transcript order. At
// most `limit` are returned; `total` counts them all.
export function searchTranscriptLines(
  lines: TranscriptLine[],
  query: string,
  limit: number,
): { matches: TranscriptSearchMatch[]; total: number } {
  const needle = query.trim().toLocaleLowerCase();
  const matches: TranscriptSearchMatch[] = [];
  let total = 0;
  if (!needle) return { matches, total };
  for (const line of lines) {
    if (!line.text.toLocaleLowerCase().includes(needle)) continue;
    total++;
    if (matches.length < limit) {
      matches.push({ key: transcriptLineKey(line), seconds: elapsedSeconds(lines, line) });
    }
  }
  return { matches, total };
}

export interface TranscriptTimelineBand {
  userId: string;
  // Seconds since the session's first line.
  from: number;
  to: number;
}

export interface TranscriptTimeline {
  durationSeconds: number;
  // Who talked most in each stretch of the session, merged where the same
  // speaker holds consecutive stretches.
  bands: TranscriptTimelineBand[];
}

// A coarse picture of who was talking when, for the transcript's timeline.
// The session is cut into `buckets` equal stretches and each goes to whoever
// said the most words in it; a stretch nobody spoke in joins the one before.
export function transcriptTimeline(lines: TranscriptLine[], buckets: number): TranscriptTimeline {
  if (lines.length === 0) return { durationSeconds: 0, bands: [] };
  const durationSeconds = elapsedSeconds(lines, lines.at(-1)!);
  const count = Math.max(1, buckets);
  const width = Math.max(1, durationSeconds) / count;
  const words = Array.from({ length: count }, () => new Map<string, number>());
  for (const line of lines) {
    const index = Math.min(count - 1, Math.floor(elapsedSeconds(lines, line) / width));
    const bucket = words[index];
    bucket.set(line.userId, (bucket.get(line.userId) ?? 0) + line.text.split(/\s+/).length);
  }

  const bands: TranscriptTimelineBand[] = [];
  words.forEach((bucket, index) => {
    let top: string | null = null;
    let most = 0;
    for (const [userId, total] of bucket) {
      if (total > most) {
        top = userId;
        most = total;
      }
    }
    const from = Math.round(index * width);
    const to = Math.round((index + 1) * width);
    const previous = bands.at(-1);
    if (previous && (top === null || top === previous.userId)) previous.to = to;
    else if (top !== null) bands.push({ userId: top, from, to });
  });
  if (bands[0]) bands[0].from = 0;
  return { durationSeconds, bands };
}

function orderedUtterances(transcript: Transcript): Utterance[] {
  return transcript.segments
    .flatMap(explodeSegment)
    .toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// Preserve utterance-level speaker boundaries and chronological ordering for
// inference. Instead of a timestamp on every line, a "[h:mm:ss]" marker of
// elapsed time since the first utterance opens each new minute, so the model
// can cite where something happened without much extra context. The stored
// transcript remains the lossless source for display and future formatting
// improvements.
export function formatTranscriptForInference(transcript: Transcript, cast: CastMember[]): string {
  const utterances = orderedUtterances(transcript).filter((utterance) => utterance.text.trim());
  const labelByUserId = new Map<string, string>();
  const startMs = utterances.length > 0 ? new Date(utterances[0].timestamp).getTime() : NaN;
  let lastMinute = -1;

  const lines = utterances.flatMap((utterance) => {
    const name = utterance.username ?? utterance.userId;
    if (!labelByUserId.has(utterance.userId)) labelByUserId.set(utterance.userId, name);
    const line = `${name}: ${utterance.text.trim()}`;

    const elapsedMs = new Date(utterance.timestamp).getTime() - startMs;
    const minute = Number.isNaN(elapsedMs)
      ? lastMinute
      : Math.floor(Math.max(0, elapsedMs) / 60_000);
    if (minute <= lastMinute) return [line];
    lastMinute = minute;
    return [`[${formatElapsed(minute * 60)}]`, line];
  });

  return buildCastLegend(cast, labelByUserId) + lines.join("\n") + "\n";
}

// Session length and how much each voice spoke, for the recap's table stats.
// Word counts are a robust stand-in for talk time: Whisper's sub-segment end
// times include trailing silence, while words reflect who actually spoke.
export function transcriptTableStats(transcript: Transcript, cast: CastMember[]): TableStats {
  const utterances = orderedUtterances(transcript).filter((utterance) => utterance.text.trim());
  const characterByUserId = new Map(cast.map((member) => [member.userId, member.characterName]));
  const speakers = new Map<string, TableStats["speakers"][number]>();

  for (const utterance of utterances) {
    const speaker = speakers.get(utterance.userId) ?? {
      userId: utterance.userId,
      name: utterance.username ?? utterance.userId,
      characterName: characterByUserId.get(utterance.userId) ?? null,
      words: 0,
    };
    speaker.words += utterance.text.trim().split(/\s+/).length;
    speakers.set(utterance.userId, speaker);
  }

  const first = utterances.at(0);
  const last = utterances.at(-1);
  const durationMs =
    first && last ? new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime() : 0;

  return {
    durationSeconds: Number.isNaN(durationMs) ? 0 : Math.round(durationMs / 1000),
    speakers: [...speakers.values()].toSorted((a, b) => b.words - a.words),
  };
}

function buildCastLegend(cast: CastMember[], labelByUserId: Map<string, string>): string {
  if (cast.length === 0) return "";

  const entries = cast.map((member) => {
    const label = labelByUserId.get(member.userId) ?? member.username;
    return `- ${label} plays ${member.characterName}`;
  });

  return `Cast — the players and the characters they play:\n${entries.join("\n")}\n\nTranscript:\n`;
}
