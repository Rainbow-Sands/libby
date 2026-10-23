// Links campaigns' recaps to their world pages with the linking model, after
// sorting each campaign's stored other names into names and references. Run it
// once after deploying recap links, and again whenever recaps should be linked
// from scratch. The running worker links the recaps; this only enqueues it.
//
// Usage:
//   pnpm --filter @rainbot/worker link:recaps <campaign-id> [...campaign-id]
//   pnpm --filter @rainbot/worker link:recaps --all [--sort-names] [--relink] [--dry-run]
//
//   --sort-names  first ask the model which stored other names are really
//                 references, such as "the children", and move them
//   --relink      forget earlier links and failures, so every recap links again
//   --dry-run     with --sort-names, print the names it would move and stop
//
// In the deployed worker container (working directory /app):
//   docker compose exec worker node packages/worker/src/scripts/link-recaps.ts --all --sort-names

import {
  clearRecapLinkRuns,
  enqueueRecapLinks,
  getWorldSummary,
  listCampaigns,
  moveAliasesToReferences,
  stopJobQueue,
} from "@rainbot/db";
import { findAliasReferences } from "../tasks.ts";

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const ids = args.filter((arg) => !arg.startsWith("--"));
if (ids.length === 0 && !flags.has("--all")) {
  console.error(
    "Usage: pnpm --filter @rainbot/worker link:recaps <campaign-id> [...campaign-id] | --all " +
      "[--sort-names] [--relink] [--dry-run]",
  );
  process.exit(1);
}
const dryRun = flags.has("--dry-run");

try {
  const known = await listCampaigns();
  const campaigns = flags.has("--all")
    ? known
    : known.filter((campaign) => ids.includes(campaign.id));
  for (const id of ids) {
    if (!known.some((campaign) => campaign.id === id)) {
      console.error(`No campaign has id ${id}`);
      process.exitCode = 1;
    }
  }

  if (flags.has("--sort-names")) {
    for (const campaign of campaigns) {
      const references = await findAliasReferences(await getWorldSummary(campaign.id));
      for (const [slug, names] of references) {
        console.log(`${campaign.name} / ${slug}: ${names.map((name) => `"${name}"`).join(", ")}`);
      }
      if (dryRun) continue;
      const changed = await moveAliasesToReferences(campaign.id, references);
      console.log(`Moved references on ${changed} page revisions of ${campaign.name}`);
    }
  }
  if (dryRun) process.exit();

  if (flags.has("--relink")) await clearRecapLinkRuns(campaigns.map((campaign) => campaign.id));
  for (const campaign of campaigns) {
    const jobId = await enqueueRecapLinks({ campaignId: campaign.id });
    console.log(
      jobId
        ? `Queued recap linking for ${campaign.name}`
        : `Recap linking for ${campaign.name} is already queued`,
    );
  }
} catch (err) {
  console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await stopJobQueue();
  process.exit();
}
