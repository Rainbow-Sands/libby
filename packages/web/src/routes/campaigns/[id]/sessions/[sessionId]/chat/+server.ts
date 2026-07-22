import { error, json } from "@sveltejs/kit";
import { getCampaignCast, getSessionDetail, isCampaignMember } from "@rainbot/db";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { CHAT_MODEL, CHAT_THINKING_BUDGET, INFERENCE_URL } from "$lib/server/env";
import { buildSessionContext } from "$lib/server/chat-context";
import type { RequestHandler } from "./$types";

// llama.cpp exposes an OpenAI-compatible API at /v1 and requires no auth; the
// apiKey is a placeholder so the SDK doesn't send an empty Authorization header.
const llama = createOpenAICompatible({
  name: "llama",
  baseURL: `${INFERENCE_URL}/v1`,
  apiKey: "-",
});

export const POST: RequestHandler = async ({ params, locals, request }) => {
  if (!locals.user) throw error(401, "You must be logged in.");

  const session = await getSessionDetail(params.sessionId);
  if (!session || session.campaignId !== params.id) {
    throw error(404, "Session not found.");
  }

  const member = await isCampaignMember(session.campaignId, locals.user.id);
  if (!member) throw error(403, "You are not a member of this campaign.");

  if (!session.transcript) {
    throw error(409, "This session has no transcript to chat about yet.");
  }

  const { messages }: { messages: UIMessage[] } = await request.json();
  if (!Array.isArray(messages)) {
    return json({ error: "Expected a `messages` array." }, { status: 400 });
  }

  const cast = await getCampaignCast(session.campaignId);

  const result = streamText({
    model: llama(CHAT_MODEL),
    system: buildSessionContext(session, cast),
    messages: await convertToModelMessages(messages),
    providerOptions: {
      llama: {
        thinking_budget_tokens: CHAT_THINKING_BUDGET,
        chat_template_kwargs: { enable_thinking: CHAT_THINKING_BUDGET !== 0 },
      },
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream, sendReasoning: true }),
  });
};
