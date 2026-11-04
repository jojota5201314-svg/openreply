import { env } from "../lib/env.js";
import { verifyMetaSignature } from "../lib/crypto.js";
import { handleWebhook } from "../lib/engine.js";
import { log } from "../lib/db.js";

export function GET(request) {
  const p = new URL(request.url).searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === env("WEBHOOK_VERIFY_TOKEN")) {
    return new Response(p.get("hub.challenge") || "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request) {
  const raw = await request.text();
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"))) {
    await log({ kind: "系統", status: "通知簽章不對，已擋下" });
    return new Response("Invalid signature", { status: 401 });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  try { await handleWebhook(body); } catch (e) { console.error(e); await log({ kind: "系統", status: "錯誤", detail: e.message }); }
  return new Response("EVENT_RECEIVED", { status: 200 });
}
