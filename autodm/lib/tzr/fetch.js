import { json, readJson, isAdmin, unauthorized } from "../auth.js";
import { fetchPost, findUrl } from "../tz_fetch.js";

export async function POST(request) {
  if (!isAdmin(request)) return unauthorized();
  const { url: raw } = await readJson(request);
  const url = findUrl(raw || "") || (raw || "").trim();
  if (!url) return json({ ok: false, error: "請貼上連結" }, 400);
  try {
    const r = await fetchPost(url);
    return json({ url, ...r });
  } catch (e) {
    return json({ ok: false, url, error: e.message }, 500);
  }
}
