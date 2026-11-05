import { json, readJson, isAdmin, unauthorized } from "../../lib/auth.js";
import { tq } from "../../lib/tz_db.js";
import { kick } from "../../lib/tz_jobs.js";

const idOf = (request) => Number(new URL(request.url).searchParams.get("id"));

export async function GET(request) {
  if (!isAdmin(request)) return unauthorized();
  const [p] = await tq("SELECT * FROM tz_posts WHERE id = $1", [idOf(request)]);
  if (!p) return json({ error: "找不到" }, 404);
  return json({ ...p, created: new Date(p.created_at).getTime() });
}
export async function PATCH(request) {
  if (!isAdmin(request)) return unauthorized();
  const b = await readJson(request);
  const id = idOf(request);
  await tq("UPDATE tz_posts SET category = COALESCE($2, category), subcategory = COALESCE($3, subcategory), country = COALESCE($4, country), region = COALESCE($5, region) WHERE id = $1",
    [id, b.category ?? null, b.subcategory ?? null, b.country ?? null, b.region ?? null]);
  return json({ ok: true });
}
export async function DELETE(request) {
  if (!isAdmin(request)) return unauthorized();
  await tq("DELETE FROM tz_posts WHERE id = $1", [idOf(request)]);
  return json({ ok: true });
}
// 重新整理:full = 重新抓;不然只重跑 AI
export async function POST(request) {
  if (!isAdmin(request)) return unauthorized();
  const b = await readJson(request);
  const id = idOf(request);
  if (typeof b.user_text === "string") await tq("UPDATE tz_posts SET user_text = $2 WHERE id = $1", [id, b.user_text.slice(0, 8000)]);
  const [p] = await tq("SELECT raw FROM tz_posts WHERE id = $1", [id]);
  const status = b.full || !p?.raw ? "排隊中" : "待整理";
  await tq("UPDATE tz_posts SET status = $2, error = '' WHERE id = $1", [id, status]);
  kick(request, "post", id);
  return json({ ok: true });
}
