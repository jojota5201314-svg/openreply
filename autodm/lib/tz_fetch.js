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
  抖音: { id: "zen-studio~douyin-transcripts-scraper", input: (url) => ({ videoUrls: [url], targetLanguage: "zh", outputSrt: false }) },
  小紅書: { id: "zen-studio~rednote-note-detail-scraper", input: (url) => ({ noteUrls: [url], downloadVideos: false, downloadImages: false }) },
  臉書: { id: "apify~facebook-posts-scraper", input: (url) => ({ startUrls: [{ url }], resultsLimit: 1 }) },
};

const pick = (...v) => v.find((x) => typeof x === "string" && x.trim()) || "";

export function normalize(platform, item) {
  const it = item || {};
  const imgs = [];
  const push = (x) => { if (typeof x === "string" && x.startsWith("http") && !imgs.includes(x)) imgs.push(x); };
  push(it.displayUrl); (it.images || []).forEach((x) => push(typeof x === "string" ? x : x?.url_original || x?.url));
  (it.childPosts || []).forEach((c) => push(c?.displayUrl));
  push(it.videoMeta?.coverUrl); push(it.cover); push(it.coverUrl); push(it.thumbnail);
  (it.media || []).forEach((m) => push(m?.thumbnail || m?.photo_image?.uri));
  return {
    platform,
    author: pick(it.ownerUsername, it.ownerFullName, it.authorMeta?.name, it.author?.nickname, it.user?.nickname, it.nickname, it.pageName, it.user?.name),
    title: pick(it.title, it.itemTitle),
    text: pick(it.caption, it.text, it.desc, it.description, it.message),
    transcript: pick(it.transcript, typeof it.subtitles === "string" ? it.subtitles : ""),
    location: pick(it.locationName, it.ipLocation, it.location?.name),
    images: imgs.slice(0, 8),
    is_video: Boolean(it.videoUrl || it.videoMeta || it.video || it.type === "Video" || it.transcript),
  };
}

export async function fetchPost(url) {
  const platform = platformOf(url);
  const actor = ACTORS[platform];
  if (!actor) return { ok: false, platform, error: "這個連結不是 IG、TikTok、抖音、小紅書或臉書的貼文" };
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
  if (item.error || item.errorDescription) return { ok: false, platform, actor: actor.id, error: "抓不到這篇:" + (item.errorDescription || item.error) };
  const post = normalize(platform, item);
  return { ok: Boolean(post.text || post.transcript || post.title || post.images.length), platform, actor: actor.id, post,
    raw_keys: Object.keys(item).slice(0, 60), error: post.text || post.transcript || post.title || post.images.length ? "" : "抓到了,但裡面沒有文字" };
}
