// 叫 Claude 分類、整理食譜、排行程
import { env } from "./env.js";

export const CATS = ["旅遊", "餐廳美食", "食譜", "日常生活", "穿搭美妝", "健身運動", "居家手作", "知識學習", "購物好物", "其他"];

export async function claude(system, user, { images = [], maxTokens = 6000, timeoutMs = 52000 } = {}) {
  const key = env("ANTHROPIC_API_KEY");
  const model = process.env.TZ_MODEL || "claude-sonnet-5-5";
  const send = async (imgs) => {
    const content = [...imgs.map((u) => ({ type: "image", source: { type: "url", url: u } })), { type: "text", text: user }];
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: ctl.signal,
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }) });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, j };
    } finally { clearTimeout(t); }
  };
  let res;
  try { res = await send(images); }
  catch (e) { throw new Error(e.name === "AbortError" ? "AI 想太久了,再試一次" : "連不到 AI:" + e.message); }
  if (!res.ok && images.length && res.status === 400) res = await send([]); // 圖片讀不了就只用文字
  if (!res.ok) {
    const m = res.j?.error?.message || "";
    if (res.status === 401) throw new Error("AI 鑰匙不對(Vercel 的 ANTHROPIC_API_KEY)");
    if (res.status === 402 || /credit|billing/i.test(m)) throw new Error("AI 的儲值額度用完了");
    if (res.status === 429 || res.status === 529) throw new Error("AI 現在太忙,等一下再試");
    throw new Error(`AI 出錯了(${res.status}):${m.slice(0, 200)}`);
  }
  if (res.j.stop_reason === "max_tokens") throw new Error("內容太長,AI 沒寫完");
  return (res.j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

export function parseJson(text) {
  const t = (text || "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("AI 回傳的格式壞掉了,按「重新整理」再試一次");
  const s = t.slice(a, b + 1);
  try { return JSON.parse(s); } catch {}
  try { return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")); } catch {}
  throw new Error("AI 回傳的格式壞掉了,按「重新整理」再試一次");
}

const SYS_ANALYZE = `你是社群貼文整理助手。使用者收藏了 IG、TikTok、抖音、小紅書、臉書的貼文,你要根據貼文文案、影片逐字稿、封面圖片,整理成乾淨的資料。
規則:
- 一律用繁體中文、台灣用語輸出(簡體字要轉成繁體)。店名、地名保留原本寫法,外文可以在後面括號加中文。
- 逐字稿是機器辨識的,可能有錯字或只是背景音樂歌詞,沒有意義就忽略。
- 只寫貼文裡真的有的內容,不要自己編店名、份量或步驟;真的缺少的就留空或寫「貼文沒寫」。
- 只輸出 JSON,不要任何其他文字。`;

const SCHEMA_ANALYZE = `請輸出這個格式的 JSON:
{"title":"清楚的標題,20 字內","summary":"2~3 句重點摘要",
"category":"只能從這裡選一個:${CATS.join("、")}",
"subcategory":"細分類。旅遊=城市或地區(例:東京、墾丁);餐廳美食=料理類型(火鍋、咖啡廳、甜點店、燒肉…);食譜=甜點/料理/飲品/麵包/湯品/醬料/便當/氣炸鍋 其中之一;其他分類自己取 2~6 字",
"country":"相關國家,例:台灣、日本、中國、香港、韓國;沒有就空字串","region":"城市或地區,例:台北、嘉義、深圳、大阪;沒有就空字串",
"tags":["3~6 個標籤"],
"places":[{"name":"地點名稱","type":"景點|餐廳|咖啡廳|甜點|小吃|酒吧|住宿|購物|交通|其他","city":"城市","address":"地址(貼文有寫才填)","note":"必點、價錢、營業時間、要預約、門票…","lat":緯度數字或 null,"lng":經度數字或 null}],
"recipe":null 或 {"dish":"菜名","type":"甜點|料理|飲品|麵包|湯品|醬料|便當|其他","servings":幾人份數字,"time":"大約時間","difficulty":"簡單|中等|有點難",
 "ingredients":[{"group":"主材料/醃料/醬汁/裝飾…","name":"食材","qty":數字或 null,"unit":"g/ml/大匙/小匙/顆/杯…","note":"切丁、室溫、適量…"}],
 "steps":["每一步一句,照順序"],"tips":["小技巧"]},
"key_points":["其他重點:好物清單、知識點、穿搭單品、運動動作…沒有就空陣列"]}
places:貼文有提到具體地點就列出來,不論分類;沒有就空陣列。lat/lng 你知道大概位置才填。recipe:只有教做菜/飲料/甜點時才填,否則 null。`;

export async function analyze(post) {
  const r = post.raw || {};
  const parts = [`平台:${post.platform || ""}`, `作者:${r.author || ""}`];
  if (post.user_text) parts.push("【使用者貼上的文字】\n" + post.user_text.slice(0, 6000));
  if (r.title) parts.push("【標題】\n" + r.title);
  if (r.text) parts.push("【貼文文案】\n" + r.text.slice(0, 8000));
  if (r.transcript) parts.push("【影片講話的逐字稿】\n" + r.transcript.slice(0, 10000));
  if (r.location) parts.push("【貼文標的地點】" + r.location);
  const imgs = (r.images || []).slice(0, 3);
  if (imgs.length) parts.push(`【附上 ${imgs.length} 張貼文的圖片/封面,上面的字也要讀】`);
  const out = parseJson(await claude(SYS_ANALYZE, parts.join("\n\n") + "\n\n" + SCHEMA_ANALYZE, { images: imgs, maxTokens: 5000 }));
  if (!CATS.includes(out.category)) out.category = "其他";
  out.places = Array.isArray(out.places) ? out.places.slice(0, 40) : [];
  out.tags = Array.isArray(out.tags) ? out.tags.slice(0, 8) : [];
  out.key_points = Array.isArray(out.key_points) ? out.key_points.slice(0, 30) : [];
  return out;
}

const SYS_TRIP = `你是很會排自由行的旅遊規劃師,熟悉各國交通、地理位置和營業時間。用繁體中文(台灣用語),只輸出 JSON。
排行程原則:
- 同一天的點要在同一區或順路,不要來回折返;考慮營業時間(早餐店早上去、夜市晚上去)和用餐時間。
- 使用者收藏的地點優先排進去,並填上它的 saved_id;你另外推薦的點 saved_id 填 null,note 開頭寫「推薦:」。
- 交通要具體:搭幾號線、哪站上下車、大約幾分鐘、大約多少錢。
- 住宿依照使用者的住宿方式,推薦住在哪一區最方便,並說明原因。
- 每個點都要給 lat/lng(大概座標)。文字精簡,note 一兩句。`;
const SCHEMA_TRIP = `只輸出這個格式的 JSON:
{"title":"行程名稱","overview":"整體說明 2~3 句",
"days":[{"day":1,"date":"YYYY-MM-DD 或空字串","area":"今天主要在哪一區","theme":"今天的主題",
 "stops":[{"time":"09:00","name":"地點名稱","city":"城市","type":"景點|餐廳|咖啡廳|甜點|小吃|購物|住宿|其他","saved_id":"收藏地點的 id 或 null","lat":數字,"lng":數字,"stay":"建議停留","note":"要做什麼、必點","cost":"大約花費",
  "next":{"mode":"步行|地鐵|公車|計程車|開車|火車|高鐵|渡輪","minutes":數字,"detail":"怎麼去下一站"}}]}],
"hotels":[{"area":"住宿區域","nights":"第幾晚","why":"為什麼住這區","suggestions":[{"name":"飯店名稱","level":"平價|中等|高級","price":"每晚大約多少"}]}],
"transport":{"arrival":"怎麼抵達、從機場/車站到市區","local":"當地交通:票卡、App","tips":["交通小提醒"]},
"budget":"每人大約花費(住宿、交通、吃、門票)","checklist":["出發前要準備的事"]}
每天最後一站的 next 填 null。`;

export function tripRequest(p, places) {
  const L = [`國家/目的地:${p.country || ""}`, `地區:${p.region || "(依收藏地點所在地)"}`, `天數:${p.days || 3} 天`];
  if (p.start_date) L.push("出發日期:" + p.start_date);
  L.push(`步調:${p.pace || "適中"}`, `主要交通:${p.transport || "大眾運輸"}`, `住宿方式:${p.stay || "一間住到底"}`, `住宿預算:${p.budget || "中等"}`, `同行:${p.people || "未說明"}`);
  if (p.interests?.length) L.push("喜歡:" + p.interests.join("、"));
  L.push("可以另外推薦收藏以外的地點:" + (p.auto_add !== false ? "可以,幫我補足行程" : "不要,只排我收藏的地點"));
  if (p.extra) L.push("其他需求:" + p.extra);
  if (places?.length) {
    L.push("\n【我收藏的地點】(一定要排進去,排不下就寫在 overview)");
    for (const x of places) L.push(JSON.stringify({ saved_id: x.sid, name: x.name, type: x.type, city: x.city, address: x.address, note: x.note }));
  }
  return L.join("\n");
}
export async function planTrip(params, places) {
  return parseJson(await claude(SYS_TRIP, tripRequest(params, places) + "\n\n" + SCHEMA_TRIP, { maxTokens: 14000, timeoutMs: 270000 }));
}
export async function refineTrip(params, places, plan, instruction) {
  const u = tripRequest(params, places) + "\n\n【目前的行程】\n" + JSON.stringify(plan) + "\n\n【使用者想要這樣改】\n" + instruction +
    "\n\n照使用者的要求修改,沒提到的部分盡量保持原樣。輸出完整的新行程。\n" + SCHEMA_TRIP;
  return parseJson(await claude(SYS_TRIP, u, { maxTokens: 14000, timeoutMs: 270000 }));
}

// ---- 分段排行程:先排大綱(每天去哪區、放哪些收藏點),再一天一天排細節 ----
const SCHEMA_OUTLINE = `只輸出這個格式的 JSON(先排大綱,不用排每一站的細節):
{"title":"行程名稱","overview":"整體說明 2~3 句",
"days":[{"day":1,"date":"YYYY-MM-DD 或空字串","area":"今天主要在哪一區","theme":"今天的主題","saved_ids":["這天要去的收藏地點 saved_id"],"ideas":["這天另外推薦的點或要吃什麼,沒有就空陣列"]}],
"hotels":[{"area":"住宿區域","nights":"第幾晚","why":"為什麼住這區","suggestions":[{"name":"飯店名稱","level":"平價|中等|高級","price":"每晚大約多少"}]}],
"transport":{"arrival":"怎麼抵達、從機場/車站到市區","local":"當地交通:票卡、App","tips":["交通小提醒"]},
"budget":"每人大約花費(住宿、交通、吃、門票)","checklist":["出發前要準備的事"]}
同一區的收藏地點放在同一天,每天的量要符合步調。`;
const SCHEMA_DAY = `只輸出這個格式的 JSON(只排這一天):
{"stops":[{"time":"09:00","name":"地點名稱","city":"城市","type":"景點|餐廳|咖啡廳|甜點|小吃|購物|住宿|其他","saved_id":"收藏地點的 saved_id 或 null","lat":數字,"lng":數字,"stay":"建議停留","note":"要做什麼、必點(一兩句)","cost":"大約花費",
 "next":{"mode":"步行|地鐵|公車|計程車|開車|火車|高鐵|渡輪","minutes":數字,"detail":"怎麼去下一站"}}]}
最後一站的 next 填 null。要排早餐/午餐/晚餐。`;
export async function planOutline(params, places) {
  return parseJson(await claude(SYS_TRIP, tripRequest(params, places) + "\n\n" + SCHEMA_OUTLINE, { maxTokens: 8000, timeoutMs: 270000 }));
}
export async function planDay(params, places, outline, i) {
  const d = outline.days[i] || {};
  const ids = new Set(d.saved_ids || []);
  const mine = (places || []).filter((x) => ids.has(x.sid));
  const ctx = [`整趟:${outline.title || ""}(共 ${outline.days.length} 天)`, `步調:${params.pace || "適中"}`, `主要交通:${params.transport || "大眾運輸"}`,
    `同行:${params.people || "未說明"}`, params.interests?.length ? "喜歡:" + params.interests.join("、") : "", params.extra ? "其他需求:" + params.extra : "",
    `住宿區域:${(outline.hotels || []).map((h) => h.area + "(" + (h.nights || "") + ")").join("、")}`,
    `\n現在排第 ${i + 1} 天:${d.date || ""} 主要在 ${d.area || ""},主題 ${d.theme || ""}`,
    `這天一定要去的收藏地點:\n${mine.map((x) => JSON.stringify({ saved_id: x.sid, name: x.name, type: x.type, city: x.city, address: x.address, note: x.note })).join("\n") || "(沒有)"}`,
    `可以參考的點子:${(d.ideas || []).join("、") || "(自由安排)"}`,
    params.auto_add !== false ? "可以補推薦的地點,note 開頭寫「推薦:」" : "不要加收藏以外的景點(吃飯可以推薦)"].filter(Boolean).join("\n");
  const out = parseJson(await claude(SYS_TRIP, ctx + "\n\n" + SCHEMA_DAY, { maxTokens: 6000, timeoutMs: 270000 }));
  return Array.isArray(out.stops) ? out.stops : [];
}
