DELETE FROM "session_segments" WHERE "audio_object_key" IS NULL;--> statement-breakpoint
ALTER TABLE "session_segments" ALTER COLUMN "audio_object_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "session_segments" DROP COLUMN "audio_file";--> statement-breakpoint
ALTER TABLE "session_segments" DROP COLUMN "audio_storage";--> statement-breakpoint
ALTER TABLE "session_segments" DROP COLUMN "audio_byte_size";--> statement-breakpoint
ALTER TABLE "session_segments" DROP COLUMN "audio_deleted_at";
