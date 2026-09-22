// A BUILDING WITH NO POWER — does the renderer know, and does it stop at the building?
//
//   node scripts/shapes/power.mjs            # gate
//   node scripts/shapes/power.mjs --report   # what each model sheds
//
// The power sim has produced scattered per-building blackouts for as long as it has existed: a
// severe storm faults individual junction boxes offline, which is the building-level distribution
// feed rather than the hardened central plant, and an EMP takes the lot. `pw` has been on the wire
// the whole time and the buildings never read it — a tower with its feed down kept its lit window
// grid, its neon, its blades, its blooms and its rooftop ad over a blacked-out street.
//
// ⚠ NOTHING HERE ASSERTS THAT IT LOOKS RIGHT. Every harness in this repo installs a GL hook that
// hands back a bare canvas and never reaches a draw call, so how a dark facade READS is a question
// for the Modelshop and the eye. What this pins is the five things that can be wrong while the
// picture is never drawn at all, each of which is silent in a different way:
//
//   1. THE MAPPING. `pw` is three states, with `em` and `og` answering over one of them. Read any
//      of them wrong and a browning-out block reads as dead, or a dead one as lit, with every
//      downstream reader working perfectly. `og` is the one with a whole region behind it:
//      Deadwater and the Under are dark BY CONSTRUCTION — 4,953 orphan `power_zones` rows between
//      them, no generator anywhere — and every light in those arms is flame, oil or carbide. Lose
//      that exemption and the feature blacks out the Null's powerhouse for a fault it cannot have.
//   2. THE LIGHT. A blackout has to reach ~600 call sites through about a dozen primitives. Miss
//      one and a single kind of light burns on over a dark city, which is the hardest class of
//      rendering bug to find by looking. The first run of this named 526 leaks, and the answer was
//      not another primitive — it was that `pushLight` has a dozen direct callers that reach no
//      primitive at all.
//   3. THE ARTICLE. A dead sign is a PAINTED BOARD, never a deleted one — the streetlight's own
//      rule ("an unlit lamp post is still a thing you can see") pointed at signage. A blackout
//      that deletes the signs makes a whole block pop out of the world.
//      ⚠ DECALS, NEVER STROKES. A decal is a board and the lettering baked onto it; a stroke is a
//      wire, and a LINE OF LIGHT traced up a corner is a wire made entirely of light with no
//      article under it at all. Held against strokes, the five glass-and-chrome Halcyon types read
//      as "the blackout deleted the signage" when what went out is the only thing they wear — and
//      the claim would have been demanding that a dead neon tube stay visible.
//   4. THE DIMMER. A brownout is not a blackout. It pushes the same lights at a lower alpha, which
//      no COUNT can see — so this is the one claim here that has to read the sink's contents.
//      ⚠ AND IT SHEDS A FEW, WHICH IS CORRECT AND NOT A LEAK. `pushLight` refuses anything under
//      alpha 0.002, so a light already down at 0.003 falls under the floor when it is halved. A
//      claim that the count is IDENTICAL fails six models for the renderer working as designed.
//   5. THE ADDITIVE PROMISE. A powered building must be identical to one with no `pw` at all, or
//      every baseline, budget and census in this repo silently moved.
//      ⚠ WARM THE MODEL FIRST. `type:noodle_bar` emits 0 strokes on its first run and 4 on every
//      one after it — a cold shape/kit cache, nothing to do with power — so comparing the first
//      two runs of a model reports the CACHE, which is this repo's own most-repeated measurement
//      lesson. One throwaway run before the pair, and it is 4 against 4.
//
// …and a sixth that no harness can execute at all, so it is read out of the source instead: the
// GLASS 2 threading. The variant goes windshield → install → world → the atlas, the group and the
// upload, and `gl:opts`'s own lesson is that a hop missed one short of the shader is
// indistinguishable from a feature nobody switched on.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWindshield } from './dom-stub.mjs';
import { blank } from '../lib/blank-scanner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPORT = process.argv.includes('--report');
const ws = await loadWindshield();

const problems = [];
const fail = (msg) => problems.push(msg);
let checks = 0;
const check = (cond, msg) => { checks++; if (!cond) fail(msg); };

// ── 1. THE MAPPING ───────────────────────────────────────────────────────────────────────────
//
// One function answers this for both renderers (see the ⚠ on `winModeForCell`), so these rows are
// the whole of what `pw` means anywhere in the client.
const { winModeForCell, glPowerForCell } = ws;
const ON = winModeForCell({ pw: 1 });
const BROWN = winModeForCell({ pw: 2 });
const DARK = winModeForCell({ pw: 0 });
const EMERG = winModeForCell({ pw: 0, em: 1 });

