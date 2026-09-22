// Does the starling have a year, and is it still off?
//
// A murmuration used to be unconditional: `SPECIES.songbird` rolled 450-1700 birds off the anchor
// tile and `murmur()` ran whenever such a flock was airborne, so every starling flock in the world
// was a murmuration, all year, all day. `BIRD_TUNE.season` gives it the real bird's two cycles —
// the winter roost and the pre-roost gathering at dusk — and every way that can go wrong is either
// silent or takes months of game time to show.
//
// ⚠ THE FLAG IS OFF, AND THAT IS THE CLAIM MOST WORTH GATING. While it is 0 this whole feature has
// to be arithmetically absent: the same flock size, for every species, at every hour of every day.
// A partial revert is the one failure nobody would catch by looking, because what it looks like is
// the renderer that shipped.
//
// ⚠ AND THE OTHER CLAIMS ARE ALL MEASURED WITH IT ON. A gate that only ever tests the off state is
// testing that a feature is absent, which it can do perfectly while the feature is broken.
//
// ⚠ NO HARNESS HERE CAN SEE THE PICTURE — a murmuration is a GL sprite layer and every gate in this
// repo installs a hook that returns null — so what this checks is the arithmetic and the hand-offs,
// which is the half that is silent when wrong. The picture is `__glFauna`-shaped work in the
// Modelshop and the eye, and the flag is what makes that A/B possible at all.

import fs from 'node:fs';
import path from 'node:path';
import {
  SPECIES, BIRD_TUNE, flockSize, flockState, seasonFactor, roostFactor, doyOf,
  PARTY_FLOOR, PARTY_SPREAD,
} from '../../client/shared/birds.js';

const problems = [];
const notes = [];
const REPORT = process.argv.includes('--report') || !!process.env.REPORT;
const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// A spread of anchors rather than one tile: the roll is a hash of the anchor, so a single tile
// measures one point of a 450-1700 band and would pass or fail by luck.
const ANCHORS = [];
for (let i = 0; i < 400; i++) ANCHORS.push({ ax: 900 + (i % 20), ay: 900 + Math.floor(i / 20), sp: 'songbird' });
const A_OTHER = (sp) => ANCHORS.map((f) => ({ ax: f.ax, ay: f.ay, sp }));

const MIDWINTER = doyOf('2026-01-08'), MIDSUMMER = doyOf('2026-07-08');
const SB = SPECIES.songbird;
const DUSK = (SB.dayEnd ?? 21) - SB.roost.lead;
const NOON = 13;

const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sizes = (anchors, opts) => anchors.map((f) => flockSize(f, opts));

// ── 1. doyOf ──────────────────────────────────────────────────────────────────
// A day-of-year that is quietly wrong by a constant puts the whole year out of phase, and every
// other check here would still pass — the swing would be the right size in the wrong months.
{
  const cases = [['2026-01-01', 1], ['2026-02-01', 32], ['2026-12-31', 365], ['2024-12-31', 366]];
  for (const [d, want] of cases) {
    const got = doyOf(d);
    if (got !== want) problems.push(`doyOf('${d}') is ${got}, not ${want} — the year is out of phase, which reads as the right seasonal swing happening in the wrong months`);
  }
  if (doyOf(null) !== null || doyOf('') !== null || doyOf('nonsense') !== null) {
    problems.push('doyOf answers a number for a missing or malformed date — a client that has not had the clock yet would be given a season rather than none');
  }
}

// ── 2. OFF IS THE MODULE AS IT SHIPPED, TO THE BIT ───────────────────────────
{
  BIRD_TUNE.season = 0;
  let bad = 0, worst = null;
  for (const id of Object.keys(SPECIES)) {
    for (const f of A_OTHER(id)) {
      const base = flockSize(f);
      for (const hour of [0, 5, 13, DUSK, 20.9, 23.5]) {
        for (const doy of [1, 60, MIDWINTER, MIDSUMMER, 200, 300, 365]) {
          const got = flockSize(f, { hour, doy });
          if (got !== base) { bad++; if (!worst) worst = `${id} at hour ${hour} doy ${doy}: ${got} against ${base}`; }
        }
      }
    }
  }
  if (bad) problems.push(`with BIRD_TUNE.season = 0, ${bad} flock sizes differ from the unseasoned roll (${worst}) — the off switch does not switch off, which is what every later A/B is measured against`);
  else notes.push(`off: ${Object.keys(SPECIES).length} species × 400 anchors × 6 hours × 7 days all identical to the old roll`);
}

