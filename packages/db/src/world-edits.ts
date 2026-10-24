import { z } from "zod";
import {
  exactly,
  recapTextFields,
  replaceInField,
  setRecapField,
  wholeWords,
  type RecapChange,
} from "./recap-edits.ts";
import type { RecapSections } from "./session-notes.ts";
import { nameKey } from "./world-links.ts";
import {
  QUEST_STATUSES,
  WORLD_PAGE_KINDS,
  slugify,
  markRemoved,
  uniqueNames,
  unmarkRemoved,
  type WorldFact,
  type WorldPageContent,
  type WorldPageKind,
} from "./world.ts";

// Hand edits to the world, asked for in chat and applied only after someone
// confirms them. An edit is a list of small changes, planned here as a pure
// function over the pages' whole revision history so the preview and the write
// are the same computation. Name, alias and fact changes rewrite every revision,
// since they correct what the world got wrong; status, holder, summary and new
// facts only change the page as it stands now.

const page = z.string().describe("The page's slug, or its exact name");
const fact = z.number().int().describe("The fact's #id on that page");

export const worldEditChangeSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("rename"),
    page,
    name: z.string(),
    keepOldName: z
      .boolean()
      .describe("Keep the old name as another name, as for a misspelling people still use"),
  }),
  z.object({ op: z.literal("setKind"), page, kind: z.enum(WORLD_PAGE_KINDS) }),
  z.object({ op: z.literal("addAlias"), page, alias: z.string() }),
  z.object({ op: z.literal("removeAlias"), page, alias: z.string() }),
  z.object({ op: z.literal("editFact"), page, fact, text: z.string() }),
  z.object({ op: z.literal("removeFact"), page, fact }),
  z.object({ op: z.literal("addFact"), page, text: z.string() }),
  z.object({ op: z.literal("setStatus"), page, status: z.string().nullable() }),
  z.object({ op: z.literal("setHolder"), page, holder: z.string().nullable() }),
  z.object({ op: z.literal("setSummary"), page, summary: z.string() }),
  z.object({
    op: z.literal("merge"),
    page: page.describe("The duplicate page, which is removed"),
    into: z.string().describe("The page that keeps its name and gains the other's facts"),
  }),
  z.object({
    op: z.literal("split"),
    page: page.describe("The page that wrongly holds two things"),
    name: z.string().describe("Name of the new page"),
    kind: z.enum(WORLD_PAGE_KINDS),
    facts: z.array(fact).describe("Facts that move to the new page"),
    aliases: z.array(z.string()).describe("Other names that move to the new page"),
    summary: z.string().describe("Two or three sentences describing the new page"),
  }),
  z.object({
    op: z.literal("editRecap"),
    session: z.string().describe("The session's id in square brackets, or its number"),
    field: z.string().describe("The recap field's id from readSession, such as recap or loot.2"),
    find: z
      .string()
      .describe("The exact words to replace, as the field has them, long enough to occur once"),
    replace: z.string(),
  }),
  z.object({
    op: z.literal("replaceInRecaps"),
    find: z
      .string()
      .describe("A name or phrase, replaced wherever it appears as whole words in any recap"),
    replace: z.string(),
  }),
]);

export const worldEditSchema = z.object({
  summary: z.string().describe("One sentence describing the whole edit"),
  remember: z
    .string()
    .nullable()
    .describe(
      "A short standing note future recaps and world updates should follow so the mistake is not repeated, or null",
    ),
  changes: z.array(worldEditChangeSchema).min(1),
});

export type WorldEditChange = z.infer<typeof worldEditChangeSchema>;
export type WorldEdit = z.infer<typeof worldEditSchema>;

export interface EditRevision {
  sessionId: string;
  content: WorldPageContent;
}

export interface EditPage {
  // Null for a page this edit creates.
  id: string | null;
  slug: string;
  kind: WorldPageKind;
  createdInSessionId: string;
  // Oldest first.
  revisions: EditRevision[];
  removed: boolean;
  // For a removed page, the slug it was folded into.
  mergedInto: string | null;
}

