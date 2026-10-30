type ValueOf<T extends readonly string[]> = T[number];

export const CAMPAIGN_MEMBER_ROLES = ["dm", "player"] as const;
export type CampaignMemberRole = ValueOf<typeof CAMPAIGN_MEMBER_ROLES>;
export type CampaignAccessRole = CampaignMemberRole | "admin";

export const SUBSCRIPTION_STATUSES = ["none", "active"] as const;
export type SubscriptionStatus = ValueOf<typeof SUBSCRIPTION_STATUSES>;

export const SESSION_STATUSES = [
  "recording",
  // A single room recording waiting for its speakers to be found.
  "detecting",
  "closing",
  "transcribing",
  "summarizing",
  "done",
  "failed",
] as const;
export type SessionStatus = ValueOf<typeof SESSION_STATUSES>;

export const RECOVERABLE_SESSION_STATUSES = [
  "recording",
  "closing",
] as const satisfies readonly SessionStatus[];
export type RecoverableSessionStatus = ValueOf<typeof RECOVERABLE_SESSION_STATUSES>;

export const PROCESSING_RUN_KINDS = ["recording", "inference", "retranscription"] as const;
export type ProcessingRunKind = ValueOf<typeof PROCESSING_RUN_KINDS>;

export const PROCESSING_RUN_STATUSES = [
  "recording",
  "detecting",
  "transcribing",
  "aggregating",
  "summarizing",
  "recapping",
  "titling",
  "done",
  "failed",
] as const;
export type ProcessingRunStatus = ValueOf<typeof PROCESSING_RUN_STATUSES>;

// discord: the bot recorded one clip per voice activation. tracks: uploaded
// files, one per speaker. room: one uploaded recording of the whole table,
// split by speaker detection.
export const SESSION_SOURCES = ["discord", "tracks", "room"] as const;
export type SessionSource = ValueOf<typeof SESSION_SOURCES>;

export const NOTIFICATION_STATUSES = ["pending", "completed", "failed"] as const;
export type NotificationStatus = ValueOf<typeof NOTIFICATION_STATUSES>;

export const AUDIO_STATUSES = ["recording", "ready", "failed", "discarded"] as const;
export type AudioStatus = ValueOf<typeof AUDIO_STATUSES>;

export const TRANSCRIPTION_STATUSES = ["pending", "processing", "completed", "failed"] as const;
export type TranscriptionStatus = ValueOf<typeof TRANSCRIPTION_STATUSES>;

// "pending" holds a failed attempt that will be retried; "skipped" marks a
// session with no ledger to read.
export const WORLD_UPDATE_STATUSES = ["pending", "done", "skipped", "failed"] as const;
export type WorldUpdateStatus = ValueOf<typeof WORLD_UPDATE_STATUSES>;

export const RECAP_LINK_STATUSES = ["done", "failed"] as const;
export type RecapLinkStatus = ValueOf<typeof RECAP_LINK_STATUSES>;
