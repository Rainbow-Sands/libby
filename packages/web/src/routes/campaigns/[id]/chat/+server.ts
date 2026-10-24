import { error, json } from "@sveltejs/kit";
import {
  getCampaignAccess,
  getCampaignCast,
  getCampaignName,
  getSessionDetail,
  getWorldPageHistory,
  getWorldSummary,
  listWorldCorrections,
  listWorldSessions,
} from "@rainbot/db";
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
import {
  CHAT_STOP,
  buildCampaignSystem,
  buildViewSystem,
  campaignChatTools,
  formatPageContent,
  parseChatContext,
  type SessionViewMaterial,
} from "$lib/server/campaign-chat";
import { createChatInference } from "$lib/server/chat-inference";
import { CHAT_INFERENCE_CONFIG } from "$lib/server/env";
import type { RequestHandler } from "./$types";

const chatInference = createChatInference(CHAT_INFERENCE_CONFIG);

export const POST: RequestHandler = async ({ params, locals, request }) => {
  if (!locals.user) throw error(401, "You must be logged in.");

  const body: { messages?: UIMessage[]; context?: unknown } = await request.json();
  if (!Array.isArray(body.messages)) {
    return json({ error: "Expected a `messages` array." }, { status: 400 });
  }
  const context = parseChatContext(body.context);

  const [access, campaignName, cast, allSessions, corrections] = await Promise.all([
    getCampaignAccess(params.id, locals.user.id),
    getCampaignName(params.id),
    getCampaignCast(params.id),
    listWorldSessions(params.id),
    listWorldCorrections(params.id),
  ]);
  if (!access.canAccess) throw error(403, "You cannot view this campaign.");
  if (!campaignName) throw error(404, "Campaign not found.");
  // A page viewed as of a session gets answers from what was known by then:
  // the world, the sessions and the tools all stop at that session.
  const asOf =
    context.kind === "page" && context.asOf
      ? allSessions.find((session) => session.id === context.asOf)
      : undefined;
  const sessions = asOf
    ? allSessions.filter((session) => session.number <= asOf.number)
    : allSessions;
  const world = await getWorldSummary(params.id, asOf ? { through: asOf.startedAt } : {});
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));

  // Sessions processed with a ledger carry it and the full transcript; older
  // ones keep their detailed record instead.
  async function loadSession(sessionId: string): Promise<SessionViewMaterial | null> {
    const session = sessionsById.get(sessionId);
    const detail = session ? await getSessionDetail(sessionId) : null;
    if (!session || !detail || detail.campaignId !== params.id) return null;
    const [ledger, detailedRecord, transcript] = await Promise.all([
      detail.ledgerArtifact ? loadSessionLedgerArtifact(detail.ledgerArtifact) : null,
      !detail.ledgerArtifact && detail.detailedRecordArtifact
        ? loadDetailedRecordArtifact(detail.detailedRecordArtifact)
        : null,
      detail.transcriptArtifact ? loadTranscriptArtifact(detail.transcriptArtifact) : null,
    ]);
    return {
      session,
      recap: detail.recap,
      recapSections: detail.recapSections?.sections ?? null,
      ledger,
      detailedRecord,
      transcript,
    };
  }

  let view = `The person is on the campaign's home page.`;
  let sessionMaterial: SessionViewMaterial | null = null;
  if (context.kind === "world") {
    view = "The person is on the world wiki's index of every page.";
  } else if (context.kind === "page") {
    const history = await getWorldPageHistory(params.id, context.slug);
    const current = history?.revisions
      .filter((revision) => sessionsById.has(revision.sessionId))
      .at(-1)?.content;
    if (history && current) {
      const page = formatPageContent(history.slug, history.kind, current, sessionsById);
      view = asOf
        ? `The person is looking at this world page as it stood after session ${asOf.number}, and only the campaign up to that session is shown to you. Answer from what was known by then. If they ask about later events, say the page's latest view covers them.\n\n${page}`
        : `The person is looking at this world page:\n\n${page}`;
    }
  } else if (context.kind === "session") {
    sessionMaterial = await loadSession(context.sessionId);
    if (sessionMaterial) {
      const { number, title } = sessionMaterial.session;
      view = `The person is looking at session ${number}: ${title ?? "Untitled"} [${sessionMaterial.session.id}]. Its recap and ledger follow; read its transcript with readTranscript when they don't answer the question.`;
    }
  }

  const tools = campaignChatTools({ campaignId: params.id, sessions, loadSession, cast });
  const result = streamText({
    model: chatInference.model,
    system: [
      buildCampaignSystem({ campaignName, cast, sessions, world, corrections }),
      buildViewSystem(view, sessionMaterial),
    ],
    messages: await convertToModelMessages(body.messages, { tools }),
    tools,
    stopWhen: CHAT_STOP,
    providerOptions: chatInference.providerOptions,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream, sendReasoning: true }),
  });
};
