CREATE TABLE "world_mention_indexes" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"fingerprint" varchar(32) NOT NULL,
	"built_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_page_mentions" (
	"page_id" uuid NOT NULL,
	"session_id" varchar(30) NOT NULL,
	"sentences" jsonb NOT NULL,
	CONSTRAINT "world_page_mentions_page_id_session_id_pk" PRIMARY KEY("page_id","session_id")
);
--> statement-breakpoint
ALTER TABLE "world_updates" ADD COLUMN "changes" jsonb;--> statement-breakpoint
ALTER TABLE "world_mention_indexes" ADD CONSTRAINT "world_mention_indexes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_page_mentions" ADD CONSTRAINT "world_page_mentions_page_id_world_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."world_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_page_mentions" ADD CONSTRAINT "world_page_mentions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_page_mentions_session_idx" ON "world_page_mentions" USING btree ("session_id");