import { json, readJson, isAdmin, unauthorized } from "../../lib/auth.js";
import { tq } from "../../lib/tz_db.js";
import { kick } from "../../lib/tz_jobs.js";

const idOf = (request) => Number(new URL(request.url).searchParams.get("id"));

export async function GET(request) {
  if (!isAdmin(request)) return unauthorized();
  const [t] = await tq("SELECT * FROM tz_trips WHERE id = $1", [idOf(request)]);
  return t ? json(t) : json({ error: "找不到" }, 404);
}
export async function PUT(request) {
  if (!isAdmin(request)) return unauthorized();
  const { plan, name } = await readJson(request);
  await tq("UPDATE tz_trips SET plan = COALESCE($2, plan), name = COALESCE($3, name) WHERE id = $1",
    [idOf(request), plan ? JSON.stringify(plan) : null, name || null]);
  return json({ ok: true });
}
export async function DELETE(request) {
  if (!isAdmin(request)) return unauthorized();
  await tq("DELETE FROM tz_trips WHERE id = $1", [idOf(request)]);
  return json({ ok: true });
}
// 請 AI 修改
export async function POST(request) {
  if (!isAdmin(request)) return unauthorized();
  const { instruction } = await readJson(request);
  const id = idOf(request);
  if (!instruction) return json({ error: "請寫想怎麼改" }, 400);
  await tq("UPDATE tz_trips SET status = '修改中', pending = $2, error = '' WHERE id = $1", [id, String(instruction).slice(0, 1000)]);
  kick(request, "trip", id);
  return json({ ok: true });
}
