import { listCurrentDetailedRecordsForKnowledge } from "@rainbot/db";
import {
  isKnowledgeSyncEnabled,
  requestKnowledgeIndexing,
  uploadExistingKnowledgeRecord,
} from "../knowledge-sync.ts";

const records = await listCurrentDetailedRecordsForKnowledge();
console.log(`[knowledge] publishing ${records.length} current detailed records`);

let next = 0;
const concurrency = Math.min(8, records.length);
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next < records.length) {
      const record = records[next++];
      if (record) await uploadExistingKnowledgeRecord(record);
    }
  }),
);

if (records.length > 0 && isKnowledgeSyncEnabled()) {
  await requestKnowledgeIndexing();
  console.log("[knowledge] synchronization requested");
} else if (!isKnowledgeSyncEnabled()) {
  console.log(
    "[knowledge] projections published; RAG provider is disabled, so indexing was skipped",
  );
}
