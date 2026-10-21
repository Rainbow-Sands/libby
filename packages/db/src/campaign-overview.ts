import { count, eq, max } from "drizzle-orm";
import { db } from "./client.ts";
import { campaigns, sessions } from "./schema.ts";

export interface CampaignSessionStats {
  sessionCount: number;
  lastPlayedAt: Date | null;
}

// Session counts and the latest session date for every campaign, keyed by
// campaign id. It reads every campaign so it can run alongside the access
// query; callers keep only the campaigns the user can see.
export async function getCampaignSessionStats(): Promise<Map<string, CampaignSessionStats>> {
  const rows = await db
    .select({
      campaignId: sessions.campaignId,
      sessionCount: count(),
      lastPlayedAt: max(sessions.startedAt),
    })
    .from(sessions)
    .groupBy(sessions.campaignId);
  return new Map(
    rows.map((row) => [
      row.campaignId,
      { sessionCount: row.sessionCount, lastPlayedAt: row.lastPlayedAt },
    ]),
  );
}

export async function getCampaignName(campaignId: string): Promise<string | null> {
  const [campaign] = await db
    .select({ name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return campaign?.name ?? null;
}
