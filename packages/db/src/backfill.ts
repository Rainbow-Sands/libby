import { and, asc, eq, exists, isNotNull, isNull } from "drizzle-orm";
import { db } from "./client.ts";
import { sessionArtifacts, sessions } from "./schema.ts";

export type BackfillStep =
  | { kind: "waiting"; sessionId: string }
  | { kind: "next"; sessionId: string }
  | { kind: "finished" };

// Sessions are backfilled oldest first and one at a time, because each recap
// reads the previous session's open threads and "where we left off". While any
// session in the campaign is processing, the backfill waits for it. A session
// whose regeneration fails ends up "failed" rather than "done", so the next
// step moves past it instead of retrying it forever.
export async function nextBackfillStep(campaignId: string): Promise<BackfillStep> {
  const [active] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.campaignId, campaignId), isNotNull(sessions.activeRunId)))
    .limit(1);
  if (active) return { kind: "waiting", sessionId: active.id };

  const [next] = await db
    .select({ id: sessions.id })
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
  return next ? { kind: "next", sessionId: next.id } : { kind: "finished" };
}
