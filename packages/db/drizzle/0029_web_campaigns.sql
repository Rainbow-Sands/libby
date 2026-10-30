ALTER TABLE "campaigns" ALTER COLUMN "guild_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "invite_code" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_status" varchar(20) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_invite_code_idx" ON "campaigns" USING btree ("invite_code");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_subscription_status_check" CHECK ("users"."subscription_status" in ('none', 'active'));