// ⚠ THE UNSEASONED ANSWER HAS TO BE TAKEN WHILE THE FLAG IS STILL OFF, and taking it any other way
// is how check 3 first tested itself: it compared `flockSize(f)` with `flockSize(f, null)`, which
// are two no-opts calls, so a `seasonalSize` that quietly defaulted a missing `opts` to midwinter
// dusk gave the same wrong answer to both and the check passed.
const BASE = new Map();
for (const id of Object.keys(SPECIES)) for (const f of A_OTHER(id)) BASE.set(id + ':' + f.ax + ',' + f.ay, flockSize(f));

// Everything below is the feature ON.
BIRD_TUNE.season = 1;

// ── 3. A CALLER THAT PASSES NO OPTS IS UNSEASONED, EVEN WITH THE FLAG ON ─────
// Every harness in scripts/ and every bench in glbench.js calls flockState(f, now) with no opts,
// and so does the bird-strike path. If a missing season resolved to anything other than the roll,
// turning this feature on would silently move every one of those gates.
{
  let bad = 0, worst = null;
  for (const id of Object.keys(SPECIES)) {
    for (const f of A_OTHER(id)) {
      const base = BASE.get(id + ':' + f.ax + ',' + f.ay);
      for (const got of [flockSize(f), flockSize(f, null), flockState(f, 0).n, flockState(f, 0, null, null).n]) {
        if (got !== base) { bad++; if (!worst) worst = `${id} ${f.ax},${f.ay}: ${got} against ${base}`; }
      }
    }
  }
  if (bad) problems.push(`${bad} callers that pass no season get a different size with the flag on (${worst}) — every gate in scripts/ and every bench in glbench.js is such a caller, so turning this on would move all of them at once`);
  else notes.push('no-opts callers are unseasoned with the flag on: gates and benches measure the unseasoned peak, which is the worst case');
}

// ── 4. ONE SPECIES HAS A YEAR ────────────────────────────────────────────────
// The starling is the only bird here whose flock size swings by orders of magnitude between its
// breeding season and its winter roost. Giving the resident five a season would be authoring a
// phenomenon they do not have — and it would move the goose, which the bird-strike path reads.
{
  for (const id of Object.keys(SPECIES)) {
    const sp = SPECIES[id];
    const has = !!(sp.season || sp.roost);
    if (id === 'songbird' && !has) problems.push('the songbird has no season or roost row — the feature has nothing to act on');
    if (id !== 'songbird' && has) problems.push(`${id} has a season/roost row: the resident species go about in the same small parties all year, and the goose's size is read by the bird-strike radius in plugins/flight/hazards.js`);
    if (id === 'songbird') continue;
    let bad = 0;
    for (const f of A_OTHER(id)) {
      const base = flockSize(f);
      for (const doy of [MIDWINTER, MIDSUMMER]) for (const hour of [NOON, DUSK]) {
        if (flockSize(f, { hour, doy }) !== base) bad++;
      }
    }
    if (bad) problems.push(`${id} changes size with the season (${bad} cases) though it has no season row`);
  }
}

