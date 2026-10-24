import {
  DORMANT_AFTER_SESSIONS,
  formatElapsed,
  recapLinkFields,
  recapLinkIndex,
  recapLinksSchema,
  recapSectionsSchema,
  renderRecapMarkdown,
  sessionLedgerSchema,
  summaryLine,
  worldUpdateSchema,
  type CampaignCastMember,
  type PreviousSessionNotes,
  type RecapLink,
  type RecapSections,
  type SessionLedger,
  type WorldPageState,
  type WorldPageSummary,
  type WorldUpdate,
} from "@rainbot/db";
import type { FlexibleSchema } from "ai";
import {
  RECAP_LINKS_SYSTEM,
  RECAP_SYSTEM,
  SESSION_LEDGER_SYSTEM,
  WORLD_UPDATE_SYSTEM,
} from "./prompts.ts";

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
  // The world's unresolved quests, or null before the world has any pages,
  // when open threads still come from the previous recap.
  quests: QuestState[] | null;
}

export interface QuestState {
  name: string;
  aliases: string[];
  summary: string;
  // Sessions since the quest last came up: since one changed its page or its
  // recap mentioned it.
  sessionsSinceActive: number;
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
      if (content.references.length) {
        lines.push(`Referred to as: ${content.references.join(", ")}`);
      }
      if (content.holder) lines.push(`Held by: ${content.holder}`);
      if (content.removed?.names.length) {
        lines.push(`Never called: ${content.removed.names.join(", ")}`);
      }
      if (content.summary) lines.push(`Summary: ${content.summary}`);
      for (const fact of content.facts) {
        if (!fact.supersededIn) lines.push(`#${fact.id} ${fact.text}`);
      }
      for (const fact of content.removed?.facts ?? []) lines.push(`Not true: ${fact}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

// Open threads come from the world's quest pages rather than the previous
// recap, so a quest resolved later, or by hand, stops being carried forward.
function questName(quest: QuestState): string {
  return quest.aliases.length ? `${quest.name} (also: ${quest.aliases.join(", ")})` : quest.name;
}

function formatQuests(quests: QuestState[]): string[] {
  const active = quests.filter((quest) => quest.sessionsSinceActive < DORMANT_AFTER_SESSIONS);
  const dormant = quests.filter((quest) => quest.sessionsSinceActive >= DORMANT_AFTER_SESSIONS);
  return [
    "Open quests:",
    ...(active.length
      ? active.map((quest) => {
          const line = summaryLine(quest.summary);
          const since =
            quest.sessionsSinceActive === 0
              ? "came up last session"
              : `last came up ${quest.sessionsSinceActive + 1} sessions ago`;
          return `- ${questName(quest)}${line ? `: ${line}` : ""} (${since})`;
        })
      : ["- None"]),
    "",
    `Dormant quests, not mentioned for ${DORMANT_AFTER_SESSIONS} or more sessions:`,
    ...(dormant.length ? dormant.map((quest) => `- ${questName(quest)}`) : ["- None"]),
  ];
}

function formatPrevious(
  previous: PreviousSessionNotes | null,
  quests: QuestState[] | null,
): string {
  if (!previous) return "None. This is the first recorded session of the campaign.";

  const heading = `${previous.title ?? "Untitled session"} (${previous.startedAt.toISOString().slice(0, 10)})`;
  const sections = previous.recapSections?.sections;
  if (!sections) {
    return [
      heading,
      "",
      previous.recap ?? "No recap was written.",
      ...(quests ? ["", ...formatQuests(quests)] : []),
    ].join("\n");
  }

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
    ...(quests
      ? formatQuests(quests)
      : ["Unresolved threads:", ...(threads.length > 0 ? threads : ["- None"])]),
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
    tagged("earlier_session", formatPrevious(material.previous, material.quests)),
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
    tagged("earlier_session", formatPrevious(material.previous, material.quests)),
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

export interface RecapLinkMaterial {
  // The world as the session left it.
  world: WorldPageSummary[];
  recap: RecapSections;
}

function formatLinkPages(world: WorldPageSummary[]): string {
  if (world.length === 0) return "No pages.";
  return world
    .map((page) => {
      const { content } = page;
      const names = content.aliases.length ? `; also ${content.aliases.join(", ")}` : "";
      const refs = content.references.length
        ? `; referred to as ${content.references.join(", ")}`
        : "";
      const line = summaryLine(content.summary);
      return `- [${page.slug}] ${content.name} (${page.kind}${names}${refs})${line ? `: ${line}` : ""}`;
    })
    .join("\n");
}

// Asks which phrases of a recap mean which pages. Only links that point at
// text really in the recap and at a page that exists are kept, so a confused
// answer leaves text unlinked instead of linking it wrongly. Links come back
// in reading order.
export async function createRecapLinks(
  material: RecapLinkMaterial,
  completeObject: CompleteObject,
): Promise<RecapLink[]> {
  const fields = recapLinkFields(material.recap);
  if (fields.length === 0 || material.world.length === 0) return [];
  const prompt = [
    tagged("pages", formatLinkPages(material.world)),
    tagged("recap", JSON.stringify(fields, null, 2)),
  ].join("\n\n");
  const answer = await completeObject(prompt, RECAP_LINKS_SYSTEM, recapLinksSchema, "recap_links");

  const order = new Map(fields.map((entry, index) => [entry.field, index]));
  const slugs = new Set(material.world.map((page) => page.slug));
  const seen = new Set<string>();
  return answer.links
    .flatMap((link) => {
      const field = order.get(link.field);
      const at =
        field === undefined ? -1 : recapLinkIndex(fields[field].text, link.phrase, link.occurrence);
      const key = `${link.field}|${link.phrase}|${link.occurrence}`;
      if (field === undefined || at < 0 || !slugs.has(link.page) || seen.has(key)) return [];
      seen.add(key);
      return [{ field, at, link }];
    })
    .toSorted((a, b) => a.field - b.field || a.at - b.at)
    .map(({ link }) => ({
      field: link.field,
      phrase: link.phrase,
      occurrence: link.occurrence,
      slug: link.page,
    }));
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
