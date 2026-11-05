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
import { SEA_TILE_M, SEA_K } from '../../client/shared/sea-swell.js';
import {
  SPECIES, SPECIES_IDS, ACTIVE, WATCHES, habitatFor, schoolsNear,
  schoolState, schoolFish, fishKg, fishNear, loopPeriod, forecastLines,
  SHADOW_R, LAMP_R, landMask, maskedLand, daylightOfNight,
} from '../../client/shared/fish.js';
import { shadowFish, shadowInstances, packShadows, resetShadowScene } from '../../client/game/js/panels/fish-shadow-scene.js';

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
  const a = JSON.stringify(schoolsNear(30, 30, 25 / SEA_K, env, habA));
  const b = JSON.stringify(schoolsNear(30, 30, 25 / SEA_K, env, habB));
  if (a !== b) { say(`schoolsNear differs between two habitat caches at ${env.hour}:00`); break; }
  const s = schoolsNear(30, 30, 25 / SEA_K, env, habA)[0];
  if (s && JSON.stringify(schoolFish(s, 0, NOW, env)) !== JSON.stringify(schoolFish(s, 0, NOW, env))) say('schoolFish gave two answers to one question');
}

// 5. Schools swim at their species' speed, without jumps, and never onto land.
const night = ENVS[3], day = ENVS[1];
let swum = 0;
for (const env of [day, night]) {
  for (const s of schoolsNear(30, 30, 30 / SEA_K, env, habA)) {
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
for (const s of schoolsNear(30, 30, 30 / SEA_K, night, habA)) {
  for (let i = 0; i < s.n; i++) {
    const kg = fishKg(s, i), [lo, , hi] = SPECIES[s.sp].kg;
    if (kg < lo - 0.01 || kg > hi + 0.01) say(`${s.id} fish ${i} weighs ${kg} kg, outside ${lo}-${hi}`);
  }
}
const near = fishNear(30, 30, 8 / SEA_K, NOW, night, habA);
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
// Kept, because the shore searches ask the same tiles thousands of times and this is most of the run.
const landKept = new Map();
const realLand = (ix, iy) => {
  const k = ix + ',' + iy;
  let l = landKept.get(k);
  if (l === undefined) { const v = water.get(k); l = v === undefined ? !wildlandsAt(ix, iy).sea : !v; landKept.set(k, l); }
  return l;
};
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

// 8. The shadows (fish-shadow-scene.js, drawn by gl/fish-shadows.js).
//
// The seat draws fish.js's fish from its own copy of the arithmetic, on the land the server sends it
// (fish.js landMask), with the schools kept between frames. So: the seat's list is the server's
// fishNear to the fish, the server's way round (x + 0.5) and on the masked land; the same question
// gets the same instances; nothing is drawn under way, or at night outside the lamp.
const SCENE_SRC = fs.readFileSync('client/game/js/panels/fish-shadow-scene.js', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
for (const bad of ['Date.now', 'new Date', 'performance.now', 'Math.random']) {
  if (SCENE_SRC.includes(bad)) say(`fish-shadow-scene.js calls ${bad}: the seat hands in the server's clock`);
}
if (daylightOfNight(1) !== 0 || daylightOfNight(0) !== 1 || daylightOfNight(0.88) !== 0) say('daylightOfNight: full night and the blue hour must be 0, full day 1');
const key = (f) => `${f.school.id}:${f.i}:${f.x.toFixed(6)}:${f.y.toFixed(6)}`;
let agreed = 0, compared = 0, drawnDay = 0, lampSeen = 0;
const spots = [];
for (let x = 884; x <= 932; x += 4) for (let y = 884; y <= 912; y += 4) if (!realLand(x, y) && habR(x + 0.5, y + 0.5)?.depth > 1) spots.push([x, y]);
if (spots.length < 20) say(`only ${spots.length} water spots round the harbour to test the shadows on`);
for (const [bx, by] of spots.slice(0, 48)) {
  const masked = habitatFor(maskedLand(landMask(bx, by, realLand), () => false));
  for (const env of [ENVS[1], ENVS[3]]) {
    resetShadowScene();
    for (const [dx, dy] of [[0, 0], [0.12, -0.09]]) {   // a swing on the anchor: the kept schools serve both
      const x = bx + dx, y = by + dy;
      const server = fishNear(x + 0.5, y + 0.5, SHADOW_R, NOW, env, habR).map(key).join('|');
      const seat = shadowFish(x, y, NOW, env, masked).map(key).join('|');
      compared++;
      if (server === seat) agreed++;
      else if (compared - agreed <= 3) say(`shadows at ${x},${y} ${env.hour}:00: the seat's fish aren't the server's (${seat.split('|').length} against ${server.split('|').length})`);
    }
  }
  // The same question, the same instances, from a fresh cache too.
  const q = { x: bx, y: by, now: NOW, env: ENVS[1], habitat: masked, thinned: null, anchored: true, speedMph: 0, daylight: 1, lamp: false };
  const a = JSON.stringify(shadowInstances(q));
  resetShadowScene();
  if (JSON.stringify(shadowInstances(q)) !== a) say(`shadowInstances at ${bx},${by} gave two answers to one question`);
  const day = shadowInstances(q);
  drawnDay += day.length;
  // What's drawn by day is the seat's fish: each instance is one of them, and every one well inside
  // sight that has arrived is drawn.
  const all = new Map(shadowFish(bx, by, NOW, ENVS[1], masked).map((f) => [`${f.school.id}:${f.i}`, f]));
  const drawn = new Set(day.map((s) => `${s.school}:${s.i}`));
  const stray = day.find((s) => !all.has(`${s.school}:${s.i}`));
  const missed = [...all.values()].find((f) => f.dist <= SHADOW_R - 2 && f.school.fade >= 0.05 && !drawn.has(`${f.school.id}:${f.i}`));
  if (stray) say(`a shadow at ${bx},${by} (${stray.school} ${stray.i}) is no fish the server has`);
  if (missed) say(`fish ${missed.school.id} ${missed.i} at ${bx},${by} is in sight by day and isn't drawn`);
  // The packed buffer is the same list, in the window's frame.
  const box = { data: null }, n = packShadows(q, box, bx - 3, by + 2, () => 0.01, SEA_TILE_M);
  if (n !== day.length) say(`packShadows packed ${n} at ${bx},${by} against ${day.length} instances`);
  else if (n && (Math.abs(box.data[0] - (day[0].x - (bx - 3))) > 1e-4 || Math.abs(box.data[4] - day[0].len / SEA_TILE_M) > 1e-4 || box.data[2] !== Math.fround(0.01))) {
    say(`packShadows at ${bx},${by} doesn't put the first shadow where shadowInstances does`);
  }
  // Under way, nothing; a stopped boat that isn't anchored, the same as an anchored one.
  if (shadowInstances({ ...q, anchored: false, speedMph: 6 }).length) say(`shadows drawn under way at ${bx},${by}`);
  if (shadowInstances({ ...q, anchored: false, speedMph: 1.5 }).length !== day.length) say(`a boat stopped off anchor at ${bx},${by} sees different shadows`);
  // At night, nothing without the lamp, and with it only what it lights.
  const nq = { ...q, env: ENVS[3], daylight: daylightOfNight(1) };
  if (shadowInstances(nq).length) say(`shadows drawn at night with no lamp at ${bx},${by}`);
  for (const s of shadowInstances({ ...nq, lamp: true })) {
    lampSeen++;
    if (Math.hypot(s.x - bx, s.y - by) > LAMP_R + 1e-9) { say(`a shadow ${Math.hypot(s.x - bx, s.y - by).toFixed(2)} tiles off at night, outside the lamp`); break; }
  }
}
if (compared && agreed !== compared) say(`the seat's shadows matched the server's fish at ${agreed} of ${compared} points`);
if (!drawnDay) say('no shadows drawn by day at any spot round the harbour');
if (!lampSeen) say('no fish came under the lamp at any spot round the harbour after dark');

if (problems.length) {
  console.log(`✗ fish: ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 40)) console.log('  · ' + p);
  process.exit(1);
}
console.log(`✓ fish: nothing reads the clock; ${SPECIES_IDS.length} species are whole and every catch is a raw_fish item; the same question gets the same answer; ${swum} schools swim at their species' speed without jumps, under the surface, over their floor and never onto land; weights stay in range; every marina has fish at every watch; and at ${compared} points the seat's shadows are the server's fish on the land it sends, drawn by day (${drawnDay}), never under way, and after dark only under the lamp (${lampSeen}).`);
