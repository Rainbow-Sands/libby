import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db, type DatabaseTransaction } from "./client.ts";
import {
  sessions,
  worldCorrections,
  worldEdits,
  worldPageAvatars,
  worldPageMoments,
  worldPageRevisions,
  worldPages,
  worldRecapLinks,
  worldUpdates,
} from "./schema.ts";
import { nameKey } from "./world-links.ts";
import {
  planWorldEdit,
  previewWorldEdit,
  type EditLink,
  type EditPage,
  type EditWorld,
  type WorldEdit,
  type WorldEditPreview,
} from "./world-edits.ts";
import type { WorldMoment, WorldPageContent, WorldPageKind } from "./world.ts";
import { getWorldSummary, lockWorld } from "./world-store.ts";

type Queryable = typeof db | DatabaseTransaction;

// A refusal the person can act on, shown as it is.
export class WorldEditError extends Error {}

type PageRow = typeof worldPages.$inferSelect;

// Every row an edit touched, as it was before, so it can be put back.
export interface WorldEditSnapshot {
  pages: PageRow[];
  revisions: { id: string; pageId: string; sessionId: string; content: WorldPageContent }[];
  moments: { pageId: string; sessionId: string; position: number; moment: WorldMoment }[];
  avatars: { id: string; pageId: string }[];
  links: { revisionId: string; related: string[] }[];
  // Recap links a merge moved to the page it kept. Missing from edits saved
  // before recaps were linked by the model.
  recapLinks?: { id: string; pageId: string }[];
  createdPageIds: string[];
  // The campaign's newest world update time when the edit was applied, read
  // from the same column it is compared with so clocks never mix.
  worldUpdatedAt: string | null;
}

async function latestWorldUpdate(
  tx: DatabaseTransaction,
  campaignId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ at: sql<string | null>`max(${worldUpdates.updatedAt})::text` })
    .from(worldUpdates)
    .where(eq(worldUpdates.campaignId, campaignId));
  return row?.at ?? null;
}

// The pages an edit names, with their whole history, and the other revisions
// that link to a page a merge removes.
async function loadEditWorld(
  campaignId: string,
  edit: WorldEdit,
  queryable: Queryable,
): Promise<{ world: EditWorld; rows: PageRow[] }> {
  const [summary, order] = await Promise.all([
    getWorldSummary(campaignId, {}, queryable),
    queryable
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.campaignId, campaignId))
      .orderBy(asc(sessions.startedAt)),
  ]);
  const resolve = (ref: string) => {
    const bySlug = summary.find((page) => page.slug === ref);
    if (bySlug) return bySlug;
    const key = nameKey(ref);
    return summary.find((page) =>
      [page.content.name, ...page.content.aliases].some((name) => nameKey(name) === key),
    );
  };
  const refs = edit.changes.flatMap((change) =>
    change.op === "merge" ? [change.page, change.into] : [change.page],
  );
  const ids = [...new Set(refs.map(resolve).flatMap((page) => (page ? [page.id] : [])))];
  const removing = edit.changes.flatMap((change) =>
    change.op === "merge" ? [resolve(change.page)?.slug].filter((s) => s !== undefined) : [],
  );

  const [rows, revisions, links] = await Promise.all([
    ids.length ? queryable.select().from(worldPages).where(inArray(worldPages.id, ids)) : [],
    ids.length
      ? queryable
          .select({
            pageId: worldPageRevisions.pageId,
            sessionId: worldPageRevisions.sessionId,
            content: worldPageRevisions.content,
          })
          .from(worldPageRevisions)
          .innerJoin(sessions, eq(worldPageRevisions.sessionId, sessions.id))
          .where(inArray(worldPageRevisions.pageId, ids))
          .orderBy(asc(sessions.startedAt))
      : [],
    removing.length
      ? queryable
          .select({
            revisionId: worldPageRevisions.id,
            pageSlug: worldPages.slug,
            pageName: sql<string>`${worldPageRevisions.content}->>'name'`,
            related: sql<string[]>`${worldPageRevisions.content}->'related'`,
          })
          .from(worldPageRevisions)
          .innerJoin(worldPages, eq(worldPageRevisions.pageId, worldPages.id))
          .where(
            and(
              eq(worldPages.campaignId, campaignId),
              ids.length ? notInArray(worldPages.id, ids) : undefined,
              sql`${worldPageRevisions.content}->'related' ?| array[${sql.join(
                removing.map((slug) => sql`${slug}`),
                sql`, `,
              )}]::text[]`,
            ),
          )
      : ([] as EditLink[]),
  ]);

  const pages: EditPage[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    createdInSessionId: row.createdInSessionId,
    revisions: revisions
      .filter((revision) => revision.pageId === row.id)
      .map((revision) => ({ sessionId: revision.sessionId, content: revision.content })),
    removed: false,
    mergedInto: null,
  }));
  return {
    world: {
      pages: pages.filter((page) => page.revisions.length > 0),
      slugs: new Set(summary.map((page) => page.slug)),
      sessionOrder: order.map((row) => row.id),
      links,
    },
    rows,
  };
}