// ── 5. THE SWING IS REAL, AND IT IS THE RIGHT WAY ROUND ──────────────────────
// ⚠ DIRECTION AS WELL AS MAGNITUDE. A phase error puts the peak in the breeding season, which is a
// perfectly good-looking seasonal cycle running exactly backwards — big clouds in June and pairs at
// Christmas — and every magnitude check in this file would pass.
{
  const wDusk = med(sizes(ANCHORS, { hour: DUSK, doy: MIDWINTER }));
  const sDusk = med(sizes(ANCHORS, { hour: DUSK, doy: MIDSUMMER }));
  const wNoon = med(sizes(ANCHORS, { hour: NOON, doy: MIDWINTER }));
  if (!(wDusk >= sDusk * 4)) problems.push(`a midwinter dusk flock (${wDusk}) is not meaningfully bigger than a midsummer one (${sDusk}) — the season is present but does not bite, so the murmuration is still a year-round event`);
  if (!(wDusk >= wNoon * 4)) problems.push(`a midwinter dusk flock (${wDusk}) is not meaningfully bigger than a midwinter afternoon one (${wNoon}) — the murmuration is a pre-roost display, and without this it happens all day`);
  else notes.push(`midwinter dusk ${wDusk} · midwinter noon ${wNoon} · midsummer dusk ${sDusk}`);

  // The peak must be nearer the turn of the year than the breeding season, checked by sweeping the
  // whole year rather than by reading the authored number back.
  let peakDoy = 1, peak = -1;
  for (let d = 1; d <= 365; d++) { const s = seasonFactor(SB, d); if (s > peak) { peak = s; peakDoy = d; } }
  const winter = peakDoy <= 46 || peakDoy >= 305;                 // mid-Nov to mid-Feb
  if (!winter) problems.push(`the season peaks on day ${peakDoy}, which is not the winter roost — a phase error reads as a convincing seasonal cycle running exactly backwards`);
  let troughDoy = 1, trough = 2;
  for (let d = 1; d <= 365; d++) { const s = seasonFactor(SB, d); if (s < trough) { trough = s; troughDoy = d; } }
  const breeding = troughDoy >= 91 && troughDoy <= 227;           // April to mid-August
  if (!breeding) problems.push(`the lean season bottoms out on day ${troughDoy}, which is not the breeding season`);
  else notes.push(`peak day ${peakDoy} (${peak.toFixed(3)}) · trough day ${troughDoy} (${trough.toFixed(3)})`);
}

// ── 6. THE ROOST PEAK RIDES dayEnd ───────────────────────────────────────────
// ⚠ AN AUTHORED PEAK HOUR WOULD BE A SECOND COPY OF DUSK. `birdDaylight` stops drawing this species
// at `dayEnd`, so a gathering pinned to a literal drifts out of the window the moment the day moves
// — a flock that assembles an hour after it has stopped being drawn, which reads as the feature
// doing nothing at all.
{
  let best = 0, bestH = 0;
  for (let h = 0; h < 24; h += 0.05) { const r = roostFactor(SB, h); if (r > best) { best = r; bestH = h; } }
  if (Math.abs(bestH - DUSK) > 0.1) problems.push(`the roost gathering peaks at ${bestH.toFixed(2)} rather than at dayEnd - lead (${DUSK.toFixed(2)}) — it is pinned to a literal rather than derived, so it will drift out of the day window`);
  if (!(bestH < (SB.dayEnd ?? 21))) problems.push(`the gathering peaks at ${bestH.toFixed(2)}, at or after dayEnd (${SB.dayEnd}) — birdDaylight has already stopped drawing the flock by then`);
  else notes.push(`gathering peaks ${bestH.toFixed(2)}, inside the day window ${SB.dayStart}-${SB.dayEnd}`);
  // And it must actually be a window rather than the whole day.
  if (!(roostFactor(SB, NOON) < 0.25)) problems.push(`the gathering is ${roostFactor(SB, NOON).toFixed(2)} at midday — a murmuration that runs all afternoon is not a pre-roost display`);
}

