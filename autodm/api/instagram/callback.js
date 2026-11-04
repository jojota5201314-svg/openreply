import { baseUrl } from "../../lib/env.js";
import { isAdmin } from "../../lib/auth.js";
import { readSignedToken, encrypt } from "../../lib/crypto.js";
import { q, log } from "../../lib/db.js";
import * as ig from "../../lib/ig.js";

export async function GET(request) {
  const base = baseUrl(request);
  const p = new URL(request.url).searchParams;
  if (!isAdmin(request)) return Response.redirect(`${base}/`, 302);
  if (p.get("error")) return Response.redirect(`${base}/?connect=cancel`, 302);
  if (!readSignedToken(p.get("state"), 15 * 60 * 1000)) return Response.redirect(`${base}/?connect=expired`, 302);
  try {
    const short = await ig.exchangeCode(p.get("code"), `${base}/api/instagram/callback`);
    const { token, expiresIn } = await ig.longLived(short);
    const { igId, username } = await ig.me(token);
    let subscribed = false;
    try { const s = await ig.subscribe(igId, token); subscribed = Boolean(s.success); }
    catch (e) { await log({ ig_id: igId, kind: "系統", status: "訂閱通知失敗", detail: e.message }); }
    await q(`INSERT INTO ad_accounts (ig_id, username, token_enc, token_expires, subscribed)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (ig_id) DO UPDATE SET username = EXCLUDED.username, token_enc = EXCLUDED.token_enc,
               token_expires = EXCLUDED.token_expires, subscribed = EXCLUDED.subscribed`,
      [igId, username, encrypt(token), new Date(Date.now() + expiresIn * 1000), subscribed]);
    await log({ ig_id: igId, kind: "系統", status: `已連上 @${username}` });
    return Response.redirect(`${base}/?connected=${encodeURIComponent(username)}`, 302);
  } catch (e) {
    await log({ kind: "系統", status: "連 IG 失敗", detail: e.message });
    return Response.redirect(`${base}/?connect=fail`, 302);
  }
}
