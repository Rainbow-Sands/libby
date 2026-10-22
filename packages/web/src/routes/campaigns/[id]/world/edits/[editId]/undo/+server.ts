import { error, json } from "@sveltejs/kit";
import { WorldEditError, getCampaignAccess, undoWorldEdit } from "@rainbot/db";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) throw error(401, "You must be logged in.");
  const access = await getCampaignAccess(params.id, locals.user.id);
  if (!access.canAccess) throw error(403, "You cannot change this campaign.");

  try {
    await undoWorldEdit(params.id, params.editId, locals.user.id);
    return json({ ok: true });
  } catch (err) {
    if (err instanceof WorldEditError) return json({ error: err.message }, { status: 409 });
    throw err;
  }
};
