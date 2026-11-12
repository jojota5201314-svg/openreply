// 命盤小工具:所有功能共用一個入口(Vercel 免費方案最多 12 個函式,這是第 12 個)
import { routes } from "../lib/mp.js";

async function handle(request) {
  const a = new URL(request.url).searchParams.get("a") || "";
  const fn = Object.hasOwn(routes, a) ? routes[a] : null;
  if (!fn) return Response.json({ error: "找不到這個功能" }, { status: 404 });
  try { return await fn(request); }
  catch (e) { console.error(e); return Response.json({ error: "出錯了:" + e.message }, { status: 500 }); }
}
export const GET = handle, POST = handle, PUT = handle, DELETE = handle;