// Another page's revision that links to a page an edit removes.
export interface EditLink {
  revisionId: string;
  pageSlug: string;
  pageName: string;
  related: string[];
}

// A session's recap as an edit sees it.
export interface EditRecap {
  sessionId: string;
  sections: RecapSections;
}

export interface EditWorld {
  pages: EditPage[];
  // Every recap in the campaign, loaded only for an edit that changes recaps.
  recaps?: EditRecap[];
  // Every slug in the campaign, so a new page never reuses one.
  slugs: Set<string>;
  // Session ids in play order.
  sessionOrder: string[];
  links: EditLink[];
}

export interface PlannedEdit {
  pages: EditPage[];
  // Revision id to its new related list.
  links: Map<string, string[]>;
  // The recaps the edit changes, as they would read.
  recaps: EditRecap[];
  // Each replaced stretch of recap text, with the index of its change.
  recapChanges: (RecapChange & { change: number })[];
  errors: string[];
}

const isQuestStatus = (status: string) => (QUEST_STATUSES as readonly string[]).includes(status);
const clone = <T>(value: T): T => structuredClone(value);
const latest = (target: EditPage) => target.revisions.at(-1)!.content;
const factTexts = (content: WorldPageContent) => content.facts.map((f) => f.text);
// What a page shows as its other names: names and references together.
const otherNames = (content: WorldPageContent) => [...content.aliases, ...content.references];

