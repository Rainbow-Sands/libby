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

// A quest the party stops pursuing stays open; it goes dormant once sessions
// stop moving it, which is worked out from its history rather than stored.
export const QUEST_STATUSES = ["open", "resolved"] as const;

// An open quest that has not come up for this many sessions is dormant: still
// on the quest board, but no longer repeated in every recap.
export const DORMANT_AFTER_SESSIONS = 5;

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
  // Other names that mean only this page: spellings, mishearings, nicknames.
  aliases: string[];
  // Descriptions that mean this page only in context, such as "the children"
  // or "the Captain". Shown with the other names, but never used to link text
  // or to match a session's mentions to the page.
  references: string[];
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

// What one session changed on a page. Only the difference is kept, since a
// page's full content grows with every session and the session page only
// shows what changed.
export interface WorldPageDiff {
  name: string;
  holder: string | null;
  // The page's summary, kept only for a new page that gained no facts.
  summary: string | null;
  added: WorldFact[];
  superseded: WorldFact[];
  renamedFrom: string | null;
  status: { from: string | null; to: string | null } | null;
}

export function diffWorldPage(
  sessionId: string,
  content: WorldPageContent,
  previous: WorldPageContent | null,
): WorldPageDiff {
  const before = new Set(previous?.facts.map((fact) => fact.id));
  const added = content.facts.filter((fact) => !before.has(fact.id));
  return {
    name: content.name,
    holder: content.holder,
    summary: !previous && added.length === 0 ? content.summary || null : null,
    added,
    superseded: content.facts.filter((fact) => fact.supersededIn === sessionId),
    renamedFrom: previous && previous.name !== content.name ? previous.name : null,
    status:
      previous && previous.status !== content.status
        ? { from: previous.status, to: content.status }
        : null,
  };
}

