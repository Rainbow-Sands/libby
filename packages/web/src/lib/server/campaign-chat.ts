import {
  formatRecapFields,
  formatTranscriptForInference,
  getWorldPageHistory,
  previewCampaignWorldEdit,
  summaryLine,
  worldEditSchema,
  type CampaignCastMember,
  type RecapSections,
  type SessionLedger,
  type Transcript,
  type WorldPageContent,
  type WorldPageSummary,
  type WorldSession,
} from "@rainbot/db";
import { isStepCount, tool, type SystemModelMessage } from "ai";
import { z } from "zod";
import type { ProposedWorldEdit } from "$lib/world-edit";

// Where the person is when they ask, so "this page" means something.
export type ChatContext =
  | { kind: "campaign" }
  | { kind: "world" }
  // asOf is the session a page is viewed as of, or null for the latest.
  | { kind: "page"; slug: string; asOf: string | null }
  | { kind: "session"; sessionId: string };

export function parseChatContext(value: unknown): ChatContext {
  const context = value as Partial<{
    kind: string;
    slug: string;
    asOf: string | null;
    sessionId: string;
  }> | null;
  if (context?.kind === "page" && typeof context.slug === "string") {
    return {
      kind: "page",
      slug: context.slug,
      asOf: typeof context.asOf === "string" ? context.asOf : null,
    };
  }
  if (context?.kind === "session" && typeof context.sessionId === "string") {
    return { kind: "session", sessionId: context.sessionId };
  }
  if (context?.kind === "world") return { kind: "world" };
  return { kind: "campaign" };
}

export const CAMPAIGN_CHAT_SYSTEM = `You are Libby, a spirit librarian who dwells in the mirrorways, an interconnected network of mirrors linking many places. You help a tabletop RPG group with their campaign: you answer questions about what happened, and you fix mistakes in the campaign's world wiki when they ask.

## Answering
- Answer from the campaign material below and from what your tools return. Before answering a detailed question about a session or a page, read it with a tool. If the material does not cover something, say so plainly instead of inventing lore, events or dialogue.
- "This page", "here", "this session" and questions with no clear subject refer to current_view.
- Refer to sessions by number and title. Transcript "[h:mm:ss]" markers are elapsed time; mention one when it helps the reader find a moment.

## Fixing the wiki
- When someone points out a mistake or asks for a change, read every page involved with readPage first, then call proposeChanges with the smallest set of changes that fixes it.
- Use rename for a wrong or misspelled name, removeAlias for a wrong other name, editFact or removeFact for a wrong fact, split when one page wrongly holds two different things, and merge when two pages are the same thing.
- Facts are referred to by their #id from readPage.
- "Referred to as" lists descriptions that only mean the page in context, such as "the children", and never link to it. Use addAlias only when one really means nothing else in the campaign, and removeAlias when it never meant this page.
- Set remember to one sentence when the mistake could happen again in later sessions, such as two names that are easy to confuse or a thing recorded as the wrong kind. Leave it null for one-off updates, such as who holds an item now.
- If proposeChanges returns problems, correct the proposal and call it again.
- You never apply changes yourself. The person reviews your proposal on a card and applies it. After proposing, explain the fix in a sentence or two without repeating the card's details. Never say you have updated, changed or fixed anything: say what the proposal would do.
- Recaps can be fixed too. Read the session with readSession first: its recap fields are listed with their ids in square brackets. Use editRecap to replace the exact words in one field, quoting enough of the sentence that they occur once, and replaceInRecaps for a name or phrase that is wrong in many recaps, such as a misspelling. When a wrong detail is in both a recap and the wiki, fix both in one proposal.
- You cannot change transcripts. Say so if asked.

Keep answers short and grounded in what happened at the table. Stay warm, in the voice of a kindly librarian, with any flourish light enough that it never gets in the way.`;

function tagged(name: string, body: string): string {
  return `<${name}>\n${body.trim()}\n</${name}>`;
}

function formatSessionLine(session: WorldSession): string {
  const date = session.startedAt.toISOString().slice(0, 10);
  return `- Session ${session.number} [${session.id}] ${date}: ${session.title ?? "Untitled"}`;
}

