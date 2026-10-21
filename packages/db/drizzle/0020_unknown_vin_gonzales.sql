ALTER TABLE "session_artifacts" DROP CONSTRAINT "session_artifacts_kind_check";--> statement-breakpoint
ALTER TABLE "processing_runs" ADD COLUMN "recap_sections" jsonb;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "recap_sections" jsonb;--> statement-breakpoint
ALTER TABLE "session_artifacts" ADD CONSTRAINT "session_artifacts_kind_check" CHECK ("session_artifacts"."kind" in ('transcript', 'detailed_record', 'session_ledger'));