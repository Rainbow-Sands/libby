import type { KnowledgeDetailedRecord, ProcessingRunData } from "@rainbot/db";
import {
  buildSessionKnowledgeDocument,
  createKnowledgeService,
  loadRagConfig,
  normalizeRagObjectPrefix,
  sessionKnowledgeObjectKey,
} from "@rainbot/knowledge";
import { getArtifactStorage, loadDetailedRecordArtifact } from "@rainbot/storage";
import { UnrecoverableTaskError } from "./errors.ts";

const ragConfig = loadRagConfig(process.env);
const knowledgeService = createKnowledgeService(ragConfig);
const knowledgeObjectPrefix =
  ragConfig.provider === "digitalocean"
    ? ragConfig.objectPrefix
    : normalizeRagObjectPrefix(process.env.RAG_OBJECT_PREFIX || "rag");

interface KnowledgeRecord {
  campaignId: string;
  sessionId: string;
  title: string | null;
  startedAt: Date;
  detailedRecord: string;
}

export function isKnowledgeSyncEnabled(): boolean {
  return knowledgeService !== null;
}

async function uploadKnowledgeProjection(record: KnowledgeRecord): Promise<void> {
  const body = buildSessionKnowledgeDocument(record);
  await getArtifactStorage().uploadArtifact(
    sessionKnowledgeObjectKey(knowledgeObjectPrefix, record.campaignId, record.sessionId),
    body,
    "text/markdown; charset=utf-8",
  );
}

export async function syncProcessingRunKnowledge(run: ProcessingRunData): Promise<void> {
  if (!knowledgeService) {
    throw new UnrecoverableTaskError("RAG synchronization is pending but RAG is not configured");
  }
  if (!run.generatedDetailedRecordArtifact) {
    throw new UnrecoverableTaskError(`Run ${run.id} has no detailed record to synchronize`);
  }
  await uploadKnowledgeProjection({
    campaignId: run.campaignId,
    sessionId: run.sessionId,
    title: run.title,
    startedAt: run.startedAt,
    detailedRecord: await loadDetailedRecordArtifact(run.generatedDetailedRecordArtifact),
  });
  await knowledgeService.requestIndexing();
}

export async function uploadExistingKnowledgeRecord(
  record: KnowledgeDetailedRecord,
): Promise<void> {
  await uploadKnowledgeProjection({
    campaignId: record.campaignId,
    sessionId: record.sessionId,
    title: record.title,
    startedAt: record.startedAt,
    detailedRecord: await loadDetailedRecordArtifact(record.artifact),
  });
}

export async function requestKnowledgeIndexing(): Promise<void> {
  if (!knowledgeService) throw new Error("Set RAG_PROVIDER to synchronize campaign knowledge");
  await knowledgeService.requestIndexing();
}
