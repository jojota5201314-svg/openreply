import { q } from "../../lib/db.js";
import { decrypt } from "../../lib/crypto.js";
import { recentMedia } from "../../lib/ig.js";
import { json, isAdmin, unauthorized } from "../../lib/auth.js";

export async function GET(request) {
  if (!isAdmin(request)) return unauthorized();
  const igId = new URL(request.url).searchParams.get("ig_id") || "";
  const rows = await q("SELECT token_enc FROM ad_accounts WHERE ig_id = $1", [igId]);
  if (!rows.length) return json({ error: "找不到這個帳號，請先選帳號" }, 404);
  try {
    return json({ media: await recentMedia(decrypt(rows[0].token_enc)) });
  } catch (e) {
    return json({ error: "讀不到貼文：" + e.message }, 502);
  }
}
