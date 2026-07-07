import {
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { Transcript } from "./transcript.ts";

export const guilds = pgTable("guilds", {
  id: varchar("id", { length: 20 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: varchar("id", { length: 20 }).primaryKey(),
  username: varchar("username", { length: 100 }).notNull(),
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
  (t) => [primaryKey({ columns: [t.campaignId, t.userId] })]
);

// status: 'recording' | 'transcribing' | 'summarizing' | 'done' | 'failed'
//
// transcript, summary, recap, and title are each 1:1 with a session and written
// independently by the pipeline as they become ready, so they live here as
// nullable columns (Postgres TOASTs the large values out-of-line automatically).
//
// transcript stores the full per-segment recording (see transcript.ts) as
// jsonb, so it can be re-simplified for the LLM later without re-transcribing.
export const sessions = pgTable("sessions", {
  id: varchar("id", { length: 30 }).primaryKey(),
  campaignId: uuid("campaign_id")
    .references(() => campaigns.id)
    .notNull(),
  title: text("title"),
  channelId: varchar("channel_id", { length: 20 }).notNull(),
  sessionDir: text("session_dir").notNull(),
  workflowId: text("workflow_id").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("recording"),
  transcript: jsonb("transcript").$type<Transcript>(),
  summary: text("summary"),
  recap: text("recap"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
});
