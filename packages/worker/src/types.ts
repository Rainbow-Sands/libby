export interface SegmentRef {
  segmentId: string;
  audioFile: string; // Relative path in the recorder's temporary scratch directory.
  timestamp: string; // ISO - when the speaker started talking
  userId: string;
  username?: string; // human-readable label for the transcript; falls back to userId
}
