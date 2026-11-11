// ROOM SOUND SMOKE: the weather, heard from a room (client/shared/room-sfx.js, panels/room-sound.js).
//
//   node scripts/audio/room-sound-smoke.mjs
//
// WHAT IT GUARDS:
//   • every room-* cue passes the critic with no findings, at its target level: an unlevelled bed came in 8 to
//     10 dB hot and went into the master limiter
//   • windowMix: the en-suite is quieter than the room and the room than the balcony, no rain is no rain
//     sound, the wind picks up with height, and it's only ever the weather
//   • the player starts a bed when it's wanted, lets go of it when it's not, plays thunder after the flash, and
//     `stop` takes everything with it: a closed room can't go on raining
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tally, ROOT } from './stub-context.mjs';
import { measure, findings, render } from './sfx-lint.mjs';
import { momentaryMax } from './loudness-lib.mjs';

const { check, done } = tally('audio:room');
const { BUILTINS, ROOM_BEDS, windowMix } = await import(pathToFileURL(join(ROOT, 'client/shared/room-sfx.js')).href);

// ── the cues ────────────────────────────────────────────────────────────────────────────────────
for (const def of BUILTINS) {
  const fs = findings(def, await measure(def, { alias: false }));
  check(`${def.id} passes the critic`, !fs.length, fs.map((f) => `${f.code}: ${f.msg}`).join('; '));
  const lu = momentaryMax(await render(def, 48000, def.loop ? 5 : undefined), 48000), target = def.loop ? -20 : -16;
  check(`${def.id} is within 2.5 LU of ${target} LUFS`, Math.abs(lu - target) <= 2.5, `${lu.toFixed(1)} LUFS`);
}
for (const id of ROOM_BEDS) check(`${id} is a bed in the bank`, BUILTINS.some((d) => d.id === id && d.loop));

// ── the mix ─────────────────────────────────────────────────────────────────────────────────────
const CALM = { rain: 0, wind: 0.2 }, WET = { rain: 0.8, wind: 0.7 };
const ear = (o = {}) => ({ near: 6, open: 0, out: false, annex: false, storey: 30, ...o });
const bath = windowMix(WET, ear({ annex: true })), room = windowMix(WET, ear()), glass = windowMix(WET, ear({ near: 0.5 })), deck = windowMix(WET, ear({ out: true, open: 1, near: 0 }));
const RAIN = ['room-rain', 'room-rain-out', 'room-rain-heavy'], sum = (m, ids) => ids.reduce((x, id) => x + m[id], 0);
for (const [id, ids] of [['rain', RAIN], ['room-wind', ['room-wind']]]) {
  check(`${id}: the en-suite is quieter than the room`, sum(bath, ids) < sum(room, ids), `${sum(bath, ids)} ${sum(room, ids)}`);
  check(`${id}: the balcony is well over the room`, sum(room, ids) * 1.4 < sum(deck, ids), `${sum(room, ids)} ${sum(deck, ids)}`);
}
check('indoors it is the rain on the glass', room['room-rain'] > 0 && room['room-rain-out'] === 0 && room['room-rain-heavy'] === 0);
check('out on the balcony it is the open-air rain', deck['room-rain'] === 0 && deck['room-rain-out'] + deck['room-rain-heavy'] > 0);
check('a downpour sounds like one', windowMix({ rain: 1, wind: 0 }, ear({ out: true }))['room-rain-heavy'] > 0 && windowMix({ rain: 0.2, wind: 0 }, ear({ out: true }))['room-rain-heavy'] === 0);
check('rain is louder at the glass than across the room', sum(glass, RAIN) > sum(room, RAIN));
check('the wind picks up with height', windowMix(WET, ear({ storey: 30 }))['room-wind'] > windowMix(WET, ear({ storey: 2 }))['room-wind']);
check('no rain is no rain sound', windowMix(CALM, ear())['room-rain'] === 0);
check('it stays under full level, even on the balcony in a downpour', Object.values(windowMix({ rain: 1, wind: 1 }, ear({ out: true, near: 0 }))).every((v) => v <= 0.9));
check('it is only the weather', BUILTINS.every((d) => /^room-(rain|wind|thunder)/.test(d.id)), BUILTINS.map((d) => d.id).join(' '));

// ── the player ──────────────────────────────────────────────────────────────────────────────────
const live = new Map(), shots = [];
globalThis.window = globalThis;
globalThis.AudioEngine = {
  loopSound: (def, opts) => live.set(def.id, opts.gain),
  stopLoop: (id) => live.delete(id),
  setLoopGain: (id, g) => { if (live.has(id)) live.set(id, g); },
  playSfx: (def, gain, opts) => shots.push({ id: def.id, gain, pan: opts?.pan }),
};
const { createRoomSound } = await import(pathToFileURL(join(ROOT, 'client/game/js/panels/room-sound.js')).href);
const S = createRoomSound();
let now = 1000;
const step = (hear, e, ms = 300) => { now += ms; S.tick(hear, { ...ear(e), now, look: 0 }); };
step(WET, { near: 1 });
check('rain starts its bed', live.has('window:room-rain') && live.get('window:room-rain') > 0.1, JSON.stringify([...live]));
step(CALM, { near: 1 });
check('when the rain stops the bed goes quiet', live.get('window:room-rain') === 0);
for (let i = 0; i < 30; i++) step(CALM, { near: 1 });
check('and after a while it gives its voice back', !live.has('window:room-rain'));
step({ ...WET, thunder: { seed: 7, dist: 1, bearing: 1.2 } }, { near: 1 });
await new Promise((res) => setTimeout(res, 450));
check('the thunder follows the flash', shots.some((s) => s.id === 'room-thunder'), JSON.stringify(shots));
const before = shots.length;
step({ ...WET, thunder: { seed: 7, dist: 1, bearing: 1.2 } }, { near: 1 });
step({ ...WET, thunder: { seed: 8, dist: 40, bearing: 0.2 } }, { near: 1 });
S.stop();
check('stop takes every bed with it', live.size === 0, JSON.stringify([...live]));
await new Promise((res) => setTimeout(res, 300));
check('and a clap still on its way', shots.length === before, JSON.stringify(shots.slice(before)));

done();
