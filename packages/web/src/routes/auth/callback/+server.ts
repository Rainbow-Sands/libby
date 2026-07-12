import { error, redirect } from "@sveltejs/kit";
import { exchangeCode, fetchDiscordUser } from "$lib/server/discord";
import { signSession } from "$lib/server/session";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, cookies }) => {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = cookies.get("oauth_state");

  if (!code || !state || !storedState || state !== storedState) {
    throw error(400, "Invalid OAuth state.");
  }
  cookies.delete("oauth_state", { path: "/" });

  const redirectUri = `${url.origin}/auth/callback`;
  const { access_token } = await exchangeCode(code, redirectUri);
  const discordUser = await fetchDiscordUser(access_token);

  cookies.set(
    "session",
    signSession({
      id: discordUser.id,
      username: discordUser.global_name ?? discordUser.username,
    }),
    {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
    },
  );

  throw redirect(303, "/");
};
