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

export interface TranscriptTurn {
  timestamp: string;
  userId: string;
  speaker: string;
  characterName: string | null;
  text: string;
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

function orderedUtterances(transcript: Transcript): Utterance[] {
  return transcript.segments
    .flatMap(explodeSegment)
    .toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// Build display-ready speaker turns while retaining the first utterance's
// timestamp. Consecutive utterances from the same user are grouped so the UI
// reads like a conversation rather than a wall of Whisper fragments.
export function formatTranscriptForDisplay(
  transcript: Transcript,
  cast: CastMember[],
): TranscriptTurn[] {
  const characterByUserId = new Map(cast.map((member) => [member.userId, member.characterName]));
  const turns: TranscriptTurn[] = [];

  for (const utterance of orderedUtterances(transcript)) {
    const text = utterance.text.trim();
    if (!text) continue;

    const previous = turns.at(-1);
    if (previous?.userId === utterance.userId) {
      previous.text += ` ${text}`;
      continue;
    }

    turns.push({
      timestamp: utterance.timestamp,
      userId: utterance.userId,
      speaker: utterance.username ?? utterance.userId,
      characterName: characterByUserId.get(utterance.userId) ?? null,
      text,
    });
  }

  return turns;
}

// Reduce a full transcript down to what the LLM actually needs: wall-clock
// timing is dropped, consecutive lines from the same speaker are merged onto
// one labelled line, and a cast legend is prepended so dialogue can be
// attributed to characters. This is the seam to improve if better LLM-facing
// formatting is found later — re-run it over `Transcript.segments` from any
// stored session to benefit retroactively, no re-transcription needed.
export function simplifyTranscript(transcript: Transcript, cast: CastMember[]): string {
  const turns = formatTranscriptForDisplay(transcript, cast);
  const labelByUserId = new Map<string, string>();

  for (const turn of turns) {
    if (!labelByUserId.has(turn.userId)) labelByUserId.set(turn.userId, turn.speaker);
  }

  return (
    buildCastLegend(cast, labelByUserId) +
    turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n") +
    "\n"
  );
}

// Preserve utterance-level timestamps and speaker boundaries for the detailed
// record pipeline. These source markers let the model retain chronology and
// make the resulting record auditable against the original transcript.
export function formatTranscriptForInference(transcript: Transcript, cast: CastMember[]): string {
  const utterances = orderedUtterances(transcript);
  const labelByUserId = new Map<string, string>();

  const lines = utterances.flatMap((utterance) => {
    const text = utterance.text.trim();
    if (!text) return [];
    const name = utterance.username ?? utterance.userId;
    if (!labelByUserId.has(utterance.userId)) labelByUserId.set(utterance.userId, name);
    return [`${name}: ${text}`];
  });

  return buildCastLegend(cast, labelByUserId) + lines.join("\n") + "\n";
}

function buildCastLegend(cast: CastMember[], labelByUserId: Map<string, string>): string {
  if (cast.length === 0) return "";

  const entries = cast.map((member) => {
    const label = labelByUserId.get(member.userId) ?? member.username;
    return `- ${label} plays ${member.characterName}`;
  });

  return `Cast — the players and the characters they play:\n${entries.join("\n")}\n\nTranscript:\n`;
}
