CREATE TABLE "processing_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" varchar(30) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"transcript" jsonb,
	"summary" text,
	"recap" text,
	"title" text,
	"notification_channel_id" varchar(20),
	"notification_status" varchar(20),
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "session_segments" (
	"session_id" varchar(30) NOT NULL,
	"segment_id" varchar(100) NOT NULL,
	"audio_file" text NOT NULL,
	"recorded_at" text NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"username" text,
	"audio_status" varchar(20) NOT NULL,
	"transcription_run_id" uuid,
	"transcription_status" varchar(20),
	"transcript" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_segments_session_id_segment_id_pk" PRIMARY KEY("session_id","segment_id")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "guild_id" varchar(20);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "active_run_id" uuid;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_segments" ADD CONSTRAINT "session_segments_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_segments" ADD CONSTRAINT "session_segments_transcription_run_id_processing_runs_id_fk" FOREIGN KEY ("transcription_run_id") REFERENCES "public"."processing_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "processing_runs_status_idx" ON "processing_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "processing_runs_session_idx" ON "processing_runs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_segments_run_status_idx" ON "session_segments" USING btree ("transcription_run_id","transcription_status");--> statement-breakpoint
CREATE INDEX "session_segments_session_audio_idx" ON "session_segments" USING btree ("session_id","audio_status");--> statement-breakpoint
CREATE INDEX "sessions_guild_status_idx" ON "sessions" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "sessions_active_run_idx" ON "sessions" USING btree ("active_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_open_guild_unique" ON "sessions" USING btree ("guild_id") WHERE "sessions"."guild_id" is not null and "sessions"."status" in ('recording', 'closing');--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "workflow_id";