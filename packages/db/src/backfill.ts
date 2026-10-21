import { and, asc, desc, eq, exists, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "./client.ts";
import { sessionArtifacts, sessions, worldUpdates } from "./schema.ts";

export type BackfillStep =
  | { kind: "waiting"; sessionId: string }
  | { kind: "world"; sessionId: string }
  | { kind: "next"; sessionId: string }
  | { kind: "finished" };

// Sessions are backfilled oldest first and one at a time, because each recap
// reads the previous session's open threads and "where we left off". While any
// session in the campaign is processing, the backfill waits for it. A session
// whose regeneration fails ends up "failed" rather than "done", so the next
// step moves past it instead of retrying it forever. Each recap also reads
// the world as it stood before its session, so the backfill waits for the
// world to apply every earlier session first.
export async function nextBackfillStep(campaignId: string): Promise<BackfillStep> {
  const [active] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.campaignId, campaignId), isNotNull(sessions.activeRunId)))
    .limit(1);
  if (active) return { kind: "waiting", sessionId: active.id };

  const [next] = await db
    .select({ id: sessions.id, startedAt: sessions.startedAt })
    .from(sessions)
    .where(
      and(
        eq(sessions.campaignId, campaignId),
        eq(sessions.status, "done"),
        isNull(sessions.recapSections),
        exists(
          db
            .select({ id: sessionArtifacts.id })
            .from(sessionArtifacts)
            .where(
              and(
                eq(sessionArtifacts.sessionId, sessions.id),
                eq(sessionArtifacts.kind, "transcript"),
                eq(sessionArtifacts.isCurrent, true),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(sessions.startedAt))
    .limit(1);
  if (!next) return { kind: "finished" };

  const behind = await sessionBehindWorld(campaignId, next.startedAt);
  if (behind) return { kind: "world", sessionId: behind };
  return { kind: "next", sessionId: next.id };
}

// The oldest finished session before `before` that the world will still
// apply. Like nextWorldStep, only sessions newer than the newest one the
// world has settled count, so a session the world skipped never blocks.
async function sessionBehindWorld(campaignId: string, before: Date): Promise<string | null> {
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
    lt(sessions.startedAt, before),
    sql`not exists (
      select 1 from ${worldUpdates}
      where ${worldUpdates.sessionId} = ${sessions.id} and ${worldUpdates.status} <> 'pending'
    )`,
  ];
  if (latest) conditions.push(gt(sessions.startedAt, latest.startedAt));
  const [behind] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(...conditions))
    .orderBy(asc(sessions.startedAt))
    .limit(1);
  return behind?.id ?? null;
}
