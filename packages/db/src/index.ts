export { db } from "./client.ts";
export * from "./schema.ts";
export {
  simplifyTranscript,
  type Transcript,
  type TranscriptSegment,
} from "./transcript.ts";
export {
  createCampaign,
  addCampaignMember,
  removeCampaignMember,
  type CreateCampaignInput,
  type AddCampaignMemberInput,
} from "./campaigns.ts";
export {
  getCampaignsForGuild,
  getCampaignsForUser,
  isCampaignMember,
  getCampaignMeta,
  getCampaignCast,
  getCampaignDetail,
  getSessionDetail,
  type CampaignMember,
  type CampaignCastMember,
  type CampaignSessionSummary,
  type CampaignDetail,
  type SessionDetail,
} from "./queries.ts";
export {
  upsertSession,
  setSessionStatus,
  setSessionTitle,
  saveTranscript,
  saveSummary,
  saveRecap,
  type UpsertSessionInput,
} from "./sessions.ts";
