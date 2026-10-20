import type { Client } from "discord.js";
import {
  claimCampaignReminder,
  getCampaignCast,
  getDueCampaignReminders,
  type CampaignReminder,
} from "@rainbot/db";
import { nextSessionAfter } from "./reminder-schedule.ts";

export const REMINDER_LEAD_MS = 60 * 60_000;
const POLL_INTERVAL_MS = 60_000;

// Polls Postgres for sessions starting within the reminder lead time and posts
// one reminder per occurrence. The schedule lives in the database, so reminders
// survive restarts; occurrences that passed while the bot was down are skipped.
export function startReminderScheduler(bot: Client): void {
  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      await sendDueReminders(bot, new Date());
    } catch (err) {
      console.error("[reminders] poll failed:", err);
    } finally {
      polling = false;
    }
  };
  setInterval(poll, POLL_INTERVAL_MS);
  void poll();
}

async function sendDueReminders(bot: Client, now: Date): Promise<void> {
  const due = await getDueCampaignReminders(new Date(now.getTime() + REMINDER_LEAD_MS));
  for (const reminder of due) {
    const occurrence = reminder.nextSessionAt;
    const next = nextSessionAfter(reminder, occurrence > now ? occurrence : now);
    // Claim before sending so a reminder is posted at most once.
    if (!(await claimCampaignReminder(reminder.campaignId, occurrence, next))) continue;

    if (occurrence <= now) {
      console.warn(
        `[reminders] skipped reminder for campaign ${reminder.campaignId}: ` +
          `session at ${occurrence.toISOString()} already started`,
      );
      continue;
    }

    try {
      await postReminder(bot, reminder, occurrence);
    } catch (err) {
      console.error(`[reminders] failed to post reminder for ${reminder.campaignId}:`, err);
    }
  }
}

async function postReminder(
  bot: Client,
  reminder: CampaignReminder,
  sessionAt: Date,
): Promise<void> {
  const channel = await bot.channels.fetch(reminder.channelId);
  if (!channel?.isSendable()) {
    throw new Error(`Channel ${reminder.channelId} is not available for messages`);
  }

  const players = await getCampaignCast(reminder.campaignId);
  const playerIds = players.map((p) => p.userId);
  const timestamp = Math.floor(sessionAt.getTime() / 1000);
  const lines = [`⏰ The next **${reminder.campaignName}** session starts <t:${timestamp}:R>.`];
  if (playerIds.length > 0) lines.push(playerIds.map((id) => `<@${id}>`).join(" "));

  await channel.send({
    content: lines.join("\n"),
    allowedMentions: { users: playerIds },
  });
}
