import { and, eq } from "drizzle-orm";
import { db } from "./client.ts";
import { guilds, users, campaigns, campaignMembers } from "./schema.ts";

interface DiscordUser {
  id: string;
  username: string;
}

export interface CreateCampaignInput {
  guildId: string;
  guildName: string;
  name: string;
  dm: DiscordUser;
}

export async function createCampaign(input: CreateCampaignInput): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    await tx
      .insert(guilds)
      .values({ id: input.guildId, name: input.guildName })
      .onConflictDoUpdate({
        target: guilds.id,
        set: { name: input.guildName, updatedAt: new Date() },
      });

    await tx
      .insert(users)
      .values({ id: input.dm.id, username: input.dm.username })
      .onConflictDoUpdate({
        target: users.id,
        set: { username: input.dm.username, updatedAt: new Date() },
      });

    const [campaign] = await tx
      .insert(campaigns)
      .values({ guildId: input.guildId, name: input.name })
      .returning({ id: campaigns.id });

    await tx.insert(campaignMembers).values({
      campaignId: campaign.id,
      userId: input.dm.id,
      role: "dm",
    });

    return campaign;
  });
}

export interface AddCampaignMemberInput {
  campaignId: string;
  user: DiscordUser;
  characterName: string;
}

// Adds (or re-adds) a player to a campaign. Re-running updates their character.
export async function addCampaignMember(input: AddCampaignMemberInput): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({ id: input.user.id, username: input.user.username })
      .onConflictDoUpdate({
        target: users.id,
        set: { username: input.user.username, updatedAt: new Date() },
      });

    await tx
      .insert(campaignMembers)
      .values({
        campaignId: input.campaignId,
        userId: input.user.id,
        role: "player",
        characterName: input.characterName,
      })
      .onConflictDoUpdate({
        target: [campaignMembers.campaignId, campaignMembers.userId],
        set: { role: "player", characterName: input.characterName },
      });
  });
}

// Removes a player from a campaign. Scoped to role 'player' so the DM, who owns
// the campaign, can never be removed by this command.
export async function removeCampaignMember(campaignId: string, userId: string): Promise<boolean> {
  const removed = await db
    .delete(campaignMembers)
    .where(
      and(
        eq(campaignMembers.campaignId, campaignId),
        eq(campaignMembers.userId, userId),
        eq(campaignMembers.role, "player"),
      ),
    )
    .returning({ userId: campaignMembers.userId });
  return removed.length > 0;
}
