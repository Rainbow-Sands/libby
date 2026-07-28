ALTER TABLE "processing_runs" ADD COLUMN "available_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD COLUMN "locked_by" text;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD COLUMN "lease_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "session_segments" ADD COLUMN "audio_storage" varchar(20) DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "session_segments" ADD COLUMN "audio_object_key" text;--> statement-breakpoint
ALTER TABLE "session_segments" ADD COLUMN "audio_byte_size" bigint;--> statement-breakpoint
ALTER TABLE "session_segments" ADD COLUMN "audio_deleted_at" timestamp;