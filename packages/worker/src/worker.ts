import { runSessionWorker } from "./session-worker.ts";

const controller = new AbortController();
let stopping = false;

function shutdown(): void {
  if (stopping) return;
  stopping = true;
  console.log("[worker] shutting down...");
  controller.abort();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

await runSessionWorker(controller.signal);
