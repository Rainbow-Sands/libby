import { NativeConnection, Worker } from "@temporalio/worker";
import { fileURLToPath } from "url";
import * as activities from "./activities/transcribe.ts";
import * as persistActivities from "./activities/persist.ts";
import * as notifyActivities from "./activities/notify.ts";
import { TEMPORAL_URL } from "./env.ts";

export async function startWorker(): Promise<void> {
  console.log("Starting Temporal worker.");
  const connection = await NativeConnection.connect({
    address: TEMPORAL_URL,
  });

  const workflowWorker = await Worker.create({
    connection,
    namespace: "rainbot",
    taskQueue: "rainbot",
    workflowsPath: fileURLToPath(new URL("./workflows/session.ts", import.meta.url)),
  });

  const transcriptionWorker = await Worker.create({
    connection,
    namespace: "rainbot",
    taskQueue: "rainbot-transcription",
    activities: {
      transcribeSegment: activities.transcribeSegment,
      aggregateTranscript: activities.aggregateTranscript,
      // DB persistence runs alongside transcription (light, always-on queue).
      recordSessionStart: persistActivities.recordSessionStart,
      updateSessionStatus: persistActivities.updateSessionStatus,
      updateRegenerationStatus: persistActivities.updateRegenerationStatus,
      prepareSessionRegeneration: persistActivities.prepareSessionRegeneration,
      persistTranscript: persistActivities.persistTranscript,
      persistSummary: persistActivities.persistSummary,
      persistRecap: persistActivities.persistRecap,
      persistTitle: persistActivities.persistTitle,
      postSessionLink: notifyActivities.postSessionLink,
    },
    maxConcurrentActivityTaskExecutions: 4,
  });

  const summarizationWorker = await Worker.create({
    connection,
    namespace: "rainbot",
    taskQueue: "rainbot-summarization",
    activities: {
      summarize: activities.summarize,
      recap: activities.recap,
      generateTitle: activities.generateTitle,
    },
    maxConcurrentActivityTaskExecutions: 2,
  });

  const shutdown = async () => {
    console.log("[temporal] shutting down workers...");
    await Promise.all([
      workflowWorker.shutdown(),
      transcriptionWorker.shutdown(),
      summarizationWorker.shutdown(),
    ]);
    console.log("[temporal] workers shut down");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  Promise.all([workflowWorker.run(), transcriptionWorker.run(), summarizationWorker.run()]).catch(
    (err: unknown) => console.error("[temporal] worker error:", err),
  );

  console.log(
    "[temporal] workers started (rainbot / rainbot-transcription / rainbot-summarization)",
  );
}

await startWorker();
