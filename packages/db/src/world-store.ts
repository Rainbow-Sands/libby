import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  sql,
} from "drizzle-orm";
import type { SessionArtifactRef } from "./artifacts.ts";
import { db, type DatabaseTransaction } from "./client.ts";
import type { CampaignCastMember } from "./queries.ts";
import {
  sessionArtifacts,
  sessions,
  worldPageAvatars,
  worldRecapLinkRuns,
  worldRecapLinks,
  worldPageMoments,
  worldPageRevisions,
  worldPages,
  worldUpdates,
} from "./schema.ts";
import type { RecapSections } from "./session-notes.ts";
import { nameKey, type MentionSentence } from "./world-links.ts";
import {
  PERSON_KINDS,
  addPageNames,
  pageNames,
  diffWorldPage,
  planWorldUpdate,
  type StoredWorldPageChange,
  type WorldPageDiff,
  type WorldMoment,
  type WorldPageContent,
  type WorldPageKind,
  type WorldPageState,
  type WorldUpdate,
  type WorldRecap,
  type WorldUpdateReport,
} from "./world.ts";
import type { WorldUpdateStatus } from "./domain.ts";

type Queryable = typeof db | DatabaseTransaction;

// World updates and hand edits both rewrite pages from what they read, so a
// campaign's world is changed by one of them at a time.
export async function lockWorld(tx: DatabaseTransaction, campaignId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`world:${campaignId}`}))`);
}

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
  // Only sessions that started at or before this session, for callers that
  // have not read the session yet.
  throughSession?: string;
}

// A page's content without its facts, which grow with every session and
// which lists, links and the sidebar never show.
export type WorldPageHeader = Omit<WorldPageContent, "facts">;

export interface WorldPageSummary extends Omit<WorldPageSnapshot, "content"> {
  content: WorldPageHeader;
}

function worldBoundConditions(campaignId: string, bound: WorldBound) {
  const conditions = [eq(worldPages.campaignId, campaignId)];
  if (bound.before) conditions.push(lt(sessions.startedAt, bound.before));
  if (bound.through) conditions.push(lte(sessions.startedAt, bound.through));
  if (bound.throughSession) {
    conditions.push(
      lte(
        sessions.startedAt,
        sql`(select bound_session.started_at from ${sessions} bound_session where bound_session.id = ${bound.throughSession})`,
      ),
    );
  }
  return conditions;
}

// Every page of a campaign as it stood at the bound, like getWorldState, but
// without facts, so only a small part of each revision is read and sent.
export async function getWorldSummary(
  campaignId: string,
  bound: WorldBound = {},
  queryable: Queryable = db,
): Promise<WorldPageSummary[]> {
  const rows = await queryable
    .selectDistinctOn([worldPageRevisions.pageId], {
      id: worldPages.id,
      slug: worldPages.slug,
      kind: worldPages.kind,
      avatarId: worldPages.avatarId,
      memberUserId: worldPages.memberUserId,
      createdInSessionId: worldPages.createdInSessionId,
      revisionSessionId: worldPageRevisions.sessionId,
      content: sql<WorldPageHeader>`${worldPageRevisions.content} - 'facts'`,
    })
    .from(worldPageRevisions)
    .innerJoin(worldPages, eq(worldPageRevisions.pageId, worldPages.id))
    .innerJoin(sessions, eq(worldPageRevisions.sessionId, sessions.id))
    .where(and(...worldBoundConditions(campaignId, bound)))
    .orderBy(worldPageRevisions.pageId, desc(sessions.startedAt));
  return rows.toSorted((a, b) => a.content.name.localeCompare(b.content.name));
}

// Every page of a campaign as it stood at the bound: the newest revision of
// each page from a session inside it. Without a bound, the current world.
export async function getWorldState(
  campaignId: string,
  bound: WorldBound = {},
  queryable: Queryable = db,
): Promise<WorldPageSnapshot[]> {
  const conditions = worldBoundConditions(campaignId, bound);

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
  recap: WorldRecap,
  cast: CampaignCastMember[],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockWorld(tx, campaignId);
    await tx
      .insert(worldUpdates)
      .values({ sessionId, campaignId, status: "pending" })
      .onConflictDoNothing();
    if (await settledWorldUpdate(tx, sessionId)) return false;

    const existing = await getWorldState(campaignId, {}, tx);
    const pageIds = new Map(existing.map((page) => [page.slug, page.id]));
    const before = new Map(existing.map((page) => [page.slug, page.content]));
    const changes: StoredWorldPageChange[] = [];
    const plan = planWorldUpdate(existing, update, sessionId, recap);

    // Each kind of write is one statement for all pages, not one per page.
    const newPages = plan.pages.filter((page) => !pageIds.has(page.slug));
    const created = newPages.length
      ? await tx
          .insert(worldPages)
          .values(
            newPages.map((page) => ({
              campaignId,
              slug: page.slug,
              kind: page.kind,
              memberUserId:
                page.kind === "character" ? characterOwner(page.content.name, cast) : null,
              createdInSessionId: sessionId,
            })),
          )
          .returning({ id: worldPages.id, slug: worldPages.slug })
      : [];
    for (const row of created) pageIds.set(row.slug, row.id);

    const touchedIds = plan.pages.flatMap((page) =>
      before.has(page.slug) ? [pageIds.get(page.slug)!] : [],
    );
    if (touchedIds.length) {
      await tx
        .update(worldPages)
        .set({ updatedAt: new Date() })
        .where(inArray(worldPages.id, touchedIds));
    }

    for (const page of plan.pages) {
      changes.push({
        pageId: pageIds.get(page.slug)!,
        created: !before.has(page.slug),
        ...diffWorldPage(sessionId, page.content, before.get(page.slug) ?? null),
      });
    }
    if (plan.pages.length) {
      await tx
        .insert(worldPageRevisions)
        .values(
          plan.pages.map((page) => ({
            pageId: pageIds.get(page.slug)!,
            sessionId,
            content: page.content,
          })),
        )
        .onConflictDoUpdate({
          target: [worldPageRevisions.pageId, worldPageRevisions.sessionId],
          set: { content: sql`excluded.content` },
        });
    }

    const moments = plan.moments.flatMap((moment) => {
      const pageId = pageIds.get(moment.slug);
      return pageId
        ? [{ pageId, sessionId, position: moment.position, moment: moment.moment }]
        : [];
    });
    if (moments.length) {
      await tx.insert(worldPageMoments).values(moments).onConflictDoNothing();
    }

    await tx
      .update(worldUpdates)
      .set({ status: "done", report: plan.report, changes, error: null, updatedAt: new Date() })
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

function toLink(page: WorldPageSummary): WorldPageLink {
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
  // Sessions whose recap names the page, newest first.
  mentions: WorldPageMention[];
  // Sessions after the requested one whose recap names the page.
  laterMentions: number;
}

export interface WorldPageMention {
  sessionId: string;
  sessionTitle: string | null;
  sentences: MentionSentence[];
}

// A page as it stood at the bound, the start of the session it is viewed as
// of, or as it stands now without one. `world` is the campaign's world at the
// same bound, for callers that already loaded it or started loading it.
export async function getWorldPage(
  campaignId: string,
  slug: string,
  bound: Date | null,
  knownWorld?: WorldPageSummary[] | Promise<WorldPageSummary[]>,
): Promise<WorldPageDetail | null> {
  const thisPage = and(eq(worldPages.campaignId, campaignId), eq(worldPages.slug, slug));
  const boundConditions = [thisPage];
  if (bound) boundConditions.push(lte(sessions.startedAt, bound));
  // Sessions whose recap the linking model found mentioning this page, from
  // links still matching the recap as it reads now.
  const readMentions = () =>
    db
      .select({
        sessionId: worldRecapLinks.sessionId,
        sessionTitle: sessions.title,
        startedAt: sessions.startedAt,
        sentence: worldRecapLinks.sentence,
      })
      .from(worldRecapLinks)
      .innerJoin(worldPages, eq(worldRecapLinks.pageId, worldPages.id))
      .innerJoin(sessions, eq(worldRecapLinks.sessionId, sessions.id))
      .innerJoin(worldRecapLinkRuns, eq(worldRecapLinkRuns.sessionId, sessions.id))
      .where(
        and(
          thisPage,
          isNotNull(worldRecapLinks.sentence),
          eq(worldRecapLinkRuns.recapHash, sql`md5(${sessions.recapSections}::text)`),
        ),
      )
      .orderBy(desc(sessions.startedAt), asc(worldRecapLinks.position));
  // Everything is read at once.
  const [[page], revisions, [shown], moments, world, mentionRows] = await Promise.all([
    db.select().from(worldPages).where(thisPage).limit(1),
    // Every revision is listed in the history, but only the one shown is
    // read in full; the rest are summarized by Postgres.
    db
      .select({
        sessionId: worldPageRevisions.sessionId,
        sessionTitle: sessions.title,
        startedAt: sessions.startedAt,
        factIds: sql<
          number[]
        >`jsonb_path_query_array(${worldPageRevisions.content}, '$.facts[*].id')`,
        factsSuperseded: sql<number>`jsonb_array_length(jsonb_path_query_array(
            ${worldPageRevisions.content},
            '$.facts[*] ? (@.supersededIn == $session)',
            jsonb_build_object('session', ${worldPageRevisions.sessionId})
          ))`,
      })
      .from(worldPageRevisions)
      .innerJoin(worldPages, eq(worldPageRevisions.pageId, worldPages.id))
      .innerJoin(sessions, eq(worldPageRevisions.sessionId, sessions.id))
      .where(thisPage)
      .orderBy(asc(sessions.startedAt)),
    // The revision shown: the newest one inside the bound.
    db
      .select({ sessionId: worldPageRevisions.sessionId, content: worldPageRevisions.content })
      .from(worldPageRevisions)
      .innerJoin(worldPages, eq(worldPageRevisions.pageId, worldPages.id))
      .innerJoin(sessions, eq(worldPageRevisions.sessionId, sessions.id))
      .where(and(...boundConditions))
      .orderBy(desc(sessions.startedAt))
      .limit(1),
    db
      .select({
        sessionId: worldPageMoments.sessionId,
        sessionTitle: sessions.title,
        moment: worldPageMoments.moment,
      })
      .from(worldPageMoments)
      .innerJoin(worldPages, eq(worldPageMoments.pageId, worldPages.id))
      .innerJoin(sessions, eq(worldPageMoments.sessionId, sessions.id))
      .where(and(...boundConditions))
      .orderBy(desc(sessions.startedAt), asc(worldPageMoments.position)),
    knownWorld ?? getWorldSummary(campaignId, bound ? { through: bound } : {}),
    readMentions(),
  ]);
  if (!page) return null;
  const visible = bound ? revisions.filter((revision) => revision.startedAt <= bound) : revisions;
  const shownRevision = visible.at(-1) ?? null;
  const newest = revisions.at(-1) ?? null;

  const history = revisions.map((revision, index) => {
    const previousIds = new Set(index > 0 ? revisions[index - 1].factIds : []);
    return {
      sessionId: revision.sessionId,
      sessionTitle: revision.sessionTitle,
      startedAt: revision.startedAt,
      factsAdded: revision.factIds.filter((id) => !previousIds.has(id)).length,
      factsSuperseded: revision.factsSuperseded,
      created: index === 0,
    };
  });

  const shownIds = new Set(shownRevision?.factIds);
  const isSnapshot = Boolean(shownRevision && newest && shownRevision !== newest);
  const laterFacts = isSnapshot
    ? (newest?.factIds.filter((id) => !shownIds.has(id)).length ?? 0)
    : 0;

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

  const mentions: WorldPageMention[] = [];
  const later = new Set<string>();
  // A page viewed as of a session before it existed lists no mentions.
  for (const row of shown ? mentionRows : []) {
    if (!row.sentence) continue;
    if (bound && row.startedAt > bound) {
      later.add(row.sessionId);
      continue;
    }
    const mention = mentions.at(-1);
    if (mention?.sessionId === row.sessionId) {
      // Two links in one sentence quote it once.
      if (!mention.sentences.some((s) => JSON.stringify(s) === JSON.stringify(row.sentence))) {
        mention.sentences.push(row.sentence);
      }
    } else {
      mentions.push({
        sessionId: row.sessionId,
        sessionTitle: row.sessionTitle,
        sentences: [row.sentence],
      });
    }
  }
  const laterMentions = later.size;

  return {
    id: page.id,
    slug: page.slug,
    kind: page.kind,
    avatarId: page.avatarId,
    memberUserId: page.memberUserId,
    createdInSessionId: page.createdInSessionId,
    content: shown?.content ?? null,
    revisionSessionId: shown?.sessionId ?? null,
    isSnapshot,
    laterFacts,
    history,
    related: [...related.values()].toSorted((a, b) => a.name.localeCompare(b.name)),
    carries,
    moments: moments.map((row) => ({
      ...row.moment,
      sessionId: row.sessionId,
      sessionTitle: row.sessionTitle,
    })),
    mentions,
    laterMentions,
  };
}

export interface WorldPageChange extends WorldPageDiff {
  slug: string;
  kind: WorldPageKind;
  avatarId: string | null;
  created: boolean;
}

export interface SessionWorldChanges {
  status: WorldUpdateStatus | null;
  report: WorldUpdateReport | null;
  pages: WorldPageChange[];
}

// How many pages a session's world update wrote, for the tab label.
export async function countSessionWorldChanges(sessionId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(worldPageRevisions)
    .where(eq(worldPageRevisions.sessionId, sessionId));
  return row?.count ?? 0;
}

// What one session's world update wrote, with each page's previous revision so
// the session page can show the difference.
// Compares each page a session's update wrote with its previous revision.
// Only for updates recorded before their changes were kept with them.
async function computeSessionWorldChanges(sessionId: string): Promise<StoredWorldPageChange[]> {
  const revisions = await db
    .select({
      pageId: worldPages.id,
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
  return revisions.map((revision) => ({
    pageId: revision.pageId,
    created: revision.createdInSessionId === sessionId,
    ...diffWorldPage(sessionId, revision.content, previousByPage.get(revision.pageId) ?? null),
  }));
}

export async function getSessionWorldChanges(sessionId: string): Promise<SessionWorldChanges> {
  // The pages a session changed are the ones it wrote a revision for, so they
  // are read alongside the update instead of after it.
  const [[update], pageRows] = await Promise.all([
    db
      .select({
        status: worldUpdates.status,
        report: worldUpdates.report,
        changes: worldUpdates.changes,
      })
      .from(worldUpdates)
      .where(eq(worldUpdates.sessionId, sessionId))
      .limit(1),
    db
      .select({
        id: worldPages.id,
        slug: worldPages.slug,
        kind: worldPages.kind,
        avatarId: worldPages.avatarId,
      })
      .from(worldPages)
      .where(
        inArray(
          worldPages.id,
          db
            .select({ id: worldPageRevisions.pageId })
            .from(worldPageRevisions)
            .where(eq(worldPageRevisions.sessionId, sessionId)),
        ),
      ),
  ]);
  if (!update) return { status: null, report: null, pages: [] };

  let changes = update.changes;
  if (!changes && update.status === "done") {
    changes = await computeSessionWorldChanges(sessionId);
    await db
      .update(worldUpdates)
      .set({ changes })
      .where(and(eq(worldUpdates.sessionId, sessionId), isNull(worldUpdates.changes)));
  }
  const pagesById = new Map(pageRows.map((row) => [row.id, row]));
  const pages = (changes ?? []).flatMap(({ pageId, ...change }): WorldPageChange[] => {
    const page = pagesById.get(pageId);
    return page ? [{ ...change, slug: page.slug, kind: page.kind, avatarId: page.avatarId }] : [];
  });

  return {
    status: update.status,
    report: update.report,
    pages: pages.toSorted(
      (a, b) => Number(b.created) - Number(a.created) || a.name.localeCompare(b.name),
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

// Moves other names that turned out to be references, on every revision of
// each page, for names stored before pages had references. Returns how many
// revisions changed.
export async function moveAliasesToReferences(
  campaignId: string,
  bySlug: Map<string, string[]>,
): Promise<number> {
  if (bySlug.size === 0) return 0;
  return db.transaction(async (tx) => {
    await lockWorld(tx, campaignId);
    const revisions = await tx
      .select({
        id: worldPageRevisions.id,
        slug: worldPages.slug,
        content: worldPageRevisions.content,
      })
      .from(worldPageRevisions)
      .innerJoin(worldPages, eq(worldPageRevisions.pageId, worldPages.id))
      .where(
        and(eq(worldPages.campaignId, campaignId), inArray(worldPages.slug, [...bySlug.keys()])),
      );
    let changed = 0;
    for (const revision of revisions) {
      const keys = new Set((bySlug.get(revision.slug) ?? []).map(nameKey));
      const moving = revision.content.aliases.filter((alias) => keys.has(nameKey(alias)));
      if (!moving.length) continue;
      const content = structuredClone(revision.content);
      addPageNames(content, [], moving);
      await tx
        .update(worldPageRevisions)
        .set({ content })
        .where(eq(worldPageRevisions.id, revision.id));
      changed += 1;
    }
    return changed;
  });
}