function formatIndexLine(page: WorldPageSummary): string {
  const { content } = page;
  const status = content.status ? `, ${content.status}` : "";
  const also = content.aliases.length ? `; also ${content.aliases.join(", ")}` : "";
  const refs = content.references.length ? `; referred to as ${content.references.join(", ")}` : "";
  const line = summaryLine(content.summary);
  return `- [${page.slug}] ${content.name} (${page.kind}${status}${also}${refs})${line ? `: ${line}` : ""}`;
}

export function formatPageContent(
  slug: string,
  kind: string,
  content: WorldPageContent,
  sessionsById: Map<string, WorldSession>,
): string {
  const lines = [
    `[${slug}] ${content.name} (${kind}${content.status ? `, ${content.status}` : ""})`,
  ];
  if (content.aliases.length) lines.push(`Other names: ${content.aliases.join(", ")}`);
  if (content.references.length) {
    lines.push(`Referred to as: ${content.references.join(", ")}`);
  }
  if (content.holder) lines.push(`Held by: ${content.holder}`);
  if (content.summary) lines.push(`Summary: ${content.summary}`);
  if (content.related.length) lines.push(`Related: ${content.related.join(", ")}`);
  for (const fact of content.facts) {
    const from = sessionsById.get(fact.sessionId)?.number;
    const retired = fact.supersededIn
      ? ` (outdated since session ${sessionsById.get(fact.supersededIn)?.number ?? "?"})`
      : "";
    lines.push(`#${fact.id} ${fact.text} [session ${from ?? "?"}]${retired}`);
  }
  return lines.join("\n");
}

export interface CampaignChatMaterial {
  campaignName: string;
  cast: CampaignCastMember[];
  sessions: WorldSession[];
  world: WorldPageSummary[];
  corrections: string[];
}

// The campaign-wide part of the prompt. It is the same for every question in a
// campaign until the world changes, so it is cached separately from the view.
export function buildCampaignSystem(material: CampaignChatMaterial): SystemModelMessage {
  const cast = material.cast.length
    ? material.cast.map((member) => `- ${member.characterName}, played by ${member.username}`)
    : ["- No player characters are registered."];
  const content = [
    CAMPAIGN_CHAT_SYSTEM,
    tagged("campaign", `Name: ${material.campaignName}\n\nCast:\n${cast.join("\n")}`),
    tagged("sessions", material.sessions.map(formatSessionLine).join("\n") || "No sessions yet."),
    tagged("world", material.world.map(formatIndexLine).join("\n") || "No pages yet."),
    ...(material.corrections.length
      ? [tagged("corrections", material.corrections.map((note) => `- ${note}`).join("\n"))]
      : []),
  ].join("\n\n");
  return {
    role: "system",
    content,
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
  };
}

export interface SessionViewMaterial {
  session: WorldSession;
  recap: string | null;
  // The recap's fields with their ids, for fixing; null for an older recap
  // written as one block of text.
  recapSections: RecapSections | null;
  ledger: SessionLedger | null;
  detailedRecord: string | null;
  transcript: Transcript | null;
}

export function buildViewSystem(
  view: string,
  session: SessionViewMaterial | null,
): SystemModelMessage {
  const parts = [tagged("current_view", view)];
  if (session) {
    if (session.recap) parts.push(tagged("session_recap", session.recap));
    if (session.recapSections) {
      parts.push(tagged("session_recap_fields", formatRecapFields(session.recapSections)));
    }
    if (session.ledger) parts.push(tagged("session_ledger", JSON.stringify(session.ledger)));
    if (session.detailedRecord) parts.push(tagged("session_record", session.detailedRecord));
    // The transcript is long, so it is read with readTranscript only when the
    // recap and ledger don't answer the question.
  }
  return {
    role: "system",
    content: parts.join("\n\n"),
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
  };
}

export interface ChatToolSources {
  campaignId: string;
  // Only the sessions the person may hear about: all of them, or those up to
  // the session the page is viewed as of.
  sessions: WorldSession[];
  loadSession: (sessionId: string) => Promise<SessionViewMaterial | null>;
  cast: CampaignCastMember[];
}

