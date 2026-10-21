import { error, fail, redirect } from "@sveltejs/kit";
import {
  REMINDER_LEAD_MS,
  WEEKDAYS,
  getCampaignAccess,
  getCampaignDetail,
  getCampaignMeta,
  getCampaignReminder,
  getRecapRotation,
  nextSessionAfter,
  normalizeTimeZone,
  parseTimeOfDay,
  setCampaignReminderSchedule,
  setRecapRotation,
} from "@rainbot/db";
import type { Actions, PageServerLoad } from "./$types";

// Only the campaign's DM (or an application admin) manages its schedule.
async function requireScheduleAccess(campaignId: string, userId: string): Promise<void> {
  const [meta, access] = await Promise.all([
    getCampaignMeta(campaignId),
    getCampaignAccess(campaignId, userId),
  ]);
  if (!meta) throw error(404, "Campaign not found.");
  if (meta.dmId !== userId && !access.isAdmin) {
    throw error(403, "Only the campaign's DM can manage its schedule.");
  }
}

function formatSessionTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

function formatClockTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/auth/login?returnTo=${encodeURIComponent(url.pathname)}`);
  }
  await requireScheduleAccess(params.id, locals.user.id);

  const [campaign, reminder, rotation] = await Promise.all([
    getCampaignDetail(params.id),
    getCampaignReminder(params.id),
    getRecapRotation(params.id),
  ]);
  if (!campaign) throw error(404, "Campaign not found.");

  const timeZone = reminder?.schedule?.timeZone;
  const nextSession =
    reminder?.nextSessionAt && timeZone
      ? {
          session: formatSessionTime(reminder.nextSessionAt, timeZone),
          reminder: formatClockTime(
            new Date(reminder.nextSessionAt.getTime() - REMINDER_LEAD_MS),
            timeZone,
          ),
        }
      : null;

  return {
    campaign: { id: campaign.id, name: campaign.name },
    reminder: reminder ? { channelName: reminder.channelName, schedule: reminder.schedule } : null,
    nextSession,
    rotation: rotation.map((member) => ({
      ...member,
      lastRecapped: member.lastRecappedAt
        ? member.lastRecappedAt.toLocaleDateString("en-US", {
            timeZone: timeZone ?? "UTC",
            month: "short",
            day: "numeric",
          })
        : null,
    })),
    weekdays: WEEKDAYS,
  };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    if (!locals.user) throw error(401, "Please log in to manage the schedule.");
    await requireScheduleAccess(params.id, locals.user.id);

    const formData = await request.formData();
    const dayOfWeek = Number(formData.get("day"));
    const minuteOfDay = parseTimeOfDay(String(formData.get("time") ?? ""));
    const timeZone = normalizeTimeZone(String(formData.get("timeZone") ?? ""));
    if (!Number.isInteger(dayOfWeek) || !WEEKDAYS[dayOfWeek]) {
      return fail(400, { message: "Pick the day of the week your group plays." });
    }
    if (minuteOfDay === null) return fail(400, { message: "Enter the session start time." });
    if (!timeZone) return fail(400, { message: "Pick a valid time zone." });

    const members = await getRecapRotation(params.id);
    const memberIds = new Set(members.map((member) => member.userId));
    const recapUserIds = formData
      .getAll("recap")
      .filter((id): id is string => typeof id === "string" && memberIds.has(id));

    const schedule = { dayOfWeek, minuteOfDay, timeZone };
    // The first session is the next one whose reminder is still ahead of us.
    const nextSessionAt = nextSessionAfter(schedule, new Date(Date.now() + REMINDER_LEAD_MS));
    const saved = await setCampaignReminderSchedule(params.id, schedule, nextSessionAt);
    if (!saved) {
      return fail(400, { message: "Run /reminder in Discord first to choose the channel." });
    }
    await setRecapRotation(params.id, recapUserIds);

    return { saved: true };
  },
};
