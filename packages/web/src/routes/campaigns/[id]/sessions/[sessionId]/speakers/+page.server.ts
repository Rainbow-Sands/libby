import { error, fail, redirect } from "@sveltejs/kit";
import {
  getCampaignAccess,
  getCampaignDetail,
  getCampaignVoices,
  getSessionDetail,
  getSessionSpeakers,
  matchVoice,
  saveSpeakerAssignments,
  startSpeakerReaggregation,
  type SpeakerChoice,
} from "@rainbot/db";
import { cleanName } from "$lib/server/campaign-access";
import type { Actions, PageServerLoad } from "./$types";

async function requireMember(campaignId: string, sessionId: string, userId: string | undefined) {
  if (!userId) throw redirect(303, "/");
  const [access, session] = await Promise.all([
    getCampaignAccess(campaignId, userId),
    getSessionDetail(sessionId),
  ]);
  if (!session || session.campaignId !== campaignId) throw error(404, "Session not found.");
  if (!access.isMember && !access.isAdmin) {
    throw error(403, "Only the campaign's members can name its speakers.");
  }
  return session;
}

export const load: PageServerLoad = async ({ params, locals }) => {
  await requireMember(params.id, params.sessionId, locals.user?.id);
  const [speakers, campaign, voices] = await Promise.all([
    getSessionSpeakers(params.sessionId),
    getCampaignDetail(params.id),
    getCampaignVoices(params.id, params.sessionId),
  ]);
  if (!speakers || !campaign) throw error(404, "This session has no speakers to name.");

  const usernames = new Map(campaign.members.map((member) => [member.id, member.username]));
  return {
    campaign: { id: campaign.id, name: campaign.name, members: campaign.members },
    sessionId: params.sessionId,
    status: speakers.status,
    confirmed: speakers.confirmedAt !== null,
    speakers: speakers.speakers.map(({ embedding, ...speaker }) => {
      // Remembered voices only prefill a speaker nobody has named yet.
      const match = matchVoice(embedding, voices);
      return {
        ...speaker,
        suggestion:
          match && usernames.has(match.userId)
            ? {
                userId: match.userId,
                username: usernames.get(match.userId)!,
                score: Math.round(match.score * 100),
              }
            : null,
      };
    }),
  };
};

function readChoices(form: FormData): SpeakerChoice[] | null {
  const choices: SpeakerChoice[] = [];
  for (const [key, value] of form) {
    if (!key.startsWith("choice:") || typeof value !== "string") continue;
    const label = key.slice("choice:".length);
    if (value === "ignore") choices.push({ label, kind: "ignore" });
    else if (value === "guest") {
      const name = cleanName(form.get(`guest:${label}`), 100);
      choices.push(name ? { label, kind: "guest", name } : { label, kind: "unset" });
    } else if (value.startsWith("member:")) {
      choices.push({ label, kind: "member", userId: value.slice("member:".length) });
    } else if (value === "") choices.push({ label, kind: "unset" });
    else return null;
  }
  return choices;
}

async function save(
  params: { id: string; sessionId: string },
  locals: App.Locals,
  request: Request,
  confirm: boolean,
) {
  await requireMember(params.id, params.sessionId, locals.user?.id);
  const campaign = await getCampaignDetail(params.id);
  const choices = readChoices(await request.formData());
  const members = new Set(campaign?.members.map((member) => member.id));
  if (
    !choices ||
    choices.some((choice) => choice.kind === "member" && !members.has(choice.userId))
  ) {
    return fail(400, {
      message: "Each speaker must be a member, a guest, or not part of the game.",
    });
  }

  const result = await saveSpeakerAssignments(params.sessionId, choices, confirm);
  if (result.status === "not-found") throw error(404, "This session has no speakers to name.");
  if (result.status === "incomplete") {
    return fail(400, { message: "Name every speaker before confirming." });
  }
  if (result.status === "saved") return { saved: true };

  // The session already went through the pipeline, so its transcript and
  // recap are written again with the new names.
  if (!result.runId) {
    const session = await getSessionDetail(params.sessionId);
    if (session?.transcriptArtifact) {
      try {
        await startSpeakerReaggregation(params.sessionId);
      } catch (err) {
        if (err instanceof Error && err.message.includes("already being processed")) {
          return fail(409, {
            message: "This session is being processed. Try again when it finishes.",
          });
        }
        throw err;
      }
    }
  }
  throw redirect(303, `/campaigns/${params.id}/sessions/${params.sessionId}`);
}

export const actions: Actions = {
  save: ({ params, locals, request }) => save(params, locals, request, false),
  confirm: ({ params, locals, request }) => save(params, locals, request, true),
};