check(winModeForCell(undefined) === ON, 'a cell with no `pw` at all must read as POWERED');
check(winModeForCell({}) === ON, 'a cell with an undefined `pw` must read as POWERED');
check(new Set([ON, BROWN, DARK, EMERG]).size === 4, 'the four grid states must be four distinct codes');
// ⚠ `em` ONLY MEANS ANYTHING ON A DARK TILE. The server only ever sets it there, and a powered
// building with an emergency circuit is just a powered building.
check(winModeForCell({ pw: 1, em: 1 }) === ON, 'an emergency circuit must not change a POWERED building');
check(winModeForCell({ pw: 2, em: 1 }) === BROWN, 'an emergency circuit must not change a BROWNING-OUT building');
// ⚠ AND OFF-GRID OUTRANKS THE REST, because a region that was never wired has no blackout to show.
// This is the claim with 4,953 tiles riding on it.
check(winModeForCell({ pw: 0, og: 1 }) === ON, 'an OFF-GRID tile must draw exactly as it did before this feature existed');
check(winModeForCell({ pw: 0, og: 1, em: 1 }) === ON, 'off-grid must outrank an emergency circuit');
check(glPowerForCell({ pw: 0, og: 1 }) === null, 'an OFF-GRID tile must hand GLASS 2 nothing to do');

check(glPowerForCell({ pw: 1 }) === null, 'a powered building must hand GLASS 2 nothing to do');
check(glPowerForCell(undefined) === null, 'a cell with no `pw` must hand GLASS 2 nothing to do');
// ⚠ A BROWNOUT KEEPS ITS NIGHT BLEND and the dark pair do not. That is the whole difference
// between "some rooms are out" and "the building is out" in the GL trim, and `null` is not 0.
check(glPowerForCell({ pw: 2 })?.nb == null, 'a brownout must keep the frame’s night blend for its trim');
check(glPowerForCell({ pw: 0 })?.nb === 0, 'a dark building must pull its trim to the unlit (day) colours');
check(glPowerForCell({ pw: 0, em: 1 })?.nb === 0, 'an emergency circuit must pull its trim to the unlit colours too');
check(glPowerForCell({ pw: 0 })?.win === DARK, 'the GL variant must be the same code the wall bake takes');

// ── 2b. THE BAKE ─────────────────────────────────────────────────────────────────────────────
//
// A lit window in this city is a TEXTURE, not a light, so a dark building needs its own bake. Two
// things have to be true of that and both are identity questions the canvas stub can answer: a dark
// night wall is a SECOND entry (not a replacement, because a lit and a dark building share a
// street), and the DAY texture is shared (a blackout is invisible at noon, and one entry per
// palette is what keeps the GL atlas inside its device ceiling).
const { wallTexMixed } = ws;
for (const biome of ['citycore', 'uptown', 'marquee', 'freight', 'oldcoldwater']) {
  const lit = wallTexMixed(biome, 1);
  check(wallTexMixed(biome, 1, ON) === lit, `${biome}: the default must be the powered bake, to the object`);
  check(wallTexMixed(biome, 1, DARK) !== lit, `${biome}: a dark night wall must be its own bake`);
  check(wallTexMixed(biome, 1, EMERG) !== lit, `${biome}: an emergency night wall must be its own bake`);
  check(wallTexMixed(biome, 1, EMERG) !== wallTexMixed(biome, 1, DARK), `${biome}: emergency and dark must not share a bake`);
  check(wallTexMixed(biome, 1, BROWN) !== lit, `${biome}: a browning-out night wall must be its own bake`);
  check(wallTexMixed(biome, 0, DARK) === wallTexMixed(biome, 0), `${biome}: the DAY wall must be shared — a blackout is invisible at noon`);
}

// ── 2–5. THE CENSUS ──────────────────────────────────────────────────────────────────────────
//
// ⚠ A REAL CAMERA AND A CLOSE ONE, for glresidue's own two reasons: the decal layer goes through
// `cam.unproj`, which a stub camera has not got, and the derived detail kit is screen-size gated,
// so at the default eight tiles most of what a building wears is never emitted to be counted.
const cam = ws.makeCam(640, 160, 360, { heading: 0, height: 0, eyeH: 0.24, map: null });
const run = (m, cell) => ws.canvasResidue(m, { cam, night: 1, bn: 'THE EXAMPLE', dy: -2, cell, collect: true });
const alphaOf = (r) => (r.sink?.sprites || []).reduce((a, L) => a + (L.a || 0), 0);

let models = 0, threw = 0;
let litSprites = 0, darkSprites = 0, emergSprites = 0, brownSprites = 0, darkStrokes = 0;
let litAlpha = 0, brownAlpha = 0;
let keptArticle = 0, hadArticle = 0;
const rows = [];

