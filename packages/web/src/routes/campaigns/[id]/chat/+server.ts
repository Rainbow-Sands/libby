import { error, json } from "@sveltejs/kit";
import { getCampaignAccess, getCampaignCast, getCampaignDetail } from "@rainbot/db";
import { createKnowledgeService } from "@rainbot/knowledge";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { buildCampaignContext } from "$lib/server/chat-context";
import { createChatInference } from "$lib/server/chat-inference";
import { CHAT_INFERENCE_CONFIG, RAG_CONFIG, S3_BUCKET_ARTIFACT } from "$lib/server/env";
import type { RequestHandler } from "./$types";

const chatInference = createChatInference(CHAT_INFERENCE_CONFIG);
const knowledgeService = createKnowledgeService(RAG_CONFIG);

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

function retrievalQuery(messages: UIMessage[]): string {
  return messages
    .filter((message) => message.role === "user")
    .slice(-3)
    .map(messageText)
    .filter(Boolean)
    .join("\n");
}

export const POST: RequestHandler = async ({ params, locals, request }) => {
  if (!locals.user) throw error(401, "You must be logged in.");
  if (!knowledgeService) throw error(503, "Campaign knowledge retrieval is not configured.");

  const access = await getCampaignAccess(params.id, locals.user.id);
  if (!access.canAccess) throw error(403, "You cannot view this campaign.");
  const campaign = await getCampaignDetail(params.id);
  if (!campaign) throw error(404, "Campaign not found.");

  const { messages }: { messages: UIMessage[] } = await request.json();
  if (!Array.isArray(messages)) {
    return json({ error: "Expected a `messages` array." }, { status: 400 });
  }
  const query = retrievalQuery(messages);
  if (!query) return json({ error: "Ask a question to search the campaign." }, { status: 400 });

  const [cast, chunks] = await Promise.all([
    getCampaignCast(params.id),
    knowledgeService.retrieveCampaign({
      artifactBucket: S3_BUCKET_ARTIFACT,
      campaignId: params.id,
      query,
    }),
  ]);
  const result = streamText({
    model: chatInference.model,
    system: buildCampaignContext(campaign, cast, chunks),
    messages: await convertToModelMessages(messages),
    providerOptions: chatInference.providerOptions,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream, sendReasoning: true }),
  });
};
