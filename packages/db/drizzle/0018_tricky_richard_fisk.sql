ALTER TABLE "session_segments" DROP CONSTRAINT "session_segments_audio_status_check";--> statement-breakpoint
UPDATE "session_segments" SET "audio_status" = 'recording' WHERE "audio_status" = 'uploading';--> statement-breakpoint
DROP INDEX "session_segments_audio_status_idx";--> statement-breakpoint
ALTER TABLE "session_segments" ADD CONSTRAINT "session_segments_audio_status_check" CHECK ("session_segments"."audio_status" in ('recording', 'ready', 'failed', 'discarded'));