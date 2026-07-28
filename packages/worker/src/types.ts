export interface SegmentRef {
  segmentId: string;
  audioFile: string; // Original filename retained in transcript metadata.
  timestamp: string; // ISO - when the speaker started talking
  userId: string;
  username?: string; // human-readable label for the transcript; falls back to userId
}
