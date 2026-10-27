// Do the fish keep fish.js's promises?
//
// client/shared/fish.js works out every school from place and time, and the server and every client
// call it separately. So the promises that matter are the ones nobody would see break: the same
// question always gets the same answer, nothing reads the clock behind the caller's back, a school
// swims at its species' speed and never onto the beach, every catch is a real raw_fish item, and
// the water round each marina has fish in it at every watch.
//
// ⚠ NO HARNESS HERE SEES A SHADOW. The picture is gl/fish-shadows.js and the eye; this checks the
// arithmetic, which is the half that is silent when it's wrong. `node scripts/fish/map.mjs` paints
// the real coast for the eye.
//
// It reads content files and writes nothing, so it's safe beside any other gate.

import fs from 'node:fs';
import path from 'node:path';
import { wildlandsAt } from '../../client/shared/wildlands.js';
import { SEA_TILE_M } from '../../client/shared/sea-swell.js';
import {
  SPECIES, SPECIES_IDS, ACTIVE, WATCHES, habitatFor, schoolsNear,
  schoolState, schoolFish, fishKg, fishNear, loopPeriod, forecastLines,
} from '../../client/shared/fish.js';

const problems = [];
const say = (m) => problems.push(m);
const FISH_SRC = fs.readFileSync('client/shared/fish.js', 'utf8');

// 1. Nothing reads the clock. Comments are stripped first, so the header can talk about it.
const code = FISH_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
for (const bad of ['Date.now', 'new Date', 'performance.now', 'Math.random']) {
  if (code.includes(bad)) say(`fish.js calls ${bad}: every answer has to come from its arguments`);
}

// 2. Every species row is whole, and its catch is a raw_fish item.
const FIGHTS = new Set(['steady', 'runner', 'sulker', 'jumper', 'wriggler']);
const SHAPES = new Set(['round', 'slim', 'deep', 'long', 'eel', 'skate']);
for (const id of SPECIES_IDS) {
  const sp = SPECIES[id];
  const file = path.join('content/items', sp.item + '.json');
  if (!fs.existsSync(file)) { say(`${id}: catch ${sp.item} has no content file`); continue; }
  const row = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!row.tags?.raw_fish) say(`${id}: ${sp.item} isn't tagged raw_fish, so the fishmonger pays the ordinary rate`);
  if (!ACTIVE[sp.active]) say(`${id}: active '${sp.active}' isn't a curve in ACTIVE`);
  if (!FIGHTS.has(sp.fight)) say(`${id}: fight '${sp.fight}' isn't a fight style`);
  if (!SHAPES.has(sp.shape)) say(`${id}: shape '${sp.shape}' has no shadow`);
  const [lo, mode, hi] = sp.kg;
  if (!(lo > 0 && lo <= mode && mode <= hi)) say(`${id}: kg ${sp.kg} isn't min <= mode <= max`);
  if (!(sp.school[0] >= 1 && sp.school[0] <= sp.school[1])) say(`${id}: school ${sp.school} isn't 1 <= min <= max`);
  if (!(sp.depth[0] < sp.depth[1]) || !(sp.shore[0] < sp.shore[1])) say(`${id}: a depth or shore band is empty`);
  if (!(sp.speed > 0) || !(sp.rare > 0 && sp.rare <= 1)) say(`${id}: speed or rare is out of range`);
}

// 3. A made-up coast: land west of x = 0, with a headland, so a check can know the answer.
const synthLand = (ix, iy) => ix < 0 || (ix < 6 && iy >= 20 && iy < 24);
const habA = habitatFor(synthLand), habB = habitatFor(synthLand);
const NOW = Date.UTC(2026, 3, 10, 12, 0, 0);
const ENVS = WATCHES.map(([, hour]) => ({ hour, doy: 100, weather: 'clear', rough: 0 }));

// 4. The same question gets the same answer, from a fresh cache too.
for (const env of ENVS) {
  const a = JSON.stringify(schoolsNear(30, 30, 25, env, habA));
  const b = JSON.stringify(schoolsNear(30, 30, 25, env, habB));
  if (a !== b) { say(`schoolsNear differs between two habitat caches at ${env.hour}:00`); break; }
  const s = schoolsNear(30, 30, 25, env, habA)[0];
  if (s && JSON.stringify(schoolFish(s, 0, NOW, env)) !== JSON.stringify(schoolFish(s, 0, NOW, env))) say('schoolFish gave two answers to one question');
}

