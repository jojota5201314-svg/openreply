// 從影片截幾張畫面給 AI 看,讀出畫面上的字幕和字卡
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const run = (args, ms) => new Promise((ok, no) => {
  const p = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  p.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
  const t = setTimeout(() => { p.kill("SIGKILL"); no(new Error("截圖太久")); }, ms);
  p.on("close", (c) => { clearTimeout(t); c === 0 ? ok() : no(new Error("截圖失敗:" + err.slice(-200))); });
  p.on("error", (e) => { clearTimeout(t); no(e); });
});

export async function videoFrames(url, duration = 0, max = 8) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tz-"));
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error("影片下載不了(" + r.status + ")");
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 80 * 1024 * 1024) throw new Error("影片太大");
    const file = path.join(dir, "v.mp4");
    await fs.writeFile(file, buf);
    const dur = Math.min(Number(duration) || 60, 180);
    const fps = Math.max(max / dur, 1 / 30); // 平均分布在整支影片
    await run(["-hide_banner", "-loglevel", "error", "-i", file, "-t", String(dur), "-vf", `fps=${fps.toFixed(4)},scale=720:-2`, "-frames:v", String(max), "-q:v", "5", path.join(dir, "f%02d.jpg")], 60000);
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".jpg")).sort();
    const out = [];
    for (const n of names) out.push((await fs.readFile(path.join(dir, n))).toString("base64"));
    return out;
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
