CREATE TABLE "world_recap_link_runs" (
	"session_id" varchar(30) PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"recap_hash" varchar(32) NOT NULL,
	"status" varchar(20) NOT NULL,
	"error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "world_recap_link_runs_status_check" CHECK ("world_recap_link_runs"."status" in ('done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "world_recap_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar(30) NOT NULL,
	"page_id" uuid NOT NULL,
	"field" varchar(40) NOT NULL,
	"phrase" text NOT NULL,
	"occurrence" integer NOT NULL,
	"position" integer NOT NULL,
	"sentence" jsonb
);
--> statement-breakpoint
ALTER TABLE "world_recap_link_runs" ADD CONSTRAINT "world_recap_link_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_recap_link_runs" ADD CONSTRAINT "world_recap_link_runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_recap_links" ADD CONSTRAINT "world_recap_links_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_recap_links" ADD CONSTRAINT "world_recap_links_page_id_world_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."world_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_recap_link_runs_campaign_idx" ON "world_recap_link_runs" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "world_recap_links_session_idx" ON "world_recap_links" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "world_recap_links_page_idx" ON "world_recap_links" USING btree ("page_id");--> statement-breakpoint
-- Pages written before references existed have none.
UPDATE "world_page_revisions" SET "content" = "content" || '{"references": []}'::jsonb WHERE NOT ("content" ? 'references');