import { env, graphBase } from "./env.js";

export class MetaError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

async function call(url, { method = "GET", token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  if (form) { headers["Content-Type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(form).toString(); }
  const res = await fetch(url, { method, headers, body: payload });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok || data.error) {
    const e = data.error || {};
    throw new MetaError(e.message || data.error_message || `HTTP ${res.status}`, e.code);
  }
  return data;
}

export const SCOPES = "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments";

export function authorizeUrl(redirectUri, state) {
  const p = new URLSearchParams({ client_id: env("INSTAGRAM_APP_ID"), redirect_uri: redirectUri, scope: SCOPES, response_type: "code", state });
  return `https://www.instagram.com/oauth/authorize?${p}`;
}

export async function exchangeCode(code, redirectUri) {
  const d = await call("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    form: { client_id: env("INSTAGRAM_APP_ID"), client_secret: env("INSTAGRAM_APP_SECRET"), grant_type: "authorization_code", redirect_uri: redirectUri, code },
  });
  return d.access_token;
}

export async function longLived(shortToken) {
  const u = new URL(`${graphBase()}/access_token`);
  u.searchParams.set("grant_type", "ig_exchange_token");
  u.searchParams.set("client_secret", env("INSTAGRAM_APP_SECRET"));
  u.searchParams.set("access_token", shortToken);
  const d = await call(u.toString());
  return { token: d.access_token, expiresIn: d.expires_in ?? 5184000 };
}

export async function refresh(token) {
  const u = new URL(`${graphBase()}/refresh_access_token`);
  u.searchParams.set("grant_type", "ig_refresh_token");
  u.searchParams.set("access_token", token);
  const d = await call(u.toString());
  return { token: d.access_token, expiresIn: d.expires_in ?? 5184000 };
}

export async function me(token) {
  const u = new URL(`${graphBase()}/me`);
  u.searchParams.set("fields", "id,user_id,username");
  u.searchParams.set("access_token", token);
  const d = await call(u.toString());
  return { igId: String(d.user_id ?? d.id), username: d.username };
}

export async function subscribe(igId, token) {
  return call(`${graphBase()}/${igId}/subscribed_apps`, { method: "POST", token, body: { subscribed_fields: ["comments", "messages"] } });
}

/** recipient is { comment_id } for a private reply to a comment, or { id } for a normal DM. */
export async function sendMessage(igId, token, recipient, message) {
  return call(`${graphBase()}/${igId}/messages`, { method: "POST", token, body: { recipient, message } });
}

export async function replyToComment(commentId, token, text) {
  return call(`${graphBase()}/${commentId}/replies`, { method: "POST", token, body: { message: text } });
}

/** The account's latest posts and Reels (newest first), for picking one post in a rule. */
export async function recentMedia(token, limit = 30) {
  const u = new URL(`${graphBase()}/me/media`);
  u.searchParams.set("fields", "id,caption,media_type,permalink,timestamp,thumbnail_url,media_url");
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("access_token", token);
  const d = await call(u.toString());
  return (d.data || []).map((m) => ({
    id: String(m.id),
    caption: String(m.caption || "").replace(/\s+/g, " ").slice(0, 60),
    type: m.media_type,
    date: m.timestamp,
    link: m.permalink,
    thumb: m.thumbnail_url || (m.media_type === "VIDEO" ? null : m.media_url) || null,
  }));
}
