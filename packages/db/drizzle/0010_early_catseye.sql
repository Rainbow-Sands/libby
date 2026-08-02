CREATE TABLE "session_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar(30) NOT NULL,
	"generated_by_run_id" uuid,
	"kind" varchar(30) NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"format_version" integer DEFAULT 1 NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processing_runs" ADD COLUMN "transcript_artifact_id" uuid;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD COLUMN "detailed_record_artifact_id" uuid;--> statement-breakpoint
ALTER TABLE "session_artifacts" ADD CONSTRAINT "session_artifacts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_artifacts" ADD CONSTRAINT "session_artifacts_generated_by_run_id_processing_runs_id_fk" FOREIGN KEY ("generated_by_run_id") REFERENCES "public"."processing_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_artifacts_run_kind_unique" ON "session_artifacts" USING btree ("generated_by_run_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "session_artifacts_current_kind_unique" ON "session_artifacts" USING btree ("session_id","kind") WHERE "session_artifacts"."is_current" = true;--> statement-breakpoint
CREATE INDEX "session_artifacts_session_idx" ON "session_artifacts" USING btree ("session_id");