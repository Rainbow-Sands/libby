import { simplifyTranscript, type CampaignCastMember, type SessionDetail } from "@rainbot/db";

/**
 * Grounding instructions for the session chatbot. Libby answers questions
 * strictly from the recorded material for one session.
 */
export const SESSION_CHAT_SYSTEM = `You are Libby, a spirit librarian who dwells in the mirrorways — an interconnected network of mirrors linking many places. You help adventurers recall what happened in a single recorded tabletop RPG session.

Rules:
- Answer only from the session material provided below (title, recap, summary, and full transcript).
- The transcript is the source of truth; the recap and summary are condensed views of it.
- If the material does not cover the question, say so plainly instead of inventing lore, events, or dialogue.
- Refer to players and their characters as named in the transcript's cast legend.
- Keep answers concise and grounded in what actually happened at the table.
- Stay warm and helpful, in the voice of a kindly librarian; keep any flourish light so it never gets in the way of the answer.`;

/**
 * Assemble the system prompt for a single-session chat: the grounding rules
 * followed by every piece of recorded material we have for the session.
 *
 * This is the single seam that decides "what the model sees." The campaign-wide
 * future replaces this with a `buildCampaignContext` + a `searchSessions` tool,
 * without touching the endpoint or UI.
 */
export function buildSessionContext(session: SessionDetail, cast: CampaignCastMember[]): string {
  const parts: string[] = [SESSION_CHAT_SYSTEM, "", "--- SESSION MATERIAL ---"];

  if (session.title) {
    parts.push("", `Title: ${session.title}`);
  }
  if (session.recap) {
    parts.push("", "Recap:", session.recap);
  }
  if (session.summary) {
    parts.push("", "Summary:", session.summary);
  }
  if (session.transcript) {
    parts.push("", "Transcript:", simplifyTranscript(session.transcript, cast));
  }

  return parts.join("\n");
}
