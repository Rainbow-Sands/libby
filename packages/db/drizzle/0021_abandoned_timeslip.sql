CREATE TABLE "world_page_avatars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"uploaded_by_user_id" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_page_moments" (
	"page_id" uuid NOT NULL,
	"session_id" varchar(30) NOT NULL,
	"position" integer NOT NULL,
	"moment" jsonb NOT NULL,
	CONSTRAINT "world_page_moments_page_id_session_id_position_pk" PRIMARY KEY("page_id","session_id","position")
);
--> statement-breakpoint
CREATE TABLE "world_page_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"session_id" varchar(30) NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"slug" varchar(100) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"member_user_id" varchar(20),
	"avatar_id" uuid,
	"created_in_session_id" varchar(30) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "world_pages_kind_check" CHECK ("world_pages"."kind" in ('character', 'npc', 'location', 'faction', 'item', 'quest', 'other'))
);
--> statement-breakpoint
CREATE TABLE "world_updates" (
	"session_id" varchar(30) PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"report" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "world_updates_status_check" CHECK ("world_updates"."status" in ('pending', 'done', 'skipped', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "world_page_avatars" ADD CONSTRAINT "world_page_avatars_page_id_world_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."world_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_page_avatars" ADD CONSTRAINT "world_page_avatars_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_page_moments" ADD CONSTRAINT "world_page_moments_page_id_world_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."world_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_page_moments" ADD CONSTRAINT "world_page_moments_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_page_revisions" ADD CONSTRAINT "world_page_revisions_page_id_world_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."world_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_page_revisions" ADD CONSTRAINT "world_page_revisions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_pages" ADD CONSTRAINT "world_pages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_pages" ADD CONSTRAINT "world_pages_member_user_id_users_id_fk" FOREIGN KEY ("member_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_pages" ADD CONSTRAINT "world_pages_created_in_session_id_sessions_id_fk" FOREIGN KEY ("created_in_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_updates" ADD CONSTRAINT "world_updates_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_updates" ADD CONSTRAINT "world_updates_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_page_avatars_page_idx" ON "world_page_avatars" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "world_page_moments_session_idx" ON "world_page_moments" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "world_page_revisions_page_session_unique" ON "world_page_revisions" USING btree ("page_id","session_id");--> statement-breakpoint
CREATE INDEX "world_page_revisions_session_idx" ON "world_page_revisions" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "world_pages_campaign_slug_unique" ON "world_pages" USING btree ("campaign_id","slug");--> statement-breakpoint
CREATE INDEX "world_updates_campaign_idx" ON "world_updates" USING btree ("campaign_id");