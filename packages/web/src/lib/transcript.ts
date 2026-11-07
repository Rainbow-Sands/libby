import type { TranscriptLine, TranscriptSearchMatch, TranscriptTimelineBand } from "@rainbot/db";

export type { TranscriptLine, TranscriptSearchMatch, TranscriptTimelineBand };

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
  // From the first line to the last so far.
  durationSeconds: number;
  // The campaign's DM, whose lines read as narration.
  dmUserId: string | null;
  // Who was talking when, for a finished transcript's timeline.
  timeline: TranscriptTimelineBand[] | null;
  live: boolean;
  // Where the event stream picks up, for a live transcript.
  cursor: string | null;
}

// GET transcript/search?q=
export interface TranscriptSearchResponse {
  query: string;
  matches: TranscriptSearchMatch[];
  // Every match, when there are more than were sent.
  total: number;
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

// "h:mm:ss", as recap citations write elapsed time.
export function parseElapsed(at: string | null | undefined): number | null {
  const match = at ? /^(\d+):([0-5]\d):([0-5]\d)$/.exec(at.trim()) : null;
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// "3 h 42 min", or "12 min" under an hour.
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(Math.max(0, totalSeconds) / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

// Text cut around each case-insensitive occurrence of `query`, for
// highlighting find matches. Matches the server's search, which compares
// lower-cased text.
export function splitMatches(text: string, query: string): { text: string; match: boolean }[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [{ text, match: false }];
  const haystack = text.toLocaleLowerCase();
  // Lower-casing can change a string's length; fall back to no highlight.
  if (haystack.length !== text.length) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}
