// DEADBALL SHOTS: screenshots of the 3-D park at a play's moments, with nobody at the keyboard.
//
//   node tools/sandbox/deadball-shots.mjs --slot 1 --play bases
//   node tools/sandbox/deadball-shots.mjs --slot 3 --play inplay --kinds homerun --max 2
//   node tools/sandbox/deadball-shots.mjs --slot 2 --play bases --kinds third --out shots
//
// It serves the repo the way the sandbox page wants it (deadball-park-test.html), opens the page
// in headless Chromium with the park's clock stopped (?speed=0), and for each payload it shows,
// steps the world by hand (view.world.step) to the play's moments and screenshots the TV window.
// The gates prove the staging agrees with the sim and runs; this is for looking at it. On this
// branch it found a runner standing up off his bag, a batter left in the box ten seconds after
// the third out, and a fielder stepping off the bag past the man he'd just tagged, none of which
// any gate saw.
//
// The moments come from the director's own log, so they land on the play:
//   - an at-bat: each pitch shown a beat after its release and at its catch or contact, then every
//     --every seconds (1.5) of a ball in play;
//   - a play on the bases: coming set, the jump, the mitt, the catcher's throw, the tag, the call,
//     the ball by the catcher and picked up;
//   - a changeover: every --every seconds of it;
//   - for all of them the landing, 1.5 s after it, and the side going off after a third out;
//   - and a play that earns a replay (diamond/replay.js): its first frame, its moment and its last,
//     the replay's own world stepped by hand.
// --at 0.5,2,5 takes seconds after the payload's start instead.
//
// The graphics' cards and splashes come and go on the wall clock, not the park's, and a frame
// here takes seconds, so one can be gone by the next shot; the gate's view checks hold them.
//
// Options:
//   --slot N      the game (the sandbox's ?slot=), 1 by default
//   --sim 1|2     the sim, 2 by default (steals, errors and the rest)
//   --play F      the sandbox's filter: runs, hits, dp, walk, k, bases, errors, half, inplay
//   --kinds a,b   only these kinds of play; `third` for any third out
//   --i N         just the Nth payload of the filter
//   --max N       at most N payloads, 3 by default
//   --every S     seconds between frames of a ball in play or a changeover
//   --out DIR     where the PNGs go, <os tmpdir>/deadball-shots by default
//   --city 0      leave the city out (faster); --hud 0 hides the graphics; --shot NAME holds a camera
//   --w PX        the frame's width in CSS pixels
//   --hold MS     how long each payload holds (the sandbox's ?hold=, 35000 by default): a longer
//                 one leaves more dead time after the play (diamond/between.js)
//   --hour H      the in-game hour the first payload airs at (the sandbox's ?hour=), each after
//                 it a hold later: the sky follows it (diamond/sky.js)
//   --wx WORD     the weather over the park (?wx=: rain, snow, thunderstorm, fog...), with --rate
//                 how hard it falls and --event a city-wide event (ion_storm, acid_rain)
//
// Needs Playwright and its Chromium: `npm i --no-save playwright` and `npx playwright install
// chromium` in the repo, or a global install on NODE_PATH, or PLAYWRIGHT_DIR set to a
// node_modules that has it. WebGL2 runs on SwiftShader, so it's slow (a frame takes a few
// seconds) but needs no GPU. Local only: the server listens on 127.0.0.1 and a free port.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && i + 1 < args.length ? args[i + 1] : def; };
const slot = Number(opt('slot', 1)), sim = opt('sim', '2'), play = opt('play', ''), only = opt('i', null);
const kinds = opt('kinds', '') ? new Set(opt('kinds').split(',')) : null;
const max = Number(opt('max', 3)), every = Number(opt('every', 1.5)), at = opt('at', null);
const out = opt('out', join(tmpdir(), 'deadball-shots'));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bsm': 'text/plain', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
// /sandbox/ is tools/sandbox and /shared/ is client/shared, as the game serves them; the rest is
// the repo root, which the page reaches with ../ paths
function fileFor(url) {
  const path = decodeURIComponent(new URL(url, 'http://x').pathname);
  const rel = path.startsWith('/sandbox/') ? join('tools', path) : path.startsWith('/shared/') ? join('client', path) : path;
  const file = normalize(join(REPO, rel));
  return file.startsWith(normalize(REPO) + sep) ? file : null;
}

async function chromiumOf() {
  try { return (await import('playwright')).chromium; } catch { /* not installed beside the repo */ }
  const tries = [createRequire(import.meta.url)];
  if (process.env.PLAYWRIGHT_DIR) tries.push(createRequire(join(process.env.PLAYWRIGHT_DIR, 'noop.js')));
  for (const req of tries) { try { return req('playwright').chromium; } catch { /* next */ } }
  throw new Error('Playwright not found: `npm i --no-save playwright && npx playwright install chromium`, or set PLAYWRIGHT_DIR to a node_modules that has it');
}

