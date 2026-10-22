CREATE TABLE "world_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"edit_id" uuid,
	"note" text NOT NULL,
	"created_by_user_id" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"retired_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "world_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"summary" text NOT NULL,
	"changes" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"undone_at" timestamp,
	"undone_by_user_id" varchar(20)
);
--> statement-breakpoint
ALTER TABLE "world_corrections" ADD CONSTRAINT "world_corrections_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_corrections" ADD CONSTRAINT "world_corrections_edit_id_world_edits_id_fk" FOREIGN KEY ("edit_id") REFERENCES "public"."world_edits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_corrections" ADD CONSTRAINT "world_corrections_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_edits" ADD CONSTRAINT "world_edits_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_edits" ADD CONSTRAINT "world_edits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_edits" ADD CONSTRAINT "world_edits_undone_by_user_id_users_id_fk" FOREIGN KEY ("undone_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_corrections_campaign_idx" ON "world_corrections" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "world_edits_campaign_idx" ON "world_edits" USING btree ("campaign_id","created_at");