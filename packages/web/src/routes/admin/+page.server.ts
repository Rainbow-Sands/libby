import { error, fail, redirect } from "@sveltejs/kit";
import {
  SUBSCRIPTION_STATUSES,
  isAdmin,
  listUsersForAdmin,
  setSubscriptionStatus,
  type SubscriptionStatus,
} from "@rainbot/db";
import type { Actions, PageServerLoad } from "./$types";

async function requireAdmin(user: App.Locals["user"]): Promise<void> {
  if (!user) throw error(401, "Please log in.");
  if (!(await isAdmin(user.id))) throw error(403, "Only admins can see this page.");
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    throw redirect(303, `/auth/login?returnTo=${encodeURIComponent(url.pathname)}`);
  }
  await requireAdmin(locals.user);
  return { users: await listUsersForAdmin() };
};

function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return SUBSCRIPTION_STATUSES.includes(value as SubscriptionStatus);
}

export const actions: Actions = {
  subscription: async ({ request, locals }) => {
    await requireAdmin(locals.user);
    const formData = await request.formData();
    const userId = String(formData.get("userId") ?? "");
    const status = formData.get("status");
    if (!isSubscriptionStatus(status)) {
      return fail(400, { userId, message: "Pick a subscription status." });
    }
    if (!(await setSubscriptionStatus(userId, status))) {
      return fail(404, { userId, message: "That member no longer exists." });
    }
    return { saved: userId };
  },
};
