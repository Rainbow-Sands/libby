export interface SegmentProcessingState {
  audioStatus: string;
  transcriptionRunId: string | null;
  transcriptionStatus: string | null;
}

export type TranscriptionBarrier = "ready" | "waiting" | "failed";

export function evaluateTranscriptionBarrier(
  runId: string,
  segments: SegmentProcessingState[],
): TranscriptionBarrier {
  if (
    segments.some(
      (segment) =>
        segment.audioStatus === "ready" &&
        segment.transcriptionRunId === runId &&
        segment.transcriptionStatus === "failed",
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
