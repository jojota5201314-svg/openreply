// 一步一步在背後處理:抓內容 → AI 整理;排行程。每一步一個請求,做完自己叫下一步
import { waitUntil } from "@vercel/functions";
import { tq } from "./tz_db.js";
import { fetchPost, platformOf } from "./tz_fetch.js";
import { analyze, planTrip, refineTrip } from "./tz_ai.js";
import { baseUrl } from "./env.js";

export function kick(request, type, id) {
  const url = `${baseUrl(request)}/api/tz?a=run`;
  const p = fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-tz-internal": process.env.CRON_SECRET || "" },
    body: JSON.stringify({ type, id }) }).then((r) => r.text()).catch((e) => console.error("kick failed", e));
  waitUntil(p);
}

export async function runPost(id) {
  const [p] = await tq("SELECT * FROM tz_posts WHERE id = $1", [id]);
  if (!p) return { done: true };
  if (p.status === "排隊中") {
    await tq("UPDATE tz_posts SET status = '抓取中', error = '', tries = tries + 1 WHERE id = $1", [id]);
    if (!p.url) {
      await tq("UPDATE tz_posts SET status = '待整理', raw = $2 WHERE id = $1", [id, JSON.stringify({})]);
      return { next: true };
    }
    const r = await fetchPost(p.url);
    if (!r.ok && !p.user_text) {
      await tq("UPDATE tz_posts SET status = '失敗', error = $2 WHERE id = $1", [id, r.error || "抓不到內容"]);
      return { done: true };
    }
    const raw = r.post || {};
    await tq("UPDATE tz_posts SET status = '待整理', raw = $2, platform = $3, thumb = $4 WHERE id = $1",
      [id, JSON.stringify(raw), r.platform || platformOf(p.url) || p.platform, (raw.images || [])[0] || ""]);
    return { next: true };
  }
  if (p.status === "待整理") {
    await tq("UPDATE tz_posts SET status = 'AI 整理中' WHERE id = $1", [id]);
    try {
      const d = await analyze(p);
      await tq(`UPDATE tz_posts SET status = '完成', error = '', data = $2, title = $3, category = $4, subcategory = $5, country = $6, region = $7 WHERE id = $1`,
        [id, JSON.stringify(d), d.title || "(沒有標題)", d.category, d.subcategory || "", d.country || "", d.region || ""]);
    } catch (e) {
      await tq("UPDATE tz_posts SET status = '失敗', error = $2 WHERE id = $1", [id, "AI 整理失敗:" + e.message]);
    }
    return { done: true };
  }
  return { done: true };
}

export async function runTrip(id) {
  const [t] = await tq("SELECT * FROM tz_trips WHERE id = $1", [id]);
  if (!t) return { done: true };
  try {
    if (t.status === "生成中") {
      const plan = await planTrip(t.params || {}, t.places || []);
      if (!plan?.days) throw new Error("AI 回傳的行程格式不對,再試一次");
      await tq("UPDATE tz_trips SET status = '完成', error = '', plan = $2, name = $3 WHERE id = $1", [id, JSON.stringify(plan), plan.title || t.name]);
    } else if (t.status === "修改中") {
      const plan = await refineTrip(t.params || {}, t.places || [], t.plan, t.pending || "");
      if (!plan?.days) throw new Error("AI 回傳的行程格式不對,再試一次");
      await tq("UPDATE tz_trips SET status = '完成', error = '', plan = $2, name = $3, pending = '' WHERE id = $1", [id, JSON.stringify(plan), plan.title || t.name]);
    }
  } catch (e) {
    await tq("UPDATE tz_trips SET status = $2, error = $3 WHERE id = $1", [id, t.plan ? "完成" : "失敗", e.message]);
  }
  return { done: true };
}
