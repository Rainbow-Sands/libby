export interface SegmentRef {
  segmentId: string;
  audioFile: string; // relative to sessionDir: "clips/{segmentId}.ogg"
  timestamp: string; // ISO - when the speaker started talking
  userId: string;
  username?: string; // human-readable label for the transcript; falls back to userId
}

export interface RunJob {
  runId: string;
}

export interface TranscriptionJob extends RunJob {
  sessionId: string;
  segmentId: string;
}
