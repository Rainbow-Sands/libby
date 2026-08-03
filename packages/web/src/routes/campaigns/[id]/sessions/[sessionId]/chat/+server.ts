import { error, json } from "@sveltejs/kit";
import { getCampaignAccess, getCampaignCast, getSessionDetail } from "@rainbot/db";
import { loadDetailedRecordArtifact, loadTranscriptArtifact } from "@rainbot/storage";
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
    throw error(409, "This session has no detailed record or transcript to chat about yet.");
  }

  const { messages }: { messages: UIMessage[] } = await request.json();
  if (!Array.isArray(messages)) {
    return json({ error: "Expected a `messages` array." }, { status: 400 });
  }

  const cast = await getCampaignCast(session.campaignId);
  const detailedRecord = session.detailedRecordArtifact
    ? await loadDetailedRecordArtifact(session.detailedRecordArtifact)
    : null;
  const transcript =
    detailedRecord || !session.transcriptArtifact
      ? null
      : await loadTranscriptArtifact(session.transcriptArtifact);

  const result = streamText({
    model: chatInference.model,
    system: buildSessionContext({ ...session, detailedRecord, transcript }, cast),
    messages: await convertToModelMessages(messages),
    providerOptions: chatInference.providerOptions,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream, sendReasoning: true }),
  });
};
