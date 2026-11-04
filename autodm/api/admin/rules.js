import { q } from "../../lib/db.js";
import { json, isAdmin, unauthorized, readJson } from "../../lib/auth.js";

const TRIGGERS = ["comment", "story", "dm"];
function clean(b) {
  const triggers = (Array.isArray(b.triggers) ? b.triggers : String(b.triggers || "").split(",")).map((s) => s.trim()).filter((t) => TRIGGERS.includes(t));
  const buttons = (Array.isArray(b.buttons) ? b.buttons : []).slice(0, 3).map((x) =>
    x.type === "postback" ? { type: "postback", title: String(x.title || "").slice(0, 20), rule_id: Number(x.rule_id) }
                          : { type: "url", title: String(x.title || "").slice(0, 20), url: String(x.url || "").trim() }
  ).filter((x) => x.title && (x.type === "postback" ? Number.isInteger(x.rule_id) : /^https?:\/\//.test(x.url)));
  const r = {
    name: String(b.name || "").trim().slice(0, 80),
    account_ig_id: b.account_ig_id ? String(b.account_ig_id) : null,
    triggers: triggers.join(","),
    keywords: String(b.keywords || "").trim().slice(0, 500),
    match_mode: b.match_mode === "exact" ? "exact" : "contains",
    media_id: b.media_id ? String(b.media_id).trim() : null,
    public_replies: String(b.public_replies || "").slice(0, 1500),
    opener_text: String(b.opener_text || "").slice(0, 640),
    opener_button: String(b.opener_button || "").slice(0, 20),
    dm_text: String(b.dm_text || "").slice(0, 1000),
    buttons: JSON.stringify(buttons),
    active: b.active !== false,
    sort: Number.isFinite(Number(b.sort)) ? Number(b.sort) : 100,
  };
  const errs = [];
  if (!r.name) errs.push("請填規則名稱");
  if (!r.triggers) errs.push("至少勾一種觸發方式");
  if (!r.keywords) errs.push("請填關鍵字");
  if (!r.dm_text) errs.push("請填要私訊的內容");
  if (r.buttons !== "[]" && r.dm_text.length > 640) errs.push("有按鈕時，私訊內容最多 640 字");
  if (r.opener_text && !r.opener_button) errs.push("有開場訊息時，請填按鈕文字");
  return { r, errs };
}

export async function GET(request) {
  if (!isAdmin(request)) return unauthorized();
  return json({ rules: await q("SELECT * FROM ad_rules ORDER BY sort ASC, id ASC") });
}
export async function POST(request) {
  if (!isAdmin(request)) return unauthorized();
  const b = await readJson(request);
  const { r, errs } = clean(b);
  if (errs.length) return json({ error: errs.join("；") }, 400);
  const vals = [r.name, r.account_ig_id, r.triggers, r.keywords, r.match_mode, r.media_id, r.public_replies, r.opener_text, r.opener_button, r.dm_text, r.buttons, r.active, r.sort];
  if (b.id) {
    await q(`UPDATE ad_rules SET name=$1, account_ig_id=$2, triggers=$3, keywords=$4, match_mode=$5, media_id=$6, public_replies=$7,
             opener_text=$8, opener_button=$9, dm_text=$10, buttons=$11, active=$12, sort=$13 WHERE id=$14`, [...vals, Number(b.id)]);
    return json({ ok: true, id: Number(b.id) });
  }
  const rows = await q(`INSERT INTO ad_rules (name, account_ig_id, triggers, keywords, match_mode, media_id, public_replies, opener_text, opener_button, dm_text, buttons, active, sort)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, vals);
  return json({ ok: true, id: rows[0].id });
}
export async function DELETE(request) {
  if (!isAdmin(request)) return unauthorized();
  const { id } = await readJson(request);
  await q("DELETE FROM ad_rules WHERE id = $1", [Number(id)]);
  return json({ ok: true });
}