// Sets the related list of many revisions in one statement.
async function setRelated(
  tx: DatabaseTransaction,
  entries: { revisionId: string; related: string[] }[],
): Promise<void> {
  if (!entries.length) return;
  const values = sql.join(
    entries.map(
      (entry) => sql`(${entry.revisionId}::uuid, ${JSON.stringify(entry.related)}::jsonb)`,
    ),
    sql`, `,
  );
  await tx.execute(sql`
    update ${worldPageRevisions} as r
    set content = jsonb_set(r.content, '{related}', v.related)
    from (values ${values}) as v(id, related)
    where r.id = v.id`);
}

// What applying the edit would change, without writing anything.
export async function previewCampaignWorldEdit(
  campaignId: string,
  edit: WorldEdit,
): Promise<WorldEditPreview> {
  const { world } = await loadEditWorld(campaignId, edit, db);
  return previewWorldEdit(world, edit, planWorldEdit(world, edit.changes));
}

export async function applyWorldEdit(
  campaignId: string,
  userId: string,
  edit: WorldEdit,
): Promise<{ editId: string; preview: WorldEditPreview }> {
  return db.transaction(async (tx) => {
    await lockWorld(tx, campaignId);
    const { world, rows } = await loadEditWorld(campaignId, edit, tx);
    const planned = planWorldEdit(world, edit.changes);
    const preview = previewWorldEdit(world, edit, planned);
    if (planned.errors.length) throw new WorldEditError(planned.errors.join(" "));

    const existingIds = rows.map((row) => row.id);
    const [revisions, moments, avatars] = existingIds.length
      ? await Promise.all([
          tx
            .select({
              id: worldPageRevisions.id,
              pageId: worldPageRevisions.pageId,
              sessionId: worldPageRevisions.sessionId,
              content: worldPageRevisions.content,
            })
            .from(worldPageRevisions)
            .where(inArray(worldPageRevisions.pageId, existingIds)),
          tx.select().from(worldPageMoments).where(inArray(worldPageMoments.pageId, existingIds)),
          tx
            .select({ id: worldPageAvatars.id, pageId: worldPageAvatars.pageId })
            .from(worldPageAvatars)
            .where(inArray(worldPageAvatars.pageId, existingIds)),
        ])
      : [[], [], []];

    const ids = new Map(rows.map((row) => [row.slug, row.id]));
    const created = planned.pages.filter((page) => page.id === null);
    if (created.length) {
      const inserted = await tx
        .insert(worldPages)
        .values(
          created.map((page) => ({
            campaignId,
            slug: page.slug,
            kind: page.kind,
            createdInSessionId: page.createdInSessionId,
          })),
        )
        .returning({ id: worldPages.id, slug: worldPages.slug });
      for (const row of inserted) ids.set(row.slug, row.id);
    }

    const kept = planned.pages.filter((page) => !page.removed);
    const keptIds = kept.map((page) => ids.get(page.slug)!);
    const updated = kept.filter((page) => page.id !== null);
    if (updated.length) {
      const values = sql.join(
        updated.map((page) => sql`(${page.id}::uuid, ${page.kind}, ${page.createdInSessionId})`),
        sql`, `,
      );
      await tx.execute(sql`
        update ${worldPages} as p
        set kind = v.kind, created_in_session_id = v.created_in, updated_at = now()
        from (values ${values}) as v(id, kind, created_in)
        where p.id = v.id`);
    }
    await tx.delete(worldPageRevisions).where(inArray(worldPageRevisions.pageId, keptIds));
    await tx.insert(worldPageRevisions).values(
      kept.flatMap((page) =>
        page.revisions.map((revision) => ({
          pageId: ids.get(page.slug)!,
          sessionId: revision.sessionId,
          content: revision.content,
        })),
      ),
    );

    const recapLinks: { id: string; pageId: string }[] = [];
    for (const page of planned.pages.filter((p) => p.removed && p.id !== null)) {
      const intoId = ids.get(page.mergedInto!)!;
      const fromId = page.id!;
      const row = rows.find((r) => r.id === fromId)!;
      const intoRow = rows.find((r) => r.id === intoId);
      await tx.execute(sql`
        insert into ${worldPageMoments} (page_id, session_id, position, moment)
        select ${intoId}, session_id, position, moment from ${worldPageMoments} where page_id = ${fromId}
        on conflict do nothing`);
      await tx.delete(worldPageMoments).where(eq(worldPageMoments.pageId, fromId));
      const moved = await tx
        .update(worldRecapLinks)
        .set({ pageId: intoId })
        .where(eq(worldRecapLinks.pageId, fromId))
        .returning({ id: worldRecapLinks.id });
      recapLinks.push(...moved.map((link) => ({ id: link.id, pageId: fromId })));
      await tx
        .update(worldPageAvatars)
        .set({ pageId: intoId })
        .where(eq(worldPageAvatars.pageId, fromId));
      if (row.avatarId && !intoRow?.avatarId) {
        await tx
          .update(worldPages)
          .set({ avatarId: row.avatarId })
          .where(eq(worldPages.id, intoId));
      }
      await tx.delete(worldPageRevisions).where(eq(worldPageRevisions.pageId, fromId));
      await tx.delete(worldPages).where(eq(worldPages.id, fromId));
    }

    await setRelated(
      tx,
      [...planned.links].map(([revisionId, related]) => ({ revisionId, related })),
    );

    const snapshot: WorldEditSnapshot = {
      pages: rows,
      revisions,
      moments,
      avatars,
      recapLinks,
      links: world.links
        .filter((link) => planned.links.has(link.revisionId))
        .map((link) => ({ revisionId: link.revisionId, related: link.related })),
      createdPageIds: created.map((page) => ids.get(page.slug)!),
      worldUpdatedAt: await latestWorldUpdate(tx, campaignId),
    };
    const [saved] = await tx
      .insert(worldEdits)
      .values({ campaignId, userId, summary: edit.summary, changes: edit.changes, snapshot })
      .returning({ id: worldEdits.id });
    if (preview.remember) {
      await tx.insert(worldCorrections).values({
        campaignId,
        editId: saved.id,
        note: preview.remember,
        createdByUserId: userId,
      });
    }
    return { editId: saved.id, preview };
  });
}

