ALTER TABLE "processing_runs" DROP CONSTRAINT "processing_runs_knowledge_sync_status_check";--> statement-breakpoint
ALTER TABLE "processing_runs" DROP COLUMN "knowledge_sync_status";--> statement-breakpoint
ALTER TABLE "processing_runs" DROP COLUMN "knowledge_sync_error";