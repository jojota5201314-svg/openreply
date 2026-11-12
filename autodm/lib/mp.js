// 命盤小工具:資料表、AI 解讀、各功能(入口在 api/mp.js)
import crypto from "node:crypto";
import { q } from "./db.js";
import { claude } from "./tz_ai.js";
import { json, readJson, isAdmin, unauthorized } from "./auth.js";
import { buildChart, chartText } from "./mp_chart.js";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS mp_readings (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    name TEXT DEFAULT '',
    source TEXT DEFAULT '網頁',
    chart JSONB,
    teaser JSONB,
    full_text TEXT DEFAULT '',
    status TEXT DEFAULT '',
    error TEXT DEFAULT '',
    unlocked BOOLEAN DEFAULT FALSE,
    edited BOOLEAN DEFAULT FALSE,
    ip TEXT DEFAULT '',
    step_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS mp_codes (
    code TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    note TEXT DEFAULT '',
    used_by TEXT,
    used_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS mp_settings (k TEXT PRIMARY KEY, v TEXT)`,
];
let ready = null;
async function mq(sql, params = []) {
  if (!ready) ready = (async () => { for (const s of SCHEMA) await q(s); })().catch((e) => { ready = null; throw e; });
  await ready;
  return q(sql, params);
}

const DEFAULT_SETTINGS = {
  line_url: "",
  price_note: "完整解讀(工作、感情、健康、未來 3 年流年、10 年後的信)請加 LINE,付款後會給你解鎖碼。",
  daily_cap: "60",
  per_ip: "3",
};
async function settings() {
  const rows = await mq("SELECT k, v FROM mp_settings");
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.k] = r.v;
  return s;
}

const clientIp = (req) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

const SYS = `你是 Jojo 的命理解讀助手。Jojo 是台灣的塔羅占卜師,說話直接、溫暖、不講空話,用台灣繁體中文和台灣口語(不要用中國用語)。
重要規則:
- 命盤已經由程式排好,一律以提供的盤面為準,不要自己重新排盤,也不要改動任何干支、星曜。
- 每個結論都要點出盤面依據(例如「日主戊土生在卯月」「命宮廉貞廟」)。
- 喜用神是判斷,要寫出判斷理由;盤面資訊不夠下結論時要老實說。
- 不說「一定」「保證」「注定」,講傾向和建議。
- 健康只講要多留意的方向,不做醫療診斷,提醒有不舒服要看醫生。
- 不嚇人、不講破財消災、不推銷任何東西。
- 時辰不明時,說明哪些部分因此比較不準。`;

async function makeTeaser(chart) {
  const user = `以下是命盤:\n${chartText(chart)}\n\n請給簡短的免費版解讀,用 JSON:
{"keywords":[{"word":"兩到四字的個性關鍵詞","basis":"一句盤面依據","scene":"一句生活中會出現的具體場景"}](剛好 3 個),
 "wake":"一句像師父一樣的當頭棒喝(30 字內)",
 "tease":"一句話說完整版會幫他看清楚的事(針對他的盤,具體但不嚇人,40 字內)"}`;
  return claude(SYS, user, { asJson: true, maxTokens: 1500, timeoutMs: 60000, model: process.env.MP_TEASER_MODEL || "claude-haiku-5-5" });
}

const FULL_PARTS = (chart) => {
  const ly = chart.bazi.liunian.map((l) => `${l.year}(${l.gz})`).join("、");
  return [
`## 1. 命盤重點
八字:日主強弱(說明月令和五行數量的判斷)、格局傾向、喜用神與忌神(寫理由)。${chart.ziwei ? "紫微:命宮主星與亮度、身宮落在哪一宮、四化落點的意思。" : "(沒有時辰,紫微不排,說明這點)"}
## 2. 個性核心
3 個關鍵詞,各舉一個具體生活場景。
## 3. 工作與錢
適合的工作型態、賺錢方式、最容易「少賺錢」的一個習慣(講具體、講直接)。
## 4. 感情
在關係裡的模式、容易卡住的地方、適合的另一半特質。`,
`## 5. 健康與家庭
需要多留意的身體方向(不做診斷)與家庭課題。
## 6. 未來 3 年流年
逐年寫 ${ly}:重點機會、要避開的坑${chart.bazi.dayun.length ? ",並說明目前走的大運" : ""}。
## 7. 一句當頭棒喝
## 8. 10 年後的你寫給現在的你的一封信(300 字內,第一人稱)
## 總整理
用表格:| 優勢 | 盲點 | 今年最該做的 3 件事 |`];
};

// 完整版拆兩半同時寫(一次寫 8 段會超過 AI 單次字數上限)
async function makeFull(chart) {
  const parts = FULL_PARTS(chart);
  const texts = await Promise.all(parts.map((spec, i) => claude(SYS,
    `以下是命盤:\n${chartText(chart)}\n\n完整解讀分成上下兩半,你這次只寫${i ? "下" : "上"}半,用 Markdown,照下面的標題,每段先寫「依據」再寫結論,不要寫開場白和結語,也不要寫其他段落:\n${spec}\n\n這一半寫 1200 到 1800 字。`,
    { maxTokens: 16000, timeoutMs: 240000 })));
  return texts.map((t) => t.trim()).join("\n\n");
}

const pub = (r, admin) => ({
  id: r.id, created: new Date(r.created_at).getTime(), name: r.name, source: r.source, chart: r.chart, teaser: r.teaser,
  unlocked: r.unlocked || admin, status: r.status, error: r.error, edited: r.edited,
  full_text: r.unlocked || admin ? r.full_text : "",
});

// ===== 各功能 =====
export const routes = {
  // 公開設定(LINE 連結、說明文字)
  async config(req) {
    const s = await settings();
    return json({ line_url: s.line_url, price_note: s.price_note, admin: isAdmin(req) });
  },

  // 排盤 + 免費版解讀
  async chart(req) {
    if (req.method !== "POST") return json({ error: "用 POST" }, 405);
    const admin = isAdmin(req);
    const body = await readJson(req);
    let chart;
    try { chart = buildChart(body); } catch (e) { return json({ error: e.message }, 400); }
    const ip = clientIp(req);
    if (!admin) {
      const s = await settings();
      const [day] = await mq("SELECT COUNT(*)::int AS n FROM mp_readings WHERE created_at > NOW() - INTERVAL '1 day' AND source = '網頁'");
      if (day.n >= +s.daily_cap) return json({ error: "今天的免費名額用完了,明天再來,或直接加 LINE 找 Jojo" }, 429);
      const [mine] = await mq("SELECT COUNT(*)::int AS n FROM mp_readings WHERE created_at > NOW() - INTERVAL '1 day' AND ip = $1", [ip]);
      if (mine.n >= +s.per_ip) return json({ error: "你今天已經排過好幾次了,明天再來" }, 429);
    }
    const id = crypto.randomBytes(9).toString("base64url");
    const source = admin ? (body.source === "付費客人" ? "付費客人" : "自己") : "網頁";
    await mq("INSERT INTO mp_readings (id, name, source, chart, status, unlocked, ip) VALUES ($1,$2,$3,$4,'免費版撰寫中',$5,$6)",
      [id, chart.input.name, source, chart, admin, ip]);
    let teaser = null, error = "";
    try { teaser = await makeTeaser(chart); } catch (e) { error = e.message; }
    await mq("UPDATE mp_readings SET teaser = $2, status = $3, error = $4, step_at = NOW() WHERE id = $1",
      [id, teaser, teaser ? "免費版完成" : "免費版失敗", error]);
    const [r] = await mq("SELECT * FROM mp_readings WHERE id = $1", [id]);
    return json(pub(r, admin));
  },

  // 讀一份(分享連結用)
  async get(req) {
    const id = new URL(req.url).searchParams.get("id") || "";
    const [r] = await mq("SELECT * FROM mp_readings WHERE id = $1", [id]);
    if (!r) return json({ error: "找不到這份命盤" }, 404);
    return json(pub(r, isAdmin(req)));
  },

  // 用解鎖碼解鎖
  async unlock(req) {
    const { id, code } = await readJson(req);
    const c = String(code || "").trim().toUpperCase();
    await new Promise((r) => setTimeout(r, 300));
    const [r] = await mq("SELECT * FROM mp_readings WHERE id = $1", [id || ""]);
    if (!r) return json({ error: "找不到這份命盤" }, 404);
    if (r.unlocked) return json(pub(r, false));
    const used = await mq("UPDATE mp_codes SET used_by = $2, used_at = NOW() WHERE code = $1 AND used_by IS NULL RETURNING code", [c, id]);
    if (!used.length) return json({ error: "解鎖碼不對,或已經用過了" }, 400);
    await mq("UPDATE mp_readings SET unlocked = TRUE WHERE id = $1", [id]);
    const [r2] = await mq("SELECT * FROM mp_readings WHERE id = $1", [id]);
    return json(pub(r2, false));
  },

  // 寫完整版(要解鎖或是 Jojo 本人)
  async full(req) {
    const admin = isAdmin(req);
    const { id, redo } = await readJson(req);
    const [r] = await mq("SELECT * FROM mp_readings WHERE id = $1", [id || ""]);
    if (!r) return json({ error: "找不到這份命盤" }, 404);
    if (!r.unlocked && !admin) return json({ error: "還沒解鎖" }, 403);
    if (r.full_text && !(redo && admin)) return json(pub(r, admin));
    // 同一份不要同時寫兩次(5 分鐘內在寫就等)
    const lock = await mq("UPDATE mp_readings SET status = '完整版撰寫中', error = '', step_at = NOW() WHERE id = $1 AND (status <> '完整版撰寫中' OR step_at < NOW() - INTERVAL '5 minutes') RETURNING id", [id]);
    if (!lock.length) return json({ ...pub(r, admin), status: "完整版撰寫中" });
    try {
      const text = await makeFull(r.chart);
      await mq("UPDATE mp_readings SET full_text = $2, status = '完整版完成', edited = FALSE, step_at = NOW() WHERE id = $1", [id, text]);
    } catch (e) {
      await mq("UPDATE mp_readings SET status = '完整版失敗', error = $2, step_at = NOW() WHERE id = $1", [id, e.message]);
    }
    const [r2] = await mq("SELECT * FROM mp_readings WHERE id = $1", [id]);
    return json(pub(r2, admin));
  },

  // ===== 以下只有 Jojo 能用 =====
  async save(req) {
    if (!isAdmin(req)) return unauthorized();
    const { id, full_text, name, unlocked } = await readJson(req);
    const sets = [], vals = [id];
    if (typeof full_text === "string") { vals.push(full_text); sets.push(`full_text = $${vals.length}, edited = TRUE`); }
    if (typeof name === "string") { vals.push(name.slice(0, 20)); sets.push(`name = $${vals.length}`); }
    if (typeof unlocked === "boolean") { vals.push(unlocked); sets.push(`unlocked = $${vals.length}`); }
    if (!sets.length) return json({ error: "沒有要改的" }, 400);
    await mq(`UPDATE mp_readings SET ${sets.join(", ")} WHERE id = $1`, vals);
    const [r] = await mq("SELECT * FROM mp_readings WHERE id = $1", [id]);
    return json(pub(r, true));
  },

  async list(req) {
    if (!isAdmin(req)) return unauthorized();
    const rows = await mq("SELECT id, created_at, name, source, status, unlocked, edited, chart->'input' AS input FROM mp_readings ORDER BY created_at DESC LIMIT 200");
    return json({ readings: rows.map((r) => ({ id: r.id, created: new Date(r.created_at).getTime(), name: r.name, source: r.source, status: r.status, unlocked: r.unlocked, edited: r.edited, input: r.input })) });
  },

  async remove(req) {
    if (!isAdmin(req)) return unauthorized();
    const { id } = await readJson(req);
    await mq("DELETE FROM mp_readings WHERE id = $1", [id || ""]);
    return json({ ok: true });
  },

  async codes(req) {
    if (!isAdmin(req)) return unauthorized();
    if (req.method === "POST") {
      const { count = 1, note = "" } = await readJson(req);
      const n = Math.min(Math.max(+count || 1, 1), 20);
      const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉容易看錯的 0 O 1 I
      const made = [];
      for (let i = 0; i < n; i++) {
        const code = Array.from(crypto.randomBytes(6), (b) => ABC[b % ABC.length]).join("");
        await mq("INSERT INTO mp_codes (code, note) VALUES ($1, $2) ON CONFLICT DO NOTHING", [code, String(note).slice(0, 40)]);
        made.push(code);
      }
      return json({ made });
    }
    const rows = await mq("SELECT c.*, r.name AS used_name FROM mp_codes c LEFT JOIN mp_readings r ON r.id = c.used_by ORDER BY c.created_at DESC LIMIT 100");
    return json({ codes: rows.map((c) => ({ code: c.code, note: c.note, created: new Date(c.created_at).getTime(), used_by: c.used_by, used_name: c.used_name, used_at: c.used_at && new Date(c.used_at).getTime() })) });
  },

  async settings(req) {
    if (!isAdmin(req)) return unauthorized();
    if (req.method === "POST") {
      const body = await readJson(req);
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (typeof body[k] === "string") await mq("INSERT INTO mp_settings (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = $2", [k, body[k].slice(0, 500)]);
      }
    }
    return json(await settings());
  },
};
