import { and, asc, desc, eq, exists, gt, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { SessionArtifactRef } from "./artifacts.ts";
import { db, type DatabaseTransaction } from "./client.ts";
import type { CampaignCastMember } from "./queries.ts";
import {
  sessionArtifacts,
  sessions,
  worldPageAvatars,
  worldPageMoments,
  worldPageRevisions,
  worldPages,
  worldUpdates,
} from "./schema.ts";
import type { RecapSections } from "./session-notes.ts";
import { nameKey } from "./world-links.ts";
import {
  PERSON_KINDS,
  pageNames,
  planWorldUpdate,
  type WorldMoment,
  type WorldPageContent,
  type WorldPageKind,
  type WorldPageState,
  type WorldUpdate,
  type WorldUpdateReport,
} from "./world.ts";
import type { WorldUpdateStatus } from "./domain.ts";

type Queryable = typeof db | DatabaseTransaction;

export interface WorldSession {
  id: string;
  title: string | null;
  startedAt: Date;
  // 1-based position among the campaign's sessions, oldest first.
  number: number;
}

export async function listWorldSessions(campaignId: string): Promise<WorldSession[]> {
  const rows = await db
    .select({ id: sessions.id, title: sessions.title, startedAt: sessions.startedAt })
    .from(sessions)
    .where(eq(sessions.campaignId, campaignId))
    .orderBy(asc(sessions.startedAt));
  return rows.map((row, index) => ({ ...row, number: index + 1 }));
}

export interface WorldPageSnapshot extends WorldPageState {
  avatarId: string | null;
  memberUserId: string | null;
  createdInSessionId: string;
  // The session whose update wrote this revision.
  revisionSessionId: string;
}

export interface WorldBound {
  // Only sessions that started before this time.
  before?: Date;
  // Only sessions that started at or before this time.
  through?: Date;
}

// Every page of a campaign as it stood at the bound: the newest revision of
// each page from a session inside it. Without a bound, the current world.
export async function getWorldState(
  campaignId: string,
  bound: WorldBound = {},
  queryable: Queryable = db,
): Promise<WorldPageSnapshot[]> {
  const conditions = [eq(worldPages.campaignId, campaignId)];
  if (bound.before) conditions.push(lt(sessions.startedAt, bound.before));
  if (bound.through) conditions.push(lte(sessions.startedAt, bound.through));

  const rows = await queryable
    .selectDistinctOn([worldPageRevisions.pageId], {
      id: worldPages.id,
      slug: worldPages.slug,
      kind: worldPages.kind,
      avatarId: worldPages.avatarId,
      memberUserId: worldPages.memberUserId,
      createdInSessionId: worldPages.createdInSessionId,
      revisionSessionId: worldPageRevisions.sessionId,
      content: worldPageRevisions.content,
    })
    .from(worldPageRevisions)
    .innerJoin(worldPages, eq(worldPageRevisions.pageId, worldPages.id))
    .innerJoin(sessions, eq(worldPageRevisions.sessionId, sessions.id))
    .where(and(...conditions))
    .orderBy(worldPageRevisions.pageId, desc(sessions.startedAt));
  return rows.toSorted((a, b) => a.content.name.localeCompare(b.content.name));
}

async function sessionStart(sessionId: string): Promise<Date | null> {
  const [row] = await db
    .select({ startedAt: sessions.startedAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return row?.startedAt ?? null;
}

// The world as the given session left it.
export async function getWorldAsOfSession(
  campaignId: string,
  sessionId: string,
): Promise<WorldPageSnapshot[]> {
  const startedAt = await sessionStart(sessionId);
  return startedAt ? getWorldState(campaignId, { through: startedAt }) : [];
}

// The world as it stood when the given session began, for prompts. Later
// sessions are excluded so regenerating an old session cannot leak spoilers.
export async function getWorldBeforeSession(
  campaignId: string,
  sessionId: string,
): Promise<WorldPageSnapshot[]> {
  const startedAt = await sessionStart(sessionId);
  return startedAt ? getWorldState(campaignId, { before: startedAt }) : [];
}

export type WorldStep =
  | { kind: "waiting"; sessionId: string }
  | {
      kind: "next";
      sessionId: string;
      startedAt: Date;
      ledgerArtifact: SessionArtifactRef;
      recapSections: RecapSections | null;
    }
  // The session predates session ledgers; a recap backfill gives it one and
  // then resumes the world.
  | { kind: "needs-recap"; sessionId: string }
  | { kind: "skip"; sessionId: string }
  | { kind: "finished" };

// Sessions update the world strictly oldest first, each reading the world the
// previous one left. A session is eligible only after the newest session
// already handled, so a session that finishes late (a failure retried much
// later) never rewrites history; rebuilding the world handles that.
export async function nextWorldStep(campaignId: string): Promise<WorldStep> {
  const [active] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.campaignId, campaignId), isNotNull(sessions.activeRunId)))
    .limit(1);
  if (active) return { kind: "waiting", sessionId: active.id };

  const [latest] = await db
    .select({ startedAt: sessions.startedAt })
    .from(worldUpdates)
    .innerJoin(sessions, eq(worldUpdates.sessionId, sessions.id))
    .where(
      and(
        eq(worldUpdates.campaignId, campaignId),
        inArray(worldUpdates.status, ["done", "skipped", "failed"]),
      ),
    )
    .orderBy(desc(sessions.startedAt))
    .limit(1);

  const conditions = [
    eq(sessions.campaignId, campaignId),
    eq(sessions.status, "done"),
    sql`not exists (
      select 1 from ${worldUpdates}
      where ${worldUpdates.sessionId} = ${sessions.id} and ${worldUpdates.status} <> 'pending'
    )`,
  ];
  if (latest) conditions.push(gt(sessions.startedAt, latest.startedAt));
  const [candidate] = await db
    .select({
      id: sessions.id,
      startedAt: sessions.startedAt,
      recapSections: sessions.recapSections,
    })
    .from(sessions)
    .where(and(...conditions))
    .orderBy(asc(sessions.startedAt))
    .limit(1);
  if (!candidate) return { kind: "finished" };

  const artifacts = await db
    .select()
    .from(sessionArtifacts)
    .where(
      and(
        eq(sessionArtifacts.sessionId, candidate.id),
        eq(sessionArtifacts.isCurrent, true),
        inArray(sessionArtifacts.kind, ["transcript", "session_ledger"]),
      ),
    );
  const ledger = artifacts.find((artifact) => artifact.kind === "session_ledger");
  if (ledger) {
    return {
      kind: "next",
      sessionId: candidate.id,
      startedAt: candidate.startedAt,
      ledgerArtifact: {
        id: ledger.id,
        kind: "session_ledger",
        bucket: ledger.bucket,
        objectKey: ledger.objectKey,
        contentType: ledger.contentType,
        formatVersion: ledger.formatVersion,
        byteSize: ledger.byteSize,
        sha256: ledger.sha256,
      },
      recapSections: candidate.recapSections?.sections ?? null,
    };
  }
  const hasTranscript = artifacts.some((artifact) => artifact.kind === "transcript");
  if (hasTranscript && !candidate.recapSections) {
    return { kind: "needs-recap", sessionId: candidate.id };
  }
  return { kind: "skip", sessionId: candidate.id };
}

