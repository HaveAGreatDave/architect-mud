// Recompile data/scripts/jackpotprotocol.bsm into the shipped broadcast row.
//
// WHY THIS EXISTS. Same reason as build-open-signal.mjs: the .bsm in git is where the show
// is actually written and reviewed, but the row that airs was compiled once through the dev
// panel and then drifted. Here it drifted twice over.
//
// First, the script was MALFORMED and the compiler said nothing — it opened four SHOT blocks
// and closed none, and `collectBlock` ran to EOF on the first one. The shipped row was the
// result: a 12-node graph for a 600-second show, with the other 59 nodes flattened into a
// single 2,645-character `messages` entry that aired at the player as one unbroken paragraph
// of raw stage directions ("4s CAM 1 Main Stage LANCE: … OVERLAY grand_prize … OVERLAY_END").
// The compiler now bails a prose block at the first directive line rather than swallowing
// the file, and this script refuses to write a row from a script that left one open.
//
// Second, and worse than a rendering bug: the show was `@type scripted`. Same three
// contestants, same questions, same winner, every night, for a fixed 250,000-credit prize
// against a world whose dearest object is worth 9,200. It is now `@type gameshow` on the
// `basin` subject — a live quiz assembled per in-game day from the district registry and
// the orders, playable by anyone standing in the KSAB soundstage.
//
// WHAT A LIVE SHOW STORES. Almost nothing. The episode is assembled at airtime by
// assembleGameshowGraph from `gameshow_pools`, so `broadcast_graph` is a one-node stub by
// design and `messages` is empty — those are the fallback ticker lines for a broadcast with
// no graph, and a live show that needs them is broken. The checks below are therefore about
// the POOLS and the CAST, which are the parts that have to be right in the file.
//
// SURGICAL BY DESIGN. It rewrites `playback_mode`, `gameshow_pools`, `broadcast_graph`,
// `messages` and `override_duration` and nothing else. The row's id, its channel binding and
// its playlist slots are left alone — the schedule lives in media_channel_playlist.
//
//   node scripts/content/build-jackpot-protocol.mjs
//
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SRC = 'data/scripts/jackpotprotocol.bsm';
const ROW = 'content/media_broadcasts/bc_1783114654023.json';

// The compiler is a browser script that drops `compileBsm` into global scope; the repo is
// "type": "module", so it's evaluated here rather than imported.
const compileBsm = new Function(`${rd('client/devpanel/js/bsm-compiler.js')}; return compileBsm;`)();
const compiled = compileBsm(rd(SRC));
const { meta, gameshowScript } = compiled;

const die = (msg) => { console.error(`x ${msg}`); process.exit(1); };

if (compiled._debug.unknownDirectives.length) {
  die(`unknown directives in ${SRC}: ${compiled._debug.unknownDirectives.join(', ')}`);
}
// The exact shape of the bug this script exists to prevent. An unterminated prose block no
// longer eats the rest of the file, but it still means the author left a block open — and a
// recovered block is not the same as an authored one. Fail loudly rather than ship the guess.
if (compiled._debug.unterminatedBlocks.length) {
  die(`unterminated blocks in ${SRC}: ${compiled._debug.unterminatedBlocks.join(', ')}`);
}
if (meta.type !== 'gameshow') die(`${SRC} is not a game show (@type ${meta.type})`);
if (!gameshowScript) die(`${SRC} produced no gameshow script`);

// The beats a show cannot air without. A missing pool isn't a crash — `draw` returns an empty
// array and the beat is silently skipped — which is precisely why it needs checking here.
for (const need of ['open', 'announce_host', 'audience_call', 'prompt', 'stall', 'reveal', 'verdict_read', 'signoff']) {
  if (!gameshowScript.pools?.[need]?.length) {
    die(`${SRC} has no ::lines ${need} — that beat would air as silence`);
  }
}
// Presence-gated: assembleGameshowGraph sets _requireHost, so a show with no cast on the
// studio floor goes to tech-difficulties rather than airing.
if (!gameshowScript.host || !gameshowScript.sidekick) {
  die(`${SRC} needs @host and @sidekick — a game show is presence-gated on its cast`);
}
if (!gameshowScript.contestants?.length) {
  die(`${SRC} has no ::contestants — a night nobody attends would have nobody playing at all`);
}
// The subject is what makes this show a different programme from The Last Lot rather than a
// re-skin of it. A typo here would silently fall back to retail, which is exactly the outcome
// the rewrite existed to avoid — so it's checked rather than trusted.
if (gameshowScript.subject !== 'basin') {
  die(`${SRC} has @subject "${gameshowScript.subject}" — expected basin`);
}

const p = path.join(ROOT, ROW);
const row = JSON.parse(fs.readFileSync(p, 'utf8'));
const before = canonicalJson(row);

row.playback_mode  = 'gameshow';
row.gameshow_pools = gameshowScript;
// The stub. A live show's chain is built at airtime; anything stored here would be a stale
// copy of one particular night.
row.broadcast_graph = { _start: 'gs_stub', nodes: { gs_stub: { type: 'start', _vine: { x: 80, y: 80 } } } };
row.messages = [];
if (meta.length)   row.override_duration = meta.length;
if (meta.name)     row.name = meta.name;
if (meta.category) row.category = meta.category;

// Written through the same canonicaliser content:export uses, so a later export is a no-op
// against this file rather than a whole-file reorder diff.
const after = canonicalJson(row);
fs.writeFileSync(p, after, 'utf8');

const poolKeys = Object.keys(gameshowScript.pools || {});
const lineCount = poolKeys.reduce((n, k) => n + gameshowScript.pools[k].length, 0);
console.log(`${before === after ? '= unchanged' : '~ updated'}  ${ROW}`);
console.log(`  @type ${meta.type} · @subject ${gameshowScript.subject} · ${meta.length}s · ${gameshowScript.rounds || 4} rounds`);
console.log(`  ${poolKeys.length} pools, ${lineCount} lines, ${gameshowScript.contestants.length} contestants`);
console.log(`  cast: ${gameshowScript.host} + ${gameshowScript.sidekick}`);
