// FOOTSTEP SMOKE: the walker's own steps on the street on foot (client/shared/footstep-sfx.js).
//
//   node scripts/audio/footstep-smoke.mjs
//
// Every patch is rendered through the real audio-engine.js on scripts/audio/offline-audio.mjs and
// held to a footstep's shape; the stepper is driven at a walk, a run and a sneak. No browser, DB
// or network.
//
// WHAT IT GUARDS:
//   • every patch: finite, starting and ending in silence, no DC, a quiet peak, 20-300 ms long
//   • the surfaces sound different: no two share a spectral centroid within 4%, chrome and the
//     grating ring longer than concrete, and grass is the softest
//   • a take is the same twice for a seed and differs for another; a run is louder and brighter
//     than a walk, a sneak quieter than a walk
//   • the stepper: the step rate follows the stride (a run steps more often per second, fewer per
//     metre), standing still is silent, a jump isn't a step, Sound Detail off is silent
//   • wet ground: every wet step has water on it, some on hard ground find a puddle, none on grass
//   • surfaceOf: lane vs walkway, a bridge deck, dirt, grass, planking
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installAudioGlobals } from './offline-audio.mjs';
import { renderCue, measure, SR } from './hockey-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); } };

installAudioGlobals();
if (!globalThis.AudioEngine) new Function(readFileSync(join(ROOT, 'client/shared/audio-engine.js'), 'utf8'))();
const AE = globalThis.AudioEngine;
const F = await import(pathToFileURL(join(ROOT, 'client/shared/footstep-sfx.js')).href);