for (const { key, m } of ws.shapeModelRegistry()) {
  run(m, { pw: 1 });                  // warm — see claim 5
  const lit = run(m, { pw: 1 });
  if (lit.threw) { threw++; fail(`${key}: threw with the grid up — ${lit.threw}`); continue; }
  const bare = run(m, undefined);
  const offgrid = run(m, { pw: 0, og: 1 });
  const dark = run(m, { pw: 0 });
  const emerg = run(m, { pw: 0, em: 1 });
  const brown = run(m, { pw: 2 });
  for (const [what, r] of [['dark', dark], ['emergency', emerg], ['brownout', brown]]) {
    if (r.threw) { threw++; fail(`${key}: threw with the grid ${what} — ${r.threw}`); }
  }
  if (dark.threw || emerg.threw || brown.threw) continue;
  models++;

  // 5. THE ADDITIVE PROMISE. A cell that says "powered" and no cell at all are the same building.
  const same = lit.sprites === bare.sprites && lit.strokes === bare.strokes
    && lit.decals === bare.decals && lit.faces === bare.faces;
  if (!same) fail(`${key}: a POWERED cell is not the building drawn with no cell at all`);
  // …and the same promise for a region that was never wired. Deadwater's flame, oil and carbide
  // are not on anybody's grid, so its arms must be untouched by all of this.
  const offSame = lit.sprites === offgrid.sprites && lit.strokes === offgrid.strokes
    && lit.decals === offgrid.decals && lit.faces === offgrid.faces;
  if (!offSame) fail(`${key}: an OFF-GRID building is not the building drawn with the grid up — Deadwater burns flame, not mains`);

  // 2. THE LIGHT. Nothing a building emits may survive its own blackout.
  litSprites += lit.sprites; darkSprites += dark.sprites; emergSprites += emerg.sprites;
  if (dark.sprites) fail(`${key}: ${dark.sprites} light(s) still burning on a building with no power`);
  if (emerg.sprites) fail(`${key}: ${emerg.sprites} light(s) burning on an EMERGENCY circuit — the battery pack is over a stairwell door, it does not run the sign`);

  // 3. THE ARTICLE. A blade, a board, a name: the light goes and the thing stays.
  darkStrokes += dark.strokes;
  if (lit.decals > 0) {
    hadArticle++;
    if (dark.decals > 0) keptArticle++;
    else fail(`${key}: the blackout DELETED the building’s lettering rather than unlighting it`);
  }

  // 4. THE DIMMER. The same lights, less of them — which no count can see.
  litAlpha += alphaOf(lit); brownAlpha += alphaOf(brown); brownSprites += brown.sprites;
  if (lit.sprites && !brown.sprites) fail(`${key}: a brownout put every light out — it is a dimmer, not a switch`);

  if (REPORT && (lit.sprites || lit.decals)) {
    rows.push([key, lit.sprites, dark.sprites, lit.decals, dark.decals, alphaOf(lit), alphaOf(brown)]);
  }
}

check(models > 100, `only ${models} models were censused — the registry did not load`);
check(litSprites > 0, 'no model emitted a single light with the grid UP — the census is measuring nothing');
check(darkSprites === 0, `${darkSprites} lights survived a blackout across the registry`);
check(emergSprites === 0, `${emergSprites} lights survived on an emergency circuit`);
check(hadArticle > 0, 'no model drew any lettering at all — the article check is vacuous');
check(keptArticle === hadArticle, `${hadArticle - keptArticle} model(s) lost their lettering entirely in a blackout`);
// ⚠ AND THE IRONWORK SURVIVES. A stroke is a wire, and most of them are structure — a mast, a
// lattice leg, a catwalk rail. Only the ones that are LIGHT go out, so a registry that sheds every
// stroke in a blackout is one where the gate has been put in `pushStroke`, which would take a dark
// building's steelwork away along with its neon.
check(darkStrokes > 0, 'every stroke in the registry went out in a blackout — structural wire is not light');
// A brownout is a dimmer, so the count barely moves: what it sheds is the handful already sitting
// on `pushLight`'s own alpha floor. 85% is far below the measured figure and far above a blackout.
check(brownSprites >= litSprites * 0.85,
  `a brownout shed ${litSprites - brownSprites} of ${litSprites} lights — that is a switch, not a dimmer`);
// ⚠ STRICTLY BETWEEN, NOT MERELY LESS. `brownAlpha === 0` would pass a "dimmer" test and is a
// blackout wearing a brownout's name, which is exactly the state this third code exists to tell
// apart from the other two.
check(brownAlpha > 0 && brownAlpha < litAlpha,
  `a brownout must be dimmer than lit and brighter than dark (lit ${litAlpha.toFixed(1)}, brown ${brownAlpha.toFixed(1)})`);