// Applies an edit's changes in order to a copy of the world. Errors name the
// change that could not be applied, so the model can correct its proposal.
export function planWorldEdit(world: EditWorld, changes: WorldEditChange[]): PlannedEdit {
  const pages = world.pages.map(clone);
  const slugs = new Set(world.slugs);
  const order = new Map(world.sessionOrder.map((id, index) => [id, index]));
  const links = new Map<string, string[]>();
  const errors: string[] = [];

  const find = (ref: string): EditPage | undefined => {
    const live = pages.filter((candidate) => !candidate.removed);
    const bySlug = live.find((candidate) => candidate.slug === ref);
    if (bySlug) return bySlug;
    const key = nameKey(ref);
    return live.find((candidate) =>
      [latest(candidate).name, ...latest(candidate).aliases].some((name) => nameKey(name) === key),
    );
  };
  const asOf = (target: EditPage, sessionId: string): WorldPageContent | null => {
    const position = order.get(sessionId) ?? -1;
    let found: WorldPageContent | null = null;
    for (const revision of target.revisions) {
      if ((order.get(revision.sessionId) ?? -1) <= position) found = revision.content;
    }
    return found;
  };
  const sortRevisions = (revisions: EditRevision[]) =>
    revisions.toSorted((a, b) => (order.get(a.sessionId) ?? 0) - (order.get(b.sessionId) ?? 0));

  const recaps = (world.recaps ?? []).map(clone);
  const changedRecaps = new Set<string>();
  const recapChanges: PlannedEdit["recapChanges"] = [];
  const findRecap = (ref: string): EditRecap | undefined => {
    const number = Number(ref.replace(/^session\s*/i, ""));
    const id = Number.isInteger(number) ? (world.sessionOrder[number - 1] ?? ref) : ref;
    return recaps.find((recap) => recap.sessionId === ref || recap.sessionId === id);
  };

  changes.forEach((change, index) => {
    const label = `Change ${index + 1} (${change.op})`;
    if (change.op === "editRecap") {
      const recap = findRecap(change.session);
      if (!recap) return void errors.push(`${label}: session ${change.session} has no recap.`);
      const field = recapTextFields(recap.sections).find((entry) => entry.field === change.field);
      if (!field) {
        return void errors.push(`${label}: the recap has no field "${change.field}".`);
      }
      const found = change.find ? field.text.split(change.find).length - 1 : 0;
      if (found !== 1) {
        return void errors.push(
          found
            ? `${label}: "${change.find}" appears ${found} times in ${change.field}; quote more of the sentence.`
            : `${label}: ${change.field} does not contain "${change.find}".`,
        );
      }
      const replaced = replaceInField(field.text, exactly(change.find), change.replace, {
        sessionId: recap.sessionId,
        field: field.field,
        label: field.label,
      });
      setRecapField(recap.sections, field.field, replaced.text);
      changedRecaps.add(recap.sessionId);
      recapChanges.push(...replaced.changes.map((c) => ({ ...c, change: index })));
      return;
    }
    if (change.op === "replaceInRecaps") {
      const phrase = change.find.trim();
      if (!phrase) return void errors.push(`${label}: there is nothing to find.`);
      let count = 0;
      for (const recap of recaps) {
        for (const field of recapTextFields(recap.sections)) {
          const replaced = replaceInField(field.text, wholeWords(phrase), change.replace, {
            sessionId: recap.sessionId,
            field: field.field,
            label: field.label,
          });
          if (!replaced.changes.length) continue;
          setRecapField(recap.sections, field.field, replaced.text);
          changedRecaps.add(recap.sessionId);
          recapChanges.push(...replaced.changes.map((c) => ({ ...c, change: index })));
          count += replaced.changes.length;
        }
      }
      if (!count) errors.push(`${label}: no recap mentions "${phrase}".`);
      return;
    }
    const target = find(change.page);
    if (!target) {
      errors.push(`${label}: no page is called "${change.page}".`);
      return;
    }
    const all = target.revisions.map((revision) => revision.content);
    const now = latest(target);

    switch (change.op) {
      case "rename": {
        const name = change.name.trim();
        if (!name) return void errors.push(`${label}: the new name is empty.`);
        for (const content of all) {
          const previous = content.name;
          content.name = name;
          content.aliases = uniqueNames(
            change.keepOldName ? [previous, ...content.aliases] : content.aliases,
            name,
          );
          // A dropped name stays dropped, so a later session never renames the
          // page back to it.
          if (!change.keepOldName) markRemoved(content, { names: [previous] });
          unmarkRemoved(content, { names: [name] });
        }
        return;
      }
      case "setKind":
        target.kind = change.kind;
        return;
      case "addAlias": {
        // A person naming it makes a reference a name again.
        const key = nameKey(change.alias);
        for (const content of all) {
          content.aliases = uniqueNames([...content.aliases, change.alias], content.name);
          content.references = content.references.filter((ref) => nameKey(ref) !== key);
          unmarkRemoved(content, { names: [change.alias] });
        }
        return;
      }
      case "removeAlias": {
        const key = nameKey(change.alias);
        const named = (content: WorldPageContent) =>
          [...content.aliases, ...content.references].some((alias) => nameKey(alias) === key);
        if (!all.some(named)) {
          return void errors.push(`${label}: ${now.name} has no other name "${change.alias}".`);
        }
        for (const content of all) {
          content.aliases = content.aliases.filter((alias) => nameKey(alias) !== key);
          content.references = content.references.filter((ref) => nameKey(ref) !== key);
          markRemoved(content, { names: [change.alias] });
        }
        return;
      }
      case "editFact":
      case "removeFact": {
        if (!all.some((content) => content.facts.some((f) => f.id === change.fact))) {
          return void errors.push(`${label}: ${now.name} has no fact #${change.fact}.`);
        }
        for (const content of all) {
          // The old wording stays out too, or the next session that reports
          // it would add it back beside the correction.
          const old = content.facts.find((f) => f.id === change.fact);
          if (old) markRemoved(content, { facts: [old.text] });
          content.facts =
            change.op === "editFact"
              ? content.facts.map((f) => (f.id === change.fact ? { ...f, text: change.text } : f))
              : content.facts.filter((f) => f.id !== change.fact);
          if (change.op === "editFact") unmarkRemoved(content, { facts: [change.text] });
        }
        return;
      }
      case "addFact": {
        const revision = target.revisions.at(-1)!;
        const nextId = Math.max(0, ...all.flatMap((content) => content.facts.map((f) => f.id))) + 1;
        for (const content of all) unmarkRemoved(content, { facts: [change.text] });
        revision.content.facts.push({
          id: nextId,
          text: change.text,
          sessionId: revision.sessionId,
          at: null,
          supersededIn: null,
        });
        return;
      }
      case "setStatus": {
        const status = change.status?.trim().toLowerCase() || null;
        if (target.kind === "quest" && status !== null && !isQuestStatus(status)) {
          return void errors.push(
            `${label}: a quest's status is ${QUEST_STATUSES.join(" or ")}, not "${status}".`,
          );
        }
        now.status = status;
        return;
      }
      case "setHolder":
        now.holder = change.holder?.trim() || null;
        return;
      case "setSummary":
        now.summary = change.summary.trim();
        return;
      case "merge": {
        const into = find(change.into);
        if (!into) return void errors.push(`${label}: no page is called "${change.into}".`);
        if (into === target) return void errors.push(`${label}: a page cannot merge into itself.`);
        const offset = Math.max(
          0,
          ...into.revisions.flatMap((revision) => revision.content.facts.map((f) => f.id)),
        );
        const sessions = [
          ...new Set(
            [...target.revisions, ...into.revisions].map((revision) => revision.sessionId),
          ),
        ];
        into.revisions = sortRevisions(
          sessions.map((sessionId) => {
            const from = asOf(target, sessionId);
            const base: WorldPageContent = clone(asOf(into, sessionId)) ?? {
              version: 1,
              name: latest(into).name,
              aliases: [],
              references: [],
              status: from?.status ?? null,
              summary: from?.summary ?? "",
              facts: [],
              holder: from?.holder ?? null,
              related: [],
            };
            if (from) {
              base.facts = [
                ...base.facts,
                ...from.facts.map((f): WorldFact => ({ ...f, id: f.id + offset })),
              ];
              base.aliases = uniqueNames([...base.aliases, from.name, ...from.aliases], base.name);
              base.references = uniqueNames(
                [...base.references, ...from.references],
                base.name,
              ).filter((ref) => !base.aliases.some((alias) => nameKey(alias) === nameKey(ref)));
              base.related = [...new Set([...base.related, ...from.related])].filter(
                (slug) => slug !== target.slug && slug !== into.slug,
              );
              if (from.removed) markRemoved(base, from.removed);
            }
            return { sessionId, content: base };
          }),
        );
        if (
          (order.get(target.createdInSessionId) ?? 0) < (order.get(into.createdInSessionId) ?? 0)
        ) {
          into.createdInSessionId = target.createdInSessionId;
        }
        target.removed = true;
        target.mergedInto = into.slug;
        const relink = (related: string[], self: string) =>
          [...new Set(related.map((slug) => (slug === target.slug ? into.slug : slug)))].filter(
            (slug) => slug !== self,
          );
        for (const other of pages) {
          if (other.removed) continue;
          for (const revision of other.revisions) {
            revision.content.related = relink(revision.content.related, other.slug);
          }
        }
        for (const link of world.links) {
          if (!link.related.includes(target.slug)) continue;
          links.set(
            link.revisionId,
            relink(links.get(link.revisionId) ?? link.related, link.pageSlug),
          );
        }
        return;
      }
      case "split": {
        const name = change.name.trim();
        if (!name) return void errors.push(`${label}: the new page has no name.`);
        const moving = new Set(change.facts);
        const missing = change.facts.filter(
          (id) => !all.some((content) => content.facts.some((f) => f.id === id)),
        );
        if (missing.length) {
          return void errors.push(
            `${label}: ${now.name} has no fact ${missing.map((id) => `#${id}`).join(", ")}.`,
          );
        }
        const base = slugify(name);
        let slug = base;
        for (let n = 2; slugs.has(slug); n++) slug = `${base}-${n}`;
        slugs.add(slug);

        const renumber = new Map([...moving].toSorted((a, b) => a - b).map((id, i) => [id, i + 1]));
        const movedNames = new Set(change.aliases.map(nameKey));
        const revisions: EditRevision[] = [];
        for (const revision of target.revisions) {
          const moved = revision.content.facts.filter((f) => moving.has(f.id));
          revision.content.facts = revision.content.facts.filter((f) => !moving.has(f.id));
          revision.content.aliases = revision.content.aliases.filter(
            (alias) => !movedNames.has(nameKey(alias)) && nameKey(alias) !== nameKey(name),
          );
          revision.content.references = revision.content.references.filter(
            (ref) => !movedNames.has(nameKey(ref)) && nameKey(ref) !== nameKey(name),
          );
          if (!moved.length) continue;
          revisions.push({
            sessionId: revision.sessionId,
            content: {
              version: 1,
              name,
              aliases: uniqueNames(change.aliases, name),
              references: [],
              status: null,
              summary: change.summary.trim(),
              facts: moved.map((f) => ({ ...f, id: renumber.get(f.id)! })),
              holder: null,
              related: [target.slug],
            },
          });
        }
        if (!revisions.length) {
          revisions.push({
            sessionId: target.revisions.at(-1)!.sessionId,
            content: {
              version: 1,
              name,
              aliases: uniqueNames(change.aliases, name),
              references: [],
              status: null,
              summary: change.summary.trim(),
              facts: [],
              holder: null,
              related: [target.slug],
            },
          });
        }
        latest(target).related = [...new Set([...latest(target).related, slug])];
        pages.push({
          id: null,
          slug,
          kind: change.kind,
          createdInSessionId: revisions[0].sessionId,
          revisions,
          removed: false,
          mergedInto: null,
        });
        return;
      }
    }
  });

  return {
    pages,
    links,
    recaps: recaps.filter((recap) => changedRecaps.has(recap.sessionId)),
    recapChanges,
    errors,
  };
}

