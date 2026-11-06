// 一步一步在背後處理:抓內容 → AI 整理;排行程。每一步一個請求,做完自己叫下一步
import { waitUntil } from "@vercel/functions";
import { tq } from "./tz_db.js";
import { fetchPost, platformOf } from "./tz_fetch.js";
import { analyze, refineTrip, planOutline, planDay } from "./tz_ai.js";
import { baseUrl } from "./env.js";

// 叫下一步:只負責把請求送出去,不等它做完(等的話會一層套一層,超過 5 分鐘就被切斷)
export function kick(request, type, id) {
  const url = `${baseUrl(request)}/api/tz?a=run`;
  const ctl = new AbortController();
  const p = fetch(url, { method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", "x-tz-internal": process.env.CRON_SECRET || "" },
    body: JSON.stringify({ type, id }) }).then((r) => r.text()).catch(() => {});
  waitUntil(Promise.race([p, new Promise((r) => setTimeout(r, 4000))]).then(() => ctl.abort()));
}

export async function runPost(id) {
  const [p] = await tq("SELECT * FROM tz_posts WHERE id = $1", [id]);
  if (!p) return { done: true };
  if (p.status === "排隊中") {
    await tq("UPDATE tz_posts SET status = '抓取中', error = '', tries = tries + 1, step_at = NOW() WHERE id = $1", [id]);
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
    await tq("UPDATE tz_posts SET status = 'AI 整理中', step_at = NOW() WHERE id = $1", [id]);
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
  // 同一個行程正在排(2 分半內有動作)就不重複排
  const claim = await tq("UPDATE tz_trips SET step_at = NOW() WHERE id = $1 AND (step_at IS NULL OR step_at < NOW() - INTERVAL '150 seconds') RETURNING id", [id]);
  if (!claim.length) return { done: true, busy: true };
  const release = () => tq("UPDATE tz_trips SET step_at = NULL WHERE id = $1", [id]);
  try {
    if (t.status === "生成中") {
      const o = await planOutline(t.params || {}, t.places || []);
      if (!Array.isArray(o?.days) || !o.days.length) throw new Error("AI 回傳的行程格式不對,再試一次");
      o.days = o.days.map((d, i) => ({ ...d, day: i + 1, stops: [] }));
      const booked = (t.params || {}).booked || [];
      if (booked.length) { o.stays = {}; for (const h of booked) for (let k = h.from; k <= h.to; k++) if (k - 1 < o.days.length) o.stays[k - 1] = { name: h.name, address: h.address || "" }; }
      await tq("UPDATE tz_trips SET status = '排細節', error = '', plan = $2, name = $3, pending = '0' WHERE id = $1", [id, JSON.stringify(o), o.title || t.name]);
      await release();
      return { next: true };
    }
    if (t.status === "排細節") {
      const plan = t.plan;
      const i = Number(t.pending || 0);
      let stops = [];
      try { stops = await planDay(t.params || {}, t.places || [], plan, i); }
      catch (e) { stops = await planDay(t.params || {}, t.places || [], plan, i); } // 失敗再試一次
      plan.days[i].stops = stops;
      const last = i >= plan.days.length - 1;
      await tq("UPDATE tz_trips SET status = $2, plan = $3, pending = $4 WHERE id = $1",
        [id, last ? "完成" : "排細節", JSON.stringify(plan), last ? "" : String(i + 1)]);
      await release();
      return last ? { done: true } : { next: true };
    }
    if (t.status === "修改中") {
      const plan = await refineTrip(t.params || {}, t.places || [], t.plan, t.pending || "");
      if (!plan?.days) throw new Error("AI 回傳的行程格式不對,再試一次");
      if (t.plan?.stays) plan.stays = t.plan.stays; // 自己設定的住宿要留著
      await tq("UPDATE tz_trips SET status = '完成', error = '', plan = $2, name = $3, pending = '' WHERE id = $1", [id, JSON.stringify(plan), plan.title || t.name]);
    }
  } catch (e) {
    const failed = t.status === "排細節" ? "完成" : (t.plan ? "完成" : "失敗");
    await tq("UPDATE tz_trips SET status = $2, error = $3, pending = '' WHERE id = $1", [id, failed,
      (t.status === "排細節" ? `第 ${Number(t.pending || 0) + 1} 天之後沒排好:` : "") + e.message]);
  }
  await release();
  return { done: true };
}
