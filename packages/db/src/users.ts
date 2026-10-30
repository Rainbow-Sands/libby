import { eq, sql } from "drizzle-orm";
import { db } from "./client.ts";
import type { SubscriptionStatus } from "./domain.ts";
import { campaignMembers, users } from "./schema.ts";

// Creating a campaign takes an active subscription; admins can always.
export async function canCreateCampaigns(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ isAdmin: users.isAdmin, subscriptionStatus: users.subscriptionStatus })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return !!user && (user.isAdmin || user.subscriptionStatus === "active");
}

export interface AdminUserSummary {
  id: string;
  username: string;
  isAdmin: boolean;
  subscriptionStatus: SubscriptionStatus;
  lastSeenAt: Date | null;
  createdAt: Date;
  dmCount: number;
  playerCount: number;
}

export async function listUsersForAdmin(): Promise<AdminUserSummary[]> {
  return db
    .select({
      id: users.id,
      username: users.username,
      isAdmin: users.isAdmin,
      subscriptionStatus: users.subscriptionStatus,
      lastSeenAt: users.lastSeenAt,
      createdAt: users.createdAt,
      dmCount: sql<number>`count(*) filter (where ${campaignMembers.role} = 'dm')::int`,
      playerCount: sql<number>`count(*) filter (where ${campaignMembers.role} = 'player')::int`,
    })
    .from(users)
    .leftJoin(campaignMembers, eq(campaignMembers.userId, users.id))
    .groupBy(users.id)
    .orderBy(sql`${users.lastSeenAt} desc nulls last`, users.username);
}

export async function setSubscriptionStatus(
  userId: string,
  subscriptionStatus: SubscriptionStatus,
): Promise<boolean> {
  const updated = await db
    .update(users)
    .set({ subscriptionStatus, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return updated.length > 0;
}
