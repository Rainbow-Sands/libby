// Public interface consumed by other packages.
// Activities and worker are internal — not exported here.
export { getTemporalClient } from "./client.ts";
export { sessionWorkflow, segmentRecorded, sessionEnded, getStatus } from "./workflows/session.ts";
export type { SegmentRef, SessionInput, SessionStatus } from "./types.ts";
