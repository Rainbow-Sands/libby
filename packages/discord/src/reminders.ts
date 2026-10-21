import type { Client } from "discord.js";
import {
  claimCampaignReminder,
  getCampaignCast,
  getDueCampaignReminders,
  nextSessionAfter,
  REMINDER_LEAD_MS,
  type CampaignReminder,
} from "@rainbot/db";

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
    const next = nextSessionAfter(reminder.schedule, occurrence > now ? occurrence : now);
    // Claim before sending so a reminder is posted at most once. Claiming also
    // assigns recap duty, unless the session started while the bot was down.
    const started = occurrence <= now;
    const claim = await claimCampaignReminder(reminder.campaignId, occurrence, next, !started);
    if (!claim.claimed) continue;

    if (started) {
      console.warn(
        `[reminders] skipped reminder for campaign ${reminder.campaignId}: ` +
          `session at ${occurrence.toISOString()} already started`,
      );
      continue;
    }

    try {
      await postReminder(bot, reminder, occurrence, claim.recapUserId);
    } catch (err) {
      console.error(`[reminders] failed to post reminder for ${reminder.campaignId}:`, err);
    }
  }
}

async function postReminder(
  bot: Client,
  reminder: CampaignReminder,
  sessionAt: Date,
  recapUserId: string | null,
): Promise<void> {
  const channel = await bot.channels.fetch(reminder.channelId);
  if (!channel?.isSendable()) {
    throw new Error(`Channel ${reminder.channelId} is not available for messages`);
  }

  const players = await getCampaignCast(reminder.campaignId);
  const playerIds = players.map((p) => p.userId).filter((id) => id !== recapUserId);
  const timestamp = Math.floor(sessionAt.getTime() / 1000);
  const lines = [`⏰ The next **${reminder.campaignName}** session starts <t:${timestamp}:R>.`];
  if (recapUserId) {
    lines.push(`📜 Recap duty: <@${recapUserId}>. Can't make it? Run \`/skip-recapper\`.`);
  }
  if (playerIds.length > 0) lines.push(playerIds.map((id) => `<@${id}>`).join(" "));

  await channel.send({
    content: lines.join("\n"),
    allowedMentions: { users: recapUserId ? [recapUserId, ...playerIds] : playerIds },
  });
}
