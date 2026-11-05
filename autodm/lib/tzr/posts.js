import { json, readJson, isAdmin, unauthorized } from "../auth.js";
import { tq, slimPost, shareKey } from "../tz_db.js";
import { findUrl, platformOf } from "../tz_fetch.js";
import { safeEqual } from "../crypto.js";
import { kick } from "../tz_jobs.js";

export async function GET(request) {
  if (!isAdmin(request)) return unauthorized();
  const rows = await tq("SELECT * FROM tz_posts ORDER BY id DESC LIMIT 2000");
  return json({ posts: rows.map(slimPost) });
}

// 新增:App 裡貼上,或 iPhone 捷徑分享(帶 key)
export async function POST(request) {
  const u = new URL(request.url);
  let body = await readJson(request);
  if (!body || typeof body !== "object") body = {};
  const key = u.searchParams.get("key") || body.key || "";
  const viaShare = Boolean(key);
  if (viaShare) { if (!safeEqual(key, await shareKey())) return json({ error: "分享鑰匙不對" }, 401); }
  else if (!isAdmin(request)) return unauthorized();
  const raw = String(body.text || body.url || u.searchParams.get("url") || "").trim();
  if (!raw) return json({ error: "請貼上連結或文字" }, 400);
  const urls = [...new Set((raw.match(/https?:\/\/[^\s<>"'，。！]+/g) || []))];
  const ids = [];
  const textOnly = raw.replace(/https?:\/\/\S+/g, "").trim();
  const list = urls.length ? urls : [""];
  for (const url of list) {
    if (url) {
      const [dup] = await tq("SELECT id FROM tz_posts WHERE url = $1 AND status <> '失敗' LIMIT 1", [url]);
      if (dup) { ids.push(dup.id); continue; }
    }
    const note = urls.length <= 1 ? textOnly : "";
    const [r] = await tq("INSERT INTO tz_posts (url, platform, user_text, title) VALUES ($1,$2,$3,$4) RETURNING id",
      [url, url ? platformOf(url) : "貼上文字", note.slice(0, 8000), (url || note).slice(0, 60)]);
    ids.push(r.id);
    kick(request, "post", r.id);
  }
  if (viaShare) return new Response("✅ 收到了,正在整理", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return json({ ok: true, ids });
}