// ── 7. NEVER ZERO, NEVER ONE NUMBER, NEVER OVER THE ROLL ─────────────────────
{
  let min = Infinity, over = 0;
  for (let d = 1; d <= 365; d += 1) {
    for (const hour of [0, 4, 9, NOON, 17, DUSK, 20.9, 23]) {
      for (const f of ANCHORS) {
        const n = flockSize(f, { hour, doy: d });
        if (n < min) min = n;
        // ⚠ THE DECLARED CEILING, which plugins/flight/hazards.js derives its strike radius from.
        // A curve that could multiply UP would let a flock outgrow the thing that flies into it.
        if (n > SB.maxFlock) over++;
      }
    }
  }
  if (!(min >= 1)) problems.push(`a flock is reduced to ${min} birds — a party of one is a bird, and the skein, the mill and the spacing are all arithmetic about a bird's place among others`);
  if (min < PARTY_FLOOR) problems.push(`a flock falls to ${min}, below PARTY_FLOOR (${PARTY_FLOOR}) — the feature is meant to thin the starlings out of the summer, never to delete them`);
  else notes.push(`smallest party anywhere in the year: ${min} birds (floor ${PARTY_FLOOR})`);
  if (over) problems.push(`${over} flocks exceed the declared maxFlock (${SB.maxFlock}) — the bird-strike radius in plugins/flight/hazards.js is derived from that number, so a flock can now outgrow the thing that flies into it`);

  // ⚠ A FLOOR THAT IS ONE NUMBER MAKES EVERY SUMMER FLOCK IN THE WORLD IDENTICAL, which reads as a
  // bug rather than as a lean season — and it is invisible to every other check here, because the
  // magnitude, the direction and the floor are all correct while it happens.
  const summer = new Set(sizes(ANCHORS, { hour: NOON, doy: MIDSUMMER }));
  if (summer.size < 3) problems.push(`every summer afternoon party is one of ${summer.size} size(s) (${[...summer].join(', ')}) — a field of identical flocks reads as a clamp rather than as a quiet season; PARTY_SPREAD (${PARTY_SPREAD}) is what carries the anchor's own variation through the floor`);
  else notes.push(`summer afternoon parties span ${Math.min(...summer)}-${Math.max(...summer)} across ${summer.size} sizes`);
}