// 5. Schools swim at their species' speed, without jumps, and never onto land.
const night = ENVS[3], day = ENVS[1];
let swum = 0;
for (const env of [day, night]) {
  for (const s of schoolsNear(30, 30, 30, env, habA)) {
    const sp = SPECIES[s.sp], P = loopPeriod(s);
    let prev = null, onLand = 0, jump = 0, dist = 0;
    const steps = 200, dt = P / steps;
    for (let k = 0; k <= steps; k++) {
      const st = schoolState(s, NOW + k * dt, env);
      if (synthLand(Math.floor(st.x), Math.floor(st.y))) onLand++;
      if (st.depth > s.floorM + 0.01 || st.depth < 0.29) say(`${s.id} (${s.sp}) holds at ${st.depth.toFixed(2)} m over a ${s.floorM.toFixed(1)} m floor`);
      if (prev) {
        const d = Math.hypot(st.x - prev.x, st.y - prev.y);
        dist += d;
        if (d > 0.25) jump++;
      }
      prev = st;
    }
    const mps = (dist * SEA_TILE_M) / (P / 1000);
    if (onLand) say(`${s.id} (${s.sp}) swims onto land on ${onLand} of ${steps} steps`);
    if (jump) say(`${s.id} (${s.sp}) jumps a quarter tile in one step ${jump} times`);
    if (mps < sp.speed * 0.4 || mps > sp.speed * 2.5) say(`${s.id} (${s.sp}) averages ${mps.toFixed(2)} m/s against a cruising ${sp.speed}`);
    swum++;
  }
}
if (!swum) say('no schools on the made-up coast at noon or midnight, so nothing was swum');

// 6. Weights stay inside the species' range and don't change.
for (const s of schoolsNear(30, 30, 30, night, habA)) {
  for (let i = 0; i < s.n; i++) {
    const kg = fishKg(s, i), [lo, , hi] = SPECIES[s.sp].kg;
    if (kg < lo - 0.01 || kg > hi + 0.01) say(`${s.id} fish ${i} weighs ${kg} kg, outside ${lo}-${hi}`);
  }
}
const near = fishNear(30, 30, 8, NOW, night, habA);
for (let i = 1; i < near.length; i++) if (near[i].dist < near[i - 1].dist) { say("fishNear isn't nearest first"); break; }

// 7. The real coast: the marinas' water, read from content/zones by file name. A tile with no zone
// falls back to the wildlands' sea, as the submersible's isLandTile does.
// The window is the whole Basin round Coldwater: the grouper lives only on shelf wrecks, and the
// nearest one with a grouper on it is 47 tiles from the harbour.
const X0 = 830, X1 = 980, Y0 = 840, Y1 = 960;
const water = new Map();
for (let x = X0; x < X1; x++) for (let y = Y0; y < Y1; y++) {
  const f = `content/zones/zone_district_${x}_${y}.json`;
  if (!fs.existsSync(f)) continue;
  const z = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (z.map_id === 'map_world' && (z.grid_z | 0) === 0) water.set(x + ',' + y, z.flags?.terrain === 'water');
}
const realLand = (ix, iy) => { const v = water.get(ix + ',' + iy); return v === undefined ? !wildlandsAt(ix, iy).sea : !v; };
const habR = habitatFor(realLand);
const MARINAS = [['Fairweather', 892.5, 901.5], ['the Fish Quay', 903.5, 904.5], ['the Eastern Marina', 919.5, 899.5]];
const seen = new Set();
for (const [name, x, y] of MARINAS) {
  const kinds = new Set();
  for (const env of ENVS) {
    const s = schoolsNear(x, y, 12, env, habR);
    if (!s.length) say(`${name}: no schools within 12 tiles ${WATCHES[ENVS.indexOf(env)][0]}`);
    for (const one of s) { kinds.add(one.sp); seen.add(one.sp); }
  }
  if (kinds.size < 4) say(`${name}: only ${kinds.size} species within 12 tiles across the day`);
  const lines = forecastLines({ name, x, y, R: 12 }, { doy: 100, weather: 'clear' }, habR);
  if (!lines.length) say(`${name}: the forecast has nothing to say`);
  for (const l of lines) if (/[—–]/.test(l) || l.endsWith('.')) say(`${name}: forecast line "${l}" has a dash or its own full stop`);
}
// Every species lives somewhere in this window in some season, or it's a row nobody can catch.
for (const env of [...ENVS, ...ENVS.map((e) => ({ ...e, doy: 20 }))]) {
  for (const s of schoolsNear(905, 900, 70, env, habR)) seen.add(s.sp);
}
for (const id of SPECIES_IDS) if (!seen.has(id)) say(`${id}: no school of it within 70 tiles of the harbour at any watch, spring or winter`);

if (problems.length) {
  console.log(`✗ fish: ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 40)) console.log('  · ' + p);
  process.exit(1);
}
console.log(`✓ fish: nothing reads the clock; ${SPECIES_IDS.length} species are whole and every catch is a raw_fish item; the same question gets the same answer; ${swum} schools swim at their species' speed without jumps, under the surface, over their floor and never onto land; weights stay in range; and every marina has fish at every watch.`);
