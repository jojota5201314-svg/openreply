import { json, readJson, isAdmin, unauthorized } from "../../lib/auth.js";
import { shareKey } from "../../lib/tz_db.js";
import { baseUrl } from "../../lib/env.js";

export async function GET(request) {
  if (!isAdmin(request)) return unauthorized();
  const key = await shareKey();
  return json({ key, url: `${baseUrl(request)}/api/tz/posts?key=${key}`, ai: Boolean(process.env.ANTHROPIC_API_KEY), apify: Boolean(process.env.APIFY_TOKEN) });
}
export async function POST(request) {
  if (!isAdmin(request)) return unauthorized();
  const { rotate } = await readJson(request);
  const key = await shareKey(Boolean(rotate));
  return json({ key, url: `${baseUrl(request)}/api/tz/posts?key=${key}` });
}
