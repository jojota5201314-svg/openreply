import { json, readJson, isAdmin, unauthorized } from "../auth.js";
import { shareKey } from "../tz_db.js";
import { baseUrl } from "../env.js";

export async function GET(request) {
  if (!isAdmin(request)) return unauthorized();
  const key = await shareKey();
  return json({ key, url: `${baseUrl(request)}/api/tz?a=posts&key=${key}`, ai: Boolean(process.env.ANTHROPIC_API_KEY), apify: Boolean(process.env.APIFY_TOKEN) });
}
export async function POST(request) {
  if (!isAdmin(request)) return unauthorized();
  const { rotate } = await readJson(request);
  const key = await shareKey(Boolean(rotate));
  return json({ key, url: `${baseUrl(request)}/api/tz?a=posts&key=${key}` });
}
