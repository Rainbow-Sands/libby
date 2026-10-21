import { z } from "zod";
import type { RecapSections } from "./session-notes.ts";
import { nameKey } from "./world-links.ts";

// The campaign world: one page per character, NPC, place, faction, item and
// quest, rebuilt after each session from its ledger and recap. Pages are never
// edited in place. Each session that changes a page writes a new immutable
// revision holding the page's whole content, so "the world as of session N" is
// the newest revision of every page at or before N.

export const WORLD_PAGE_KINDS = [
  "character",
  "npc",
  "location",
  "faction",
  "item",
  "quest",
  "other",
] as const;
export type WorldPageKind = (typeof WORLD_PAGE_KINDS)[number];

// "character" is a player character. Every other person or creature is an NPC.
export const PERSON_KINDS = ["character", "npc"] as const satisfies readonly WorldPageKind[];

export const QUEST_STATUSES = ["open", "resolved", "abandoned"] as const;

export interface WorldFact {
  // Stable within a page, so later sessions can supersede it.
  id: number;
  text: string;
  sessionId: string;
  at: string | null;
  // The session that proved this fact wrong or outdated.
  supersededIn: string | null;
}

export interface WorldPageContent {
  version: 1;
  name: string;
  aliases: string[];
  // Free text for people and things ("alive", "dead", "destroyed"); one of
  // QUEST_STATUSES for quests.
  status: string | null;
  summary: string;
  facts: WorldFact[];
  // Items only: who carries it.
  holder: string | null;
  // Slugs of pages closely tied to this one: an NPC's faction, a quest's
  // people and places.
  related: string[];
}

export interface WorldPageState {
  id: string;
  slug: string;
  kind: WorldPageKind;
  content: WorldPageContent;
}

export interface WorldUpdateReport {
  possibleDuplicates: { first: string; second: string; reason: string }[];
  nameCorrections: { heard: string; canonical: string }[];
}

export interface WorldMoment {
  description: string;
  quote: string | null;
  speaker: string | null;
  at: string | null;
}

const at = z
  .string()
  .nullable()
  .describe('Elapsed time in the transcript as "h:mm:ss", or null when no moment applies');

export const worldUpdateSchema = z.object({
  pages: z
    .array(
      z.object({
        page: z
          .string()
          .nullable()
          .describe("The existing page's slug, or null when this session introduces it"),
        name: z
          .string()
          .describe("Canonical name. A corrected spelling replaces an existing page's name"),
        kind: z.enum(WORLD_PAGE_KINDS),
        aliases: z
          .array(z.string())
          .describe("Other names, titles and mishearings used for it this session"),
        status: z
          .string()
          .nullable()
          .describe(
            'One or two words such as "alive", "dead" or "missing". For quests: open, resolved or abandoned. Null keeps the current status',
          ),
        newFacts: z
          .array(z.object({ text: z.string().describe("One self-contained sentence"), at }))
          .describe("What this session established about it that the page does not say yet"),
        supersededFacts: z
          .array(z.number().int())
          .describe("Ids of this page's existing facts that this session proved wrong or outdated"),
        holder: z
          .string()
          .nullable()
          .describe("Items only: who carries it now. Null when unknown or not an item"),
        related: z
          .array(z.string())
          .describe("Names of other pages closely tied to it, such as a faction or a quest's NPCs"),
        openThreads: z
          .array(z.number().int())
          .describe("Indexes of the recap's openThreads that this quest page tracks"),
        newFaces: z
          .array(z.number().int())
          .describe("Indexes of the recap's newFaces that are this page"),
        summary: z
          .string()
          .describe("Two or three sentences describing it as of the end of this session"),
      }),
    )
    .describe("Every page this session touched"),
  possibleDuplicates: z
    .array(z.object({ first: z.string(), second: z.string(), reason: z.string() }))
    .describe("Pairs of pages that may be the same thing under two names. Never merge them"),
  nameCorrections: z
    .array(z.object({ heard: z.string(), canonical: z.string() }))
    .describe("Misheard spellings in this transcript and the name they mean"),
  epicMoments: z
    .array(
      z.object({
        moment: z.number().int().describe("Index of the moment in the recap's epicMoments"),
        pages: z.array(z.string()).describe("Names of the characters and NPCs who feature in it"),
      }),
    )
    .describe("Who features in each of the recap's epic moments"),
});

export type WorldUpdate = z.infer<typeof worldUpdateSchema>;

export function slugify(name: string): string {
  const slug = nameKey(name).replaceAll(" ", "-").slice(0, 80).replace(/-+$/, "");
  return slug || "page";
}

