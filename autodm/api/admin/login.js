import { env } from "../../lib/env.js";
import { safeEqual } from "../../lib/crypto.js";
import { json, readJson, loginCookie, logoutCookie, isAdmin } from "../../lib/auth.js";

export function GET(request) { return json({ loggedIn: isAdmin(request) }); }
export async function POST(request) {
  const { password, logout } = await readJson(request);
  if (logout) return json({ ok: true }, 200, { "Set-Cookie": logoutCookie() });
  await new Promise((r) => setTimeout(r, 400));
  if (!password || !safeEqual(password, env("ADMIN_PASSWORD"))) return json({ error: "密碼不對" }, 401);
  return json({ ok: true }, 200, { "Set-Cookie": loginCookie() });
}
