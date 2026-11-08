import { q, firstTime, log } from "./db.js";
import { decrypt } from "./crypto.js";
import * as ig from "./ig.js";

export function normalize(s) {
  return String(s || "").normalize("NFKC").toLowerCase().replace(/[\s\u3000]+/g, "").replace(/[!！?？。.,，~～「」『』"']/g, "");
}
export function splitKeywords(s) {
  return String(s || "").split(/[,，、\n]/).map((k) => k.trim()).filter(Boolean);
}
export function matches(rule, text) {
  const t = normalize(text);
  if (!t) return false;
  const kws = splitKeywords(rule.keywords).map(normalize).filter(Boolean);
  if (!kws.length) return false;
  return rule.match_mode === "exact" ? kws.some((k) => t === k) : kws.some((k) => t.includes(k));
}
const hasTrigger = (rule, trig) => String(rule.triggers || "").split(",").map((s) => s.trim()).includes(trig);

export async function findRule(igId, trigger, text, mediaIds = []) {
  const rules = await q("SELECT * FROM ad_rules WHERE active = TRUE ORDER BY sort ASC, id ASC");
  return rules.find((r) =>
    (!r.account_ig_id || r.account_ig_id === igId) &&
    hasTrigger(r, trigger) &&
    (!r.media_id || mediaIds.includes(r.media_id)) &&
    matches(r, text)) || null;
}

function asButtons(list) {
  return (Array.isArray(list) ? list : []).slice(0, 3).map((b) =>
    b.type === "postback"
      ? { type: "postback", title: String(b.title).slice(0, 20), payload: `R:${b.rule_id}` }
      : { type: "web_url", title: String(b.title).slice(0, 20), url: b.url }
  ).filter((b) => b.type === "postback" ? b.payload !== "R:undefined" : /^https?:\/\//.test(b.url || ""));
}

/** The main content of a rule: text, plus up to 3 buttons (links or "next step" taps). */
export function contentMessage(rule) {
  const buttons = asButtons(typeof rule.buttons === "string" ? JSON.parse(rule.buttons) : rule.buttons);
  if (!buttons.length) return { text: rule.dm_text };
  return { attachment: { type: "template", payload: { template_type: "button", text: String(rule.dm_text).slice(0, 640), buttons } } };
}
/** ManyChat-style opener: a short message with one tap button; the tap delivers the content. */
function openerMessage(rule) {
  const text = rule.opener_text || "嗨！謝謝你留言，點下面按鈕看你的結果 👇";
  return { attachment: { type: "template", payload: { template_type: "button", text: String(text).slice(0, 640),
    buttons: [{ type: "postback", title: String(rule.opener_button || "看結果").slice(0, 20), payload: `R:${rule.id}` }] } } };
}
/** Follow gate: ask them to follow first; the button runs the same rule again. */
function followMessage(rule, username) {
  const text = rule.follow_text || `先追蹤 @${username || "我"}，追蹤好之後再按一次下面的按鈕，就會收到你的結果 💜`;
  return { attachment: { type: "template", payload: { template_type: "button", text: String(text).slice(0, 640),
    buttons: [{ type: "postback", title: "我追蹤好了", payload: `R:${rule.id}` }] } } };
}
function pickLine(s) {
  const lines = String(s || "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[Math.floor(Math.random() * lines.length)] : "";
}

async function account(igId) {
  const rows = await q("SELECT * FROM ad_accounts WHERE ig_id = $1", [igId]);
  if (!rows.length) return null;
  return { ...rows[0], token: decrypt(rows[0].token_enc) };
}

async function onComment(acc, v) {
  const commentId = v.id || v.comment_id;
  const fromId = v.from?.id; const fromName = v.from?.username;
  if (!commentId || !fromId || fromId === acc.ig_id) return;
  if (!(await firstTime(`c:${commentId}`))) return;
  const mediaIds = [v.media?.id, v.media?.original_media_id, v.media_id].filter(Boolean);
  const rule = await findRule(acc.ig_id, "comment", v.text, mediaIds);
  const base = { ig_id: acc.ig_id, kind: "留言", from_id: fromId, from_name: fromName, text: v.text };
  if (!rule) return log({ ...base, status: "沒對到規則" });
  const done = [];
  try {
    // A follow-gated rule always starts with a button: the tap opens the chat so we can check follow status.
    const msg = rule.opener_text || rule.follow_gate ? openerMessage(rule) : contentMessage(rule);
    await ig.sendMessage(acc.ig_id, acc.token, { comment_id: commentId }, msg);
    done.push("已私訊");
  } catch (e) { await log({ ...base, rule_id: rule.id, status: "私訊失敗", detail: e.message }); }
  const pub = pickLine(rule.public_replies);
  if (pub) {
    try { await ig.replyToComment(commentId, acc.token, pub); done.push("已公開回覆"); }
    catch (e) { await log({ ...base, rule_id: rule.id, status: "公開回覆失敗", detail: e.message }); }
  }
  if (done.length) await log({ ...base, rule_id: rule.id, status: done.join("、") });
}

async function sendContent(acc, userId, rule, base) {
  if (rule.follow_gate && (await ig.followsUs(userId, acc.token)) === false) {
    try {
      await ig.sendMessage(acc.ig_id, acc.token, { id: userId }, followMessage(rule, acc.username));
      await log({ ...base, rule_id: rule.id, status: "請對方先追蹤" });
    } catch (e) { await log({ ...base, rule_id: rule.id, status: "私訊失敗", detail: e.message }); }
    return;
  }
  try {
    await ig.sendMessage(acc.ig_id, acc.token, { id: userId }, contentMessage(rule));
    await log({ ...base, rule_id: rule.id, status: "已私訊" });
  } catch (e) { await log({ ...base, rule_id: rule.id, status: "私訊失敗", detail: e.message }); }
}

async function onMessaging(acc, m) {
  const userId = m.sender?.id;
  if (!userId || userId === acc.ig_id) return;
  if (m.postback) {
    const mid = m.postback.mid || `${userId}:${m.timestamp}:${m.postback.payload}`;
    if (!(await firstTime(`p:${mid}`))) return;
    const id = Number(String(m.postback.payload || "").replace(/^R:/, ""));
    const rows = Number.isInteger(id) ? await q("SELECT * FROM ad_rules WHERE id = $1", [id]) : [];
    const base = { ig_id: acc.ig_id, kind: "按鈕", from_id: userId, text: m.postback.title };
    if (!rows.length) return log({ ...base, status: "按鈕找不到規則", detail: m.postback.payload });
    return sendContent(acc, userId, rows[0], base);
  }
  const msg = m.message;
  if (!msg || msg.is_echo || msg.is_deleted || msg.is_unsupported) return;
  if (!(await firstTime(`m:${msg.mid}`))) return;
  const isStory = Boolean(msg.reply_to?.story);
  const trigger = isStory ? "story" : "dm";
  const base = { ig_id: acc.ig_id, kind: isStory ? "限動回覆" : "私訊", from_id: userId, text: msg.text };
  const rule = await findRule(acc.ig_id, trigger, msg.text);
  if (!rule) return log({ ...base, status: "沒對到規則" });
  return sendContent(acc, userId, rule, base);
}

export async function handleWebhook(body) {
  if (!body || !Array.isArray(body.entry)) return;
  for (const entry of body.entry) {
    const igId = String(entry.id || "");
    const acc = igId ? await account(igId) : null;
    if (!acc) { await log({ ig_id: igId, kind: "系統", status: "收到通知但帳號還沒連", detail: JSON.stringify(entry).slice(0, 300) }); continue; }
    for (const ch of entry.changes || []) {
      if (ch.field === "comments" || ch.field === "live_comments") {
        try { await onComment(acc, ch.value || {}); } catch (e) { await log({ ig_id: igId, kind: "系統", status: "錯誤", detail: e.message }); }
      }
    }
    for (const m of entry.messaging || []) {
      try { await onMessaging(acc, m); } catch (e) { await log({ ig_id: igId, kind: "系統", status: "錯誤", detail: e.message }); }
    }
  }
}
