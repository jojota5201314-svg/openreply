import { q } from "../lib/db.js";
export async function GET() {
  try {
    const [a] = await q("SELECT COUNT(*)::int AS n FROM ad_accounts");
    const [r] = await q("SELECT COUNT(*)::int AS n FROM ad_rules WHERE active = TRUE");
    return Response.json({ ok: true, database: "正常", accounts: a.n, activeRules: r.n });
  } catch (e) {
    return Response.json({ ok: false, database: "連不上", detail: e.message }, { status: 500 });
  }
}
