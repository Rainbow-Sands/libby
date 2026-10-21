import {
  formatElapsed,
  recapSectionsSchema,
  renderRecapMarkdown,
  sessionLedgerSchema,
  type PreviousSessionNotes,
  type RecapSections,
  type SessionLedger,
} from "@rainbot/db";
import type { FlexibleSchema } from "ai";
import { RECAP_SYSTEM, SESSION_LEDGER_SYSTEM } from "./prompts.ts";

export type CompleteObject = <T>(
  prompt: string,
  system: string,
  schema: FlexibleSchema<T>,
  name: string,
) => Promise<T>;

export interface SessionMaterial {
  // Transcript already formatted for inference: cast legend, minute markers.
  transcript: string;
  previous: PreviousSessionNotes | null;
}

function formatPrevious(previous: PreviousSessionNotes | null): string {
  if (!previous) return "None. This is the first recorded session of the campaign.";

  const heading = `${previous.title ?? "Untitled session"} (${previous.startedAt.toISOString().slice(0, 10)})`;
  const sections = previous.recapSections?.sections;
  if (!sections) return `${heading}\n\n${previous.recap ?? "No recap was written."}`;

  const threads = sections.openThreads
    .filter((thread) => thread.status !== "resolved")
    .map((thread) => `- ${thread.title}: ${thread.note}`);
  return [
    heading,
    "",
    sections.recap,
    "",
    `Where they left off: ${sections.leftOff}`,
    "",
    "Unresolved threads:",
    ...(threads.length > 0 ? threads : ["- None"]),
    "",
    `Names introduced: ${sections.newFaces.map((face) => face.name).join(", ") || "none"}`,
  ].join("\n");
}

function tagged(name: string, body: string): string {
  return `<${name}>\n${body.trim()}\n</${name}>`;
}

export async function createSessionLedger(
  material: SessionMaterial,
  completeObject: CompleteObject,
): Promise<SessionLedger> {
  const prompt = [
    tagged("earlier_session", formatPrevious(material.previous)),
    tagged("transcript", material.transcript),
  ].join("\n\n");
  return completeObject(prompt, SESSION_LEDGER_SYSTEM, sessionLedgerSchema, "session_ledger");
}

export async function createRecap(
  material: SessionMaterial,
  ledger: SessionLedger,
  completeObject: CompleteObject,
): Promise<{ sections: RecapSections; markdown: string }> {
  const prompt = [
    tagged("earlier_session", formatPrevious(material.previous)),
    tagged("ledger", JSON.stringify(ledger, null, 2)),
    tagged("transcript", material.transcript),
  ].join("\n\n");
  const sections = normalizeRecap(
    await completeObject(prompt, RECAP_SYSTEM, recapSectionsSchema, "session_recap"),
  );
  return { sections, markdown: renderRecapMarkdown(sections) };
}

// Models sometimes cite "1:23" or "01:23:00"; store one canonical form so the
// page can link every citation into the transcript.
function normalizeAt(at: string | null): string | null {
  const parts = at?.trim().split(":").map(Number);
  if (!parts || parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isInteger(n))) {
    return null;
  }
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return formatElapsed(h * 3600 + m * 60 + s);
}

function normalizeRecap(sections: RecapSections): RecapSections {
  return {
    ...sections,
    recap: sections.recap.replace(/^\s*#+\s+[^\n]*\n+/, "").trim(),
    openThreads: sections.openThreads.map((t) => ({ ...t, at: normalizeAt(t.at) })),
    loot: sections.loot.map((item) => ({ ...item, at: normalizeAt(item.at) })),
    epicMoments: sections.epicMoments.slice(0, 3).map((m) => ({ ...m, at: normalizeAt(m.at) })),
    rulings: sections.rulings.map((ruling) => ({ ...ruling, at: normalizeAt(ruling.at) })),
  };
}
