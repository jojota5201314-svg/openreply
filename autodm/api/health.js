import { q } from "../lib/db.js";
import { decrypt } from "../lib/crypto.js";
import { me } from "../lib/ig.js";

// GET /api/health        → database check
// GET /api/health?deep=1 → also checks each IG account's connection still works
//
// The deep check always answers 200 with ok:false + the list of broken accounts and why,
// so a broken IG connection never shows up as a "server error". Each account is checked
// in parallel with its own time limit, so one slow Instagram call can't hang the whole check.

const CHECK_TIMEOUT_MS = 8000;

// Never let anything that looks like a token or key leak into the response.
const scrub = (msg) => String(msg || "").replace(/[A-Za-z0-9_\-|.]{40,}/g, "[隱藏]").slice(0, 200);

function explain(e, stage) {
  if (stage === "decrypt") return { reason: "授權資料解不開（加密金鑰可能被換過），請重新連 IG", code: "decrypt_failed" };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return { reason: `Instagram ${CHECK_TIMEOUT_MS / 1000} 秒內沒回應，稍後再測`, code: "timeout" };
  if (e?.code === 190) return { reason: "IG 授權已過期或被撤銷，請重新連 IG", code: "token_expired", meta: scrub(e.message) };
  if (e?.code) return { reason: "Instagram 回傳錯誤", code: `meta_${e.code}`, meta: scrub(e.message) };
  return { reason: "連不到 Instagram", code: "network", meta: scrub(e?.message) };
}

async function checkAccount(row) {
  const base = { username: row.username, tokenExpires: row.token_expires ? new Date(row.token_expires).toISOString() : null };
  let token;
  try { token = decrypt(row.token_enc); } catch (e) { return { ...base, ok: false, ...explain(e, "decrypt") }; }
  try {
    await me(token, { timeoutMs: CHECK_TIMEOUT_MS });
    return { ...base, ok: true };
  } catch (e) {
    return { ...base, ok: false, ...explain(e, "meta") };
  }
}

export async function GET(request) {
  let out;
  try {
    const [a] = await q("SELECT COUNT(*)::int AS n FROM ad_accounts");
    const [r] = await q("SELECT COUNT(*)::int AS n FROM ad_rules WHERE active = TRUE");
    out = { ok: true, database: "正常", accounts: a.n, activeRules: r.n };
  } catch (e) {
    return Response.json({ ok: false, database: "連不上", detail: scrub(e.message) }, { status: 500 });
  }

  if (request && new URL(request.url).searchParams.get("deep")) {
    try {
      const rows = await q("SELECT username, token_enc, token_expires FROM ad_accounts ORDER BY username");
      const results = await Promise.all(rows.map(checkAccount));
      out.accountsOk = results.filter((x) => x.ok).length;
      out.broken = results.filter((x) => !x.ok).map((x) => x.username);
      out.details = results;
      if (out.broken.length) out.ok = false;
    } catch (e) {
      out.ok = false;
      out.deepError = "帳號健檢本身出錯：" + scrub(e.message);
    }
  }
  return Response.json(out, { status: 200, headers: { "Cache-Control": "no-store" } });
}
