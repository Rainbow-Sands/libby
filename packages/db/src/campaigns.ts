import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "./client.ts";
import { guilds, users, campaigns, campaignMembers } from "./schema.ts";

interface DiscordUser {
  id: string;
  username: string;
}

interface DiscordGuild {
  id: string;
  name: string;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The secret part of a campaign's join link.
function newInviteCode(): string {
  return randomBytes(12).toString("base64url");
}

async function upsertUserIn(tx: Transaction, user: DiscordUser): Promise<void> {
  await tx
    .insert(users)
    .values({ id: user.id, username: user.username })
    .onConflictDoUpdate({
      target: users.id,
      set: { username: user.username, updatedAt: new Date() },
    });
}

async function upsertGuildIn(tx: Transaction, guild: DiscordGuild): Promise<void> {
  await tx
    .insert(guilds)
    .values({ id: guild.id, name: guild.name })
    .onConflictDoUpdate({
      target: guilds.id,
      set: { name: guild.name, updatedAt: new Date() },
    });
}

// Records a web sign-in, so people who only use the web app have a user row
// before any bot command has seen them.
export async function recordUserSignIn(user: DiscordUser): Promise<void> {
  const now = new Date();
  await db
    .insert(users)
    .values({ id: user.id, username: user.username, lastSeenAt: now })
    .onConflictDoUpdate({
      target: users.id,
      set: { username: user.username, lastSeenAt: now, updatedAt: now },
    });
}

export interface CreateCampaignInput {
  name: string;
  description?: string | null;
  dm: DiscordUser;
  // Campaigns made in the web app start without a server.
  guild?: DiscordGuild | null;
}

export async function createCampaign(input: CreateCampaignInput): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    if (input.guild) await upsertGuildIn(tx, input.guild);
    await upsertUserIn(tx, input.dm);

    const [campaign] = await tx
      .insert(campaigns)
      .values({
        guildId: input.guild?.id ?? null,
        name: input.name,
        description: input.description ?? null,
        inviteCode: newInviteCode(),
      })
      .returning({ id: campaigns.id });

    await tx.insert(campaignMembers).values({
      campaignId: campaign.id,
      userId: input.dm.id,
      role: "dm",
      recapRotation: false,
    });

    return campaign;
  });
}

export interface CampaignSettings {
  id: string;
  name: string;
  description: string | null;
  inviteCode: string | null;
  guildName: string | null;
}

export async function getCampaignSettings(campaignId: string): Promise<CampaignSettings | null> {
  const [row] = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      description: campaigns.description,
      inviteCode: campaigns.inviteCode,
      guildName: guilds.name,
    })
    .from(campaigns)
    .leftJoin(guilds, eq(campaigns.guildId, guilds.id))
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return row ?? null;
}

export async function updateCampaignDetails(
  campaignId: string,
  details: { name: string; description: string | null },
): Promise<void> {
  await db
    .update(campaigns)
    .set({ ...details, updatedAt: new Date() })
    .where(eq(campaigns.id, campaignId));
}

// Campaigns made before join links existed get their code on first use.
export async function ensureCampaignInviteCode(campaignId: string): Promise<string | null> {
  await db
    .update(campaigns)
    .set({ inviteCode: newInviteCode() })
    .where(and(eq(campaigns.id, campaignId), isNull(campaigns.inviteCode)));
  const [row] = await db
    .select({ inviteCode: campaigns.inviteCode })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return row?.inviteCode ?? null;
}

// Replaces the join link; the old one stops working. Returns the new code.
export async function resetCampaignInviteCode(campaignId: string): Promise<string> {
  const inviteCode = newInviteCode();
  await db
    .update(campaigns)
    .set({ inviteCode, updatedAt: new Date() })
    .where(eq(campaigns.id, campaignId));
  return inviteCode;
}

export interface CampaignInvite {
  campaignId: string;
  name: string;
  dmName: string | null;
  members: { id: string; username: string; role: "dm" | "player" }[];
}

export async function getCampaignInvite(inviteCode: string): Promise<CampaignInvite | null> {
  const [campaign] = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.inviteCode, inviteCode))
    .limit(1);
  if (!campaign) return null;

  const members = await db
    .select({ id: users.id, username: users.username, role: campaignMembers.role })
    .from(campaignMembers)
    .innerJoin(users, eq(campaignMembers.userId, users.id))
    .where(eq(campaignMembers.campaignId, campaign.id))
    .orderBy(asc(campaignMembers.joinedAt));

  return {
    campaignId: campaign.id,
    name: campaign.name,
    dmName: members.find((member) => member.role === "dm")?.username ?? null,
    members,
  };
}

export interface LinkableCampaign {
  id: string;
  name: string;
}

// Campaigns the user runs as DM that no Discord server has claimed yet.
export async function getUnlinkedCampaignsForDm(userId: string): Promise<LinkableCampaign[]> {
  return db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .innerJoin(
      campaignMembers,
      and(
        eq(campaignMembers.campaignId, campaigns.id),
        eq(campaignMembers.userId, userId),
        eq(campaignMembers.role, "dm"),
      ),
    )
    .where(isNull(campaigns.guildId))
    .orderBy(campaigns.name);
}

export type LinkCampaignResult = "linked" | "not-found" | "not-dm" | "already-linked";

// Attaches an unlinked campaign to a Discord server. Only its DM can, and a
// campaign that already belongs to a server stays where it is.
export async function linkCampaignToGuild(
  campaignId: string,
  userId: string,
  guild: DiscordGuild,
): Promise<LinkCampaignResult> {
  return db.transaction(async (tx) => {
    const [campaign] = await tx
      .select({ guildId: campaigns.guildId })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .for("update");
    if (!campaign) return "not-found";

    const [dm] = await tx
      .select({ userId: campaignMembers.userId })
      .from(campaignMembers)
      .where(and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.role, "dm")));
    if (dm?.userId !== userId) return "not-dm";
    if (campaign.guildId) return "already-linked";

    await upsertGuildIn(tx, guild);
    await tx
      .update(campaigns)
      .set({ guildId: guild.id, updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId));
    return "linked";
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
    await upsertUserIn(tx, input.user);

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

// Joins a campaign through its invite link. Someone who is already a member
// keeps their role and character. Returns false in that case.
export async function joinCampaign(
  campaignId: string,
  userId: string,
  characterName: string,
): Promise<boolean> {
  const joined = await db
    .insert(campaignMembers)
    .values({ campaignId, userId, role: "player", characterName })
    .onConflictDoNothing()
    .returning({ userId: campaignMembers.userId });
  return joined.length > 0;
}

// Renames a player's character. The DM has no character.
export async function setCharacterName(
  campaignId: string,
  userId: string,
  characterName: string,
): Promise<boolean> {
  const updated = await db
    .update(campaignMembers)
    .set({ characterName })
    .where(
      and(
        eq(campaignMembers.campaignId, campaignId),
        eq(campaignMembers.userId, userId),
        eq(campaignMembers.role, "player"),
      ),
    )
    .returning({ userId: campaignMembers.userId });
  return updated.length > 0;
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
