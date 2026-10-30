import { and, asc, eq, inArray, lte, notInArray, sql } from "drizzle-orm";
import { db } from "./client.ts";
import type { CampaignReminderSchedule } from "./schedule.ts";
import { campaignMembers, campaignReminders, campaigns, users } from "./schema.ts";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface CampaignReminder {
  campaignId: string;
  campaignName: string;
  channelId: string;
  channelName: string | null;
  schedule: CampaignReminderSchedule | null;
  nextSessionAt: Date | null;
  // Who is on recap duty for the session at recapSessionAt, once assigned.
  recapUserId: string | null;
  recapSessionAt: Date | null;
}

export interface DueCampaignReminder extends CampaignReminder {
  schedule: CampaignReminderSchedule;
  nextSessionAt: Date;
}

export interface SetReminderChannelInput {
  campaignId: string;
  channelId: string;
  channelName: string | null;
}

// Each campaign has at most one reminder configuration. Running /reminder again
// moves it to the new channel and keeps the schedule.
export async function setCampaignReminderChannel(input: SetReminderChannelInput): Promise<void> {
  const values = { channelId: input.channelId, channelName: input.channelName };
  await db
    .insert(campaignReminders)
    .values({ campaignId: input.campaignId, ...values })
    .onConflictDoUpdate({
      target: campaignReminders.campaignId,
      set: { ...values, updatedAt: new Date() },
    });
}

// Replaces the weekly schedule and its pending occurrence. Returns false when
// the campaign has no reminder channel yet.
export async function setCampaignReminderSchedule(
  campaignId: string,
  schedule: CampaignReminderSchedule,
  nextSessionAt: Date,
): Promise<boolean> {
  const updated = await db
    .update(campaignReminders)
    .set({ ...schedule, nextSessionAt, updatedAt: new Date() })
    .where(eq(campaignReminders.campaignId, campaignId))
    .returning({ campaignId: campaignReminders.campaignId });
  return updated.length > 0;
}

export async function getCampaignReminder(campaignId: string): Promise<CampaignReminder | null> {
  const [row] = await selectReminders().where(eq(campaignReminders.campaignId, campaignId));
  return row ? toReminder(row) : null;
}

export async function getCampaignRemindersForChannel(
  channelId: string,
): Promise<CampaignReminder[]> {
  const rows = await selectReminders().where(eq(campaignReminders.channelId, channelId));
  return rows.map(toReminder);
}

// Reminders whose session starts at or before `until`.
export async function getDueCampaignReminders(until: Date): Promise<DueCampaignReminder[]> {
  const rows = await selectReminders()
    .where(lte(campaignReminders.nextSessionAt, until))
    .orderBy(asc(campaignReminders.nextSessionAt));
  return rows.map(toReminder).filter((r): r is DueCampaignReminder => r.schedule !== null);
}

export type ClaimedReminder = { claimed: false } | { claimed: true; recapUserId: string | null };

// Advances a reminder past the occurrence it was read at and, when
// `assignRecap` is set, assigns recap duty for that occurrence. Returns claimed: false when the reminder was already
// claimed or rescheduled, so each occurrence is handled at most once even if
// several pollers overlap.
export async function claimCampaignReminder(
  campaignId: string,
  occurrence: Date,
  nextSessionAt: Date,
  assignRecap: boolean,
): Promise<ClaimedReminder> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(campaignReminders)
      .set({ nextSessionAt, updatedAt: new Date() })
      .where(
        and(
          eq(campaignReminders.campaignId, campaignId),
          eq(campaignReminders.nextSessionAt, occurrence),
        ),
      )
      .returning({ campaignId: campaignReminders.campaignId });
    if (claimed.length === 0) return { claimed: false };

    if (!assignRecap) return { claimed: true, recapUserId: null };
    const recapUserId = await assignRecapper(tx, campaignId, occurrence, []);
    return { claimed: true, recapUserId };
  });
}

export type SkipRecapperResult =
  | { status: "no-recapper" }
  | { status: "skipped"; skippedUserId: string; recapUserId: string | null };

