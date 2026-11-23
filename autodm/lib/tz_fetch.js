// 貼文整理小幫手:把社群連結交給 Apify 抓文案、字幕、圖片
import { env } from "./env.js";

export function platformOf(url) {
  const u = (url || "").toLowerCase();
  if (u.includes("instagram.com")) return "IG";
  if (u.includes("douyin.com") || u.includes("iesdouyin")) return "抖音";
  if (u.includes("tiktok.com")) return "TikTok";
  if (u.includes("xiaohongshu.com") || u.includes("xhslink")) return "小紅書";
  if (u.includes("facebook.com") || u.includes("fb.watch") || u.includes("fb.com")) return "臉書";
  return /^https?:\/\//.test(u) ? "網頁" : "";
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
  IG影片文字: { id: "tubetext~instagram-reels-transcript", timeout: 200, memory: 2048, input: (url) => ({ urls: [url], includeOnScreenText: true, maxReelsPerProfile: 1 }) },
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
    onscreen: (() => { const k = Object.keys(it).find((x) => /screen/i.test(x)); const v = k ? it[k] : "";
      return Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : x?.text || "")).filter(Boolean).join("\n") : typeof v === "string" ? v : ""; })(),
    location: pick(it.locationName, it.ipLocation, it.location?.name),
    images: imgs.slice(0, 8),
    video_url: pick(it.videoUrl, it.video_url, it.mediaUrls?.[0], it.video?.playAddr, typeof it.video === "string" ? it.video : ""),
    duration: Number(it.videoDuration || it.videoMeta?.duration || it.duration || 0) || 0,
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

// 一般網站:直接讀網頁上的標題和文章內容
function pageText(html) {
  let h = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, " ");
  const main = h.match(/<article[\s\S]*?<\/article>/i)?.[0] || h.match(/<main[\s\S]*?<\/main>/i)?.[0] || h.match(/<body[\s\S]*?<\/body>/i)?.[0] || h;
  return decodeHtml(main.replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t\u00a0]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
async function fetchWebPage(url) {
  let r;
  try {
    r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(25000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JojoTiezhi/1.0; +https://jojo-openreply.vercel.app)", "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.5", Accept: "text/html,application/xhtml+xml" } });
  } catch (e) { return { ok: false, platform: "網頁", error: "打不開這個網站(" + (e.name === "TimeoutError" ? "太久沒回應" : e.message) + "),可以把文章內容複製貼上" }; }
  if (!r.ok) return { ok: false, platform: "網頁", error: `這個網站不讓程式讀取(${r.status}),請把文章內容複製,跟連結一起貼上` };
  const type = r.headers.get("content-type") || "";
  if (!/html|text/.test(type)) return { ok: false, platform: "網頁", error: "這個連結不是網頁(可能是檔案或圖片)" };
  const html = (await r.text()).slice(0, 2_000_000);
  const title = meta(html, "og:title") || decodeHtml((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "").trim();
  const desc = meta(html, "og:description") || meta(html, "description");
  const body = pageText(html);
  const img = meta(html, "og:image");
  const site = meta(html, "og:site_name") || new URL(r.url || url).hostname.replace(/^www\./, "");
  const text = [desc, body].filter(Boolean).join("\n\n").slice(0, 15000);
  const ok = text.replace(/\s/g, "").length > 80;
  return { ok, platform: "網頁", post: { platform: "網頁", author: site, title, text, transcript: "", location: "", images: img && /^https?:/.test(img) ? [img] : [], is_video: false },
    error: ok ? "" : "這個網頁讀不到文章內容(可能要登入或是用程式產生的),請把內容複製貼上" };
}

// IG Reels:文案用一般抓取,影片裡講的話和畫面上的字用轉文字服務,兩個一起跑
async function fetchIgReel(url) {
  const [base, tr] = await Promise.all([runActor("IG", url), runActor("IG影片文字", url).catch((e) => ({ ok: false, error: e.message }))]);
  const p = base.post || { platform: "IG", author: "", title: "", text: "", transcript: "", location: "", images: [], is_video: true };
  const t = tr.post || {};
  p.platform = "IG";
  p.author = p.author || t.author || "";
  p.text = p.text || t.text || "";
  p.transcript = [t.transcript ? "【影片裡講的話】\n" + t.transcript : "", t.onscreen ? "【影片畫面上的字】\n" + t.onscreen : ""].filter(Boolean).join("\n\n");
  p.is_video = true;
  const ok = Boolean(p.text || p.transcript);
  return { ok, platform: "IG", post: p, transcript_note: tr.ok ? "" : (tr.error || ""), raw_keys: tr.raw_keys,
    error: ok ? "" : (base.error || tr.error || "抓不到這篇 Reels") };
}

export async function fetchPost(url) {
  const platform = platformOf(url);
  if (platform === "網頁") return fetchWebPage(url);
  if (!ACTORS[platform]) return { ok: false, platform, error: "這個連結看不懂,請確認是完整的網址" };
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
  const tsec = actor.timeout || 50;
  const api = `https://api.apify.com/v2/acts/${actor.id}/run-sync-get-dataset-items?timeout=${tsec}&clean=true${actor.memory ? "&memory=" + actor.memory : ""}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), (tsec + 5) * 1000);
  let res;
  try {
    res = await fetch(api, { method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(actor.input(url)) });
  } catch (e) {
    return { ok: false, platform, error: e.name === "AbortError" ? `抓太久了(超過 ${tsec + 5} 秒),再試一次` : "連不到抓取服務:" + e.message };
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