// What the confirmation card shows for one page: each changed field as the
// values it loses and gains.
export interface WorldEditRow {
  label: string;
  removed: string[];
  added: string[];
}

export interface WorldEditPagePreview {
  slug: string;
  name: string;
  kind: WorldPageKind;
  change: "new" | "edited" | "removed";
  // For a removed page, the name of the page it was folded into.
  mergedInto: string | null;
  // The first session whose version of the page changes.
  fromSessionId: string | null;
  rows: WorldEditRow[];
}

// The recap text one group of changes replaces: one session's fixes, or one
// name replaced across every recap.
export interface WorldEditRecapPreview {
  // For a name replaced across recaps, what it replaces; null for one
  // session's fixes.
  find: string | null;
  replace: string | null;
  sessionIds: string[];
  rows: RecapChange[];
}

export interface WorldEditPreview {
  summary: string;
  remember: string | null;
  changes: WorldEditChange[];
  errors: string[];
  recaps: WorldEditRecapPreview[];
  pages: WorldEditPagePreview[];
  // Other pages whose links move to the page a merge keeps.
  relinked: string[];
  fromSessionId: string | null;
}

function listDiff(label: string, before: string[], after: string[]): WorldEditRow | null {
  const removed = before.filter((value) => !after.includes(value));
  const added = after.filter((value) => !before.includes(value));
  return removed.length || added.length ? { label, removed, added } : null;
}

