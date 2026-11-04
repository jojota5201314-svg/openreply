export function env(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`缺少環境變數 ${name}`);
  }
  return v;
}
export const graphVersion = () => env("META_GRAPH_API_VERSION", "v25.0");
export const graphBase = () => `https://graph.instagram.com/${graphVersion()}`;
export function baseUrl(request) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const u = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || u.host;
  const proto = request.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
  return `${proto}://${host}`;
}
