// Recompile the two live-fact bulletins — RAPTOR NEWS (news_pools) and DOOMCAST
// (weather_pools) — from their .bsm files into the shipped broadcast rows.
//
// WHY THIS EXISTS. Same reason as build-tonight-show.mjs: the normal authoring path is the
// dev panel's .bsm import, which compiles into the LOCAL DB and relies on content:export to
// dump it back out. The file in git is where the show is written and reviewed, and the row
// that airs drifts from it silently. It HAD drifted: doomcast.bsm has carried sky.acid /
// sky.ion / warn.acid / warn.ion since the hero events shipped, and the row that actually
// aired had none of them — so on an acid day Dex fell through to the generic
// "Conditions right now: …" fallback and never once said the word. That is exactly the
// failure this script exists to make impossible: edit the .bsm, run this, the row matches.
//
// SURGICAL BY DESIGN. It rewrites `news_pools` / `weather_pools` and nothing else — not the
// row identity, not the channel, not the schedule, not `broadcast_graph` (both shows store a
// start-only graph; the bulletin is assembled live every airing from these pools), and not
// the title-card asset, which lives in media_graphics.
//
//   node scripts/content/build-news-weather.mjs
//
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// The compiler is a browser script that drops `compileBsm` into global scope; the repo is
// "type": "module", so it's evaluated here rather than imported.
const compileBsm = new Function(`${rd('client/devpanel/js/bsm-compiler.js')}; return compileBsm;`)();

const SHOWS = [
  { src: 'data/scripts/raptor_news.bsm', row: 'content/media_broadcasts/bc_1783893568943.json', type: 'news',    column: 'news_pools',    script: 'newsScript' },
  { src: 'data/scripts/doomcast.bsm',    row: 'content/media_broadcasts/bc_1783061127685.json', type: 'weather', column: 'weather_pools', script: 'weatherScript' },
];

// Pools the assembler asks for by name. A typo'd key is silently an empty pool at airtime
// (the beat just doesn't happen), so the spelling is checked here instead of on air.
const REQUIRED = {
  news:    ['open', 'anchor.intro', 'story.lead', 'handoff.reporter', 'reporter.scene', 'outro', 'signoff',
            'wx.toss', 'wx.sky.acid', 'wx.sky.ion', 'wx.warn.acid', 'wx.warn.ion', 'wx.back'],
  weather: ['intro', 'today.lead', 'forecast.lead', 'outro',
            'sky.acid', 'sky.ion', 'warn.acid', 'warn.ion'],
};

let failed = false;
for (const show of SHOWS) {
  const compiled = compileBsm(rd(show.src));
  const { meta } = compiled;
  const script = compiled[show.script];

  if (meta.type !== show.type) { console.error(`x ${show.src} is @type ${meta.type}, expected ${show.type}`); failed = true; continue; }
  if (compiled._debug.unknownDirectives.length) { console.error(`x unknown directives in ${show.src}: ${compiled._debug.unknownDirectives.join(', ')}`); failed = true; continue; }
  const pools = script?.pools || {};
  const missing = REQUIRED[show.type].filter(k => !Array.isArray(pools[k]) || !pools[k].length);
  if (missing.length) { console.error(`x ${show.src}: missing/empty pools — ${missing.join(', ')}`); failed = true; continue; }

  const p = path.join(ROOT, show.row);
  const row = JSON.parse(fs.readFileSync(p, 'utf8'));
  const before = JSON.stringify(row[show.column]);
  row[show.column] = script;
  const after = JSON.stringify(row[show.column]);
  fs.writeFileSync(p, `${JSON.stringify(row, null, 2)}\n`, 'utf8');

  const keys = Object.keys(pools).sort();
  const total = keys.reduce((s, k) => s + pools[k].length, 0);
  console.log(`${before === after ? '= unchanged' : '~ updated  '} ${show.row}  (${meta.name})`);
  console.log(`  ${keys.length} pools, ${total} lines`);
}
process.exit(failed ? 1 : 0);