// Puts back every row the edit touched. Refused once a world update or another
// edit has written since, because undoing would throw that work away.
export async function undoWorldEdit(
  campaignId: string,
  editId: string,
  userId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockWorld(tx, campaignId);
    const [edit] = await tx
      .select()
      .from(worldEdits)
      .where(and(eq(worldEdits.id, editId), eq(worldEdits.campaignId, campaignId)));
    if (!edit) throw new WorldEditError("That change no longer exists.");
    if (edit.undoneAt) throw new WorldEditError("That change was already undone.");

    const [worldUpdatedAt, newerEdit] = await Promise.all([
      latestWorldUpdate(tx, campaignId),
      tx
        .select({ id: worldEdits.id })
        .from(worldEdits)
        .where(
          and(
            eq(worldEdits.campaignId, campaignId),
            // Compared in the database, since a JavaScript date drops the
            // column's microseconds and would count this edit as newer.
            sql`${worldEdits.createdAt} > (select e.created_at from world_edits e where e.id = ${editId})`,
            isNull(worldEdits.undoneAt),
          ),
        )
        .limit(1),
    ]);
    if (worldUpdatedAt !== edit.snapshot.worldUpdatedAt || newerEdit.length) {
      throw new WorldEditError(
        "The world has changed since this was applied, so it can't be undone. Ask Libby for a new fix instead.",
      );
    }

    const snapshot = edit.snapshot;
    const touched = [...snapshot.pages.map((page) => page.id), ...snapshot.createdPageIds];
    if (touched.length) {
      await tx.delete(worldPageMoments).where(inArray(worldPageMoments.pageId, touched));
      await tx.delete(worldPageRevisions).where(inArray(worldPageRevisions.pageId, touched));
    }
    if (snapshot.pages.length) {
      await tx
        .insert(worldPages)
        .values(
          snapshot.pages.map((page) => ({
            ...page,
            createdAt: new Date(page.createdAt),
            updatedAt: new Date(page.updatedAt),
          })),
        )
        .onConflictDoUpdate({
          target: worldPages.id,
          set: {
            slug: sql`excluded.slug`,
            kind: sql`excluded.kind`,
            avatarId: sql`excluded.avatar_id`,
            memberUserId: sql`excluded.member_user_id`,
            createdInSessionId: sql`excluded.created_in_session_id`,
            updatedAt: new Date(),
          },
        });
    }
    if (snapshot.avatars.length) {
      const values = sql.join(
        snapshot.avatars.map((avatar) => sql`(${avatar.id}::uuid, ${avatar.pageId}::uuid)`),
        sql`, `,
      );
      await tx.execute(sql`
        update ${worldPageAvatars} as a set page_id = v.page_id
        from (values ${values}) as v(id, page_id)
        where a.id = v.id`);
    }
    if (snapshot.createdPageIds.length) {
      await tx.delete(worldPages).where(inArray(worldPages.id, snapshot.createdPageIds));
    }
    if (snapshot.recapLinks?.length) {
      const values = sql.join(
        snapshot.recapLinks.map((link) => sql`(${link.id}::uuid, ${link.pageId}::uuid)`),
        sql`, `,
      );
      await tx.execute(sql`
        update ${worldRecapLinks} as l set page_id = v.page_id
        from (values ${values}) as v(id, page_id)
        where l.id = v.id`);
    }
    if (snapshot.revisions.length) {
      await tx.insert(worldPageRevisions).values(
        snapshot.revisions.map((revision) => ({
          ...revision,
          // Saved before pages had references.
          content: { ...revision.content, references: revision.content.references ?? [] },
        })),
      );
    }
    if (snapshot.moments.length) await tx.insert(worldPageMoments).values(snapshot.moments);
    await setRelated(tx, snapshot.links);

    await tx
      .update(worldEdits)
      .set({ undoneAt: new Date(), undoneByUserId: userId })
      .where(eq(worldEdits.id, editId));
    await tx
      .update(worldCorrections)
      .set({ retiredAt: new Date() })
      .where(eq(worldCorrections.editId, editId));
  });
}

