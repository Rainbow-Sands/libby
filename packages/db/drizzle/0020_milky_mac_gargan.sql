CREATE TABLE "campaign_reminders" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"channel_id" varchar(20) NOT NULL,
	"day_of_week" integer NOT NULL,
	"minute_of_day" integer NOT NULL,
	"time_zone" text NOT NULL,
	"next_session_at" timestamp with time zone NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_reminders_day_of_week_check" CHECK ("campaign_reminders"."day_of_week" between 0 and 6),
	CONSTRAINT "campaign_reminders_minute_of_day_check" CHECK ("campaign_reminders"."minute_of_day" between 0 and 1439)
);
--> statement-breakpoint
ALTER TABLE "campaign_reminders" ADD CONSTRAINT "campaign_reminders_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_reminders_next_session_idx" ON "campaign_reminders" USING btree ("next_session_at");