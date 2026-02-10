/**
 * Basic authentication middleware for NutriAgent.
 *
 * @developer Eduardo Arana
 *
 * Checks the `Authorization: Basic <base64>` header against the
 * AUTH_USER and AUTH_PASS secrets. If auth is disabled (no secrets set),
 * all requests pass through.
 *
 * Returns a login HTML page on 401 instead of a bare browser prompt
 * for a better UX.
 */

import type { Env } from "./types";
import LOGIN_HTML from "./public/login.html";

/** Check if authentication is configured (secrets are set). */
export function isAuthEnabled(env: Env): boolean {
  return Boolean(env.AUTH_USER && env.AUTH_PASS);
}

/**
 * Validate the request's Basic auth credentials.
 * Returns `null` if valid (or auth disabled), or a 401 Response.
 */
export function checkAuth(request: Request, env: Env): Response | null {
  if (!isAuthEnabled(env)) return null; // auth not configured — allow

  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Basic ")) {
    return unauthorizedResponse();
  }

  const decoded = atob(auth.slice(6));
  const [user, ...passParts] = decoded.split(":");
  const pass = passParts.join(":"); // password may contain colons

  if (user === env.AUTH_USER && pass === env.AUTH_PASS) {
    return null; // valid
  }

  return unauthorizedResponse();
}

function unauthorizedResponse(): Response {
  return new Response(LOGIN_HTML, {
    status: 401,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "WWW-Authenticate": 'Basic realm="NutriAgent"',
    },
  });
}
