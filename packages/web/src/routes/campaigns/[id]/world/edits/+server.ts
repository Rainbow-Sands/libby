import { error, json } from "@sveltejs/kit";
import { WorldEditError, applyWorldEdit, getCampaignAccess, worldEditSchema } from "@rainbot/db";
import type { RequestHandler } from "./$types";

// Applies a change Libby proposed, exactly as the person reviewed it.
export const POST: RequestHandler = async ({ params, locals, request }) => {
  if (!locals.user) throw error(401, "You must be logged in.");
  const access = await getCampaignAccess(params.id, locals.user.id);
  if (!access.canAccess) throw error(403, "You cannot change this campaign.");

  const parsed = worldEditSchema.safeParse(await request.json());
  if (!parsed.success) return json({ error: "That change is not valid." }, { status: 400 });
  try {
    const { editId, preview } = await applyWorldEdit(params.id, locals.user.id, parsed.data);
    return json({ editId, preview });
  } catch (err) {
    if (err instanceof WorldEditError) return json({ error: err.message }, { status: 409 });
    throw err;
  }
};