async function settledWorldUpdate(tx: DatabaseTransaction, sessionId: string): Promise<boolean> {
  const [row] = await tx
    .select({ status: worldUpdates.status })
    .from(worldUpdates)
    .where(eq(worldUpdates.sessionId, sessionId))
    .for("update");
  return Boolean(row && row.status !== "pending");
}

export async function markWorldUpdateSkipped(campaignId: string, sessionId: string) {
  await db
    .insert(worldUpdates)
    .values({ sessionId, campaignId, status: "skipped" })
    .onConflictDoUpdate({
      target: worldUpdates.sessionId,
      set: { status: "skipped", updatedAt: new Date() },
      setWhere: eq(worldUpdates.status, "pending"),
    });
}

// Counts a failed attempt. After maxAttempts the session is marked failed and
// the world moves on without it, so one bad session cannot stall a campaign.
export async function recordWorldUpdateFailure(
  campaignId: string,
  sessionId: string,
  message: string,
  maxAttempts: number,
): Promise<WorldUpdateStatus> {
  const [row] = await db
    .insert(worldUpdates)
    .values({
      sessionId,
      campaignId,
      status: maxAttempts <= 1 ? "failed" : "pending",
      attempts: 1,
      error: message,
    })
    .onConflictDoUpdate({
      target: worldUpdates.sessionId,
      set: {
        attempts: sql`${worldUpdates.attempts} + 1`,
        status: sql`case when ${worldUpdates.attempts} + 1 >= ${maxAttempts} then 'failed' else 'pending' end`,
        error: message,
        updatedAt: new Date(),
      },
      setWhere: eq(worldUpdates.status, "pending"),
    })
    .returning({ status: worldUpdates.status });
  return row?.status ?? "failed";
}

