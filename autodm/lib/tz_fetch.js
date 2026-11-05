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

const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

// 抖音:短網址轉成影片編號,再直接讀分享頁的文案(免費),講的話交給 Apify
async function douyinId(url) {
  const direct = url.match(/(?:video|note|share\/video|share\/note)\/(\d{8,})/) || url.match(/modal_id=(\d{8,})/);
  if (direct) return direct[1];
  let cur = url;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(cur, { redirect: "manual", headers: { "User-Agent": MOBILE_UA } });
    const loc = r.headers.get("location");
    if (!loc) break;
    cur = new URL(loc, cur).toString();
    const m = cur.match(/(?:video|note)\/(\d{8,})/) || cur.match(/modal_id=(\d{8,})/);
    if (m) return m[1];
  }
  return "";
}
const SPIDER_UAS = [
  "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
];
async function douyinPage(id, dbg) {
  for (const ua of [MOBILE_UA, ...SPIDER_UAS]) {
    for (const kind of ["video", "note"]) {
      const r = await fetch(`https://www.iesdouyin.com/share/${kind}/${id}/`, { headers: { "User-Agent": ua, Referer: "https://www.douyin.com/", "Accept-Language": "zh-CN,zh;q=0.9" } });
      const html = await r.text();
      dbg.push(`${ua.slice(25, 35)}/${kind}:${r.status}:${html.length}`);
      const m = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
      if (m) {
        try {
          const data = JSON.parse(m[1]);
          for (const pg of Object.values(data.loaderData || {})) {
            const it = pg?.videoInfoRes?.item_list?.[0];
            if (it) return {
              text: it.desc || "", author: it.author?.nickname || "",
              images: [it.video?.cover?.url_list?.[0], ...(it.images || []).map((x) => x?.url_list?.[0])].filter(Boolean),
              is_video: !it.images?.length,
            };
          }
        } catch {}
      }
      const desc = meta(html, "description") || meta(html, "og:description");
      const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "";
      const t = decodeHtml(desc || title).replace(/\s*-\s*抖音\s*$/, "").trim();
      if (t.length > 12 && !/^抖音/.test(t)) return { text: t, author: "", images: [meta(html, "og:image")].filter(Boolean), is_video: kind === "video" };
    }
  }
  return null;
}
async function fetchDouyin(url) {
  const dbg = [];
  let id = "";
  try { id = await douyinId(url); } catch (e) { dbg.push("id_err:" + e.message); }
  dbg.push("id:" + id);
  let page = null;
  if (id) { try { page = await douyinPage(id, dbg); } catch (e) { dbg.push("page_err:" + e.message); } }
  let p = {}, trErr = "";
  // 講的話要用付費的轉文字服務,只有在讀不到文案時才用
  if (!page?.text && process.env.DOUYIN_TRANSCRIBE === "1") {
    const tr = await runActor("抖音", id ? `https://www.douyin.com/video/${id}` : url);
    p = tr.post || {}; trErr = tr.error || "";
  }
  const post = { platform: "抖音", author: page?.author || p.author || "", title: p.title || "", text: page?.text || p.text || "",
    transcript: p.transcript || "", location: p.location || "", images: (page?.images?.length ? page.images : p.images || []).slice(0, 8),
    is_video: page ? page.is_video : Boolean(p.is_video) };
  const ok = Boolean(post.text || post.transcript);
  return { ok, platform: "抖音", post, debug: dbg.join(" | "),
    error: ok ? "" : (trErr || "抓不到這篇抖音的文案(可能是私人、已刪除,或抖音擋住了)") };
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
  const dbg = [];
  let finalUrl = url, page = null;
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Accept-Language": "zh-TW,zh;q=0.9" } });
    finalUrl = r.url || url;
    const html = await r.text();
    dbg.push(`og:${r.status}:${html.length}`);
    const desc = meta(html, "og:description") || meta(html, "description");
    const title = meta(html, "og:title");
    const img = meta(html, "og:image");
    if (desc || title) page = { text: desc, title: title, images: img ? [img] : [] };
  } catch (e) { dbg.push("og_err:" + e.message); }
  if (page?.text && page.text.length > 20) {
    const by = "";
    return { ok: true, platform: "臉書", debug: dbg.join(" | "),
      post: { platform: "臉書", author: by, title: page.title, text: page.text, transcript: "", location: "", images: page.images, is_video: /reel|video|watch/.test(finalUrl) } };
  }
  const r2 = await runActor("臉書", finalUrl);
  if (r2.ok) return r2;
  if (page) return { ok: true, platform: "臉書", debug: dbg.join(" | "),
    post: { platform: "臉書", author: "", title: page.title, text: page.text || page.title, transcript: "", location: "", images: page.images, is_video: true } };
  return { ...r2, debug: dbg.join(" | ") };
}

export async function fetchPost(url) {
  const platform = platformOf(url);
  if (!ACTORS[platform]) return { ok: false, platform, error: "這個連結不是 IG、TikTok、抖音、小紅書或臉書的貼文" };
  if (platform === "抖音") return fetchDouyin(url);
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
