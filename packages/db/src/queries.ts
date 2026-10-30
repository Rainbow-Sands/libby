import { and, desc, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "./client.ts";
import type { SessionArtifactKind, SessionArtifactRef } from "./artifacts.ts";
import type { CampaignAccessRole, CampaignMemberRole, SessionStatus } from "./domain.ts";
import { campaigns, campaignMembers, sessionArtifacts, sessions, users } from "./schema.ts";
import type { SessionRecap } from "./session-notes.ts";

export async function getCampaignsForGuild(guildId: string) {
  return db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.guildId, guildId))
    .orderBy(campaigns.name);
}

export async function listCampaigns() {
  return db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .orderBy(campaigns.name);
}

export async function getCampaignsForUser(userId: string) {
  // Admins see every campaign; everyone else sees the ones they belong to.
  const admin = sql<boolean>`exists (
    select 1 from ${users} where ${users.id} = ${userId} and ${users.isAdmin} = true
  )`;
  return db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      role: sql<CampaignAccessRole>`case when ${admin} then 'admin' else ${campaignMembers.role} end`,
    })
    .from(campaigns)
    .leftJoin(
      campaignMembers,
      and(eq(campaignMembers.campaignId, campaigns.id), eq(campaignMembers.userId, userId)),
    )
    .where(or(admin, isNotNull(campaignMembers.userId)))
    .orderBy(campaigns.name);
}

export async function isAdmin(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.isAdmin ?? false;
}

export interface CampaignAccess {
  isAdmin: boolean;
  isMember: boolean;
  canAccess: boolean;
}

export async function getCampaignAccess(
  campaignId: string,
  userId: string,
): Promise<CampaignAccess> {
  const [access] = await db
    .select({
      isAdmin: sql<boolean>`exists (
        select 1 from ${users}
        where ${users.id} = ${userId} and ${users.isAdmin} = true
      )`,
      isMember: sql<boolean>`exists (
        select 1 from ${campaignMembers}
        where ${campaignMembers.campaignId} = ${campaignId}
          and ${campaignMembers.userId} = ${userId}
      )`,
    })
    .from(sql`(select 1) as access_source`);
  const admin = access?.isAdmin ?? false;
  const member = access?.isMember ?? false;
  return { isAdmin: admin, isMember: member, canAccess: admin || member };
}

export interface CampaignMember {
  id: string;
  username: string;
  role: CampaignMemberRole;
  characterName: string | null;
}

// Lightweight lookup for command authorization: which guild owns the campaign
// and who is its DM. Returns null if the campaign does not exist.
export async function getCampaignMeta(
  campaignId: string,
): Promise<{ guildId: string | null; dmId: string | null } | null> {
  const [[campaign], [dm]] = await Promise.all([
    db
      .select({ guildId: campaigns.guildId })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1),
    db
      .select({ userId: campaignMembers.userId })
      .from(campaignMembers)
      .where(and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.role, "dm")))
      .limit(1),
  ]);
  if (!campaign) return null;

  return { guildId: campaign.guildId, dmId: dm?.userId ?? null };
}

export interface CampaignCastMember {
  userId: string;
  username: string;
  characterName: string;
}

// The players of a campaign that have a character assigned, for building the
// transcript's cast legend. Keyed by userId so callers can align it with the
// speaker labels used in the transcript body.
export async function getCampaignCast(campaignId: string): Promise<CampaignCastMember[]> {
  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      characterName: campaignMembers.characterName,
    })
    .from(campaignMembers)
    .innerJoin(users, eq(campaignMembers.userId, users.id))
    .where(and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.role, "player")))
    .orderBy(users.username);

  return rows.filter((r): r is CampaignCastMember => r.characterName !== null);
}

export interface CampaignSessionSummary {
  id: string;
  title: string | null;
  status: SessionStatus;
  startedAt: Date;
  endedAt: Date | null;
}

export interface CampaignDetail {
  id: string;
  name: string;
  description: string | null;
  members: CampaignMember[];
  sessions: CampaignSessionSummary[];
}