// ── 6. THE GLASS 2 THREADING ─────────────────────────────────────────────────────────────────
//
// ⚠ READ OUT OF THE SOURCE, BECAUSE NO HARNESS HERE CAN EXECUTE IT. Every one installs a GL hook
// that answers null, so not one of them reaches an atlas build or an upload — and this is a hop
// chain of exactly the shape `gl:opts` exists for. A break in any link leaves a dark building
// sampling the LIT atlas entry with every other part of the feature working.
// ⚠ COMMENTS BLANKED FIRST, WHICH IS THIS REPO'S MOST-REPEATED SCANNER LESSON AND WAS PROVED
// AGAIN HERE. Mutation-tested: commenting out the `glPowerForCell` line in install.js and
// deleting the `grp.nb` line in context.js BOTH left this section green, because the import line
// still matched in the first case and this file's own ⚠ mentions `grp.nb` in the second. A regex
// over raw source is a scanner that reads the prose about a feature as the feature.
const src = (rel) => blank(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const HOPS = [
  ['client/game/js/panels/gl/install.js', /glPowerForCell/g, 2,
    'install.js must import the mapping from windshield.js AND pass it in `deps`'],
  ['client/game/js/panels/gl/world.js', /deps\.glPowerForCell/g, 1,
    'world.js must ask windshield.js what the grid is doing — never decide it locally'],
  ['client/game/js/panels/gl/world.js', /texVariant\(/g, 3,
    'world.js must name the variant when filling `need`, when defining it, and at upload'],
  ['client/game/js/panels/gl/world.js', /it\.c\.pw/g, 1,
    '`windowKey` must carry the grid state, or the vertex buffer is not stale when a feed drops'],
  ['client/game/js/panels/gl/context.js', /grp\.nb/g, 1,
    'uploadGroups must let a group disagree with the frame about the night blend'],
  ['client/game/js/panels/gl/context.js', /rectOf\(f, grp\)/g, 1,
    'uploadGroups must hand the GROUP to rectOf — the face list is shared between tiles'],
];
for (const [rel, re, want, why] of HOPS) {
  const n = (src(rel).match(re) || []).length;
  check(n >= want, `${rel}: ${why} (found ${n}, wanted at least ${want})`);
}
// ⚠ AND THE ATLAS MUST NOT BAKE A ROOF VARIANT. A roof has no windows in it, so a variant there
// doubles every roof entry on a page that has a hard device ceiling — `texVariant`'s own rule.
// Read as CODE rather than as the comment beside it, for the reason two paragraphs up.
check(/charCodeAt\(0\) === 114/.test(src('client/game/js/panels/gl/world.js')),
  'world.js: `texVariant` must keep the roof exemption');
// …and the 2-D painter's own half of the same split: a blacked-out building is run at night 0 so
// its lit trim goes out, and the WALL has to keep the hour anyway or it comes out paler than its
// lit neighbours. No headless harness can reach that line — the census runs with `MASS_OFF`, which
// returns above it — so it is read out of the source like the GL hops.
check(/POWER_NB != null \? POWER_NB :/.test(src('client/game/js/panels/windshield.js')),
  'windshield.js: draw3DBoxAt must take its night blend from POWER_NB when the grid has an opinion');

if (REPORT) {
  rows.sort((a, b) => b[1] - a[1]);
  console.log('\n  model                             lights  dark   letters  dark     lit    brown');
  for (const r of rows.slice(0, 30)) {
    console.log('  ' + String(r[0]).padEnd(32) + String(r[1]).padStart(6) + String(r[2]).padStart(6)
      + String(r[3]).padStart(9) + String(r[4]).padStart(6)
      + r[5].toFixed(1).padStart(8) + r[6].toFixed(1).padStart(9));
  }
  console.log('');
}

if (problems.length) {
  console.error(`\npower: ${problems.length} problem(s)`);
  for (const p of problems.slice(0, 25)) console.error('  ✗ ' + p);
  if (problems.length > 25) console.error(`  …and ${problems.length - 25} more`);
  process.exit(1);
}
console.log(`power — ${checks} claims over ${models} models: a blackout takes ${litSprites} lights to 0, keeps the lettering on ${keptArticle}/${hadArticle} and leaves ${darkStrokes} structural strokes standing; a brownout keeps ${brownSprites}/${litSprites} lights and dims ${litAlpha.toFixed(0)} to ${brownAlpha.toFixed(0)}${threw ? `; ${threw} arm(s) threw` : ''}`);