function characterOwner(name: string, cast: CampaignCastMember[]): string | null {
  const key = nameKey(name);
  return cast.find((member) => nameKey(member.characterName) === key)?.userId ?? null;
}

// Applies one session's world update. The plan is recomputed from the world
// read inside this transaction, so a redelivered job writes the same result
// once and a settled session is never applied twice.
export async function recordWorldUpdate(
  campaignId: string,
  sessionId: string,
  update: WorldUpdate,
  epicMoments: RecapSections["epicMoments"],
  cast: CampaignCastMember[],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx
      .insert(worldUpdates)
      .values({ sessionId, campaignId, status: "pending" })
      .onConflictDoNothing();
    if (await settledWorldUpdate(tx, sessionId)) return false;

    const existing = await getWorldState(campaignId, {}, tx);
    const pageIds = new Map(existing.map((page) => [page.slug, page.id]));
    const plan = planWorldUpdate(existing, update, sessionId, epicMoments);

    for (const page of plan.pages) {
      let pageId = pageIds.get(page.slug);
      if (!pageId) {
        const [created] = await tx
          .insert(worldPages)
          .values({
            campaignId,
            slug: page.slug,
            kind: page.kind,
            memberUserId:
              page.kind === "character" ? characterOwner(page.content.name, cast) : null,
            createdInSessionId: sessionId,
          })
          .returning({ id: worldPages.id });
        pageId = created.id;
        pageIds.set(page.slug, pageId);
      } else {
        await tx.update(worldPages).set({ updatedAt: new Date() }).where(eq(worldPages.id, pageId));
      }
      await tx
        .insert(worldPageRevisions)
        .values({ pageId, sessionId, content: page.content })
        .onConflictDoUpdate({
          target: [worldPageRevisions.pageId, worldPageRevisions.sessionId],
          set: { content: page.content },
        });
    }

    for (const moment of plan.moments) {
      const pageId = pageIds.get(moment.slug);
      if (!pageId) continue;
      await tx
        .insert(worldPageMoments)
        .values({ pageId, sessionId, position: moment.position, moment: moment.moment })
        .onConflictDoNothing();
    }

    await tx
      .update(worldUpdates)
      .set({ status: "done", report: plan.report, error: null, updatedAt: new Date() })
      .where(eq(worldUpdates.sessionId, sessionId));
    return true;
  });
}

export interface WorldPageLink {
  slug: string;
  kind: WorldPageKind;
  name: string;
  avatarId: string | null;
}

function toLink(page: WorldPageSnapshot): WorldPageLink {
  return { slug: page.slug, kind: page.kind, name: page.content.name, avatarId: page.avatarId };
}

export interface WorldPageRevisionSummary {
  sessionId: string;
  sessionTitle: string | null;
  startedAt: Date;
  factsAdded: number;
  factsSuperseded: number;
  created: boolean;
}

export interface WorldPageDetail {
  id: string;
  slug: string;
  kind: WorldPageKind;
  avatarId: string | null;
  memberUserId: string | null;
  createdInSessionId: string;
  // Null when the page did not exist yet at the requested session.
  content: WorldPageContent | null;
  revisionSessionId: string | null;
  // The revision shown is older than the newest one.
  isSnapshot: boolean;
  laterFacts: number;
  history: WorldPageRevisionSummary[];
  related: WorldPageLink[];
  carries: WorldPageLink[];
  moments: (WorldMoment & { sessionId: string; sessionTitle: string | null })[];
}

