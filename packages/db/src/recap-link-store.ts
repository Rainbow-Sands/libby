import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "./client.ts";
import {
  sessions,
  worldPages,
  worldRecapLinkRuns,
  worldRecapLinks,
  worldUpdates,
} from "./schema.ts";
import type { RecapSections } from "./session-notes.ts";
import { recapLinkSentences, type RecapLink } from "./world-links.ts";

// A session's recap is linked to the world after the world update for that
// session has settled, so the pages it introduced exist and the world as of the
// session is final.

const currentHash = sql<string>`md5(${sessions.recapSections}::text)`;

export type RecapLinkStep =
  | {
      kind: "next";
      sessionId: string;
      startedAt: Date;
      recapSections: RecapSections;
      // Which version of the recap is being linked.
      recapHash: string;
    }
  | { kind: "finished" };

// The oldest session whose recap has no links for its current text. A recap
// that failed to link is not retried until it changes or is cleared.
export async function nextRecapLinkStep(campaignId: string): Promise<RecapLinkStep> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      startedAt: sessions.startedAt,
      recapSections: sessions.recapSections,
      recapHash: currentHash,
    })
    .from(sessions)
    .innerJoin(worldUpdates, eq(worldUpdates.sessionId, sessions.id))
    .leftJoin(worldRecapLinkRuns, eq(worldRecapLinkRuns.sessionId, sessions.id))
    .where(
      and(
        eq(sessions.campaignId, campaignId),
        isNotNull(sessions.recapSections),
        inArray(worldUpdates.status, ["done", "skipped", "failed"]),
        or(
          sql`${worldRecapLinkRuns.sessionId} is null`,
          sql`${worldRecapLinkRuns.recapHash} <> ${currentHash}`,
        ),
      ),
    )
    .orderBy(asc(sessions.startedAt))
    .limit(1);
  if (!row?.recapSections) return { kind: "finished" };
  return {
    kind: "next",
    sessionId: row.sessionId,
    startedAt: row.startedAt,
    recapSections: row.recapSections.sections,
    recapHash: row.recapHash,
  };
}

export interface StoredRecapLink extends RecapLink {
  pageId: string;
}

// Replaces a session's links. Returns false, writing nothing, when the recap
// changed while it was being linked; the next step links the new text.
export async function recordRecapLinks(
  campaignId: string,
  sessionId: string,
  recapHash: string,
  sections: RecapSections,
  links: StoredRecapLink[],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ hash: currentHash })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .for("update");
    if (session?.hash !== recapHash) return false;

    const sentences = recapLinkSentences(sections, links);
    await tx.delete(worldRecapLinks).where(eq(worldRecapLinks.sessionId, sessionId));
    if (links.length) {
      await tx.insert(worldRecapLinks).values(
        links.map((link, position) => ({
          sessionId,
          pageId: link.pageId,
          field: link.field,
          phrase: link.phrase,
          occurrence: link.occurrence,
          position,
          sentence: sentences[position],
        })),
      );
    }
    await upsertRun(tx, { sessionId, campaignId, recapHash, status: "done", error: null });
    return true;
  });
}

export async function recordRecapLinkFailure(
  campaignId: string,
  sessionId: string,
  recapHash: string,
  message: string,
): Promise<void> {
  await upsertRun(db, { sessionId, campaignId, recapHash, status: "failed", error: message });
}

async function upsertRun(
  queryable: Pick<typeof db, "insert">,
  values: typeof worldRecapLinkRuns.$inferInsert,
): Promise<void> {
  await queryable
    .insert(worldRecapLinkRuns)
    .values(values)
    .onConflictDoUpdate({
      target: worldRecapLinkRuns.sessionId,
      set: {
        recapHash: values.recapHash,
        status: values.status,
        error: values.error,
        updatedAt: new Date(),
      },
    });
}

// Forgets every recap link run of the campaigns, so the next linking chain
// links each recap again from scratch.
export async function clearRecapLinkRuns(campaignIds: string[]): Promise<void> {
  if (!campaignIds.length) return;
  await db.delete(worldRecapLinkRuns).where(inArray(worldRecapLinkRuns.campaignId, campaignIds));
}

// A session's links, only while they match its recap as it reads now. A recap
// that has not been linked shows no links rather than guessed ones.
export async function getSessionRecapLinks(sessionId: string): Promise<RecapLink[]> {
  const rows = await db
    .select({
      field: worldRecapLinks.field,
      phrase: worldRecapLinks.phrase,
      occurrence: worldRecapLinks.occurrence,
      slug: worldPages.slug,
    })
    .from(worldRecapLinks)
    .innerJoin(worldPages, eq(worldRecapLinks.pageId, worldPages.id))
    .innerJoin(sessions, eq(worldRecapLinks.sessionId, sessions.id))
    .innerJoin(worldRecapLinkRuns, eq(worldRecapLinkRuns.sessionId, sessions.id))
    .where(
      and(eq(worldRecapLinks.sessionId, sessionId), eq(worldRecapLinkRuns.recapHash, currentHash)),
    )
    .orderBy(asc(worldRecapLinks.position));
  return rows;
}
