import { q } from "../../lib/db.js";
import { json, isAdmin, unauthorized, readJson } from "../../lib/auth.js";

export async function GET(request) {
  if (!isAdmin(request)) return unauthorized();
  const rows = await q("SELECT ig_id, username, token_expires, subscribed, connected_at FROM ad_accounts ORDER BY connected_at");
  return json({ accounts: rows });
}
export async function DELETE(request) {
  if (!isAdmin(request)) return unauthorized();
  const { ig_id } = await readJson(request);
  await q("DELETE FROM ad_accounts WHERE ig_id = $1", [String(ig_id)]);
  return json({ ok: true });
}
