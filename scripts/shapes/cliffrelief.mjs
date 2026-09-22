// DOES A MASSIF DIFFER FROM ITS NEIGHBOUR, AND IS ITS RIM BROKEN?
//
// ⚠ THE OCTAVES IN `cliffHeightAt` AVERAGED EACH OTHER OUT. Their weights summed to one, so the
// height was the MEAN of four independent noises — and a mean concentrates. Measured over every
// cliff and plateau tile in the world, the nominal [0.55, 1.45] band was never approached: the
// middle half of every massif sat within 19% of the median and the step from one tile to the next
// averaged 0.008 of a tile. The comment on the last two octaves said they exist to stop a rim
// running flat to the horizon, and arithmetically they could not — adding octaves to a mean makes
// it SMOOTHER.
//
// ⚠ AND THE OBVIOUS FIX MANUFACTURES THE BUG IT IS FIXING. A linear stretch about the midpoint
// clips: at the relief the picture wants, 9.4% of the world's cliff tiles pinned to a rail and came
// out at identical height, which is a flat rim again with fewer steps in it. The signed power curve
// reaches a rail only where the noise already did.
//
// ⚠ AND THE TWO QUESTIONS ARE SEPARATE, WHICH IS WHY THIS FILE NOW MAKES FOUR CLAIMS RATHER THAN
// THREE. A height answers WHICH tableland this is and HOW BROKEN its rim is, and while both lived
// in one weighted mean they traded against each other: every point of weight moved to the fine
// octaves to break a rim came off the swing that separates one massif from the next — 49% of the
// median down to 39% to buy twice the rim step. `cliffRelief` now stretches the LEVEL and
// `cliffRough` rides on top of it, so each is checked against its OWN control, and the fourth
// claim is that the roughness stays out of the level's business.
import { readFileSync } from 'node:fs';
import { loadWindshield } from './dom-stub.mjs';

const ws = await loadWindshield();
const { cliffHeightAt, RENDER_TUNE } = ws;
const world = JSON.parse(readFileSync('client/game/flightsim-world.json', 'utf8'));

const tiles = [];
for (const [k, c] of Object.entries(world.cells)) {
  if (c.biome !== 'cliff' && c.biome !== 'plateau') continue;
  const [x, y] = k.split(',').map(Number);
  tiles.push([x, y]);
}

const problems = [];
if (tiles.length < 200) problems.push(`only ${tiles.length} cliff tiles in the world — nothing to measure`);

const LO = 0.52 * 0.55, HI = 0.52 * 1.45;   // the band the height expression can produce
function survey(relief, rough) {
  const wasR = RENDER_TUNE.cliffRelief, wasG = RENDER_TUNE.cliffRough;
  RENDER_TUNE.cliffRelief = relief; RENDER_TUNE.cliffRough = rough;
  const hs = [], scale = RENDER_TUNE.cliffScale || 1;
  let step = 0, railed = 0;
  for (const [x, y] of tiles) {
    const h = cliffHeightAt(x, y);
    hs.push(h);
    step += Math.abs(h - cliffHeightAt(x + 1, y));
    if (h <= LO * scale + 1e-6 || h >= HI * scale - 1e-6) railed++;
  }
  RENDER_TUNE.cliffRelief = wasR; RENDER_TUNE.cliffRough = wasG;
  hs.sort((a, b) => a - b);
  const q = (p) => hs[Math.floor(hs.length * p)];
  return { iqr: (q(0.75) - q(0.25)) / q(0.5), step: step / tiles.length, railed: railed / tiles.length };
}

const REL = RENDER_TUNE.cliffRelief, ROU = RENDER_TUNE.cliffRough;
// ⚠ EACH KNOB AGAINST ITS OWN CONTROL, AND BOTH CONTROLS ARE THE IDENTITY BY ARITHMETIC. A relief
// of 1 is a power of 1, which is the identity; a roughness of 0 removes the added term entirely.
// Neither is a branch, so these are the real expression with one number moved — and if a knob's
// measurement ever matches its own control, that knob has stopped being wired.
const flat = survey(1, ROU);        // relief off, roughness as it ships
const smooth = survey(REL, 0);      // roughness off, relief as it ships
const live = survey(REL, ROU);

// 1. RELIEF SEPARATES ONE MASSIF FROM THE NEXT.
if (!(live.iqr > flat.iqr * 1.4)) {
  problems.push(`relief ${REL} spreads the heights no wider than a flat rim did `
    + `(${(live.iqr * 100).toFixed(0)}% of median against ${(flat.iqr * 100).toFixed(0)}%)`);
}
// 2. ROUGHNESS BREAKS THE RIM. This was relief's claim and relief cannot make it any more: the
//    stretch is monotonic in the LEVEL, so it moves whole tablelands and not the steps within one.
if (!(live.step > smooth.step * 1.4)) {
  problems.push(`cliffRough ${ROU} does not roughen the rim — the step from tile to tile is `
    + `${live.step.toFixed(4)} against ${smooth.step.toFixed(4)} with it off`);
}
// 3. AND ROUGHNESS STAYS OUT OF THE LEVEL'S BUSINESS, which is the entire reason the two were
//    split. Averaged into the same sum it cost the massif-scale swing a fifth of its width.
if (!(live.iqr > smooth.iqr * 0.85)) {
  problems.push(`cliffRough ${ROU} is eating the massif-scale swing — ${(live.iqr * 100).toFixed(0)}% `
    + `of median against ${(smooth.iqr * 100).toFixed(0)}% with it off, which is the mean that was split apart`);
}
// 4. ⚠ NOTHING MAY PIN, AT ANY SETTING. A railed tile is a flat top the noise did not ask for, and
//    the roughness is the term most likely to produce one — added and clipped it pinned 2.4% of
//    the world, so it is spent into the headroom instead.
for (const [name, s] of [['live', live], ['relief 1', flat], ['rough 0', smooth]]) {
  if (s.railed > 0.005) {
    problems.push(`${(s.railed * 100).toFixed(1)}% of cliff tiles are pinned to a height rail at ${name} — the curve is clipping`);
  }
}

if (problems.length) {
  console.log(`✗ cliffrelief: ${problems.length} problem(s)`);
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log(`✓ cliffrelief: ${tiles.length} cliff tiles — the middle half of every massif spans `
  + `${(live.iqr * 100).toFixed(0)}% of the median height against ${(flat.iqr * 100).toFixed(0)}% at relief 1, `
  + `and the rim steps ${(live.step / smooth.step).toFixed(2)}x harder from tile to tile than with cliffRough off.`);
console.log(`  · the roughness keeps the swing (${(live.iqr * 100).toFixed(0)}% against ${(smooth.iqr * 100).toFixed(0)}% without it), `
  + `and nothing is pinned to a rail at any of the three settings.`);
