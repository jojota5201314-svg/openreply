// 貼文整理小幫手的資料表(和自動私訊共用同一個資料庫,表名都用 tz_ 開頭)
import crypto from "node:crypto";
import { q } from "./db.js";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tz_posts (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    url TEXT DEFAULT '',
    platform TEXT DEFAULT '',
    status TEXT DEFAULT '排隊中',
    error TEXT DEFAULT '',
    user_text TEXT DEFAULT '',
    raw JSONB,
    data JSONB,
    title TEXT DEFAULT '',
    category TEXT DEFAULT '',
    subcategory TEXT DEFAULT '',
    country TEXT DEFAULT '',
    region TEXT DEFAULT '',
    thumb TEXT DEFAULT '',
    tries INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS tz_trips (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    name TEXT DEFAULT '',
    status TEXT DEFAULT '生成中',
    error TEXT DEFAULT '',
    params JSONB,
    places JSONB,
    plan JSONB,
    pending TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS tz_settings (k TEXT PRIMARY KEY, v TEXT)`,
  `ALTER TABLE tz_trips ADD COLUMN IF NOT EXISTS step_at TIMESTAMPTZ DEFAULT NOW()`,
  `ALTER TABLE tz_posts ADD COLUMN IF NOT EXISTS step_at TIMESTAMPTZ DEFAULT NOW()`,
];
let ready = null;
export async function tq(sql, params = []) {
  if (!ready) ready = (async () => { for (const s of SCHEMA) await q(s); })().catch((e) => { ready = null; throw e; });
  await ready;
  return q(sql, params);
}

export async function shareKey(rotate = false) {
  if (!rotate) {
    const [r] = await tq("SELECT v FROM tz_settings WHERE k = 'share_key'");
    if (r) return r.v;
  }
  const key = crypto.randomBytes(12).toString("base64url");
  await tq("INSERT INTO tz_settings (k, v) VALUES ('share_key', $1) ON CONFLICT (k) DO UPDATE SET v = $1", [key]);
  return key;
}

export function slimPost(p) {
  const d = p.data || {};
  return { id: p.id, created: new Date(p.created_at).getTime(), url: p.url, platform: p.platform, status: p.status, error: p.error,
    title: p.title, category: p.category, subcategory: p.subcategory, country: p.country, region: p.region, thumb: p.thumb,
    summary: d.summary || "", tags: d.tags || [], has_recipe: Boolean(d.recipe), recipe_type: d.recipe?.type || "",
    dish: d.recipe?.dish || "", n_ing: (d.recipe?.ingredients || []).length, places: (d.places || []).map((x) => ({ ...x })) };
}