export async function getCampaignDetail(campaignId: string): Promise<CampaignDetail | null> {
  const [[campaign], members, sessionRows] = await Promise.all([
    db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1),
    db
      .select({
        id: users.id,
        username: users.username,
        role: campaignMembers.role,
        characterName: campaignMembers.characterName,
      })
      .from(campaignMembers)
      .innerJoin(users, eq(campaignMembers.userId, users.id))
      .where(eq(campaignMembers.campaignId, campaignId))
      .orderBy(campaignMembers.joinedAt),
    db
      .select({
        id: sessions.id,
        title: sessions.title,
        status: sessions.status,
        startedAt: sessions.startedAt,
        endedAt: sessions.endedAt,
      })
      .from(sessions)
      .where(eq(sessions.campaignId, campaignId))
      .orderBy(desc(sessions.startedAt)),
  ]);
  if (!campaign) return null;

  return {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    members,
    sessions: sessionRows,
  };
}

export interface SessionDetail {
  id: string;
  campaignId: string;
  title: string | null;
  status: SessionStatus;
  startedAt: Date;
  endedAt: Date | null;
  transcriptArtifact: SessionArtifactRef | null;
  detailedRecordArtifact: SessionArtifactRef | null;
  ledgerArtifact: SessionArtifactRef | null;
  recap: string | null;
  recapSections: SessionRecap | null;
}

export async function getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  const [[session], artifacts] = await Promise.all([
    db
      .select({
        id: sessions.id,
        campaignId: sessions.campaignId,
        title: sessions.title,
        status: sessions.status,
        startedAt: sessions.startedAt,
        endedAt: sessions.endedAt,
        recap: sessions.recap,
        recapSections: sessions.recapSections,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1),
    db
      .select()
      .from(sessionArtifacts)
      .where(and(eq(sessionArtifacts.sessionId, sessionId), eq(sessionArtifacts.isCurrent, true))),
  ]);
  if (!session) return null;

  const toRef = (kind: SessionArtifactKind): SessionArtifactRef | null => {
    const artifact = artifacts.find((candidate) => candidate.kind === kind);
    return artifact
      ? {
          id: artifact.id,
          kind,
          bucket: artifact.bucket,
          objectKey: artifact.objectKey,
          contentType: artifact.contentType,
          formatVersion: artifact.formatVersion,
          byteSize: artifact.byteSize,
          sha256: artifact.sha256,
        }
      : null;
  };
  const transcriptArtifact = toRef("transcript");
  const detailedRecordArtifact = toRef("detailed_record");
  const ledgerArtifact = toRef("session_ledger");

  return {
    ...session,
    transcriptArtifact,
    detailedRecordArtifact,
    ledgerArtifact,
  };
}

export interface PreviousSessionNotes {
  title: string | null;
  startedAt: Date;
  recap: string | null;
  recapSections: SessionRecap | null;
}

// The most recent finished session in the same campaign that started before
// this one: its open threads and "where we left off" give the next session's
// inference the continuity a single transcript lacks.
export async function getPreviousSessionNotes(
  sessionId: string,
): Promise<PreviousSessionNotes | null> {
  const current = db
    .select({ campaignId: sessions.campaignId, startedAt: sessions.startedAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .as("current_session");
  const [previous] = await db
    .select({
      title: sessions.title,
      startedAt: sessions.startedAt,
      recap: sessions.recap,
      recapSections: sessions.recapSections,
    })
    .from(sessions)
    .innerJoin(
      current,
      and(eq(sessions.campaignId, current.campaignId), lt(sessions.startedAt, current.startedAt)),
    )
    .where(eq(sessions.status, "done"))
    .orderBy(desc(sessions.startedAt))
    .limit(1);
  return previous ?? null;
}

export async function getSessionStatus(sessionId: string): Promise<SessionStatus | null> {
  const [session] = await db
    .select({ status: sessions.status })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  return session?.status ?? null;
}
