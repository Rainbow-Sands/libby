import { error, json } from "@sveltejs/kit";
import { getCampaignAccess, getCampaignCast, getSessionDetail } from "@rainbot/db";
import {
  loadDetailedRecordArtifact,
  loadSessionLedgerArtifact,
  loadTranscriptArtifact,
} from "@rainbot/storage";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { createChatInference } from "$lib/server/chat-inference";
import { CHAT_INFERENCE_CONFIG } from "$lib/server/env";
import { buildSessionContext } from "$lib/server/chat-context";
import type { RequestHandler } from "./$types";

const chatInference = createChatInference(CHAT_INFERENCE_CONFIG);

export const POST: RequestHandler = async ({ params, locals, request }) => {
  if (!locals.user) throw error(401, "You must be logged in.");

  const session = await getSessionDetail(params.sessionId);
  if (!session || session.campaignId !== params.id) {
    throw error(404, "Session not found.");
  }

  const access = await getCampaignAccess(session.campaignId, locals.user.id);
  if (!access.canAccess) throw error(403, "You cannot view this campaign.");

  if (!session.detailedRecordArtifact && !session.transcriptArtifact) {
    throw error(409, "This session has no transcript to chat about yet.");
  }

  const { messages }: { messages: UIMessage[] } = await request.json();
  if (!Array.isArray(messages)) {
    return json({ error: "Expected a `messages` array." }, { status: 400 });
  }

  const cast = await getCampaignCast(session.campaignId);
  // Sessions processed with a ledger chat over it and the full transcript.
  // Older sessions keep using their detailed record alone, as before.
  const ledger = session.ledgerArtifact
    ? await loadSessionLedgerArtifact(session.ledgerArtifact)
    : null;
  const detailedRecord =
    !ledger && session.detailedRecordArtifact
      ? await loadDetailedRecordArtifact(session.detailedRecordArtifact)
      : null;
  const transcript =
    detailedRecord || !session.transcriptArtifact
      ? null
      : await loadTranscriptArtifact(session.transcriptArtifact);

  const result = streamText({
    model: chatInference.model,
    // The session material is identical for every question about a session,
    // so let Anthropic cache it instead of re-reading the transcript each turn.
    // Other providers ignore this option.
    system: {
      role: "system",
      content: buildSessionContext({ ...session, detailedRecord, ledger, transcript }, cast),
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    messages: await convertToModelMessages(messages),
    providerOptions: chatInference.providerOptions,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream, sendReasoning: true }),
  });
};
