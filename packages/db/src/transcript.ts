// One recorded audio clip, transcribed. We keep everything the transcription
// server gave us (under `whisper`) alongside the fields the pipeline actually
// uses, so future formatting improvements can re-derive better output from the
// same recordings without re-transcribing.
export interface TranscriptSegment {
  segmentId: string;
  audioFile: string;
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

interface CastMember {
  userId: string;
  username: string;
  characterName: string;
}

// Whisper's own per-clip utterance segmentation, already stored verbatim
// under TranscriptSegment.whisper. Duck-typed since that field is `unknown` —
// @rainbot/db stays decoupled from any whisper.cpp-specific package, mirroring
// how @rainbot/temporal independently declares its own WhisperResponse shape.
interface WhisperSubSegment {
  start: number; // seconds, relative to the clip
  text: string;
  no_speech_prob: number;
}

interface WhisperVerboseJson {
  segments: WhisperSubSegment[];
}

// Duplicated from packages/temporal/src/activities/transcribe.ts's constant
// of the same name/value — @rainbot/db must not depend on @rainbot/temporal.
const NO_SPEECH_THRESHOLD = 0.6;

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
    typeof v.no_speech_prob === "number"
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
// sub-segment (dropping any whose own no_speech_prob says it's noise), so
// sorting reflects when things were actually said, not when the mic opened.
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
    .filter((s) => s.no_speech_prob <= NO_SPEECH_THRESHOLD)
    .map((s) => ({
      timestamp: baseValid ? new Date(baseMs + s.start * 1000).toISOString() : segment.timestamp,
      userId: segment.userId,
      username: segment.username,
      text: s.text,
    }));
}

// Reduce a full transcript down to what the LLM actually needs: wall-clock
// timing is dropped, consecutive lines from the same speaker are merged onto
// one labelled line, and a cast legend is prepended so dialogue can be
// attributed to characters. This is the seam to improve if better LLM-facing
// formatting is found later — re-run it over `Transcript.segments` from any
// stored session to benefit retroactively, no re-transcription needed.
export function simplifyTranscript(transcript: Transcript, cast: CastMember[]): string {
  const utterances = transcript.segments.flatMap(explodeSegment);
  const sorted = utterances.toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));

  const lines: string[] = [];
  let speaker: string | null = null;
  let buffer: string[] = [];
  // Track the label actually used per speaker so the cast legend below can
  // reuse the same name (the body uses displayName, which may differ from the
  // account username).
  const labelByUserId = new Map<string, string>();

  const flush = () => {
    if (speaker !== null && buffer.length > 0) {
      lines.push(`${speaker}: ${buffer.join(" ")}`);
    }
  };

  for (const segment of sorted) {
    const text = segment.text.trim();
    if (!text) continue;
    const name = segment.username ?? segment.userId;
    if (!labelByUserId.has(segment.userId)) {
      labelByUserId.set(segment.userId, name);
    }
    if (name !== speaker) {
      flush();
      speaker = name;
      buffer = [text];
    } else {
      buffer.push(text);
    }
  }
  flush();

  return buildCastLegend(cast, labelByUserId) + lines.join("\n") + "\n";
}

// Preserve utterance-level timestamps and speaker boundaries for the detailed
// record pipeline. These source markers let the model retain chronology and
// make the resulting record auditable against the original transcript.
export function formatTranscriptForInference(transcript: Transcript, cast: CastMember[]): string {
  const utterances = transcript.segments
    .flatMap(explodeSegment)
    .toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
  const labelByUserId = new Map<string, string>();

  const lines = utterances.flatMap((utterance) => {
    const text = utterance.text.trim();
    if (!text) return [];
    const name = utterance.username ?? utterance.userId;
    if (!labelByUserId.has(utterance.userId)) labelByUserId.set(utterance.userId, name);
    return [`[${utterance.timestamp}] ${name}: ${text}`];
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
