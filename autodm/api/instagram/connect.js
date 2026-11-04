import { baseUrl } from "../../lib/env.js";
import { isAdmin } from "../../lib/auth.js";
import { signedToken } from "../../lib/crypto.js";
import { authorizeUrl } from "../../lib/ig.js";

export function GET(request) {
  const base = baseUrl(request);
  if (!isAdmin(request)) return Response.redirect(`${base}/`, 302);
  const state = signedToken({ ts: Date.now(), n: Math.random().toString(36).slice(2) });
  return Response.redirect(authorizeUrl(`${base}/api/instagram/callback`, state), 302);
}