// ── 8. BOTH SURFACES ARE HANDED THE SAME PAIR ────────────────────────────────
// ⚠ THIS IS THE CLASS THE WHOLE MODULE EXISTS TO PREVENT, and it cannot be caught by arithmetic:
// pass the season to one surface and not the other and the room description says a cloud of
// hundreds is going up over a park the windscreen has drawn with a party of nine on it. Located in
// the source rather than counted, because both files hold several calls and a count survives one of
// them being deleted.
{
  const ws = read('client/game/js/panels/windshield.js');
  const de = read('server/engine/commands/describe.js');

  if (!/const st = flockState\(fl, now, null, birdWhen\(v\)\)/.test(ws)) {
    problems.push('the murmuration AUDIO bed in windshield.js reads a flock size with no season — the bed would go on asserting there are hundreds of starlings over a summer park');
  }
  if (!/const st = flockState\(fl, now, clear, birdWhen\(v\)\)/.test(ws)) {
    problems.push('the fauna DRAW pass in windshield.js reads a flock size with no season — the picture would keep the year-round murmuration while the room description dropped to a party');
  }
  if (!/flockState\(flock, Date\.now\(\), null, \{ hour: getGameHour\(\), doy: doyOf\(getGameDate\(\)\) \}\)/.test(de)) {
    problems.push('describe.js reads a flock size with no season — the room and the window would disagree about how many birds are over the same tile');
  }
  // The renderer's own two inputs: the injected calendar and the bench pin beside `hourForce`.
  if (!/export function setBirdSeason\(/.test(ws)) problems.push('windshield.js exports no setBirdSeason — nothing can tell the renderer what month it is, so BIRD_DOY stays null and the season never reaches the picture');
  if (!/doyForce: null/.test(ws)) problems.push('RENDER_TUNE has no doyForce — the season cannot be pinned, so a report that says "in January" is one nobody can stand in front of until January');
  if (!/RENDER_TUNE\.doyForce \?\? BIRD_DOY/.test(ws)) problems.push('doyForce is declared but not read — the pin exists, the slider moves, and nothing happens, which is indistinguishable from the feature being absent');

  // And the client has to stop throwing the date away.
  const env = read('client/game/js/panels/environment.js');
  if (!/envDoy = doyOf\(env\.date\)/.test(env)) problems.push('environment.js does not keep the raw game date — it is formatted into a HUD string and discarded, which is why the client had no calendar at all');
  // ⚠ THE PUSH AND THE CATCH-UP ARE TWO CALLS AND ONLY ONE OF THEM IS THE FEATURE. A bare search for
  // `_setBirdSeason(envDoy)` finds the one inside the dynamic import — which exists for the case
  // where the clock beat the module — so deleting the push from the clock handler left the other
  // and the check stayed green, which is the two-lists trap in miniature.
  //
  // ⚠ AND IT IS THE GUARD THAT TELLS THEM APART, NOT ADJACENCY. This first pinned the push to the
  // line directly below `envDoy = doyOf(...)`, which is a claim about layout rather than about
  // behaviour — and it went red the moment the moon fix put a legitimate line between them. The
  // catch-up call carries `&& envDoy != null` because it may run before any clock has arrived; the
  // clock handler's does not, because by then one has. That difference is the real distinction.
  if (!/if \(_setBirdSeason\) _setBirdSeason\(envDoy\);/.test(env)) {
    problems.push('environment.js never pushes the date to the renderer when the clock arrives — the calendar is kept and nothing is told about it, so BIRD_DOY stays at whatever the first tick happened to set');
  }
}

// ── 9. THE AUDIO BED FALLS BACK ON ITS OWN, WITH NO SECOND TEST ──────────────
// `MURMUR_AUDIO_MIN` has stood in windshield.js since the bed shipped and is already the right
// question asked the right way round. Asserted here so that a future retune of either number cannot
// quietly leave a summer party of nine sounding like a roost of a thousand.
{
  const ws = read('client/game/js/panels/windshield.js');
  const m = ws.match(/const MURMUR_AUDIO_MIN = (\d+)/);
  if (!m) problems.push('MURMUR_AUDIO_MIN is gone from windshield.js — nothing stops a party of nine being voiced as a roost of a thousand');
  else {
    const floor = Number(m[1]);
    const sDusk = med(sizes(ANCHORS, { hour: DUSK, doy: MIDSUMMER }));
    const wNoon = med(sizes(ANCHORS, { hour: NOON, doy: MIDWINTER }));
    const wDusk = med(sizes(ANCHORS, { hour: DUSK, doy: MIDWINTER }));
    if (!(wNoon < floor)) problems.push(`a midwinter afternoon party (${wNoon}) is at or over MURMUR_AUDIO_MIN (${floor}) — a feeding party of a few dozen would be voiced as a roost`);
    if (!(sDusk < floor)) problems.push(`a midsummer dusk gathering (${sDusk}) is at or over MURMUR_AUDIO_MIN (${floor}) — the summer evening would sound exactly like a winter one`);
    if (!(wDusk >= floor)) problems.push(`a midwinter dusk flock (${wDusk}) is under MURMUR_AUDIO_MIN (${floor}) — the one moment the bed exists for would never reach it`);
    else notes.push(`audio bed (min ${floor}): winter dusk ${wDusk} in, winter noon ${wNoon} out, summer dusk ${sDusk} out`);
  }
}

// Leave it as it ships, so a suite that runs several gates in one process is not handed a flipped
// flag by this one.
BIRD_TUNE.season = 0;

if (REPORT || problems.length) for (const n of notes) console.log('  · ' + n);
if (problems.length) {
  console.log(`✗ birdseason — ${problems.length} problem(s):`);
  for (const p of problems) console.log('  · ' + p);
  process.exit(1);
}
console.log('✓ birdseason — the flag is off and off is the old roll exactly; with it on the starling alone gains a year, the peak is the winter roost and the trough the breeding season, the gathering peaks before dayEnd and is derived from it, no flock is deleted or grows past its declared max, a summer party is not one repeated number, both surfaces are handed the same season, and the audio bed falls back to bursts on its own.');
