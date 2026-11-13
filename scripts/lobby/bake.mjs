// lobby:bake — a picture of each Stage building's entry room from its street door, for the street to see through it.
//
//   npm run lobby:bake                         every entry room with a dressed street door (flags.room.street_door)
//   npm run lobby:bake -- zone_residential_lobby zone_solenne_lobby
//
// Opens each room in the Modelshop's Room Lab (tools/modelshop/room-lab.html) through its street door, so the Stage
// stands you just inside the door looking in, as the server does when you walk in off the street. It keeps that frame
// as a JPEG and the camera that took it (`vp`, the room renderer's view and projection in the room's own frame) in
// client/game/assets/lobby/. On foot, gl/interiors.js paints the room's walls with it, projected from that camera, so
// the lobby is there in the doorway before its own mesh has been built (lobby-still.js bakedStill).
//
// ⚠ NEEDS CHROME AND THE MODELSHOP. It drives system Chrome headless over the DevTools protocol with SwiftShader, so
// no GPU or Browser pane is needed, against the Modelshop on :5181 (started here if it isn't up). It's a picture of
// content, not a gate: run it again after changing how an entry room looks.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = join(ROOT, 'client', 'game', 'assets', 'lobby');
const PORT = 5181, BASE = `http://127.0.0.1:${PORT}`;
const W = 960, H = 540, HOUR = 13, QUALITY = 0.82;
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the rooms: the ones named, or every room whose street door is dressed
function zonesToBake() {
  const named = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (named.length) return named;
  const dir = join(ROOT, 'content', 'zones');
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .filter((z) => z.flags?.room?.street_door).map((z) => z.id).sort();
}

async function up() { try { return (await fetch(BASE + '/api/room-lab')).ok; } catch { return false; } }
async function modelshop() {
  if (await up()) return null;
  const p = spawn(process.execPath, [join(ROOT, 'tools', 'modelshop', 'serve.mjs')], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { await sleep(250); if (await up()) return p; }
  p.kill();
  throw new Error('the Modelshop did not come up on :' + PORT);
}

async function browser() {
  if (!CHROME) throw new Error('no Chrome found: set CHROME to its path');
  const port = 9400 + Math.floor(Math.random() * 400), dir = mkdtempSync(join(tmpdir(), 'lobby-bake-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 60 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
  const page = list?.find((t) => t.type === 'page');
  if (!page) { proc.kill(); throw new Error('Chrome did not open a page'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const waits = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 120000 });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const close = () => { try { ws.close(); } catch { /* gone */ } proc.kill(); setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* still locked */ } }, 500); };
  return { send, evaluate, close };
}

// in the page: through the street door, a few frames for the room to come, then the picture and its camera
const SHOOT = `(async () => {
  const front = (window.__lab?.spec?.openings || []).find((o) => o.kind === 'front');
  if (!front) return { error: 'no street door' };
  await window.__labOpen(null, front.to);
  const t = window.__lab.stage(), cv = document.querySelector('.rs-canvas');
  // the room's furniture and the rooms past its doorways are built in a worker: wait for them
  for (let i = 0; i < 40 && !(t.S && t.S.mesh); i++) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 2500));
  const { roomMatrices } = await import('/client/game/js/panels/gl/room.js');
  const s = t.seat, cam = { eye: [...s.eye], yaw: s.yaw || 0, pitch: s.pitch || 0, fov: s.fov };
  t.draw(performance.now());
  const vp = Array.from(roomMatrices(cam, cv.width / cv.height, t.S.seeLens || null));
  const url = cv.toDataURL('image/jpeg', ${QUALITY});
  return { url, vp, w: cv.width, h: cv.height };
})()`;

const zones = zonesToBake();
if (!zones.length) { console.log('lobby:bake — no entry room has a dressed street door'); process.exit(0); }
mkdirSync(OUT, { recursive: true });
const indexFile = join(OUT, 'index.json');
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : { rooms: {} };
index.note = 'Written by scripts/lobby/bake.mjs (npm run lobby:bake): each entry room from its street door, and the camera that took it. Read by client/game/js/panels/lobby-still.js.';
const shop = await modelshop();
const b = await browser();
let ok = 0;
try {
  for (const zone of zones) {
    // ⚠ TWICE AT MOST: under SwiftShader a page sometimes sits on its first open past the wait, and a second
    // navigation to it comes up at once
    let ready = false;
    for (let tries = 0; tries < 2 && !ready; tries++) {
      await b.send('Page.navigate', { url: `${BASE}/room-lab.html?zone=${encodeURIComponent(zone)}&hour=${HOUR}&glass=0` });
      for (let i = 0; i < 120 && !ready; i++) { await sleep(250); ready = await b.evaluate('!!(window.__lab && window.__labOpen)').catch(() => false); }
    }
    if (!ready) { console.warn(`  ✗ ${zone}: the Room Lab didn't open it`); continue; }
    const r = await b.evaluate(SHOOT).catch((e) => ({ error: e.message }));
    if (!r || r.error || !r.url) { console.warn(`  ✗ ${zone}: ${r?.error || 'no picture'}`); continue; }
    const file = zone + '.jpg', jpg = Buffer.from(r.url.split(',')[1], 'base64');
    writeFileSync(join(OUT, file), jpg);
    index.rooms[zone] = { file, w: r.w, h: r.h, hour: HOUR, vp: r.vp.map((v) => +v.toFixed(6)) };
    console.log(`  ✓ ${zone}: ${(jpg.length / 1024).toFixed(0)} kB`);
    ok++;
  }
} finally {
  b.close();
  if (shop) shop.kill();
}
index.rooms = Object.fromEntries(Object.entries(index.rooms).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
console.log(`✓ lobby:bake — ${ok} of ${zones.length} room(s) → client/game/assets/lobby/`);
process.exit(ok === zones.length ? 0 : 1);
