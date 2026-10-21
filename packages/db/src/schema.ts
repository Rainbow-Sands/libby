import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql, type SQLWrapper } from "drizzle-orm";
import { SESSION_ARTIFACT_KINDS, type SessionArtifactKind } from "./artifacts.ts";
import {
  AUDIO_STATUSES,
  WORLD_UPDATE_STATUSES,
  CAMPAIGN_MEMBER_ROLES,
  NOTIFICATION_STATUSES,
  PROCESSING_RUN_KINDS,
  PROCESSING_RUN_STATUSES,
  SESSION_STATUSES,
  TRANSCRIPTION_STATUSES,
  type AudioStatus,
  type CampaignMemberRole,
  type NotificationStatus,
  type ProcessingRunKind,
  type ProcessingRunStatus,
  type SessionStatus,
  type TranscriptionStatus,
  type WorldUpdateStatus,
} from "./domain.ts";
import type { SessionRecap } from "./session-notes.ts";
import type { TranscriptSegment } from "./transcript.ts";
import {
  WORLD_PAGE_KINDS,
  type WorldMoment,
  type WorldPageContent,
  type WorldPageKind,
  type WorldUpdateReport,
} from "./world.ts";

function oneOf(column: SQLWrapper, values: readonly string[]) {
  const literals = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
  return sql`${column} in (${sql.raw(literals)})`;
}

