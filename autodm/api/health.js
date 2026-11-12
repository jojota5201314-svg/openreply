import { q } from "../lib/db.js";
import { decrypt } from "../lib/crypto.js";
import { me } from "../lib/ig.js";

// GET /api/health        → database check
// GET /api/health?deep=1 → also checks each IG account's connection still works
export async function GET(request) {
  try {
    const [a] = await q("SELECT COUNT(*)::int AS n FROM ad_accounts");
    const [r] = await q("SELECT COUNT(*)::int AS n FROM ad_rules WHERE active = TRUE");
    const out = { ok: true, database: "正常", accounts: a.n, activeRules: r.n };
    if (request && new URL(request.url).searchParams.get("deep")) {
      const rows = await q("SELECT username, token_enc FROM ad_accounts ORDER BY username");
      out.broken = [];
      for (const row of rows) {
        try { await me(decrypt(row.token_enc)); } catch { out.broken.push(row.username); }
      }
      out.accountsOk = rows.length - out.broken.length;
      if (out.broken.length) out.ok = false;
    }
    return Response.json(out, { status: out.ok ? 200 : 503 });
  } catch (e) {
    return Response.json({ ok: false, database: "連不上", detail: e.message }, { status: 500 });
  }
}
