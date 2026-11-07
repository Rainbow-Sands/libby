import {
  listTranscribedSegments,
  transcriptLineStats,
  transcriptLines,
  type SessionDetail,
  type TranscriptLine,
} from "@rainbot/db";
import { loadTranscriptArtifact } from "@rainbot/storage";
import type { TranscriptStats } from "$lib/transcript";

export interface SessionTranscriptLines {
  // Sorted, with character names left null; see withCharacters.
  lines: TranscriptLine[];
  // True while clips are still being transcribed into the live view.
  live: boolean;
  // For a live transcript, where the event stream picks up.
  cursor: Date | null;
}

// A finished transcript is an immutable artifact, so its lines are cached by
// artifact id: paging through a long session reads object storage once.
const FINISHED_CACHE_SIZE = 8;
const finished = new Map<string, Promise<TranscriptLine[]>>();

function finishedLines(artifact: NonNullable<SessionDetail["transcriptArtifact"]>) {
  let lines = finished.get(artifact.id);
  if (lines) {
    finished.delete(artifact.id);
  } else {
    lines = loadTranscriptArtifact(artifact).then((transcript) =>
      transcriptLines(transcript.segments, []),
    );
    lines.catch(() => finished.delete(artifact.id));
  }
  finished.set(artifact.id, lines);
  while (finished.size > FINISHED_CACHE_SIZE) {
    finished.delete(finished.keys().next().value!);
  }
  return lines;
}

// The finished transcript once aggregation has written one, otherwise the
// clips transcribed so far.
export async function sessionTranscriptLines(
  session: Pick<SessionDetail, "id" | "transcriptArtifact">,
): Promise<SessionTranscriptLines> {
  if (session.transcriptArtifact) {
    return { lines: await finishedLines(session.transcriptArtifact), live: false, cursor: null };
  }
  const { segments, latestTranscribedAt } = await listTranscribedSegments(session.id);
  return { lines: transcriptLines(segments, []), live: true, cursor: latestTranscribedAt };
}

export function withCharacters(
  lines: TranscriptLine[],
  cast: { userId: string; characterName: string }[],
): TranscriptLine[] {
  const characterByUserId = new Map(cast.map((member) => [member.userId, member.characterName]));
  return lines.map((line) => ({
    ...line,
    characterName: characterByUserId.get(line.userId) ?? null,
  }));
}

export function statsWithCharacters(
  lines: TranscriptLine[],
  cast: { userId: string; characterName: string }[],
): TranscriptStats {
  const characterByUserId = new Map(cast.map((member) => [member.userId, member.characterName]));
  const { turns, speakers } = transcriptLineStats(lines);
  return {
    turns,
    speakers: speakers.map((speaker) => ({
      ...speaker,
      characterName: characterByUserId.get(speaker.userId) ?? null,
    })),
  };
}