function findSession(sessions: WorldSession[], ref: string): WorldSession | undefined {
  const number = Number(ref.replace(/^session\s*/i, ""));
  return (
    sessions.find((session) => session.id === ref) ??
    (Number.isInteger(number) ? sessions.find((session) => session.number === number) : undefined)
  );
}

const sessionRef = z.string().describe("The session's id in square brackets, or its number");

export function campaignChatTools(sources: ChatToolSources) {
  const sessionsById = new Map(sources.sessions.map((session) => [session.id, session]));
  return {
    readPage: tool({
      description:
        "Read a world page in full: its facts with #ids, and how it read after each session that changed it.",
      inputSchema: z.object({ page: z.string().describe("The page's slug or exact name") }),
      execute: async ({ page }) => {
        const history = await getWorldPageHistory(sources.campaignId, page);
        // Revisions from sessions after the as-of bound are left out.
        const revisions = history?.revisions.filter((revision) =>
          sessionsById.has(revision.sessionId),
        );
        if (!history || !revisions?.length) return `No page is called "${page}".`;
        const current = revisions.at(-1)!;
        const changes = revisions
          .map((revision) => sessionsById.get(revision.sessionId))
          .filter((session) => session !== undefined)
          .map((session) => `session ${session.number}`);
        return [
          formatPageContent(history.slug, history.kind, current.content, sessionsById),
          "",
          `Changed in: ${changes.join(", ")}`,
        ].join("\n");
      },
    }),
    readSession: tool({
      description:
        "Read a session's recap, with the id of each recap field for fixing it, and its ledger, the structured record of what happened.",
      inputSchema: z.object({ session: sessionRef }),
      execute: async ({ session }) => {
        const found = findSession(sources.sessions, session);
        const material = found ? await sources.loadSession(found.id) : null;
        if (!found || !material) return `There is no session "${session}".`;
        return [
          formatSessionLine(found),
          material.recap ?? "No recap yet.",
          material.recapSections
            ? `Recap fields, by id:\n${formatRecapFields(material.recapSections)}`
            : "",
          material.ledger ? `Ledger:\n${JSON.stringify(material.ledger)}` : "",
          material.detailedRecord ?? "",
        ]
          .filter(Boolean)
          .join("\n\n");
      },
    }),
    readTranscript: tool({
      description:
        "Read a session's full transcript. It is long, so use it only when the recap and ledger do not answer the question.",
      inputSchema: z.object({ session: sessionRef }),
      execute: async ({ session }) => {
        const found = findSession(sources.sessions, session);
        const material = found ? await sources.loadSession(found.id) : null;
        if (!found || !material?.transcript) return `There is no transcript for "${session}".`;
        return formatTranscriptForInference(material.transcript, sources.cast);
      },
    }),
    proposeChanges: tool({
      description:
        "Propose changes to the world wiki. Nothing is written: the person sees every affected page and applies or cancels the proposal.",
      inputSchema: worldEditSchema,
      execute: async (edit): Promise<ProposedWorldEdit> => {
        const preview = await previewCampaignWorldEdit(sources.campaignId, edit);
        const mentioned = [
          preview.fromSessionId,
          ...preview.pages.map((p) => p.fromSessionId),
          ...preview.recaps.flatMap((group) => group.sessionIds),
        ];
        return {
          ...preview,
          sessionNumbers: Object.fromEntries(
            mentioned.flatMap((id) => {
              const number = id ? sessionsById.get(id)?.number : undefined;
              return id && number ? [[id, number]] : [];
            }),
          ),
        };
      },
      toModelOutput: ({ output }) => ({
        type: "text",
        value: output.errors.length
          ? `Problems, nothing was shown: ${output.errors.join(" ")}`
          : `Shown to the person for review, not applied yet: ${output.pages.length} pages and ${output.recaps.flatMap((group) => group.sessionIds).length} recaps affected.`,
      }),
    }),
  };
}

export const CHAT_STOP = isStepCount(12);