const M = new Map();
check('patch ids are unique', new Set(F.BUILTINS.map((d) => d.id)).size === F.BUILTINS.length);
for (const s of F.SURFACES) check(`a patch for ${s}`, !!F.patch(`fs-${s}`));
for (const d of F.BUILTINS) {
  const m = measure((await renderCue(AE, d)).getChannelData(0), SR);
  M.set(d.id, m);
  check(`${d.id}: finite`, m.finite);
  check(`${d.id}: starts at silence`, m.first < 1e-3, m.first.toExponential(2));
  check(`${d.id}: ends in silence`, m.tail === 'ok', m.tail);
  check(`${d.id}: no DC`, m.dc < 0.01, m.dc.toFixed(4));
  check(`${d.id}: a quiet peak`, m.peak > 0.02 && m.peak <= 0.45, m.peak.toFixed(3));
  check(`${d.id}: 20-300 ms`, m.lenMs >= 20 && m.lenMs <= 300, `${m.lenMs} ms`);
  check(`${d.id}: on the sfx bus, low priority`, d.category === 'sfx' && d.priority <= 2);
}
{
  const c = F.SURFACES.map((s) => [s, M.get(`fs-${s}`).centroid]);
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
    check(`${c[i][0]} and ${c[j][0]} sound different`, Math.abs(c[i][1] - c[j][1]) / Math.max(c[i][1], c[j][1]) > 0.04, `${c[i][1].toFixed(0)} vs ${c[j][1].toFixed(0)} Hz`);
  }
  const len = (s) => M.get(`fs-${s}`).lenMs;
  check('chrome and grating ring longer than concrete', len('chrome') > len('pave') && len('grate') > len('pave'), `${len('pave')} ${len('chrome')} ${len('grate')}`);
  check('grass is softer than concrete and duller than dirt', M.get('fs-grass').peak < M.get('fs-pave').peak && M.get('fs-grass').centroid < M.get('fs-dirt').centroid);
}
{
  const d = F.patch('fs-pave');
  const r = async (v) => measure((await renderCue(AE, v)).getChannelData(0), SR);
  const a = (await renderCue(AE, F.variant(d, 7, 0.7))).getChannelData(0), b = (await renderCue(AE, F.variant(d, 7, 0.7))).getChannelData(0), c = (await renderCue(AE, F.variant(d, 8, 0.7))).getChannelData(0);
  check('a seed is the same take twice', a.every((x, i) => x === b[i]));
  check('another seed is another take', a.some((x, i) => Math.abs(x - c[i]) > 1e-4));
  const [sneak, walk, run] = [await r(F.variant(d, 7, 0.3)), await r(F.variant(d, 7, 0.7)), await r(F.variant(d, 7, 1.15))];
  check('a run is louder than a walk', run.peak > walk.peak * 1.2, `${walk.peak.toFixed(3)} ${run.peak.toFixed(3)}`);
  check('a run is brighter than a walk', run.centroid > walk.centroid, `${walk.centroid.toFixed(0)} ${run.centroid.toFixed(0)}`);
  check('a sneak is quieter than a walk', sneak.peak < walk.peak * 0.6, `${sneak.peak.toFixed(3)} ${walk.peak.toFixed(3)}`);
}
// the stepper: `ms` metres a second for `secs`, at 60 fps
const drive = (ms, secs, ctx = {}) => {
  const played = [];
  const fs = F.createFootsteps({ play: (d, g) => played.push([d.id, g]), seed: 3 });
  const dt = 1 / 60;
  for (let t = 0; t < secs; t += dt) fs.tick(dt, ms * dt, { surface: 'pave', detail: 'limited', ...ctx });
  return { fs, played, steps: fs.log.length };
};
{
  const walk = drive(1.4, 10), run = drive(4.5, 10), sneak = drive(0.7, 10, { crouched: true });
  check('a walk steps about once a stride', Math.abs(walk.steps - 14 / F.GAIT.walk.stride) <= 2, `${walk.steps}`);
  check('a run steps more often a second', run.steps > walk.steps * 2, `${walk.steps} ${run.steps}`);
  check('a run takes fewer steps a metre', run.steps / 45 < walk.steps / 14);
  check('a run is a run, a sneak is a sneak', run.fs.log.at(-1).gait === 'run' && sneak.fs.log.at(-1).gait === 'sneak' && walk.fs.log.at(-1).gait === 'walk');
  check('a run plays louder than a walk', run.played.at(-1)[1] > walk.played.at(-1)[1]);
  check('standing still is silent', drive(0, 5).steps === 0);
  check('Sound Detail off is silent', drive(1.4, 5, { detail: 'off' }).played.length === 0);
  const fs = F.createFootsteps({ play: () => {} });
  fs.tick(1 / 60, 40, { detail: 'limited' });
  check('a jump is not a step', fs.log.length === 0);
  const first = F.createFootsteps({ play: () => {} });
  first.tick(1 / 60, 0.02, { detail: 'limited' });
  check('the first step after a stop lands at once', first.log.length === 1);
  const wet = drive(1.4, 60, { wet: true });
  check('every wet step has water on it', wet.fs.log.every((s) => s.water));
  check('some wet steps on hard ground find a puddle', wet.fs.log.some((s) => s.water === 'puddle') && wet.fs.log.some((s) => s.water === 'wet'));
  check('no puddles on grass', drive(1.4, 60, { wet: true, surface: 'grass' }).fs.log.every((s) => s.water === 'wet'));
  check('dry ground has no water', walk.played.every(([id]) => id === 'fs-pave'));
}
{
  const kit = { road: 1, sc: 2, rd: 'ns' };
  check('surfaceOf: the lane is asphalt', F.surfaceOf(kit, 0.02, 0.3, { laneHalf: 0.1 }) === 'road');
  check('surfaceOf: beside the lane is the chrome walkway', F.surfaceOf(kit, 0.3, 0.3, { laneHalf: 0.1 }) === 'chrome');
  check('surfaceOf: up on a bridge is the grating', F.surfaceOf(kit, 0, 0, { deck: true }) === 'grate');
  check('surfaceOf: a dirt street', F.surfaceOf({ ...kit, ft: 'dust' }, 0, 0) === 'dirt');
  check('surfaceOf: a park is grass, a pier is planking, the badlands dirt', F.surfaceOf({ biome: 'park' }) === 'grass' && F.surfaceOf({ biome: 'pier' }) === 'wood' && F.surfaceOf({ biome: 'badlands' }) === 'dirt');
  check('surfaceOf: the city is pavement', F.surfaceOf({ biome: 'citycore' }) === 'pave' && F.surfaceOf(null) === 'pave');
  check('wetWeather: rain and storms, not fog', F.wetWeather('rain') && F.wetWeather('Thunderstorm') && !F.wetWeather('fog') && !F.wetWeather(null));
}

console.log(`footstep smoke: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
