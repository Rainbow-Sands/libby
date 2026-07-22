export interface SegmentRef {
  segmentId: string;
  audioFile: string; // relative to sessionDir: "clips/{segmentId}.ogg"
  timestamp: string; // ISO - when the speaker started talking
  userId: string;
  username?: string; // human-readable label for the transcript; falls back to userId
}

export interface SessionInput {
  guildId: string;
  channelId: string;
  /** Text channel where the completed session link should be posted. */
  notificationChannelId?: string;
  campaignId: string;
  sessionId: string;
  sessionDir: string;
}

export interface SessionStatus {
  phase: "recording" | "transcribing" | "summarizing" | "done" | "failed";
  segmentCount: number;
  transcribedCount: number;
  lastError?: string;
}

export interface RegenerateSessionInput {
  sessionId: string;
}
