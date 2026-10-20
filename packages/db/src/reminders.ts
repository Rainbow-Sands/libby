import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "./client.ts";
import { campaignReminders, campaigns } from "./schema.ts";

export interface CampaignReminderSchedule {
  dayOfWeek: number;
  minuteOfDay: number;
  timeZone: string;
}

export interface SetCampaignReminderInput extends CampaignReminderSchedule {
  campaignId: string;
  channelId: string;
  nextSessionAt: Date;
}

export interface CampaignReminder extends CampaignReminderSchedule {
  campaignId: string;
  campaignName: string;
  channelId: string;
  nextSessionAt: Date;
}

// Each campaign has at most one reminder configuration; setting it again
// replaces the schedule, channel and pending occurrence.
export async function setCampaignReminder(input: SetCampaignReminderInput): Promise<void> {
  const values = {
    channelId: input.channelId,
    dayOfWeek: input.dayOfWeek,
    minuteOfDay: input.minuteOfDay,
    timeZone: input.timeZone,
    nextSessionAt: input.nextSessionAt,
  };
  await db
    .insert(campaignReminders)
    .values({ campaignId: input.campaignId, ...values })
    .onConflictDoUpdate({
      target: campaignReminders.campaignId,
      set: { ...values, updatedAt: new Date() },
    });
}

export async function getCampaignReminder(campaignId: string): Promise<CampaignReminder | null> {
  const [row] = await selectReminders().where(eq(campaignReminders.campaignId, campaignId));
  return row ?? null;
}

// Reminders whose session starts at or before `until`.
export async function getDueCampaignReminders(until: Date): Promise<CampaignReminder[]> {
  return selectReminders()
    .where(lte(campaignReminders.nextSessionAt, until))
    .orderBy(asc(campaignReminders.nextSessionAt));
}

// Advances a reminder past the occurrence it was read at. Returns false when the
// reminder was already claimed or reconfigured, so each occurrence is sent at
// most once even if several pollers overlap.
export async function claimCampaignReminder(
  campaignId: string,
  occurrence: Date,
  nextSessionAt: Date,
): Promise<boolean> {
  const claimed = await db
    .update(campaignReminders)
    .set({ nextSessionAt, updatedAt: new Date() })
    .where(
      and(
        eq(campaignReminders.campaignId, campaignId),
        eq(campaignReminders.nextSessionAt, occurrence),
      ),
    )
    .returning({ campaignId: campaignReminders.campaignId });
  return claimed.length > 0;
}

function selectReminders() {
  return db
    .select({
      campaignId: campaignReminders.campaignId,
      campaignName: campaigns.name,
      channelId: campaignReminders.channelId,
      dayOfWeek: campaignReminders.dayOfWeek,
      minuteOfDay: campaignReminders.minuteOfDay,
      timeZone: campaignReminders.timeZone,
      nextSessionAt: campaignReminders.nextSessionAt,
    })
    .from(campaignReminders)
    .innerJoin(campaigns, eq(campaignReminders.campaignId, campaigns.id))
    .$dynamic();
}