function valueDiff(
  label: string,
  before: string | null,
  after: string | null,
): WorldEditRow | null {
  if ((before ?? "") === (after ?? "")) return null;
  return { label, removed: before ? [before] : [], added: after ? [after] : [] };
}

export function previewWorldEdit(
  world: EditWorld,
  edit: WorldEdit,
  planned: PlannedEdit,
): WorldEditPreview {
  const order = new Map(world.sessionOrder.map((id, index) => [id, index]));
  const earliest = (ids: (string | null)[]) =>
    ids
      .filter((id): id is string => id !== null)
      .toSorted((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))[0] ?? null;
  const original = new Map(world.pages.map((p) => [p.slug, p]));
  const names = new Map(planned.pages.map((p) => [p.slug, p.revisions.at(-1)!.content.name]));

  const pages: WorldEditPagePreview[] = [];
  for (const after of planned.pages) {
    const before = original.get(after.slug);
    const now = after.revisions.at(-1)!.content;
    if (!before) {
      pages.push({
        slug: after.slug,
        name: now.name,
        kind: after.kind,
        change: "new",
        mergedInto: null,
        fromSessionId: after.createdInSessionId,
        rows: [
          listDiff("Other names", [], otherNames(now)),
          listDiff(
            "Facts",
            [],
            now.facts.map((f) => f.text),
          ),
          valueDiff("Summary", null, now.summary || null),
        ].filter((row): row is WorldEditRow => row !== null),
      });
      continue;
    }
    const was = before.revisions.at(-1)!.content;
    if (after.removed) {
      pages.push({
        slug: after.slug,
        name: was.name,
        kind: before.kind,
        change: "removed",
        mergedInto: after.mergedInto ? (names.get(after.mergedInto) ?? after.mergedInto) : null,
        fromSessionId: before.createdInSessionId,
        rows: [],
      });
      continue;
    }
    const changedFrom = earliest(
      after.revisions
        .filter((revision) => {
          const old = before.revisions.find((r) => r.sessionId === revision.sessionId);
          return !old || JSON.stringify(old.content) !== JSON.stringify(revision.content);
        })
        .map((revision) => revision.sessionId),
    );
    const rows = [
      valueDiff("Name", was.name, now.name),
      valueDiff("Kind", before.kind, after.kind),
      listDiff("Other names", otherNames(was), otherNames(now)),
      listDiff("Facts", factTexts(was), factTexts(now)),
      valueDiff("Status", was.status, now.status),
      valueDiff("Holder", was.holder, now.holder),
      valueDiff("Summary", was.summary, now.summary),
    ].filter((row): row is WorldEditRow => row !== null);
    if (!rows.length && !changedFrom) continue;
    pages.push({
      slug: after.slug,
      name: now.name,
      kind: after.kind,
      change: "edited",
      mergedInto: null,
      fromSessionId: changedFrom,
      rows,
    });
  }

  const recaps: WorldEditRecapPreview[] = [];
  for (const row of planned.recapChanges) {
    const change = edit.changes[row.change];
    const bulk = change?.op === "replaceInRecaps" ? change : null;
    let group = recaps.find((candidate) =>
      bulk
        ? candidate.find === bulk.find && candidate.replace === bulk.replace
        : candidate.find === null && candidate.sessionIds[0] === row.sessionId,
    );
    if (!group) {
      group = {
        find: bulk?.find ?? null,
        replace: bulk?.replace ?? null,
        sessionIds: [],
        rows: [],
      };
      recaps.push(group);
    }
    if (!group.sessionIds.includes(row.sessionId)) group.sessionIds.push(row.sessionId);
    const { change: _, ...shown } = row;
    group.rows.push(shown);
  }
  for (const group of recaps) {
    group.sessionIds.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    group.rows.sort((a, b) => (order.get(a.sessionId) ?? 0) - (order.get(b.sessionId) ?? 0));
  }

  const relinked = [
    ...new Set(
      world.links.filter((link) => planned.links.has(link.revisionId)).map((link) => link.pageName),
    ),
  ];
  return {
    summary: edit.summary,
    remember: edit.remember?.trim() || null,
    changes: edit.changes,
    errors: planned.errors,
    recaps,
    pages,
    relinked,
    fromSessionId: earliest([
      ...pages.map((p) => p.fromSessionId),
      ...recaps.flatMap((group) => group.sessionIds),
    ]),
  };
}
