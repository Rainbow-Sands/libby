import { error, fail, redirect } from "@sveltejs/kit";
import { getCampaignReminder, getCampaignSettings, updateCampaignDetails } from "@rainbot/db";
import { cleanName, requireCampaignManager } from "$lib/server/campaign-access";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/auth/login?returnTo=${encodeURIComponent(url.pathname)}`);
  }
  const [, settings, reminder] = await Promise.all([
    requireCampaignManager(params.id, locals.user.id),
    getCampaignSettings(params.id),
    getCampaignReminder(params.id),
  ]);
  if (!settings) throw error(404, "Campaign not found.");

  return {
    campaign: {
      id: settings.id,
      name: settings.name,
      description: settings.description,
      guildName: settings.guildName,
    },
    reminderChannel: reminder
      ? (reminder.channelName ?? "the channel where /reminder was run")
      : null,
  };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    if (!locals.user) throw error(401, "Please log in to change the campaign.");
    await requireCampaignManager(params.id, locals.user.id);

    const formData = await request.formData();
    const name = cleanName(formData.get("name"), 200);
    const description = String(formData.get("description") ?? "").trim();
    if (!name) return fail(400, { message: "Give the campaign a name of up to 200 characters." });

    await updateCampaignDetails(params.id, { name, description: description || null });
    return { saved: true };
  },
};
