// 命盤小工具:排盤(八字用 lunar-javascript,紫微用 iztro,兩個都是 MIT 授權)
// 排盤一律由程式算,AI 只負責解讀,不讓 AI 自己排盤。
import lunarPkg from "lunar-javascript";
import { astro } from "iztro";

const { Solar, Lunar } = lunarPkg;

// lunar-javascript 輸出簡體,轉成繁體(只需要命理用到的字)
const S2T = { 财: "財", 杀: "殺", 头: "頭", 伤: "傷", 炉: "爐", 剑: "劍", 锋: "鋒", 涧: "澗", 蜡: "蠟", 杨: "楊", 雳: "靂", 长: "長", 灯: "燈", 驿: "驛", 钗: "釵", 钏: "釧", 阳: "陽", 阴: "陰", 猪: "豬", 马: "馬", 鸡: "雞", 龙: "龍" };
const tw = (s) => String(s ?? "").replace(/[一-鿿]/g, (c) => S2T[c] || c);

const GAN_WX = { 甲: "木", 乙: "木", 丙: "火", 丁: "火", 戊: "土", 己: "土", 庚: "金", 辛: "金", 壬: "水", 癸: "水" };
const ZHI_WX = { 子: "水", 丑: "土", 寅: "木", 卯: "木", 辰: "土", 巳: "火", 午: "火", 未: "土", 申: "金", 酉: "金", 戌: "土", 亥: "水" };

// 台灣歷年夏令時間(日光節約):這段期間出生的鐘錶時間要減 1 小時
const TW_DST = [
  [1945, 1951, "05-01", "09-30"], [1952, 1952, "03-01", "10-31"], [1953, 1954, "04-01", "10-31"],
  [1955, 1959, "04-01", "09-30"], [1960, 1961, "06-01", "09-30"], [1974, 1975, "04-01", "09-30"], [1979, 1979, "07-01", "09-30"],
];
function inTwDst(y, m, d) {
  const md = `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return TW_DST.some(([a, b, s, e]) => y >= a && y <= b && md >= s && md <= e);
}

// input: { date: "1995-03-18", time: "14:30" 或 "", gender: "女"|"男", place, name, taiwan: true }
export function buildChart(input) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input.date || "");
  if (!m) throw new Error("出生日期格式不對");
  let [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (y < 1901 || y > 2099) throw new Error("出生年份要在 1901 到 2099 之間");
  const gender = input.gender === "男" ? "男" : "女";
  const notes = [];
  let hasTime = false, h = 12, mi = 0;
  const t = /^(\d{1,2}):(\d{2})$/.exec(input.time || "");
  if (t) {
    hasTime = true; h = +t[1]; mi = +t[2];
    if (h > 23 || mi > 59) throw new Error("出生時間格式不對");
    if (input.taiwan !== false && inTwDst(y, mo, d)) {
      const s = Solar.fromYmdHms(y, mo, d, h, mi, 0).next(0); // 複製
      const adj = Solar.fromJulianDay(s.getJulianDay() - 1 / 24);
      [y, mo, d, h, mi] = [adj.getYear(), adj.getMonth(), adj.getDay(), adj.getHour(), adj.getMinute()];
      notes.push(`出生時在台灣夏令時間期間,已自動減 1 小時,用 ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")} 排盤`);
    }
  } else {
    notes.push("沒有出生時間:八字只排年、月、日三柱,紫微斗數需要時辰所以不排");
  }

  const solar = Solar.fromYmdHms(y, mo, d, h, mi, 0);
  const lunar = solar.getLunar();
  const ec = lunar.getEightChar();
  const pillar = (label, gz, ssGan, ssZhi, hide, nayin) => ({
    label, gan: gz[0], zhi: gz[1], ganWx: GAN_WX[gz[0]], zhiWx: ZHI_WX[gz[1]],
    shishen: tw(ssGan), hidden: hide.map((g, i) => ({ gan: g, wx: GAN_WX[g], shishen: tw(ssZhi[i]) })), nayin: tw(nayin),
  });
  const pillars = [
    pillar("年柱", ec.getYear(), ec.getYearShiShenGan(), ec.getYearShiShenZhi(), ec.getYearHideGan(), ec.getYearNaYin()),
    pillar("月柱", ec.getMonth(), ec.getMonthShiShenGan(), ec.getMonthShiShenZhi(), ec.getMonthHideGan(), ec.getMonthNaYin()),
    pillar("日柱", ec.getDay(), "日主", ec.getDayShiShenZhi(), ec.getDayHideGan(), ec.getDayNaYin()),
  ];
  if (hasTime) pillars.push(pillar("時柱", ec.getTime(), ec.getTimeShiShenGan(), ec.getTimeShiShenZhi(), ec.getTimeHideGan(), ec.getTimeNaYin()));

  // 五行數量:天干、地支本氣各算 1,藏干(非本氣)各算 0.5
  const wx = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  for (const p of pillars) {
    wx[p.ganWx] += 1; wx[p.zhiWx] += 1;
    p.hidden.slice(1).forEach((x) => (wx[x.wx] += 0.5));
  }

  const yun = ec.getYun(gender === "男" ? 1 : 0);
  const dayun = yun.getDaYun().slice(1, 9).map((dy) => ({ gz: dy.getGanZhi(), age: dy.getStartAge(), year: dy.getStartYear() }));

  const now = new Date().getFullYear();
  const liunian = [now, now + 1, now + 2].map((yy) => ({ year: yy, gz: Lunar.fromYmd(yy, 6, 1).getYearInGanZhi() }));

  const bazi = {
    dayMaster: ec.getDayGan(), dayMasterWx: GAN_WX[ec.getDayGan()], pillars, wuxing: wx,
    dayun: hasTime ? dayun : [], qiyun: hasTime ? `${yun.getStartYear()} 年 ${yun.getStartMonth()} 個月後起運` : "",
    liunian, monthZhi: ec.getMonth()[1],
  };

  let ziwei = null;
  if (hasTime) {
    const idx = h === 23 ? 12 : Math.floor((h + 1) / 2);
    const a = astro.bySolar(`${y}-${mo}-${d}`, idx, gender, true, "zh-TW");
    const star = (s) => ({ name: s.name, b: s.brightness || "", hua: s.mutagen || "" });
    ziwei = {
      lunarDate: a.lunarDate, chineseDate: a.chineseDate, timeRange: a.timeRange, time: a.time,
      fiveElementsClass: a.fiveElementsClass, soul: a.soul, body: a.body,
      soulBranch: a.earthlyBranchOfSoulPalace, bodyBranch: a.earthlyBranchOfBodyPalace,
      palaces: a.palaces.map((p) => ({
        name: p.name, stem: p.heavenlyStem, branch: p.earthlyBranch, isBody: p.isBodyPalace,
        major: p.majorStars.map(star), minor: p.minorStars.map(star), adj: p.adjectiveStars.map((s) => s.name),
        decadal: p.decadal?.range || [],
      })),
    };
  }

  return {
    input: { name: (input.name || "").slice(0, 20), date: input.date, time: hasTime ? input.time : "", gender, place: (input.place || "").slice(0, 40) },
    solar: solar.toYmdHms(), lunar: tw(lunar.toString()), zodiac: tw(lunar.getYearShengXiao()),
    hasTime, notes, bazi, ziwei,
  };
}