// A page's change as stored with its session's world update.
export interface StoredWorldPageChange extends WorldPageDiff {
  pageId: string;
  created: boolean;
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
          .describe(
            "Other names used for it this session that could mean nothing else in this campaign: spellings, mishearings, nicknames, unique titles",
          ),
        references: z
          .array(z.string())
          .describe(
            'Descriptions used for it this session that only mean it in context and could mean someone or something else, such as "the children", "the Captain" or "her husband"',
          ),
        status: z
          .string()
          .nullable()
          .describe(
            'Not for quests. One or two words such as "alive", "dead" or "missing". Null keeps the current status',
          ),
        questStatus: z
          .enum(QUEST_STATUSES)
          .nullable()
          .describe("Quests only: open or resolved. Null keeps the current status"),
        newFacts: z
          .array(z.object({ text: z.string().describe("One self-contained sentence"), at }))
          .describe("What this session established about it that the page does not say yet"),
        supersededFacts: z
          .array(z.number().int())
          .describe("Ids of this page's existing facts that this session proved wrong or outdated"),
        holder: z
          .string()
          .nullable()
          .describe(
            "Items only: who carries it now. Null keeps the current holder, or when unknown or not an item",
          ),
        holderGone: z
          .boolean()
          .describe(
            "Items only: true when this session the item left its holder and nobody carries it now, such as sold, lost, destroyed or left behind",
          ),
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

// The one-time sort of names stored before pages had references: which of
// each page's other names are really references.
export const aliasReferencesSchema = z.object({
  pages: z.array(
    z.object({
      page: z.string().describe("The page's slug"),
      references: z
        .array(z.string())
        .describe("Its other names that are references, copied exactly from the list"),
    }),
  ),
});

// The linking model's answer: which phrases of a recap mean which pages.
export const recapLinksSchema = z.object({
  links: z.array(
    z.object({
      field: z.string().describe("The field id the phrase is in"),
      phrase: z.string().describe("The exact text of the mention, as written in the field"),
      occurrence: z
        .number()
        .int()
        .describe("Which appearance of this exact phrase in the field it is, counting from 1"),
      page: z.string().describe("The slug of the page it means"),
    }),
  ),
});

export function slugify(name: string): string {
  const slug = nameKey(name).replaceAll(" ", "-").slice(0, 80).replace(/-+$/, "");
  return slug || "page";
}

export function uniqueNames(names: string[], exclude: string): string[] {
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
// References are left out, since they could mean another page.
export function pageNames(content: Pick<WorldPageContent, "name" | "aliases">): string[] {
  return [content.name, ...content.aliases];
}

// Adds names and references to a page's content. A reference stays one: a
// later session listing it as a name does not make it link, so only a person
// can turn it back into a name.
export function addPageNames(
  content: WorldPageContent,
  aliases: string[],
  references: string[],
): void {
  content.references = uniqueNames([...content.references, ...references], content.name);
  const referenceKeys = new Set(content.references.map(nameKey));
  content.aliases = uniqueNames([...content.aliases, ...aliases], content.name).filter(
    (alias) => !referenceKeys.has(nameKey(alias)),
  );
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
// Model output names pages loosely, so every mention resolves through the
// page's slug, name or any alias that no other page shares, and anything
// unknown becomes a new page.
// The parts of a session's recap the world update refers to by index.
export type WorldRecap = Pick<RecapSections, "epicMoments" | "openThreads" | "newFaces">;

function kindGroup(kind: WorldPageKind): string {
  return (PERSON_KINDS as readonly WorldPageKind[]).includes(kind) ? "person" : kind;
}

function compatibleKinds(a: WorldPageKind, b: WorldPageKind): boolean {
  if (a === "quest" || b === "quest") return a === b;
  return a === "other" || b === "other" || kindGroup(a) === kindGroup(b);
}

export function planWorldUpdate(
  existing: WorldPageState[],
  update: WorldUpdate,
  sessionId: string,
  recap: WorldRecap,
): WorldUpdatePlan {
  const bySlug = new Map<string, PlannedPage>();
  // Null for a name more than one existing page answers to, which matches
  // neither. A name this session gives a second page stays with the first.
  const byName = new Map<string, PlannedPage | null>();
  const touched = new Set<string>();
  const duplicates: WorldUpdateReport["possibleDuplicates"] = [];

  const index = (page: PlannedPage, shared = false) => {
    bySlug.set(page.slug, page);
    for (const name of pageNames(page.content)) {
      const key = nameKey(name);
      if (!key) continue;
      const owner = byName.get(key);
      if (owner === undefined) byName.set(key, page);
      else if (shared && owner !== page) byName.set(key, null);
    }
  };
  for (const page of existing) {
    index(
      { slug: page.slug, kind: page.kind, content: structuredClone(page.content), created: false },
      true,
    );
  }
  const resolve = (ref: string | null): PlannedPage | undefined =>
    ref ? (bySlug.get(ref) ?? byName.get(nameKey(ref)) ?? undefined) : undefined;

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
    // A quest's open thread is often worded a little differently from the
    // quest's name, and the next session may use that wording.
    const threadTitles = entry.openThreads
      .map((i) => recap.openThreads[i]?.title)
      .filter((title): title is string => Boolean(title?.trim()));
    const faceNames = entry.newFaces
      .map((i) => recap.newFaces[i]?.name)
      .filter((faceName): faceName is string => Boolean(faceName?.trim()));
    // An entry only continues a page of the same kind: a quest is never the
    // person it is about, and a winery is never the wine named after it, even
    // when the model points at that page's slug or one of its aliases. Player
    // characters and NPCs count as one kind, and "other" fits anything but a
    // quest, since the model reclassifies those between sessions. References
    // never match: "the Captain" of one ship is not the captain of another.
    const sameKind = (candidate: PlannedPage | undefined) =>
      candidate !== undefined && compatibleKinds(candidate.kind, entry.kind);
    let page = [
      resolve(entry.page),
      resolve(name),
      ...[...entry.aliases, ...threadTitles, ...faceNames].map(resolve),
    ].find(sameKind);
    // Names that already belong to another page stay with it.
    const ownNames = (names: string[]) =>
      names.filter((alias) => {
        const owner = resolve(alias);
        return !owner || owner === page;
      });
    const before = page ? JSON.stringify(page.content) : null;
    const kindBefore = page?.kind;

    if (!page) {
      page = {
        slug: uniqueSlug(name),
        kind: entry.kind,
        created: true,
        content: {
          version: 1,
          name,
          aliases: [],
          references: [],
          status: null,
          summary: "",
          facts: [],
          holder: null,
          related: [],
        },
      };
      // A new page called what another page is referred to as may be that
      // page; a person decides.
      const key = nameKey(name);
      for (const other of bySlug.values()) {
        if (other.content.references.some((reference) => nameKey(reference) === key)) {
          duplicates.push({
            first: name,
            second: other.content.name,
            reason: `${other.content.name} is also referred to as "${name}".`,
          });
        }
      }
    }

    // A page first seen as "other" takes the first specific kind a later
    // session gives it, so a stranger who turns out to be an NPC moves to the
    // NPC list. Specific kinds stay put; a person can change those.
    if (page.kind === "other" && entry.kind !== "other") page.kind = entry.kind;

    const content = page.content;
    const aliases = ownNames([...entry.aliases, ...threadTitles]);
    // Capitalization and articles vary from mention to mention; only a
    // different spelling renames the page.
    if (nameKey(name) !== nameKey(content.name)) {
      const previous = content.name;
      content.name = name;
      content.aliases = uniqueNames([previous, ...content.aliases], name);
    }
    addPageNames(content, aliases, entry.references);

    // A quest's status is one of QUEST_STATUSES, so the board and the prompts
    // can tell open quests from finished ones.
    const status = page.kind === "quest" ? entry.questStatus : entry.status?.trim().toLowerCase();
    if (status) content.status = status;
    // A null holder keeps the current one, so an item nobody carries any more
    // says so separately.
    if (page.kind === "item") {
      if (entry.holder?.trim()) content.holder = entry.holder.trim();
      else if (entry.holderGone) content.holder = null;
    }

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
    const changed = page.created || before !== JSON.stringify(content) || kindBefore !== page.kind;
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
      possibleDuplicates: [
        ...update.possibleDuplicates
          .filter((pair) => resolve(pair.first) !== resolve(pair.second) || !resolve(pair.first))
          .map((pair) => ({ ...pair, first: label(pair.first), second: label(pair.second) })),
        ...duplicates,
      ],
      nameCorrections: update.nameCorrections.filter(
        (fix) => nameKey(fix.heard) && nameKey(fix.heard) !== nameKey(fix.canonical),
      ),
    },
  };
}
