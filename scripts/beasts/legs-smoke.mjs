// LEGS SMOKE: every four-legged animal in the Bestiary and the Room Stage, in every gait, through one stride.
//
// The beast kit's quadruped stands its legs from its feet (client/game/js/panels/gl/beast-legs.js): the gait puts a
// foot down and the joints are solved up to it. This checks that it does, for every recipe in the `four` group, every
// entry in BEAST_LOOKS and anything else built on quadruped(): no throw, no NaN, every planted foot on the floor
// (within 5 mm, true size), nothing under the floor by more than that, and the triangles under a budget.
//
// No DOM, no DB, no network. The recipes import from the Modelshop's web root ('/client/…'), mapped here to the repo.
//   node scripts/beasts/legs-smoke.mjs [--verbose]
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hook = `export async function resolve(spec, ctx, next) {
  if (spec.startsWith('/client/') || spec === '/bestiary-recipes.js') return next(${JSON.stringify(pathToFileURL(ROOT).href)} + (spec === '/bestiary-recipes.js' ? '/tools/modelshop' : '') + spec, ctx);
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { beastMesh, triCount } = await import(pathToFileURL(resolve(ROOT, 'client/game/js/panels/gl/beast-kit.js')).href);
const { GAITS } = await import(pathToFileURL(resolve(ROOT, 'client/game/js/panels/gl/beast-legs.js')).href);
const { BEAST_LOOKS } = await import(pathToFileURL(resolve(ROOT, 'client/game/js/panels/gl/beast-looks.js')).href);
const { BESTIARY } = await import(pathToFileURL(resolve(ROOT, 'tools/modelshop/bestiary-recipes.js')).href);

const verbose = process.argv.includes('--verbose');
const TOL = 0.005, BUDGET = 90000, STEPS = 24;
const subjects = [
  // every recipe with a build: the ones that aren't quadrupeds report no legs and are passed over
  ...Object.entries(BESTIARY).filter(([, r]) => r.build).map(([id, r]) => [id, (M, t, o) => r.build(M, t, o)]),
  ...Object.entries(BEAST_LOOKS).map(([id, f]) => ['look ' + id, f]),
];
const fails = [];
const fail = (msg) => { fails.push(msg); console.error('✗ ' + msg); };
let built = 0;
const skipped = new Set();

for (const [id, build] of subjects) {
  for (const gait of Object.keys(GAITS)) {
    let maxTris = 0;
    for (let i = 0; i < STEPS; i++) {
      // one stride: the slowest gait's period is under 3 s for anything here; standing's fidget comes round every ~6
      const t = gait === 'stand' ? (i / STEPS) * 7 : (i / STEPS) * 3;
      const M = beastMesh();
      let out;
      try { out = build(M, t, { gait }); } catch (e) { fail(`${id} ${gait} t=${t.toFixed(2)}: threw ${e.stack || e}`); break; }
      built++;
      const legs = out?.legs;
      if (!legs?.length) { skipped.add(id); break; }
      const P = M.P;
      if (P.some((v) => !Number.isFinite(v))) { fail(`${id} ${gait} t=${t.toFixed(2)}: a vertex isn't finite`); break; }
      maxTris = Math.max(maxTris, triCount(M));
      let low = Infinity;
      for (let k = 1; k < P.length; k += 3) low = Math.min(low, P[k]);
      if (low < -TOL) { fail(`${id} ${gait} t=${t.toFixed(2)}: something ${(-low * 1000).toFixed(1)} mm under the floor`); break; }
      for (const lg of legs) {
        if (!lg.down) continue;
        let foot = Infinity;
        for (let v = lg.t0 * 3; v < lg.t1 * 3; v++) foot = Math.min(foot, P[v * 3 + 1]);
        if (foot > TOL) { fail(`${id} ${gait} t=${t.toFixed(2)}: ${lg.key} is down but ${(foot * 1000).toFixed(1)} mm off the floor`); }
      }
    }
    if (maxTris > BUDGET) fail(`${id} ${gait}: ${maxTris} triangles, over ${BUDGET}`);
    if (verbose) console.log(`${id} ${gait}: ${maxTris} triangles`);
  }
}
const four = subjects.length - skipped.size;
if (four < 9) fail(`only ${four} four-legged animals found; the recipes or BEAST_LOOKS lost some`);
if (verbose || fails.length) console.log(`legs-smoke: ${four} four-legged animals, ${built} builds, ${fails.length} failure${fails.length === 1 ? '' : 's'}`);
process.exit(fails.length ? 1 : 0);
