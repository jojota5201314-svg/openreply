import pg from "pg";

let pool = null;
let ready = null;

export function setPool(p) { pool = p; ready = null; }
function getPool() {
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return pool;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ad_accounts (
    ig_id TEXT PRIMARY KEY,
    username TEXT,
    token_enc TEXT NOT NULL,
    token_expires TIMESTAMPTZ,
    subscribed BOOLEAN DEFAULT FALSE,
    connected_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ad_rules (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    account_ig_id TEXT,
    triggers TEXT NOT NULL DEFAULT 'comment',
    keywords TEXT NOT NULL DEFAULT '',
    match_mode TEXT NOT NULL DEFAULT 'contains',
    media_id TEXT,
    public_replies TEXT DEFAULT '',
    opener_text TEXT DEFAULT '',
    opener_button TEXT DEFAULT '',
    dm_text TEXT NOT NULL DEFAULT '',
    buttons JSONB DEFAULT '[]',
    active BOOLEAN DEFAULT TRUE,
    sort INTEGER DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ad_events (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ad_logs (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    ig_id TEXT,
    kind TEXT,
    from_id TEXT,
    from_name TEXT,
    text TEXT,
    rule_id INTEGER,
    status TEXT,
    detail TEXT
  )`,
];

export async function q(sql, params = []) {
  const p = getPool();
  if (!ready) ready = (async () => { for (const s of SCHEMA) await p.query(s); })().catch((e) => { ready = null; throw e; });
  await ready;
  const r = await p.query(sql, params);
  return r.rows;
}

/** Returns true the first time an event id is seen, false for repeats. */
export async function firstTime(eventId) {
  const rows = await q("SELECT id FROM ad_events WHERE id = $1", [eventId]);
  if (rows.length) return false;
  try { await q("INSERT INTO ad_events (id) VALUES ($1)", [eventId]); return true; }
  catch { return false; }
}

export async function log(entry) {
  const { ig_id = null, kind = null, from_id = null, from_name = null, text = null, rule_id = null, status = null, detail = null } = entry;
  try {
    await q(`INSERT INTO ad_logs (ig_id, kind, from_id, from_name, text, rule_id, status, detail)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ig_id, kind, from_id, from_name, text ? String(text).slice(0, 500) : null, rule_id, status, detail ? String(detail).slice(0, 800) : null]);
  } catch (e) { console.error("log failed", e); }
}