// 給 AI 看的精簡文字版命盤
export function chartText(c) {
  const b = c.bazi;
  const lines = [];
  lines.push(`性別:${c.input.gender};排盤用時間:${c.solar}${c.hasTime ? "" : "(時辰不明)"};農曆:${c.lunar};生肖:${c.zodiac}`);
  if (c.notes.length) lines.push("備註:" + c.notes.join(";"));
  lines.push("【八字】");
  for (const p of b.pillars) lines.push(`${p.label} ${p.gan}${p.zhi}(${p.ganWx}/${p.zhiWx})天干十神:${p.shishen};藏干:${p.hidden.map((x) => `${x.gan}${x.wx}${x.shishen}`).join("、")};納音:${p.nayin}`);
  lines.push(`日主:${b.dayMaster}${b.dayMasterWx};月令:${b.monthZhi}`);
  lines.push(`五行數量(天干地支各1,藏干餘氣各0.5):${Object.entries(b.wuxing).map(([k, v]) => k + v).join(" ")}`);
  if (b.dayun.length) lines.push(`大運(${b.qiyun}):${b.dayun.map((d) => `${d.gz}(${d.age}歲/${d.year}年起)`).join("、")}`);
  lines.push(`流年:${b.liunian.map((l) => `${l.year}${l.gz}`).join("、")}`);
  if (c.ziwei) {
    const z = c.ziwei;
    lines.push("【紫微斗數】");
    lines.push(`五行局:${z.fiveElementsClass};命主:${z.soul};身主:${z.body};命宮在${z.soulBranch};身宮在${z.bodyBranch}`);
    for (const p of z.palaces) {
      const st = (arr) => arr.map((s) => s.name + (s.b ? `(${s.b})` : "") + (s.hua ? `化${s.hua}` : "")).join("、");
      lines.push(`${p.name}(${p.stem}${p.branch}${p.isBody ? ",身宮" : ""},大限${p.decadal.join("-")}歲):主星 ${st(p.major) || "無主星"};輔星 ${st(p.minor) || "無"}`);
    }
  }
  return lines.join("\n");
}
