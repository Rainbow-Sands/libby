CREATE TABLE "campaign_reminders" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"channel_id" varchar(20) NOT NULL,
	"channel_name" varchar(100),
	"day_of_week" integer,
	"minute_of_day" integer,
	"time_zone" text,
	"next_session_at" timestamp with time zone,
	"recap_user_id" varchar(20),
	"recap_session_at" timestamp with time zone,
	"recap_previous_at" timestamp with time zone,
	"recap_skipped_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_reminders_day_of_week_check" CHECK ("campaign_reminders"."day_of_week" between 0 and 6),
	CONSTRAINT "campaign_reminders_minute_of_day_check" CHECK ("campaign_reminders"."minute_of_day" between 0 and 1439),
	CONSTRAINT "campaign_reminders_schedule_check" CHECK (("campaign_reminders"."day_of_week" is null) = ("campaign_reminders"."minute_of_day" is null)
        and ("campaign_reminders"."day_of_week" is null) = ("campaign_reminders"."time_zone" is null)
        and ("campaign_reminders"."day_of_week" is null) = ("campaign_reminders"."next_session_at" is null))
);
--> statement-breakpoint
ALTER TABLE "campaign_members" ADD COLUMN "recap_rotation" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_members" ADD COLUMN "last_recapped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_members" ADD COLUMN "joined_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_reminders" ADD CONSTRAINT "campaign_reminders_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reminders" ADD CONSTRAINT "campaign_reminders_recap_user_id_users_id_fk" FOREIGN KEY ("recap_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_reminders_next_session_idx" ON "campaign_reminders" USING btree ("next_session_at");--> statement-breakpoint
UPDATE "campaign_members" SET "recap_rotation" = false WHERE "role" = 'dm';