function uniqueNames(names: string[], exclude: string): string[] {
  const seen = new Set([nameKey(exclude)]);
  const result: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

// Every name a page answers to, for matching model output and linking text.
export function pageNames(content: Pick<WorldPageContent, "name" | "aliases">): string[] {
  return [content.name, ...content.aliases];
}

export interface PlannedPage {
  slug: string;
  kind: WorldPageKind;
  content: WorldPageContent;
  // True when this session creates the page.
  created: boolean;
}

export interface WorldUpdatePlan {
  pages: PlannedPage[];
  moments: { slug: string; position: number; moment: WorldMoment }[];
  report: WorldUpdateReport;
}

// Turns one session's world update into new page revisions. Pure, so the
// caller can recompute it inside the transaction that writes the result.
// Model output names pages loosely, so every reference resolves through the
// page's slug, name or any alias, and anything unknown becomes a new page.
// The parts of a session's recap the world update refers to by index.
export type WorldRecap = Pick<RecapSections, "epicMoments" | "openThreads" | "newFaces">;

export function planWorldUpdate(
  existing: WorldPageState[],
  update: WorldUpdate,
  sessionId: string,
  recap: WorldRecap,
): WorldUpdatePlan {
  const bySlug = new Map<string, PlannedPage>();
  const byName = new Map<string, PlannedPage>();
  const touched = new Set<string>();

  const index = (page: PlannedPage) => {
    bySlug.set(page.slug, page);
    for (const name of pageNames(page.content)) {
      const key = nameKey(name);
      if (key && !byName.has(key)) byName.set(key, page);
    }
  };
  for (const page of existing) {
    index({
      slug: page.slug,
      kind: page.kind,
      content: structuredClone(page.content),
      created: false,
    });
  }
  const resolve = (ref: string | null): PlannedPage | undefined =>
    ref ? (bySlug.get(ref) ?? byName.get(nameKey(ref))) : undefined;

  const uniqueSlug = (name: string) => {
    const base = slugify(name);
    let slug = base;
    for (let n = 2; bySlug.has(slug); n++) slug = `${base}-${n}`;
    return slug;
  };

  const relatedNames = new Map<string, string[]>();

  for (const entry of update.pages) {
    const name = entry.name.trim();
    if (!name) continue;
    // The session page links the recap's open threads and new faces by exact
    // name, so their wording always becomes one of the page's names.
    const recapNames = [
      ...entry.openThreads.map((i) => recap.openThreads[i]?.title),
      ...entry.newFaces.map((i) => recap.newFaces[i]?.name),
    ].filter((recapName): recapName is string => Boolean(recapName?.trim()));
    let page =
      resolve(entry.page) ??
      resolve(name) ??
      [...entry.aliases, ...recapNames].map((alias) => resolve(alias)).find(Boolean);
    const before = page ? JSON.stringify(page.content) : null;

    if (!page) {
      page = {
        slug: uniqueSlug(name),
        kind: entry.kind,
        created: true,
        content: {
          version: 1,
          name,
          aliases: [],
          status: null,
          summary: "",
          facts: [],
          holder: null,
          related: [],
        },
      };
    }

    const content = page.content;
    // Capitalization and articles vary from mention to mention; only a
    // different spelling renames the page.
    if (nameKey(name) !== nameKey(content.name)) {
      const previous = content.name;
      content.name = name;
      content.aliases = uniqueNames([previous, ...content.aliases], name);
    }
    content.aliases = uniqueNames(
      [...content.aliases, ...entry.aliases, ...recapNames],
      content.name,
    );

    const status = entry.status?.trim().toLowerCase();
    if (status) content.status = status;
    if (page.kind === "item" && entry.holder?.trim()) content.holder = entry.holder.trim();

    for (const id of entry.supersededFacts) {
      const fact = content.facts.find((candidate) => candidate.id === id);
      if (fact && !fact.supersededIn) fact.supersededIn = sessionId;
    }
    let nextId = content.facts.reduce((max, fact) => Math.max(max, fact.id), 0) + 1;
    const known = new Set(content.facts.map((fact) => fact.text.trim().toLowerCase()));
    for (const fact of entry.newFacts) {
      const text = fact.text.trim();
      if (!text || known.has(text.toLowerCase())) continue;
      known.add(text.toLowerCase());
      content.facts.push({ id: nextId++, text, sessionId, at: fact.at, supersededIn: null });
    }

    // A summary only changes along with the facts it summarizes, so a page
    // the session merely mentioned keeps its revision history quiet.
    const changed = page.created || before !== JSON.stringify(content);
    if (changed && entry.summary.trim()) content.summary = entry.summary.trim();

    index(page);
    relatedNames.set(page.slug, [...(relatedNames.get(page.slug) ?? []), ...entry.related]);
    if (changed) touched.add(page.slug);
  }

  for (const [slug, names] of relatedNames) {
    const page = bySlug.get(slug);
    if (!page || !touched.has(slug)) continue;
    const related = new Set(page.content.related);
    for (const name of names) {
      const target = resolve(name);
      if (target && target.slug !== slug) related.add(target.slug);
    }
    page.content.related = [...related];
  }

  const moments: WorldUpdatePlan["moments"] = [];
  for (const tag of update.epicMoments) {
    const moment = recap.epicMoments[tag.moment];
    if (!moment) continue;
    const slugs = new Set(
      tag.pages.map((name) => resolve(name)?.slug).filter((slug) => slug !== undefined),
    );
    for (const slug of slugs) moments.push({ slug, position: tag.moment, moment });
  }

  const label = (ref: string) => resolve(ref)?.content.name ?? ref;
  return {
    pages: [...touched].map((slug) => bySlug.get(slug)!),
    moments,
    report: {
      possibleDuplicates: update.possibleDuplicates
        .filter((pair) => resolve(pair.first) !== resolve(pair.second) || !resolve(pair.first))
        .map((pair) => ({ ...pair, first: label(pair.first), second: label(pair.second) })),
      nameCorrections: update.nameCorrections.filter(
        (fix) => nameKey(fix.heard) && nameKey(fix.heard) !== nameKey(fix.canonical),
      ),
    },
  };
}
