import {
  AUDIT_RECORD_SYSTEM,
  DETAILED_RECORD_SYSTEM,
  RECAP_EXCERPT_SYSTEM,
  RECAP_SYSTEM,
} from "./prompts.ts";
import { stripLeadingTitle } from "./text.ts";

export type Complete = (prompt: string, system: string) => Promise<string>;

export function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    if (current && current.length + line.length + 1 > maxChars) {
      chunks.push(current.trim());
      current = "";
    }

    if (line.length > maxChars) {
      for (let offset = 0; offset < line.length; offset += maxChars) {
        if (current) {
          chunks.push(current.trim());
          current = "";
        }
        chunks.push(line.slice(offset, offset + maxChars));
      }
      continue;
    }

    current += `${current ? "\n" : ""}${line}`;
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function timeRange(chunk: string): string | null {
  const timestamps = [...chunk.matchAll(/^\[([^\]]+)]/gm)].map((match) => match[1]);
  if (timestamps.length === 0) return null;
  return timestamps.length === 1
    ? timestamps[0]
    : `${timestamps[0]} to ${timestamps[timestamps.length - 1]}`;
}

export async function createDetailedRecord(
  transcript: string,
  maxChars: number,
  complete: Complete,
): Promise<string> {
  const marker = "\n\nTranscript:\n";
  const markerIndex = transcript.indexOf(marker);
  const castLegend = markerIndex >= 0 ? transcript.slice(0, markerIndex).trim() : "";
  const legend = castLegend ? `${castLegend}\n\nTranscript:` : "";
  const body = markerIndex >= 0 ? transcript.slice(markerIndex + marker.length) : transcript;
  const bodyLimit = Math.max(1000, maxChars - legend.length - 2);
  const chunks = chunkText(body, bodyLimit).map((chunk) =>
    legend ? `${legend}\n${chunk}` : chunk,
  );
  const records: string[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const draft = stripLeadingTitle(await complete(chunk, DETAILED_RECORD_SYSTEM)).trim();
    const auditInput = `SOURCE TRANSCRIPT EXCERPT:\n${chunk}\n\nDRAFT RECORD:\n${draft}`;
    const revised = stripLeadingTitle(await complete(auditInput, AUDIT_RECORD_SYSTEM)).trim();
    const range = timeRange(chunk);
    const heading = `## Part ${index + 1}${range ? ` — ${range}` : ""}`;
    records.push(`${heading}\n\n${revised || draft}`);
  }

  return [castLegend, ...records].filter(Boolean).join("\n\n");
}

export async function createRecap(
  detailedRecord: string,
  maxChars: number,
  complete: Complete,
): Promise<string> {
  let material = detailedRecord;

  // Reduce oversized records hierarchically so no beginning or ending portion
  // is silently truncated by the model context window.
  for (let pass = 0; material.length > maxChars && pass < 8; pass++) {
    const notes: string[] = [];
    for (const chunk of chunkText(material, maxChars)) {
      notes.push(stripLeadingTitle(await complete(chunk, RECAP_EXCERPT_SYSTEM)).trim());
    }
    const reduced = notes.filter(Boolean).join("\n\n");
    if (!reduced || reduced.length >= material.length) {
      const nonEmpty = notes.filter(Boolean);
      const perChunk = Math.max(1, Math.floor(maxChars / Math.max(1, nonEmpty.length)) - 2);
      material = nonEmpty.map((note) => note.slice(0, perChunk)).join("\n\n");
      break;
    }
    material = reduced;
  }

  return stripLeadingTitle(await complete(material, RECAP_SYSTEM)).trim();
}