const server = createServer(async (req, res) => {
  const file = fileFor(req.url);
  try {
    if (!file) throw new Error('outside the repo');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
await mkdir(out, { recursive: true });

const chromium = await chromiumOf();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });

const q = new URLSearchParams({ park: '3d', speed: '0', sim, slot: String(slot), i: only ?? '0' });
if (play) q.set('play', play);
for (const k of ['city', 'hud', 'shot', 'w', 'hold', 'hour', 'wx', 'rate', 'event']) if (opt(k, null) != null) q.set(k, opt(k));
await page.goto(`http://127.0.0.1:${port}/sandbox/deadball-park-test.html?${q}`);

// staged, and every body built (a frame doesn't step the world while one is building)
async function ready() {
  for (let k = 0; k < 300; k++) {
    const ok = await page.evaluate(() => !!window.__view?.director?.payload && window.__view.renderer?.pending?.() === 0);
    if (ok) return;
    await page.evaluate(() => window.__view?.redraw?.());
    await page.waitForTimeout(1000);
  }
  throw new Error('the park never finished building');
}
await ready();
const count = await page.evaluate(() => document.getElementById('count').textContent);
const n = only != null ? 1 : Number(count.split('/')[1]?.split(' ')[0]) || 0;
console.log(`slot ${slot}${play ? ` (${play})` : ''}: ${n} payloads; shots to ${out}`);

let shot = 0;
for (let i = 0; i < n && shot < max; i++) {
  if (i > 0) { await page.evaluate(() => document.getElementById('next').click()); await ready(); }
  const info = await page.evaluate(([every, at]) => {
    const v = window.__view, D = v.director, W = v.world, p = D.payload, L = D.play?.log || {};
    const m = [], add = (name, t) => { if (Number.isFinite(t)) m.push([name, t]); }, t0 = W.t;
    const third = (p.outs | 0) >= 3 && p.phase !== 'half';
    if (at) at.split(',').map(Number).forEach((s) => add(`t+${s}`, t0 + s));
    else {
      if (p.phase === 'half') for (let t = t0 + 0.5; t < D.until; t += every) add(`t+${(t - t0).toFixed(1)}`, t);
      else if (p.phase === 'run') {
        const r = D.log[0] || {}, first = r.tFirst ?? r.tMove;
        add('set', first - 0.4); add('go', first + 0.35);
        if (!L.ball) add('mitt', r.catch?.t + 0.05);
        add('throw', L.throw?.release?.t + 0.05); add('tag', L.tag?.t); add('call', L.call?.t + 0.3);
        add('by', L.ball?.past + 0.25); add('pick', L.ball?.pick);
      } else {
        D.log.forEach((r, k) => { if (r.shown) { add(`pitch${k + 1}`, r.release + 0.15); add(`ball${k + 1}`, r.contact?.t ?? r.catch?.t); } });
        const c = D.log.find((r) => r.contact)?.contact?.t;
        if (Number.isFinite(c)) for (let t = c + 0.5; t < D.landAt; t += every) add(`play+${(t - c).toFixed(1)}`, t);
      }
      if (p.phase !== 'half') { add('land', D.landAt - 0.05); add('after', D.landAt + 1.5); }
      if (third) { add('off', D.landAt + 3); add('off2', D.landAt + 6); }
    }
    return { kind: p.phase === 'half' ? 'half' : p.kind, third, where: `${p.inningOrd || p.inning} ${p.half}`, moments: m.sort((a, b) => a[1] - b[1]).map(([name, t]) => [name, t, t - t0]) };
  }, [every, at]);
  if (kinds && !kinds.has(info.kind) && !(kinds.has('third') && info.third)) continue;
  shot++;
  console.log(`#${only ?? i} ${info.kind} (${info.where})`);
  let k = 0;
  for (const [name, t, rel] of info.moments) {
    await page.evaluate(async (target) => {
      const v = window.__view, W = v.world;
      while (W.t < target - 1e-9) W.step(1 / 120);
      v.redraw();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, t);
    await page.waitForTimeout(300);
    const file = join(out, `s${slot}-${String(only ?? i).padStart(2, '0')}-${info.kind}-${String(k++).padStart(2, '0')}-${name}.png`);
    await page.locator('#tv-window').screenshot({ path: file, timeout: 180000 });
    const cam = await page.evaluate(() => { const s = window.__view.shot; return typeof s === 'string' ? s : s?.shot; });
    console.log(`  ${name.padEnd(9)} +${rel.toFixed(2)} s  ${cam}  ${file}`);
  }
  // the replay, if the play earned one: the live world on to when it starts, then its own world
  const rp = at ? null : await page.evaluate(async () => {
    const v = window.__view, W = v.world, due = v.replayDue;
    if (!due) return null;
    while (W.t < due.at) W.step(1 / 120);
    v.redraw();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = v.replay;
    return r ? { kind: r.kind, from: r.from, key: r.key, to: r.to, still: r.still } : null;
  });
  if (rp) {
    console.log(`  a replay: ${rp.kind}${rp.still ? ' (still)' : ''}`);
    for (const [name, t] of rp.still ? [['replay', rp.key]] : [['replay', rp.from], ['replay-key', rp.key], ['replay-end', rp.to - 0.05]]) {
      await page.evaluate(async (target) => {
        const v = window.__view, RW = v.replay?.W;
        if (RW) while (RW.t < target - 1e-9) RW.step(1 / 120);
        v.redraw();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, t);
      await page.waitForTimeout(300);
      const file = join(out, `s${slot}-${String(only ?? i).padStart(2, '0')}-${info.kind}-${String(k++).padStart(2, '0')}-${name}.png`);
      await page.locator('#tv-window').screenshot({ path: file, timeout: 180000 });
      const cam = await page.evaluate(() => { const s = window.__view.shot; return typeof s === 'string' ? s : s?.shot; });
      console.log(`  ${name.padEnd(10)} ${cam}  ${file}`);
    }
  }
}
if (errors.length) console.log(`page errors:\n  ${errors.slice(0, 10).join('\n  ')}`);
await browser.close();
server.close();
process.exit(errors.some((e) => !/^\d{3} /.test(e)) ? 1 : 0);
