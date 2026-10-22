import {
  formatElapsed,
  recapSectionsSchema,
  renderRecapMarkdown,
  sessionLedgerSchema,
  summaryLine,
  worldUpdateSchema,
  type CampaignCastMember,
  type PreviousSessionNotes,
  type RecapSections,
  type SessionLedger,
  type WorldPageState,
  type WorldUpdate,
} from "@rainbot/db";
import type { FlexibleSchema } from "ai";
import { RECAP_SYSTEM, SESSION_LEDGER_SYSTEM, WORLD_UPDATE_SYSTEM } from "./prompts.ts";

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
  // The world as it stood when the session began.
  world: WorldPageState[];
  // Standing notes from the players' hand edits to the world.
  corrections: string[];
}

// Names and one line each: enough to spell names consistently and recognize
// returning characters without spending the context on full pages.
export function formatWorldGlossary(world: WorldPageState[]): string {
  if (world.length === 0) return "None yet.";
  return world
    .map((page) => {
      const also = page.content.aliases.length
        ? ` (also heard as ${page.content.aliases.join(", ")})`
        : "";
      const line = summaryLine(page.content.summary);
      return `- ${page.content.name} [${page.kind}]${also}${line ? `: ${line}` : ""}`;
    })
    .join("\n");
}

export function formatWorldPages(world: WorldPageState[]): string {
  if (world.length === 0) return "No pages yet. This is the world's first session.";
  return world
    .map((page) => {
      const { content } = page;
      const lines = [
        `[${page.slug}] ${content.name} (${page.kind}${content.status ? `, ${content.status}` : ""})`,
      ];
      if (content.aliases.length) lines.push(`Also: ${content.aliases.join(", ")}`);
      if (content.holder) lines.push(`Held by: ${content.holder}`);
      if (content.summary) lines.push(`Summary: ${content.summary}`);
      for (const fact of content.facts) {
        if (!fact.supersededIn) lines.push(`#${fact.id} ${fact.text}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
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

function correctionsBlock(corrections: string[]): string[] {
  return corrections.length
    ? [tagged("corrections", corrections.map((note) => `- ${note}`).join("\n"))]
    : [];
}

export async function createSessionLedger(
  material: SessionMaterial,
  completeObject: CompleteObject,
): Promise<SessionLedger> {
  const prompt = [
    tagged("world_glossary", formatWorldGlossary(material.world)),
    ...correctionsBlock(material.corrections),
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
    tagged("world_glossary", formatWorldGlossary(material.world)),
    ...correctionsBlock(material.corrections),
    tagged("earlier_session", formatPrevious(material.previous)),
    tagged("ledger", JSON.stringify(ledger, null, 2)),
    tagged("transcript", material.transcript),
  ].join("\n\n");
  const sections = normalizeRecap(
    await completeObject(prompt, RECAP_SYSTEM, recapSectionsSchema, "session_recap"),
  );
  return { sections, markdown: renderRecapMarkdown(sections) };
}

export interface WorldMaterial {
  world: WorldPageState[];
  corrections: string[];
  cast: CampaignCastMember[];
  ledger: SessionLedger;
  recap: RecapSections | null;
}

export async function createWorldUpdate(
  material: WorldMaterial,
  completeObject: CompleteObject,
): Promise<WorldUpdate> {
  const cast = material.cast.length
    ? material.cast.map((member) => `- ${member.characterName}, played by ${member.username}`)
    : ["- No player characters are registered."];
  const recap = material.recap
    ? JSON.stringify(
        {
          recap: material.recap.recap,
          openThreads: material.recap.openThreads.map((thread, index) => ({
            index,
            title: thread.title,
            status: thread.status,
            note: thread.note,
          })),
          newFaces: material.recap.newFaces.map((face, index) => ({ index, ...face })),
          epicMoments: material.recap.epicMoments.map((moment, index) => ({ index, ...moment })),
        },
        null,
        2,
      )
    : "No recap was written.";
  const prompt = [
    tagged("world", formatWorldPages(material.world)),
    ...correctionsBlock(material.corrections),
    tagged("cast", cast.join("\n")),
    tagged("ledger", JSON.stringify(material.ledger, null, 2)),
    tagged("recap", recap),
  ].join("\n\n");
  const update = await completeObject(
    prompt,
    WORLD_UPDATE_SYSTEM,
    worldUpdateSchema,
    "world_update",
  );
  return {
    ...update,
    pages: update.pages.map((page) => ({
      ...page,
      newFacts: page.newFacts.map((fact) => ({ ...fact, at: normalizeAt(fact.at) })),
    })),
  };
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
