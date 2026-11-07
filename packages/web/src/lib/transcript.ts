import type { TranscriptLine } from "@rainbot/db";

export type { TranscriptLine };

export interface TranscriptSpeaker {
  userId: string;
  speaker: string;
  characterName: string | null;
}

export interface TranscriptStats {
  turns: number;
  speakers: TranscriptSpeaker[];
}

// GET transcript/lines
export interface TranscriptLinesResponse {
  lines: TranscriptLine[];
  hasBefore: boolean;
  hasAfter: boolean;
  stats: TranscriptStats;
  // The first line of the whole session; citations count seconds from it.
  startedAt: string | null;
  live: boolean;
  // Where the event stream picks up, for a live transcript.
  cursor: string | null;
}

// "lines" events on transcript/events
export interface TranscriptLinesEvent {
  lines: TranscriptLine[];
  stats: TranscriptStats;
}

// Matches transcriptLineKey in @rainbot/db, which the client cannot import.
export function lineKey(line: Pick<TranscriptLine, "timestamp" | "id">): string {
  return `${line.timestamp}|${line.id}`;
}
