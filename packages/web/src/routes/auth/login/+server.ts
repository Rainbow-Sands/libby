import { redirect } from "@sveltejs/kit";
import { randomBytes } from "node:crypto";
import { getAuthorizeUrl } from "$lib/server/discord";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ url, cookies }) => {
  const state = randomBytes(16).toString("hex");
  cookies.set("oauth_state", state, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
  });

  // Only same-site paths, so the login flow cannot be used as an open redirect.
  const returnTo = url.searchParams.get("returnTo");
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//") && !returnTo.includes("\\")) {
    cookies.set("oauth_return", returnTo, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 600,
    });
  } else {
    cookies.delete("oauth_return", { path: "/" });
  }

  const redirectUri = `${url.origin}/auth/callback`;
  throw redirect(302, getAuthorizeUrl(redirectUri, state));
};