// Takes recap duty away from the current recapper and gives it to whoever
// recapped least recently among those not yet skipped for that session. The
// skipped member's previous recap date is restored, so they go first next time.
export async function skipCampaignRecapper(campaignId: string): Promise<SkipRecapperResult> {
  return db.transaction(async (tx) => {
    const [reminder] = await tx
      .select({
        recapUserId: campaignReminders.recapUserId,
        recapSessionAt: campaignReminders.recapSessionAt,
        recapPreviousAt: campaignReminders.recapPreviousAt,
        recapSkippedUserIds: campaignReminders.recapSkippedUserIds,
      })
      .from(campaignReminders)
      .where(eq(campaignReminders.campaignId, campaignId))
      .for("update");
    if (!reminder?.recapUserId || !reminder.recapSessionAt) return { status: "no-recapper" };

    const skippedUserId = reminder.recapUserId;
    await tx
      .update(campaignMembers)
      .set({ lastRecappedAt: reminder.recapPreviousAt })
      .where(
        and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, skippedUserId)),
      );

    const skipped = [...reminder.recapSkippedUserIds, skippedUserId];
    const recapUserId = await assignRecapper(tx, campaignId, reminder.recapSessionAt, skipped);
    return { status: "skipped", skippedUserId, recapUserId };
  });
}

// Picks the rotation member who recapped least recently (never first, then by
// join order), records the session as their latest recap, and stores enough on
// the reminder to undo it with a skip. Returns null when nobody is eligible.
async function assignRecapper(
  tx: Transaction,
  campaignId: string,
  sessionAt: Date,
  skippedUserIds: string[],
): Promise<string | null> {
  const conditions = [
    eq(campaignMembers.campaignId, campaignId),
    eq(campaignMembers.recapRotation, true),
  ];
  if (skippedUserIds.length > 0) {
    conditions.push(notInArray(campaignMembers.userId, skippedUserIds));
  }
  const [next] = await tx
    .select({ userId: campaignMembers.userId, lastRecappedAt: campaignMembers.lastRecappedAt })
    .from(campaignMembers)
    .where(and(...conditions))
    .orderBy(...recapOrder())
    .limit(1);

  if (next) {
    await tx
      .update(campaignMembers)
      .set({ lastRecappedAt: sessionAt })
      .where(
        and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, next.userId)),
      );
  }

  await tx
    .update(campaignReminders)
    .set({
      recapUserId: next?.userId ?? null,
      recapSessionAt: sessionAt,
      recapPreviousAt: next?.lastRecappedAt ?? null,
      recapSkippedUserIds: skippedUserIds,
      updatedAt: new Date(),
    })
    .where(eq(campaignReminders.campaignId, campaignId));

  return next?.userId ?? null;
}

function recapOrder() {
  return [
    sql`${campaignMembers.lastRecappedAt} asc nulls first`,
    asc(campaignMembers.joinedAt),
    asc(campaignMembers.userId),
  ];
}

export interface RecapRotationMember {
  userId: string;
  username: string;
  role: "dm" | "player";
  characterName: string | null;
  inRotation: boolean;
  lastRecappedAt: Date | null;
}

// Every campaign member in the order recap duty would reach them.
export async function getRecapRotation(campaignId: string): Promise<RecapRotationMember[]> {
  return db
    .select({
      userId: campaignMembers.userId,
      username: users.username,
      role: campaignMembers.role,
      characterName: campaignMembers.characterName,
      inRotation: campaignMembers.recapRotation,
      lastRecappedAt: campaignMembers.lastRecappedAt,
    })
    .from(campaignMembers)
    .innerJoin(users, eq(campaignMembers.userId, users.id))
    .where(eq(campaignMembers.campaignId, campaignId))
    .orderBy(...recapOrder());
}

// Puts exactly `userIds` on the recap rotation; every other member is taken off.
export async function setRecapRotation(campaignId: string, userIds: string[]): Promise<void> {
  await db
    .update(campaignMembers)
    .set({
      recapRotation: userIds.length > 0 ? inArray(campaignMembers.userId, userIds) : sql`false`,
    })
    .where(eq(campaignMembers.campaignId, campaignId));
}

function selectReminders() {
  return db
    .select({
      campaignId: campaignReminders.campaignId,
      campaignName: campaigns.name,
      channelId: campaignReminders.channelId,
      channelName: campaignReminders.channelName,
      dayOfWeek: campaignReminders.dayOfWeek,
      minuteOfDay: campaignReminders.minuteOfDay,
      timeZone: campaignReminders.timeZone,
      nextSessionAt: campaignReminders.nextSessionAt,
      recapUserId: campaignReminders.recapUserId,
      recapSessionAt: campaignReminders.recapSessionAt,
    })
    .from(campaignReminders)
    .innerJoin(campaigns, eq(campaignReminders.campaignId, campaigns.id))
    .$dynamic();
}

type ReminderRow = Awaited<ReturnType<ReturnType<typeof selectReminders>["execute"]>>[number];

function toReminder(row: ReminderRow): CampaignReminder {
  const { dayOfWeek, minuteOfDay, timeZone, ...rest } = row;
  const schedule =
    dayOfWeek !== null && minuteOfDay !== null && timeZone !== null
      ? { dayOfWeek, minuteOfDay, timeZone }
      : null;
  return { ...rest, schedule };
}
