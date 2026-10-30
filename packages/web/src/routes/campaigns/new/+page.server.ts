import { error, fail, redirect } from "@sveltejs/kit";
import { canCreateCampaigns, createCampaign } from "@rainbot/db";
import { cleanName } from "$lib/server/campaign-access";
import type { Actions, PageServerLoad } from "./$types";

const NOT_ALLOWED = "Creating campaigns needs an active subscription.";

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/auth/login?returnTo=${encodeURIComponent(url.pathname)}`);
  }
  if (!(await canCreateCampaigns(locals.user.id))) throw error(403, NOT_ALLOWED);
  return {};
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.user) throw error(401, "Please log in to create a campaign.");
    if (!(await canCreateCampaigns(locals.user.id))) throw error(403, NOT_ALLOWED);

    const formData = await request.formData();
    const name = cleanName(formData.get("name"), 200);
    const description = String(formData.get("description") ?? "").trim();
    if (!name) {
      return fail(400, {
        message: "Give the campaign a name of up to 200 characters.",
        description,
      });
    }

    const campaign = await createCampaign({
      name,
      description: description || null,
      dm: locals.user,
    });
    throw redirect(303, `/campaigns/${campaign.id}/members`);
  },
};