export async function getWorldPage(
  campaignId: string,
  slug: string,
  asOfSessionId: string | null,
): Promise<WorldPageDetail | null> {
  const [page] = await db
    .select()
    .from(worldPages)
    .where(and(eq(worldPages.campaignId, campaignId), eq(worldPages.slug, slug)))
    .limit(1);
  if (!page) return null;

  const revisions = await db
    .select({
      sessionId: worldPageRevisions.sessionId,
      sessionTitle: sessions.title,
      startedAt: sessions.startedAt,
      content: worldPageRevisions.content,
    })
    .from(worldPageRevisions)
    .innerJoin(sessions, eq(worldPageRevisions.sessionId, sessions.id))
    .where(eq(worldPageRevisions.pageId, page.id))
    .orderBy(asc(sessions.startedAt));

  const bound = asOfSessionId ? await sessionStart(asOfSessionId) : null;
  const visible = bound ? revisions.filter((revision) => revision.startedAt <= bound) : revisions;
  const shown = visible.at(-1) ?? null;
  const newest = revisions.at(-1) ?? null;

  const history = revisions.map((revision, index) => {
    const previous = index > 0 ? revisions[index - 1].content : null;
    const previousIds = new Set(previous?.facts.map((fact) => fact.id));
    return {
      sessionId: revision.sessionId,
      sessionTitle: revision.sessionTitle,
      startedAt: revision.startedAt,
      factsAdded: revision.content.facts.filter((fact) => !previousIds.has(fact.id)).length,
      factsSuperseded: revision.content.facts.filter(
        (fact) => fact.supersededIn === revision.sessionId,
      ).length,
      created: index === 0,
    };
  });

  const shownIds = new Set(shown?.content.facts.map((fact) => fact.id));
  const laterFacts =
    shown && newest && shown !== newest
      ? newest.content.facts.filter((fact) => !shownIds.has(fact.id)).length
      : 0;

  const world = await getWorldState(campaignId, bound ? { through: bound } : {});
  const related = new Map<string, WorldPageLink>();
  if (shown) {
    for (const target of world) {
      if (target.slug === page.slug) continue;
      if (shown.content.related.includes(target.slug) || target.content.related.includes(slug)) {
        related.set(target.slug, toLink(target));
      }
    }
  }
  const names = new Set(shown ? pageNames(shown.content).map(nameKey) : []);
  const carries = (PERSON_KINDS as readonly string[]).includes(page.kind)
    ? world
        .filter(
          (target) =>
            target.kind === "item" &&
            target.content.holder &&
            names.has(nameKey(target.content.holder)),
        )
        .map(toLink)
    : [];

  const momentConditions = [eq(worldPageMoments.pageId, page.id)];
  if (bound) momentConditions.push(lte(sessions.startedAt, bound));
  const moments = await db
    .select({
      sessionId: worldPageMoments.sessionId,
      sessionTitle: sessions.title,
      moment: worldPageMoments.moment,
    })
    .from(worldPageMoments)
    .innerJoin(sessions, eq(worldPageMoments.sessionId, sessions.id))
    .where(and(...momentConditions))
    .orderBy(desc(sessions.startedAt), asc(worldPageMoments.position));

  return {
    id: page.id,
    slug: page.slug,
    kind: page.kind,
    avatarId: page.avatarId,
    memberUserId: page.memberUserId,
    createdInSessionId: page.createdInSessionId,
    content: shown?.content ?? null,
    revisionSessionId: shown?.sessionId ?? null,
    isSnapshot: Boolean(shown && newest && shown !== newest),
    laterFacts,
    history,
    related: [...related.values()].toSorted((a, b) => a.name.localeCompare(b.name)),
    carries,
    moments: moments.map((row) => ({
      ...row.moment,
      sessionId: row.sessionId,
      sessionTitle: row.sessionTitle,
    })),
  };
}

export interface WorldPageChange {
  slug: string;
  kind: WorldPageKind;
  avatarId: string | null;
  created: boolean;
  content: WorldPageContent;
  previous: WorldPageContent | null;
}

export interface SessionWorldChanges {
  status: WorldUpdateStatus | null;
  report: WorldUpdateReport | null;
  pages: WorldPageChange[];
}

