import {
  bigint,
  boolean,
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
import { sql } from "drizzle-orm";
import type { Transcript, TranscriptSegment } from "./transcript.ts";

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

// role: 'dm' | 'player'. characterName is the player's character (null for the DM).
export const campaignMembers = pgTable(
  "campaign_members",
  {
    campaignId: uuid("campaign_id")
      .references(() => campaigns.id)
      .notNull(),
    userId: varchar("user_id", { length: 20 })
      .references(() => users.id)
      .notNull(),
    role: varchar("role", { length: 10 }).notNull().default("player"),
    characterName: text("character_name"),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.userId] })],
);

// status: 'recording' | 'closing' | 'transcribing' | 'summarizing' | 'done' | 'failed'
//
// transcript, summary, recap, and title are each 1:1 with a session. A
// processing run builds replacements separately, then publishes all of them to
// this row atomically (Postgres TOASTs large values out-of-line automatically).
//
// transcript stores the full per-segment recording (see transcript.ts) as
// jsonb, so it can be re-simplified for the LLM later without re-transcribing.
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
    status: varchar("status", { length: 20 }).notNull().default("recording"),
    transcript: jsonb("transcript").$type<Transcript>(),
    summary: text("summary"),
    recap: text("recap"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
  },
  (t) => [
    index("sessions_guild_status_idx").on(t.guildId, t.status),
    index("sessions_active_run_idx").on(t.activeRunId),
    uniqueIndex("sessions_open_guild_unique")
      .on(t.guildId)
      .where(sql`${t.guildId} is not null and ${t.status} in ('recording', 'closing')`),
  ],
);

// kind: 'recording' | 'inference' | 'retranscription'
// status: 'recording' | 'transcribing' | 'aggregating' | 'summarizing' |
//         'recapping' | 'titling' | 'done' | 'failed'
export const processingRuns = pgTable(
  "processing_runs",
  {
    id: uuid("id").primaryKey(),
    sessionId: varchar("session_id", { length: 30 })
      .references(() => sessions.id, { onDelete: "cascade" })
      .notNull(),
    kind: varchar("kind", { length: 20 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    transcript: jsonb("transcript").$type<Transcript>(),
    summary: text("summary"),
    recap: text("recap"),
    title: text("title"),
    notificationChannelId: varchar("notification_channel_id", { length: 20 }),
    notificationStatus: varchar("notification_status", { length: 20 }),
    error: text("error"),
    availableAt: timestamp("available_at").defaultNow().notNull(),
    lockedBy: text("locked_by"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    index("processing_runs_queue_idx").on(t.status, t.availableAt, t.leaseExpiresAt),
    index("processing_runs_status_idx").on(t.status),
    index("processing_runs_session_idx").on(t.sessionId),
  ],
);

// Audio metadata is the durable manifest for a session. Cross-service audio is
// stored exclusively in S3-compatible object storage; audioFile only preserves
// the activation's original filename for transcript metadata and local recovery.
export const sessionSegments = pgTable(
  "session_segments",
  {
    sessionId: varchar("session_id", { length: 30 })
      .references(() => sessions.id, { onDelete: "cascade" })
      .notNull(),
    segmentId: varchar("segment_id", { length: 100 }).notNull(),
    audioFile: text("audio_file").notNull(),
    audioStorage: varchar("audio_storage", { length: 20 }).default("local").notNull(),
    audioObjectKey: text("audio_object_key"),
    audioByteSize: bigint("audio_byte_size", { mode: "number" }),
    audioDeletedAt: timestamp("audio_deleted_at"),
    recordedAt: text("recorded_at").notNull(),
    userId: varchar("user_id", { length: 20 }).notNull(),
    username: text("username"),
    audioStatus: varchar("audio_status", { length: 20 }).notNull(),
    transcriptionRunId: uuid("transcription_run_id").references(() => processingRuns.id, {
      onDelete: "set null",
    }),
    transcriptionStatus: varchar("transcription_status", { length: 20 }),
    transcript: jsonb("transcript").$type<TranscriptSegment>(),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.segmentId] }),
    index("session_segments_run_status_idx").on(t.transcriptionRunId, t.transcriptionStatus),
    index("session_segments_session_audio_idx").on(t.sessionId, t.audioStatus),
    index("session_segments_audio_status_idx").on(t.audioStatus),
  ],
);
