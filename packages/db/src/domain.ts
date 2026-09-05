type ValueOf<T extends readonly string[]> = T[number];

export const CAMPAIGN_MEMBER_ROLES = ["dm", "player"] as const;
export type CampaignMemberRole = ValueOf<typeof CAMPAIGN_MEMBER_ROLES>;
export type CampaignAccessRole = CampaignMemberRole | "admin";

export const SESSION_STATUSES = [
  "recording",
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
  "transcribing",
  "aggregating",
  "summarizing",
  "recapping",
  "titling",
  "done",
  "failed",
] as const;
export type ProcessingRunStatus = ValueOf<typeof PROCESSING_RUN_STATUSES>;

export const NOTIFICATION_STATUSES = ["pending", "completed", "failed"] as const;
export type NotificationStatus = ValueOf<typeof NOTIFICATION_STATUSES>;

export const AUDIO_STATUSES = [
  "recording",
  "uploading",
  "ready",
  "failed",
  "discarded",
] as const;
export type AudioStatus = ValueOf<typeof AUDIO_STATUSES>;

export const TRANSCRIPTION_STATUSES = ["pending", "processing", "completed", "failed"] as const;
export type TranscriptionStatus = ValueOf<typeof TRANSCRIPTION_STATUSES>;
