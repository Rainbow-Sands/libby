ALTER TABLE "processing_runs" ADD COLUMN "knowledge_sync_status" varchar(20);--> statement-breakpoint
ALTER TABLE "processing_runs" ADD COLUMN "knowledge_sync_error" text;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_knowledge_sync_status_check" CHECK ("processing_runs"."knowledge_sync_status" in ('pending', 'completed', 'failed'));