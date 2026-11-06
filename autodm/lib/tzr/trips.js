import { json, readJson, isAdmin, unauthorized } from "../auth.js";
import { tq } from "../tz_db.js";
import { kick } from "../tz_jobs.js";

export async function GET(request) {
  if (!isAdmin(request)) return unauthorized();
  const rows = await tq("SELECT id, name, status, error, created_at, pending, EXTRACT(EPOCH FROM (NOW() - step_at)) AS idle FROM tz_trips ORDER BY id DESC LIMIT 200");
  return json({ trips: rows });
}
export async function POST(request) {
  if (!isAdmin(request)) return unauthorized();
  const { params = {}, places = [] } = await readJson(request);
  const name = `${params.country || "旅行"} ${params.days || 3} 天`;
  const [r] = await tq("INSERT INTO tz_trips (name, params, places, step_at) VALUES ($1,$2,$3,NULL) RETURNING id",
    [name, JSON.stringify(params), JSON.stringify(places.slice(0, 60))]);
  kick(request, "trip", r.id);
  return json({ ok: true, id: r.id });
}
