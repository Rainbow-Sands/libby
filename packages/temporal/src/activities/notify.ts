import { ApplicationFailure } from "@temporalio/activity";
import { createHash } from "node:crypto";
import { DISCORD_TOKEN, WEB_URL } from "../env.ts";

interface SessionNotification {
  channelId: string;
  campaignId: string;
  sessionId: string;
}

export async function postSessionLink(input: SessionNotification): Promise<void> {
  const sessionUrl = `${WEB_URL.replace(/\/$/, "")}/campaigns/${encodeURIComponent(input.campaignId)}/sessions/${encodeURIComponent(input.sessionId)}`;
  const nonce = createHash("sha256")
    .update(`session:${input.sessionId}`)
    .digest("hex")
    .slice(0, 25);
  const response = await fetch(
    `https://discord.com/api/v10/channels/${encodeURIComponent(input.channelId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${DISCORD_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: `The session recap is ready: ${sessionUrl}`,
        allowed_mentions: { parse: [] },
        nonce,
        enforce_nonce: true,
      }),
    },
  );

  if (response.ok) return;

  const detail = await response.text();
  const message = `Discord rejected the session notification (${response.status}): ${detail}`;
  if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    throw ApplicationFailure.nonRetryable(message, "DiscordNotificationRejected");
  }
  throw new Error(message);
}
