import { describe, expect, it } from "vitest";
import { evaluateTranscriptionBarrier, type SegmentProcessingState } from "./processing-state.ts";

const completed: SegmentProcessingState = {
  audioStatus: "ready",
  transcriptionRunId: "run-1",
  transcriptionStatus: "completed",
};

describe("transcription completion barrier", () => {
  it("does not need an expected count when every registered segment is complete", () => {
    expect(evaluateTranscriptionBarrier("run-1", [completed, completed])).toBe("ready");
    expect(evaluateTranscriptionBarrier("run-1", [])).toBe("ready");
  });

  it("waits for recording, pending, and stale-run segments", () => {
    expect(
      evaluateTranscriptionBarrier("run-1", [
        { ...completed, audioStatus: "recording", transcriptionStatus: null },
      ]),
    ).toBe("waiting");
    expect(
      evaluateTranscriptionBarrier("run-1", [{ ...completed, transcriptionStatus: "pending" }]),
    ).toBe("waiting");
    expect(
      evaluateTranscriptionBarrier("run-1", [{ ...completed, transcriptionRunId: "old-run" }]),
    ).toBe("waiting");
  });

  it("ignores deliberately discarded clips and surfaces permanent failures", () => {
    expect(
      evaluateTranscriptionBarrier("run-1", [
        completed,
        {
          audioStatus: "discarded",
          transcriptionRunId: "run-1",
          transcriptionStatus: null,
        },
      ]),
    ).toBe("ready");
    expect(
      evaluateTranscriptionBarrier("run-1", [{ ...completed, transcriptionStatus: "failed" }]),
    ).toBe("failed");
  });
});
