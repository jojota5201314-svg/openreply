import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

const key = () => createHash("sha256").update(env("ENCRYPTION_KEY")).digest();
const secret = () => env("SESSION_SECRET", process.env.NEXTAUTH_SECRET);

export function encrypt(text) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
export function decrypt(b64) {
  const buf = Buffer.from(b64, "base64");
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}
export function sign(value) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
export function signedToken(payload) {
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${p}.${sign(p)}`;
}
export function readSignedToken(token, maxAgeMs) {
  if (!token || !token.includes(".")) return null;
  const [p, s] = token.split(".");
  if (!safeEqual(s, sign(p))) return null;
  try {
    const data = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (typeof data.ts !== "number") return null;
    const age = Date.now() - data.ts;
    if (age < 0 || age > maxAgeMs) return null;
    return data;
  } catch { return null; }
}
export function verifyMetaSignature(raw, header) {
  if (!header) return false;
  const secrets = [process.env.INSTAGRAM_APP_SECRET, process.env.FACEBOOK_APP_SECRET].filter(Boolean);
  return secrets.some((s) => safeEqual(header, "sha256=" + createHmac("sha256", s).update(raw).digest("hex")));
}
