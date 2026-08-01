// Recompile data/scripts/the_open_signal.bsm into the shipped broadcast row's graph + film meta.
//
// WHY THIS EXISTS. Same reason as build-tonight-show.mjs and build-cluster-puck.mjs: the normal
// authoring path is the dev panel's .bsm import, which compiles the script into the LOCAL DB and
// relies on content:export to dump it back out. That loop is fine for a human at a browser, but
// the file in git — where the picture is actually written and reviewed — and the row that airs
// can drift apart silently. And they did: 3ea19db06 rescheduled the film from 21:00 to 18:00 by
// hand and flattened `broadcast_graph` and `film_meta` to `{}` on the way past. `{}` is truthy,
// so the runtime happily took the film branch, walked a graph with no `_start` and no nodes,
// emitted nothing, and fired off_air — the channel showed static every Saturday night. A film is
// a plain linear chain; there is no reason for it ever to be hand-edited.
//
// SURGICAL BY DESIGN. It rewrites `broadcast_graph`, `film_meta` and `override_duration` from the
// script and nothing else. The row's id, its channel binding and its playlist slots are left alone
// — the schedule lives in media_channel_playlist, and `ensureFilmSlots` is what pins it from
// `film_meta.airSlots`. `messages` stays empty exactly as the dev-panel import leaves it: those are
// the fallback ticker lines for a broadcast with no graph, and a film that needs them is broken.
//
//   node scripts/content/build-open-signal.mjs
//
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SRC = 'data/scripts/the_open_signal.bsm';
const ROW = 'content/media_broadcasts/bc_the_open_signal.json';

// The compiler is a browser script that drops `compileBsm` into global scope; the repo is
// "type": "module", so it's evaluated here rather than imported.
const compileBsm = new Function(`${rd('client/devpanel/js/bsm-compiler.js')}; return compileBsm;`)();
const compiled = compileBsm(rd(SRC));
const { meta, broadcastGraph, filmScript } = compiled;

if (meta.type !== 'film') {
  console.error(`x ${SRC} is not a film (@type ${meta.type})`);
  process.exit(1);
}
if (compiled._debug.unknownDirectives.length) {
  console.error(`x unknown directives in ${SRC}: ${compiled._debug.unknownDirectives.join(', ')}`);
  process.exit(1);
}
// The exact shape of the bug this script exists to prevent. A film that compiled to no chain is
// not a film, and shipping it as `{}` is indistinguishable at runtime from a dead channel.
const nodeCount = Object.keys(broadcastGraph?.nodes || {}).length;
if (!broadcastGraph?._start || !nodeCount) {
  console.error(`x ${SRC} compiled to an empty chain (_start=${broadcastGraph?._start}, ${nodeCount} nodes) — refusing to write static`);
  process.exit(1);
}
if (!filmScript?.runtime) {
  console.error(`x ${SRC} has no @length — the screening can't be blocked out without a runtime`);
  process.exit(1);
}
if (!filmScript.airSlots?.length) {
  console.error(`x ${SRC} has no @airtime — a feature needs a fixed hour, not an all-day slot`);
  process.exit(1);
}

const p = path.join(ROOT, ROW);
const row = JSON.parse(fs.readFileSync(p, 'utf8'));
const before = canonicalJson(row);

row.broadcast_graph   = broadcastGraph;
row.film_meta         = filmScript;
row.override_duration = filmScript.runtime;
if (meta.name) row.name = meta.name;
if (meta.category) row.category = meta.category;

// Written through the same canonicaliser content:export uses, so a later export is a no-op
// against this file rather than a whole-file reorder diff.
const after = canonicalJson(row);
fs.writeFileSync(p, after, 'utf8');

console.log(`${before === after ? '= unchanged' : '~ updated'}  ${ROW}`);
console.log(`  ${nodeCount} nodes, runtime ${filmScript.runtime}s, airSlots [${filmScript.airSlots}], airDays [${filmScript.airDays || ''}]`);
console.log(`  ${filmScript.cast?.length || 0} cast entries`);
