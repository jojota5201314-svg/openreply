import { json, readJson, isAdmin } from "../../lib/auth.js";
import { safeEqual } from "../../lib/crypto.js";
import { runPost, runTrip, kick } from "../../lib/tz_jobs.js";

export async function POST(request) {
  const internal = request.headers.get("x-tz-internal") || "";
  const okInternal = process.env.CRON_SECRET && internal && safeEqual(internal, process.env.CRON_SECRET);
  if (!okInternal && !isAdmin(request)) return json({ error: "沒有權限" }, 401);
  const { type, id } = await readJson(request);
  const n = Number(id);
  if (!n) return json({ error: "缺少 id" }, 400);
  const r = type === "trip" ? await runTrip(n) : await runPost(n);
  if (r.next) kick(request, type, n);
  return json({ ok: true, ...r });
}
