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

// Reduce a full transcript down to what the LLM actually needs: wall-clock
// timing is dropped, consecutive lines from the same speaker are merged onto
// one labelled line, and a cast legend is prepended so dialogue can be
// attributed to characters. This is the seam to improve if better LLM-facing
// formatting is found later — re-run it over `Transcript.segments` from any
// stored session to benefit retroactively, no re-transcription needed.
export function simplifyTranscript(
  transcript: Transcript,
  cast: CastMember[],
): string {
  const sorted = transcript.segments.toSorted((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );

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

function buildCastLegend(
  cast: CastMember[],
  labelByUserId: Map<string, string>,
): string {
  if (cast.length === 0) return "";

  const entries = cast.map((member) => {
    const label = labelByUserId.get(member.userId) ?? member.username;
    return `- ${label} plays ${member.characterName}`;
  });

  return `Cast — the players and the characters they play:\n${entries.join("\n")}\n\nTranscript:\n`;
}
