// Recompile data/scripts/Tonight_Show.bsm into the shipped broadcast row's `talkshow_pools`.
//
// WHY THIS EXISTS. Same reason as build-cluster-puck.mjs: the normal authoring path is the dev
// panel's .bsm import, which compiles the script into the LOCAL DB and relies on content:export
// to dump it back out. That loop is fine for a human at a browser, but it means the file in git
// — which is where the show is actually written and reviewed — and the row that airs can drift
// apart silently. This regenerates the row FROM the file, so editing the .bsm and running this
// is the whole authoring loop, with no browser and no local DB in it.
//
// SURGICAL BY DESIGN. It rewrites `talkshow_pools` and nothing else. The row's identity, its
// channel, its schedule and — importantly — its `broadcast_graph` are left exactly as they are:
// a talk show's stored graph is deliberately start-only (the episode is assembled live every
// night from these pools), and the title-card asset is a megabyte of base64 that lives in
// media_graphics and is maintained by update-tonight-logo.mjs. Neither is this script's business.
//
//   node scripts/content/build-tonight-show.mjs
//
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SRC = 'data/scripts/Tonight_Show.bsm';
const ROW = 'content/media_broadcasts/bc_1783897506108.json';

// The compiler is a browser script that drops `compileBsm` into global scope; the repo is
// "type": "module", so it's evaluated here rather than imported.
const compileBsm = new Function(`${rd('client/devpanel/js/bsm-compiler.js')}; return compileBsm;`)();
const compiled = compileBsm(rd(SRC));
const { meta, talkshowScript } = compiled;

if (meta.type !== 'talkshow') {
  console.error(`x ${SRC} is not a talk show (@type ${meta.type})`);
  process.exit(1);
}
if (compiled._debug.unknownDirectives.length) {
  console.error(`x unknown directives in ${SRC}: ${compiled._debug.unknownDirectives.join(', ')}`);
  process.exit(1);
}
if (!talkshowScript?.pools || !talkshowScript.guests?.length) {
  console.error(`x ${SRC} compiled without pools or guest personas — refusing to write an empty show`);
  process.exit(1);
}
// The cast is what makes the show ACTED rather than read. A missing id here would air as a
// disembodied name, which is exactly the class of failure this file is being edited to fix.
for (const [k, v] of Object.entries({ host: talkshowScript.host, sidekick: talkshowScript.sidekick, guestNpc: talkshowScript.guestNpc })) {
  if (!v?.startsWith('npc_')) { console.error(`x ${SRC}: @${k} is '${v}' — expected an npc_ id`); process.exit(1); }
  if (!fs.existsSync(path.join(ROOT, `content/npcs/${v}.json`))) { console.error(`x ${SRC}: @${k} '${v}' has no content/npcs row`); process.exit(1); }
}

const p = path.join(ROOT, ROW);
const row = JSON.parse(fs.readFileSync(p, 'utf8'));
const before = JSON.stringify(row.talkshow_pools);
row.talkshow_pools = talkshowScript;
const after = JSON.stringify(row.talkshow_pools);
fs.writeFileSync(p, `${JSON.stringify(row, null, 2)}\n`, 'utf8');

const pools = Object.entries(talkshowScript.pools).sort(([a], [b]) => a.localeCompare(b));
const total = pools.reduce((s, [, v]) => s + v.length, 0);
console.log(`${before === after ? '= unchanged' : '~ updated'}  ${ROW}`);
console.log(`  ${talkshowScript.guests.length} guest personas, ${pools.length} pools, ${total} lines`);
for (const [k, v] of pools) console.log(`    ${k.padEnd(22)} ${v.length}`);
