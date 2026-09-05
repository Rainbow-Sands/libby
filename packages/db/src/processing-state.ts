import type { AudioStatus, TranscriptionStatus } from "./domain.ts";

export interface SegmentProcessingState {
  audioStatus: AudioStatus;
  transcriptionRunId: string | null;
  transcriptionStatus: TranscriptionStatus | null;
}

export type TranscriptionBarrier = "ready" | "waiting" | "failed";

export function evaluateTranscriptionBarrier(
  runId: string,
  segments: SegmentProcessingState[],
): TranscriptionBarrier {
  if (
    segments.some(
      (segment) =>
        segment.audioStatus === "failed" ||
        (segment.audioStatus === "ready" &&
          segment.transcriptionRunId === runId &&
          segment.transcriptionStatus === "failed"),
    )
  ) {
    return "failed";
  }

  const unfinished = segments.some(
    (segment) =>
      segment.audioStatus === "recording" ||
      (segment.audioStatus === "ready" &&
        (segment.transcriptionRunId !== runId || segment.transcriptionStatus !== "completed")),
  );
  return unfinished ? "waiting" : "ready";
}
