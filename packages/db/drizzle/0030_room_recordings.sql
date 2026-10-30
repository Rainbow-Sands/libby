CREATE TABLE "session_speakers" (
	"session_id" varchar(30) NOT NULL,
	"label" varchar(20) NOT NULL,
	"position" integer NOT NULL,
	"talk_seconds" real NOT NULL,
	"turns" jsonb NOT NULL,
	"samples" jsonb NOT NULL,
	"embedding" real[],
	"user_id" varchar(20),
	"guest_name" text,
	"ignored" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_speakers_session_id_label_pk" PRIMARY KEY("session_id","label"),
	CONSTRAINT "session_speakers_assignment_check" CHECK (("session_speakers"."user_id" is not null)::int + ("session_speakers"."guest_name" is not null)::int + "session_speakers"."ignored"::int <= 1)
);
--> statement-breakpoint
ALTER TABLE "processing_runs" DROP CONSTRAINT "processing_runs_status_check";--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_status_check";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "source" varchar(20) DEFAULT 'discord' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "recording_object_key" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "expected_speakers" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "speakers_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session_speakers" ADD CONSTRAINT "session_speakers_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_speakers" ADD CONSTRAINT "session_speakers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_speakers_user_idx" ON "session_speakers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_status_check" CHECK ("processing_runs"."status" in ('recording', 'detecting', 'transcribing', 'aggregating', 'summarizing', 'recapping', 'titling', 'done', 'failed'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_source_check" CHECK ("sessions"."source" in ('discord', 'tracks', 'room'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_status_check" CHECK ("sessions"."status" in ('recording', 'detecting', 'closing', 'transcribing', 'summarizing', 'done', 'failed'));--> statement-breakpoint
-- Sessions uploaded on the Ingest Audio page before sources existed.
UPDATE "sessions" SET "source" = 'tracks' WHERE "id" LIKE 'manual-%';
