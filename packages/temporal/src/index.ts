// Public interface consumed by other packages.
// Activities and worker are internal — not exported here.
export { getTemporalClient } from "./client.ts";
export {
  regenerateSessionWorkflow,
  regenerateTranscriptWorkflow,
  sessionWorkflow,
  segmentRecorded,
  sessionEnded,
  getStatus,
} from "./workflows/session.ts";
export type {
  RegenerateSessionInput,
  RegenerateTranscriptInput,
  SegmentRef,
  SessionInput,
  SessionStatus,
} from "./types.ts";
