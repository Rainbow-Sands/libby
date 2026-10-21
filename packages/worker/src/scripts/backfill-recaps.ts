// Queues a backfill that regenerates sectioned recaps for a campaign's older
// sessions, oldest first and one at a time, so each recap can carry forward the
// previous session's open threads. When no session is left without one, the
// worker builds the campaign's world from every session in order. The running
// worker does the work; this only enqueues it. Running it again while a
// campaign's backfill is queued is a no-op, and running it after recaps are
// done just continues the world.
//
// Usage:
//   pnpm --filter @rainbot/worker backfill:recaps <campaign-id> [...campaign-id]
//   pnpm --filter @rainbot/worker backfill:recaps --all
//
// In the deployed worker container (working directory /app):
//   docker compose exec worker node packages/worker/src/scripts/backfill-recaps.ts --all

import { enqueueCampaignBackfill, listCampaigns, stopJobQueue } from "@rainbot/db";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    "Usage: pnpm --filter @rainbot/worker backfill:recaps <campaign-id> [...campaign-id] | --all",
  );
  process.exit(1);
}

try {
  const known = await listCampaigns();
  const campaigns = args.includes("--all")
    ? known
    : known.filter((campaign) => args.includes(campaign.id));
  for (const id of args) {
    if (id !== "--all" && !known.some((campaign) => campaign.id === id)) {
      console.error(`No campaign has id ${id}`);
      process.exitCode = 1;
    }
  }

  for (const campaign of campaigns) {
    const jobId = await enqueueCampaignBackfill({ campaignId: campaign.id });
    console.log(
      jobId
        ? `Queued backfill for ${campaign.name}`
        : `A backfill for ${campaign.name} is already queued`,
    );
  }
} catch (err) {
  console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await stopJobQueue();
  process.exit();
}
