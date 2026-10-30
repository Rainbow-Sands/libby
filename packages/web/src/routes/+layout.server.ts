import { isAdmin } from "@rainbot/db";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  return { user: locals.user, isAdmin: locals.user ? await isAdmin(locals.user.id) : false };
};
