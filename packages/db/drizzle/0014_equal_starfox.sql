ALTER TABLE "processing_runs" RENAME COLUMN "transcript_artifact_id" TO "source_transcript_artifact_id";--> statement-breakpoint
UPDATE "processing_runs" SET "source_transcript_artifact_id" = NULL WHERE "kind" <> 'inference';--> statement-breakpoint
ALTER TABLE "processing_runs" DROP COLUMN "detailed_record_artifact_id";--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_source_transcript_kind_check" CHECK ("processing_runs"."source_transcript_artifact_id" is null or "processing_runs"."kind" = 'inference');
