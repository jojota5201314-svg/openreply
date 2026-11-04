import { signedToken, readSignedToken } from "./crypto.js";

const COOKIE = "jojo_admin";
const MAX_AGE = 30 * 24 * 3600 * 1000;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}
function cookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function isAdmin(request) {
  return Boolean(readSignedToken(cookies(request)[COOKIE], MAX_AGE));
}
export function loginCookie() {
  return `${COOKIE}=${encodeURIComponent(signedToken({ ts: Date.now() }))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE / 1000}`;
}
export const logoutCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export const unauthorized = () => json({ error: "請先登入" }, 401);
export async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}