// The standing notes recaps and world updates follow, oldest first.
export async function listWorldCorrections(campaignId: string): Promise<string[]> {
  const rows = await db
    .select({ note: worldCorrections.note })
    .from(worldCorrections)
    .where(and(eq(worldCorrections.campaignId, campaignId), isNull(worldCorrections.retiredAt)))
    .orderBy(asc(worldCorrections.createdAt));
  return rows.map((row) => row.note);
}

export interface WorldPageHistory {
  slug: string;
  kind: WorldPageKind;
  // Oldest first.
  revisions: { sessionId: string; content: WorldPageContent }[];
}

// One page's every revision, found by slug or by any of its current names.
export async function getWorldPageHistory(
  campaignId: string,
  ref: string,
): Promise<WorldPageHistory | null> {
  const summary = await getWorldSummary(campaignId);
  const key = nameKey(ref);
  const page =
    summary.find((candidate) => candidate.slug === ref) ??
    summary.find((candidate) =>
      [candidate.content.name, ...candidate.content.aliases].some((name) => nameKey(name) === key),
    );
  if (!page) return null;
  const revisions = await db
    .select({ sessionId: worldPageRevisions.sessionId, content: worldPageRevisions.content })
    .from(worldPageRevisions)
    .innerJoin(sessions, eq(worldPageRevisions.sessionId, sessions.id))
    .where(eq(worldPageRevisions.pageId, page.id))
    .orderBy(asc(sessions.startedAt));
  return { slug: page.slug, kind: page.kind, revisions };
}
