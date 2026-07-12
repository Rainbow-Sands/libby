import type { Handle } from "@sveltejs/kit";
import { verifySession } from "$lib/server/session";

export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get("session");
  event.locals.user = token ? verifySession(token) : null;

  // Render the saved theme into the <html> tag so SSR produces the correct
  // theme with no flash. With no cookie, the attribute is omitted and the CSS
  // media query follows the system preference.
  const theme = event.cookies.get("theme");
  const themeAttr = theme === "dark" || theme === "light" ? ` data-theme="${theme}"` : "";

  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace("%theme%", themeAttr),
  });
};
