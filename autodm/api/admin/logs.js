import { q } from "../../lib/db.js";
import { json, isAdmin, unauthorized } from "../../lib/auth.js";

export async function GET(request) {
  if (!isAdmin(request)) return unauthorized();
  const rows = await q(`SELECT l.*, a.username AS account_name, r.name AS rule_name FROM ad_logs l
                        LEFT JOIN ad_accounts a ON a.ig_id = l.ig_id LEFT JOIN ad_rules r ON r.id = l.rule_id
                        ORDER BY l.id DESC LIMIT 200`);
  return json({ logs: rows });
}