// What one session's world update wrote, with each page's previous revision so
// the session page can show the difference.
export async function getSessionWorldChanges(sessionId: string): Promise<SessionWorldChanges> {
  const [update] = await db
    .select({ status: worldUpdates.status, report: worldUpdates.report })
    .from(worldUpdates)
    .where(eq(worldUpdates.sessionId, sessionId))
    .limit(1);

  const revisions = await db
    .select({
      pageId: worldPages.id,
      slug: worldPages.slug,
      kind: worldPages.kind,
      avatarId: worldPages.avatarId,
      createdInSessionId: worldPages.createdInSessionId,
      content: worldPageRevisions.content,
      startedAt: sessions.startedAt,
    })
    .from(worldPageRevisions)
    .innerJoin(worldPages, eq(worldPageRevisions.pageId, worldPages.id))
    .innerJoin(sessions, eq(worldPageRevisions.sessionId, sessions.id))
    .where(eq(worldPageRevisions.sessionId, sessionId));

  const startedAt = revisions[0]?.startedAt;
  const previous = startedAt
    ? await db
        .selectDistinctOn([worldPageRevisions.pageId], {
          pageId: worldPageRevisions.pageId,
          content: worldPageRevisions.content,
        })
        .from(worldPageRevisions)
        .innerJoin(sessions, eq(worldPageRevisions.sessionId, sessions.id))
        .where(
          and(
            inArray(
              worldPageRevisions.pageId,
              revisions.map((revision) => revision.pageId),
            ),
            lt(sessions.startedAt, startedAt),
          ),
        )
        .orderBy(worldPageRevisions.pageId, desc(sessions.startedAt))
    : [];
  const previousByPage = new Map(previous.map((row) => [row.pageId, row.content]));
  const pages: WorldPageChange[] = revisions.map((revision) => ({
    slug: revision.slug,
    kind: revision.kind,
    avatarId: revision.avatarId,
    created: revision.createdInSessionId === sessionId,
    content: revision.content,
    previous: previousByPage.get(revision.pageId) ?? null,
  }));

  return {
    status: update?.status ?? null,
    report: update?.report ?? null,
    pages: pages.toSorted(
      (a, b) =>
        Number(b.created) - Number(a.created) || a.content.name.localeCompare(b.content.name),
    ),
  };
}

export async function getWorldPageRef(
  campaignId: string,
  slug: string,
): Promise<{ id: string; avatarId: string | null } | null> {
  const [page] = await db
    .select({ id: worldPages.id, avatarId: worldPages.avatarId })
    .from(worldPages)
    .where(and(eq(worldPages.campaignId, campaignId), eq(worldPages.slug, slug)))
    .limit(1);
  return page ?? null;
}

export interface WorldAvatarObject {
  bucket: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
}

// Records an uploaded avatar and shows it on the page. Earlier avatars stay
// in storage and in this table.
export async function setWorldPageAvatar(
  pageId: string,
  object: WorldAvatarObject,
  uploadedByUserId: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    const [avatar] = await tx
      .insert(worldPageAvatars)
      .values({ pageId, ...object, uploadedByUserId })
      .returning({ id: worldPageAvatars.id });
    await tx
      .update(worldPages)
      .set({ avatarId: avatar.id, updatedAt: new Date() })
      .where(eq(worldPages.id, pageId));
    return avatar.id;
  });
}

export async function clearWorldPageAvatar(pageId: string): Promise<void> {
  await db
    .update(worldPages)
    .set({ avatarId: null, updatedAt: new Date() })
    .where(eq(worldPages.id, pageId));
}

export async function getWorldAvatar(
  campaignId: string,
  avatarId: string,
): Promise<WorldAvatarObject | null> {
  const [avatar] = await db
    .select({
      bucket: worldPageAvatars.bucket,
      objectKey: worldPageAvatars.objectKey,
      contentType: worldPageAvatars.contentType,
      byteSize: worldPageAvatars.byteSize,
      sha256: worldPageAvatars.sha256,
    })
    .from(worldPageAvatars)
    .where(
      and(
        eq(worldPageAvatars.id, avatarId),
        exists(
          db
            .select({ id: worldPages.id })
            .from(worldPages)
            .where(
              and(
                eq(worldPages.id, worldPageAvatars.pageId),
                eq(worldPages.campaignId, campaignId),
              ),
            ),
        ),
      ),
    )
    .limit(1);
  return avatar ?? null;
}
