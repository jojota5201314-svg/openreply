// 貼文整理小幫手:所有功能共用一個入口(Vercel 免費方案最多 12 個函式)
import * as fetchR from "../lib/tzr/fetch.js";
import * as postR from "../lib/tzr/post.js";
import * as postsR from "../lib/tzr/posts.js";
import * as runR from "../lib/tzr/run.js";
import * as shareR from "../lib/tzr/share.js";
import * as tripR from "../lib/tzr/trip.js";
import * as tripsR from "../lib/tzr/trips.js";

const ROUTES = { fetch: fetchR, post: postR, posts: postsR, run: runR, share: shareR, trip: tripR, trips: tripsR };

async function handle(request) {
  const a = new URL(request.url).searchParams.get("a") || "";
  const mod = ROUTES[a];
  const fn = mod?.[request.method];
  if (!fn) return Response.json({ error: "找不到這個功能" }, { status: 404 });
  try { return await fn(request); }
  catch (e) { console.error(e); return Response.json({ error: "出錯了:" + e.message }, { status: 500 }); }
}
export const GET = handle, POST = handle, PUT = handle, PATCH = handle, DELETE = handle;