export const guilds = pgTable("guilds", {
  id: varchar("id", { length: 20 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: varchar("id", { length: 20 }).primaryKey(),
  username: varchar("username", { length: 100 }).notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: varchar("guild_id", { length: 20 })
    .references(() => guilds.id)
    .notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// characterName is the player's character (null for the DM).
export const campaignMembers = pgTable(
  "campaign_members",
  {
    campaignId: uuid("campaign_id")
      .references(() => campaigns.id)
      .notNull(),
    userId: varchar("user_id", { length: 20 })
      .references(() => users.id)
      .notNull(),
    role: varchar("role", { length: 10 }).$type<CampaignMemberRole>().notNull().default("player"),
    characterName: text("character_name"),
    // Recap duty goes to the rotation member who recapped least recently.
    recapRotation: boolean("recap_rotation").notNull().default(true),
    lastRecappedAt: timestamp("last_recapped_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.userId] }),
    check("campaign_members_role_check", oneOf(t.role, CAMPAIGN_MEMBER_ROLES)),
  ],
);

// One reminder configuration per campaign. /reminder records the channel; the
// web app sets the weekly schedule (a wall-clock time in an IANA time zone).
// nextSessionAt is the next occurrence whose reminder has not been sent; the
// bot advances it when it claims a reminder.
//
// recapUserId is on recap duty for the session at recapSessionAt.
// recapPreviousAt is that member's lastRecappedAt before they were assigned, so
// a skip can restore it; recapSkippedUserIds are excluded for that session.
export const campaignReminders = pgTable(
  "campaign_reminders",
  {
    campaignId: uuid("campaign_id")
      .primaryKey()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    channelId: varchar("channel_id", { length: 20 }).notNull(),
    channelName: varchar("channel_name", { length: 100 }),
    dayOfWeek: integer("day_of_week"),
    minuteOfDay: integer("minute_of_day"),
    timeZone: text("time_zone"),
    nextSessionAt: timestamp("next_session_at", { withTimezone: true }),
    recapUserId: varchar("recap_user_id", { length: 20 }).references(() => users.id),
    recapSessionAt: timestamp("recap_session_at", { withTimezone: true }),
    recapPreviousAt: timestamp("recap_previous_at", { withTimezone: true }),
    recapSkippedUserIds: jsonb("recap_skipped_user_ids").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("campaign_reminders_next_session_idx").on(t.nextSessionAt),
    check("campaign_reminders_day_of_week_check", sql`${t.dayOfWeek} between 0 and 6`),
    check("campaign_reminders_minute_of_day_check", sql`${t.minuteOfDay} between 0 and 1439`),
    check(
      "campaign_reminders_schedule_check",
      sql`(${t.dayOfWeek} is null) = (${t.minuteOfDay} is null)
        and (${t.dayOfWeek} is null) = (${t.timeZone} is null)
        and (${t.dayOfWeek} is null) = (${t.nextSessionAt} is null)`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: varchar("id", { length: 30 }).primaryKey(),
    campaignId: uuid("campaign_id")
      .references(() => campaigns.id)
      .notNull(),
    guildId: varchar("guild_id", { length: 20 }),
    title: text("title"),
    channelId: varchar("channel_id", { length: 20 }).notNull(),
    sessionDir: text("session_dir").notNull(),
    activeRunId: uuid("active_run_id"),
    status: varchar("status", { length: 20 }).$type<SessionStatus>().notNull().default("recording"),
    // Markdown rendering of recapSections, or a free-form recap from before
    // recaps were sectioned.
    recap: text("recap"),
    recapSections: jsonb("recap_sections").$type<SessionRecap>(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
  },
  (t) => [
    index("sessions_guild_status_idx").on(t.guildId, t.status),
    index("sessions_active_run_idx").on(t.activeRunId),
    uniqueIndex("sessions_open_guild_unique")
      .on(t.guildId)
      .where(sql`${t.guildId} is not null and ${t.status} in ('recording', 'closing')`),
    check("sessions_status_check", oneOf(t.status, SESSION_STATUSES)),
  ],
);

export const processingRuns = pgTable(
  "processing_runs",
  {
    id: uuid("id").primaryKey(),
    sessionId: varchar("session_id", { length: 30 })
      .references(() => sessions.id, { onDelete: "cascade" })
      .notNull(),
    kind: varchar("kind", { length: 20 }).$type<ProcessingRunKind>().notNull(),
    status: varchar("status", { length: 20 }).$type<ProcessingRunStatus>().notNull(),
    // Only inference regeneration consumes an artifact created by another run.
    // A run's own outputs are resolved through sessionArtifacts.generatedByRunId.
    sourceTranscriptArtifactId: uuid("source_transcript_artifact_id"),
    recap: text("recap"),
    recapSections: jsonb("recap_sections").$type<SessionRecap>(),
    title: text("title"),
    notificationChannelId: varchar("notification_channel_id", { length: 20 }),
    notificationStatus: varchar("notification_status", { length: 20 }).$type<NotificationStatus>(),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    index("processing_runs_status_idx").on(t.status),
    index("processing_runs_session_idx").on(t.sessionId),
    check("processing_runs_kind_check", oneOf(t.kind, PROCESSING_RUN_KINDS)),
    check("processing_runs_status_check", oneOf(t.status, PROCESSING_RUN_STATUSES)),
    check(
      "processing_runs_notification_status_check",
      oneOf(t.notificationStatus, NOTIFICATION_STATUSES),
    ),
    check(
      "processing_runs_source_transcript_kind_check",
      sql`${t.sourceTranscriptArtifactId} is null or ${t.kind} = 'inference'`,
    ),
  ],
);

// The object body lives in private S3-compatible storage. Rows retain immutable
// provenance and integrity metadata; isCurrent identifies the version published
// for a session.
export const sessionArtifacts = pgTable(
  "session_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: varchar("session_id", { length: 30 })
      .references(() => sessions.id, { onDelete: "cascade" })
      .notNull(),
    generatedByRunId: uuid("generated_by_run_id").references(() => processingRuns.id, {
      onDelete: "set null",
    }),
    kind: varchar("kind", { length: 30 }).$type<SessionArtifactKind>().notNull(),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    formatVersion: integer("format_version").default(1).notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    isCurrent: boolean("is_current").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("session_artifacts_run_kind_unique").on(t.generatedByRunId, t.kind),
    uniqueIndex("session_artifacts_current_kind_unique")
      .on(t.sessionId, t.kind)
      .where(sql`${t.isCurrent} = true`),
    index("session_artifacts_session_idx").on(t.sessionId),
    check("session_artifacts_kind_check", oneOf(t.kind, SESSION_ARTIFACT_KINDS)),
  ],
);

// Audio metadata is the durable manifest for a session. Every registered clip
// has a stable key in private S3-compatible object storage.
export const sessionSegments = pgTable(
  "session_segments",
  {
    sessionId: varchar("session_id", { length: 30 })
      .references(() => sessions.id, { onDelete: "cascade" })
      .notNull(),
    segmentId: varchar("segment_id", { length: 100 }).notNull(),
    audioObjectKey: text("audio_object_key").notNull(),
    recordedAt: text("recorded_at").notNull(),
    userId: varchar("user_id", { length: 20 }).notNull(),
    username: text("username"),
    audioStatus: varchar("audio_status", { length: 20 }).$type<AudioStatus>().notNull(),
    transcriptionRunId: uuid("transcription_run_id").references(() => processingRuns.id, {
      onDelete: "set null",
    }),
    transcriptionStatus: varchar("transcription_status", {
      length: 20,
    }).$type<TranscriptionStatus>(),
    transcriptionJobId: uuid("transcription_job_id"),
    transcript: jsonb("transcript").$type<TranscriptSegment>(),
    transcribedAt: timestamp("transcribed_at"),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.segmentId] }),
    index("session_segments_run_status_idx").on(t.transcriptionRunId, t.transcriptionStatus),
    index("session_segments_live_transcript_idx").on(t.sessionId, t.transcribedAt),
    index("session_segments_session_audio_idx").on(t.sessionId, t.audioStatus),
    check("session_segments_audio_status_check", oneOf(t.audioStatus, AUDIO_STATUSES)),
    check(
      "session_segments_transcription_status_check",
      oneOf(t.transcriptionStatus, TRANSCRIPTION_STATUSES),
    ),
  ],
);

// One wiki page in a campaign's world. Its content lives in revisions; the row
// holds what does not change from session to session.
export const worldPages = pgTable(
  "world_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .references(() => campaigns.id)
      .notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    kind: varchar("kind", { length: 20 }).$type<WorldPageKind>().notNull(),
    // The player whose character this page describes.
    memberUserId: varchar("member_user_id", { length: 20 }).references(() => users.id),
    avatarId: uuid("avatar_id"),
    createdInSessionId: varchar("created_in_session_id", { length: 30 })
      .references(() => sessions.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("world_pages_campaign_slug_unique").on(t.campaignId, t.slug),
    check("world_pages_kind_check", oneOf(t.kind, WORLD_PAGE_KINDS)),
  ],
);

// Immutable page content written by one session's world update. The page as of
// session N is its newest revision from a session that started at or before N.
export const worldPageRevisions = pgTable(
  "world_page_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .references(() => worldPages.id)
      .notNull(),
    sessionId: varchar("session_id", { length: 30 })
      .references(() => sessions.id)
      .notNull(),
    content: jsonb("content").$type<WorldPageContent>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("world_page_revisions_page_session_unique").on(t.pageId, t.sessionId),
    index("world_page_revisions_session_idx").on(t.sessionId),
  ],
);

// Every uploaded avatar is kept; world_pages.avatar_id names the one shown.
export const worldPageAvatars = pgTable(
  "world_page_avatars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .references(() => worldPages.id)
      .notNull(),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    uploadedByUserId: varchar("uploaded_by_user_id", { length: 20 }).references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("world_page_avatars_page_idx").on(t.pageId)],
);

// A recap epic moment featuring a page, copied so the page keeps it even if
// the session's recap is regenerated later.
export const worldPageMoments = pgTable(
  "world_page_moments",
  {
    pageId: uuid("page_id")
      .references(() => worldPages.id)
      .notNull(),
    sessionId: varchar("session_id", { length: 30 })
      .references(() => sessions.id)
      .notNull(),
    position: integer("position").notNull(),
    moment: jsonb("moment").$type<WorldMoment>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.pageId, t.sessionId, t.position] }),
    index("world_page_moments_session_idx").on(t.sessionId),
  ],
);

// The world update of one session. Sessions update the world oldest first, so
// a row exists for every finished session up to the newest one processed.
export const worldUpdates = pgTable(
  "world_updates",
  {
    sessionId: varchar("session_id", { length: 30 })
      .references(() => sessions.id)
      .primaryKey(),
    campaignId: uuid("campaign_id")
      .references(() => campaigns.id)
      .notNull(),
    status: varchar("status", { length: 20 }).$type<WorldUpdateStatus>().notNull(),
    attempts: integer("attempts").default(0).notNull(),
    report: jsonb("report").$type<WorldUpdateReport>(),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("world_updates_campaign_idx").on(t.campaignId),
    check("world_updates_status_check", oneOf(t.status, WORLD_UPDATE_STATUSES)),
  ],
);
