CREATE TABLE "world_page_redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"slug" varchar(100) NOT NULL,
	"page_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "world_page_redirects" ADD CONSTRAINT "world_page_redirects_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_page_redirects" ADD CONSTRAINT "world_page_redirects_page_id_world_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."world_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "world_page_redirects_campaign_slug_unique" ON "world_page_redirects" USING btree ("campaign_id","slug");--> statement-breakpoint
CREATE INDEX "world_page_redirects_page_idx" ON "world_page_redirects" USING btree ("page_id");