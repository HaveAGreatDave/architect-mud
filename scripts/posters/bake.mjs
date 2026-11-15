// posters:bake — the HELLMOO lettering lifted off the hero posters' print into a layer of its own.
//
//   node scripts/posters/bake.mjs
//
// The print comes in two versions of the same picture, pixel for pixel: client/game/assets/posters/hellmoo.webp with
// no lettering (the art ROOM hangs, cut into its seven sheets), and scripts/posters/hellmoo-lettered.webp with the gold
// HELLMOO across the foot of it. Where the two differ is the lettering: this writes it, and only it, with an alpha
// that follows how far the lettered version is from the plain one, to client/game/assets/posters/hellmoo-letters.webp.
// Drawn over the plain print it gives back the lettered one (panels/room-sheets.js, once the run has joined).
//
// ⚠ NEEDS CHROME. It decodes and encodes WebP in system Chrome, headless, over the DevTools protocol, as
// scripts/lobby/bake.mjs does. Run it again after replacing either picture.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PLAIN = join(ROOT, 'client', 'game', 'assets', 'posters', 'hellmoo.webp');
const LETTERED = join(ROOT, 'scripts', 'posters', 'hellmoo-lettered.webp');
const OUT = join(ROOT, 'client', 'game', 'assets', 'posters', 'hellmoo-letters.webp');
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What runs in the page: the difference, as alpha, kept to the band the lettering is in and off the divider strips
// (their hinges differ a little between the two pictures and aren't lettering).
const PAGE = (plainUrl, letteredUrl) => `(async () => {
  const load = (src) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
  const [P, Lt] = await Promise.all([load(${JSON.stringify(plainUrl)}), load(${JSON.stringify(letteredUrl)})]);
  const W = P.naturalWidth, H = P.naturalHeight;
  if (Lt.naturalWidth !== W || Lt.naturalHeight !== H) throw new Error('the two pictures are different sizes');
  const px = (im) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, W, H).data; };
  const a = px(P), b = px(Lt);
  // the lettering's rows, and the dividers: columns that are a flat grey from top to bottom
  const rowGold = [];
  for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (b[i] > 170 && b[i + 1] > 120 && b[i + 2] < 120 && Math.abs(b[i] - a[i]) > 40) n++; } rowGold.push(n); }
  const rows = rowGold.map((n, y) => n > 30 ? y : -1).filter((y) => y >= 0);
  const y0 = Math.max(0, rows[0] - 18), y1 = Math.min(H, rows[rows.length - 1] + 18);
  const divider = new Uint8Array(W);
  // (grey isn't enough, the whole picture is dark and grey: a strip is also the same grey all the way down, and not black)
  for (let x = 0; x < W; x++) {
    let sat = 0, lum = 0, l2 = 0, n = 0;
    for (let y = 20; y < H - 20; y += 2) { const i = (y * W + x) * 4, L = (a[i] + a[i + 1] + a[i + 2]) / 3; sat += Math.max(a[i], a[i + 1], a[i + 2]) - Math.min(a[i], a[i + 1], a[i + 2]); lum += L; l2 += L * L; n++; }
    const m = lum / n, sd = Math.sqrt(Math.max(0, l2 / n - m * m));
    if (sat / n < 14 && sd < 28 && m > 40) for (let k = -6; k <= 6; k++) if (x + k >= 0 && x + k < W) divider[x + k] = 1;
  }
  const out = new ImageData(W, H), o = out.data;
  const ss = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  let kept = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
    if (divider[x]) continue;
    const i = (y * W + x) * 4, d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    const al = ss(14, 60, d);
    if (al <= 0) continue;
    o[i] = b[i]; o[i + 1] = b[i + 1]; o[i + 2] = b[i + 2]; o[i + 3] = Math.round(al * 255); kept++;
  }
  const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(out, 0, 0);
  return { url: c.toDataURL('image/webp', 0.92), W, H, band: [y0, y1], kept };
})()`;

if (!CHROME) throw new Error('no Chrome found: set CHROME to its path');
const port = 9400 + Math.floor(Math.random() * 400), dir = mkdtempSync(join(tmpdir(), 'posters-bake-'));
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
try {
  let list = null;
  for (let i = 0; i < 100 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
  const page = list?.find((t) => t.type === 'page');
  if (!page) throw new Error('Chrome did not open a page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const dataUrl = (p) => 'data:image/webp;base64,' + readFileSync(p).toString('base64');
  const r = await send('Runtime.evaluate', { expression: PAGE(dataUrl(PLAIN), dataUrl(LETTERED)), awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
  const v = r.result.result.value;
  writeFileSync(OUT, Buffer.from(v.url.split(',')[1], 'base64'));
  console.log(`posters:bake — ${v.W}x${v.H}, lettering in rows ${v.band[0]}..${v.band[1]}, ${v.kept} pixels kept: ${OUT}`);
  ws.close();
} finally {
  proc.kill();
  setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Chrome may still hold it */ } }, 500);
}
