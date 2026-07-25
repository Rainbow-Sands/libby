import {
  listInterruptedSegments,
  listPendingTranscriptions,
  listRunsToReconcile,
} from "@rainbot/db";
import { stat } from "node:fs/promises";
import path from "node:path";
import { createWorkers } from "./workers.ts";
import {
  closeProducerQueues,
  enqueueAggregation,
  enqueueNotification,
  enqueueRecap,
  enqueueSummarization,
  enqueueTitle,
  enqueueTranscriptions,
} from "./queues.ts";
import {
  completeAudioSegment,
  discardAudioSegment,
  scheduleAggregationIfReady,
} from "./pipeline.ts";

const MIN_CLIP_BYTES = 1024;

async function reconcileQueues(): Promise<void> {
  for (const segment of await listInterruptedSegments()) {
    const audioPath = path.join(segment.sessionDir, segment.audioFile);
    const usable = await stat(audioPath)
      .then((details) => details.size >= MIN_CLIP_BYTES)
      .catch(() => false);
    if (usable) {
      await completeAudioSegment(segment.sessionId, segment.runId, segment.segmentId);
    } else {
      await discardAudioSegment(
        segment.sessionId,
        segment.runId,
        segment.segmentId,
        "Recording ended before a usable clip was written",
      );
    }
  }

  const pending = await listPendingTranscriptions();
  await enqueueTranscriptions(pending);

  for (const run of await listRunsToReconcile()) {
    switch (run.status) {
      case "transcribing":
        await scheduleAggregationIfReady(run.id);
        break;
      case "aggregating":
        await enqueueAggregation(run.id);
        break;
      case "summarizing":
        await enqueueSummarization(run.id);
        break;
      case "recapping":
        await enqueueRecap(run.id);
        break;
      case "titling":
        await enqueueTitle(run.id);
        break;
      case "done":
        if (run.notificationStatus === "pending") await enqueueNotification(run.id);
        break;
    }
  }
}

console.log("Starting BullMQ workers.");
const workers = createWorkers();

await reconcileQueues();
const reconciliationTimer = setInterval(() => {
  void reconcileQueues().catch((error) => console.error("[worker] reconciliation failed:", error));
}, 60_000);

const shutdown = async () => {
  console.log("[worker] shutting down...");
  clearInterval(reconciliationTimer);
  await Promise.all(workers.map((worker) => worker.close()));
  await closeProducerQueues();
  console.log("[worker] shut down");
};

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

console.log(
  "[worker] started transcription, aggregation, summarization, recap, title, and notification workers",
);
