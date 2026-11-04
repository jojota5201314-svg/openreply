import { env } from "../../lib/env.js";
import { q, log } from "../../lib/db.js";
import { decrypt, encrypt, safeEqual } from "../../lib/crypto.js";
import * as ig from "../../lib/ig.js";

export async function GET(request) {
  const auth = request.headers.get("authorization") || "";
  if (!safeEqual(auth, `Bearer ${env("CRON_SECRET")}`)) return new Response("Forbidden", { status: 403 });
  const rows = await q("SELECT * FROM ad_accounts WHERE token_expires IS NULL OR token_expires < NOW() + INTERVAL '30 days'");
  let ok = 0;
  for (const a of rows) {
    try {
      const { token, expiresIn } = await ig.refresh(decrypt(a.token_enc));
      await q("UPDATE ad_accounts SET token_enc=$1, token_expires=$2 WHERE ig_id=$3", [encrypt(token), new Date(Date.now() + expiresIn * 1000), a.ig_id]);
      ok++;
    } catch (e) { await log({ ig_id: a.ig_id, kind: "系統", status: "更新授權失敗，請重新連 IG", detail: e.message }); }
  }
  await q("DELETE FROM ad_events WHERE created_at < NOW() - INTERVAL '30 days'");
  await q("DELETE FROM ad_logs WHERE created_at < NOW() - INTERVAL '90 days'");
  return new Response(JSON.stringify({ refreshed: ok, checked: rows.length }), { headers: { "Content-Type": "application/json" } });
}
