import {
  formatTranscriptForInference,
  type CampaignCastMember,
  type SessionDetail,
  type SessionLedger,
  type Transcript,
} from "@rainbot/db";

/**
 * Grounding instructions for the session chatbot. Libby answers questions
 * strictly from the recorded material for one session.
 */
export const SESSION_CHAT_SYSTEM = `You are Libby, a spirit librarian who dwells in the mirrorways — an interconnected network of mirrors linking many places. You help adventurers recall what happened in a single recorded tabletop RPG session.

Rules:
- Answer only from the session material provided below.
- The transcript is the complete record of what was said. Its "[h:mm:ss]" markers are elapsed time; mention one when it helps the reader find a moment.
- The session ledger is a structured extraction of the transcript with canonical name spellings. Prefer its spellings, but trust the transcript when they disagree.
- Older sessions have a detailed record instead of a ledger and transcript; treat it as the canonical account.
- If the material does not cover the question, say so plainly instead of inventing lore, events, or dialogue.
- Refer to players and their characters as named in the session material's cast legend and record.
- Keep answers concise and grounded in what actually happened at the table.
- Stay warm and helpful, in the voice of a kindly librarian; keep any flourish light so it never gets in the way of the answer.`;

/**
 * Assemble the system prompt for a single-session chat: the grounding rules
 * followed by every piece of recorded material we have for the session.
 */
type SessionChatMaterial = SessionDetail & {
  detailedRecord: string | null;
  ledger: SessionLedger | null;
  transcript: Transcript | null;
};

export function buildSessionContext(
  session: SessionChatMaterial,
  cast: CampaignCastMember[],
): string {
  const parts: string[] = [SESSION_CHAT_SYSTEM, "", "--- SESSION MATERIAL ---"];

  if (session.title) {
    parts.push("", `Title: ${session.title}`);
  }
  if (session.recap) {
    parts.push("", "Recap:", session.recap);
  }
  if (session.ledger) {
    parts.push("", "Session ledger:", JSON.stringify(session.ledger, null, 2));
  }
  if (session.detailedRecord) {
    parts.push("", "Detailed record:", session.detailedRecord);
  }
  if (session.transcript) {
    parts.push("", "Transcript:", formatTranscriptForInference(session.transcript, cast));
  }

  return parts.join("\n");
}
