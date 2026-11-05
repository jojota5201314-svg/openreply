// 貼文整理小幫手:把社群連結交給 Apify 抓文案、字幕、圖片
import { env } from "./env.js";

export function platformOf(url) {
  const u = (url || "").toLowerCase();
  if (u.includes("instagram.com")) return "IG";
  if (u.includes("douyin.com") || u.includes("iesdouyin")) return "抖音";
  if (u.includes("tiktok.com")) return "TikTok";
  if (u.includes("xiaohongshu.com") || u.includes("xhslink")) return "小紅書";
  if (u.includes("facebook.com") || u.includes("fb.watch") || u.includes("fb.com")) return "臉書";
  return "";
}

export function findUrl(text) {
  const m = (text || "").match(/https?:\/\/[^\s<>"'，。！]+/);
  return m ? m[0] : "";
}

const ACTORS = {
  IG: { id: "apify~instagram-scraper", input: (url) => ({ directUrls: [url], resultsType: "posts", resultsLimit: 1, addParentData: false }) },
  TikTok: { id: "clockworks~tiktok-scraper", input: (url) => ({ postURLs: [url], shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSubtitles: false }) },
  抖音: { id: "thirdwatch~douyin-scraper", input: (url) => ({ urls: [url], maxResults: 1 }) },
  小紅書: { id: "zen-studio~rednote-note-detail-scraper", input: (url) => ({ noteUrls: [url], downloadVideos: false, downloadImages: false }) },
  臉書: { id: "apify~facebook-posts-scraper", input: (url) => ({ startUrls: [{ url }], resultsLimit: 1 }) },
  臉書影片: { id: "alpha-scraper~facebook-reels-details-scraper-pro", input: (url) => ({ startUrls: [{ url }] }) },
};

const pick = (...v) => v.find((x) => typeof x === "string" && x.trim()) || "";

export function normalize(platform, item) {
  const it = item || {};
  const imgs = [];
  const push = (x) => { if (typeof x === "string" && x.startsWith("http") && !imgs.includes(x)) imgs.push(x); };
  push(it.displayUrl); (Array.isArray(it.images) ? it.images : []).forEach((x) => push(typeof x === "string" ? x : x?.url_original || x?.url));
  (Array.isArray(it.childPosts) ? it.childPosts : []).forEach((c) => push(c?.displayUrl));
  push(it.videoMeta?.coverUrl); push(it.cover); push(it.coverUrl); push(it.thumbnail);
  push(it.media?.thumbnail); push(it.media?.thumbnail_url); push(it.video?.thumbnail);
  (Array.isArray(it.media) ? it.media : []).forEach((m) => push(m?.thumbnail || m?.photo_image?.uri));
  return {
    platform,
    author: pick(typeof it.author === "string" ? it.author : "", it.owner?.name, it.owner?.username, it.page_context?.name, it.ownerUsername, it.ownerFullName, it.authorMeta?.name, it.author?.nickname, it.user?.nickname, it.nickname, it.pageName, it.user?.name),
    title: pick(it.title, it.itemTitle),
    text: pick(typeof it.caption === "string" ? it.caption : "", it.text, it.desc, typeof it.description === "string" ? it.description : "", it.message,
      it.video?.caption, it.video?.description, typeof it.post === "string" ? it.post : it.post?.text, it.post?.caption),
    transcript: pick(it.transcript, typeof it.subtitles === "string" ? it.subtitles : ""),
    location: pick(it.locationName, it.ipLocation, it.location?.name),
    images: imgs.slice(0, 8),
    is_video: Boolean(it.videoUrl || it.videoMeta || it.video || it.type === "Video" || it.transcript),
  };
}


// 臉書:用臉書自己的預覽機器人身分讀網頁的分享資訊(免費),讀不到再交給 Apify
const decodeHtml = (t) => (t || "").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function meta(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
  const m = html.match(re);
  return m ? decodeHtml(m[1] || m[2] || "") : "";
}
async function fetchFacebook(url) {
  const fix = (r) => { r.platform = "臉書"; if (r.post) r.post.platform = "臉書"; return r; };
  const isReel = /\/reel\/|\/share\/r\/|\/share\/v\/|\/watch|fb\.watch|\/videos\//.test(url);
  const r = await runActor(isReel ? "臉書影片" : "臉書", url);
  if (!r.ok) { const r2 = await runActor(isReel ? "臉書" : "臉書影片", url); if (r2.ok) return fix(r2); }
  return fix(r);
}

export async function fetchPost(url) {
  const platform = platformOf(url);
  if (!ACTORS[platform]) return { ok: false, platform, error: "這個連結不是 IG、TikTok、抖音、小紅書或臉書的貼文" };
  if (platform === "臉書") return fetchFacebook(url);
  const first = await runActor(platform, url);
  if (!first.ok && platform === "小紅書" && !/401|402|403/.test(first.error || "")) {
    const again = await runActor(platform, url);
    if (again.ok) return again;
  }
  return first;
}

async function runActor(platform, url) {
  const actor = ACTORS[platform];
  const token = env("APIFY_TOKEN");
  const api = `https://api.apify.com/v2/acts/${actor.id}/run-sync-get-dataset-items?timeout=50&clean=true`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 55000);
  let res;
  try {
    res = await fetch(api, { method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(actor.input(url)) });
  } catch (e) {
    return { ok: false, platform, error: e.name === "AbortError" ? "抓太久了(超過 55 秒),再試一次" : "連不到抓取服務:" + e.message };
  } finally { clearTimeout(timer); }
  const body = await res.text();
  if (!res.ok) {
    let msg = body.slice(0, 300);
    try { msg = JSON.parse(body)?.error?.message || msg; } catch {}
    const hint = res.status === 401 ? "(APIFY_TOKEN 不對)" : res.status === 402 ? "(Apify 免費額度用完了,或這個抓取工具要付費方案)" : res.status === 403 ? "(要先在 Apify 網站上同意使用這個抓取工具)" : "";
    return { ok: false, platform, actor: actor.id, error: `抓取服務回錯誤 ${res.status}${hint}:${msg}` };
  }
  let items = [];
  try { items = JSON.parse(body); } catch { return { ok: false, platform, error: "抓取服務回傳的格式看不懂" }; }
  const item = Array.isArray(items) ? items[0] : items;
  if (!item) return { ok: false, platform, actor: actor.id, error: "抓不到這篇(可能是私人帳號、已刪除,或平台擋住了)" };
  const itemErr = item.errorDescription || item.errMsg || (typeof item.error === "string" ? item.error : item.error?.message) || "";
  const post = normalize(platform, item);
  if (itemErr && !(post.text || post.transcript || post.title)) return { ok: false, platform, actor: actor.id, error: "抓不到這篇:" + itemErr };
  return { ok: Boolean(post.text || post.transcript || post.title || post.images.length), platform, actor: actor.id, post,
    raw_keys: Object.keys(item).slice(0, 60), error: post.text || post.transcript || post.title || post.images.length ? "" : "抓到了,但裡面沒有文字" };
}
