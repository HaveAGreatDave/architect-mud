// KITCHEN SOUND: what the Kitchen Stage should be playing, worked out from the workspace payload.
//
// The hob is one held cue per state, chosen from what's in the active pan: a dry pan of fat
// (`kitchen-sizzle-dry`), a wet one (`kitchen-sizzle-wet`) or a liquid past a simmer
// (`kitchen-boil`). Its level follows the dial and steps up once while a food is in its window.
// The cues are built-ins in client/shared/sfx-catalog.js; docs/proposals/kitchen-stage.md
// (Next, item 6) says how each is made.
//
// ⚠ NO CLOCK. The state and the level come from the dial, what's in the pan and each food's
// `cook.phase`. Nothing here reads a stage count or the time, so the sound can't get louder or
// brighter as a beat approaches: that would be the countdown the workspace withholds.
//
// ⚠ NO DOM AND NO AUDIO in hobSoundState, thockFor and boxHums. createLoopMixer drives an engine
// it's handed, so scripts/audio/kitchen-sound-smoke.mjs can run all of it in Node.

import { matterFor } from './kitchen-matter.js';

export const HOB_CUES = { dry: 'kitchen-sizzle-dry', wet: 'kitchen-sizzle-wet', boil: 'kitchen-boil' };
export const HUM_CUE = 'kitchen-fridge-hum';
export const SEAL_OPEN = 'kitchen-seal-open';
export const SEAL_SHUT = 'kitchen-seal-shut';
// Knife strokes by the food's cut.firmness: under 0.4 soft (bread, egg, tomato), under 0.75
// medium (meat, fruit, onion, cheese), and hard above that (roots).
export const THOCKS = [
  { below: 0.4, cue: 'kitchen-thock-soft' },
  { below: 0.75, cue: 'kitchen-thock-medium' },
  { below: Infinity, cue: 'kitchen-thock-hard' },
];

// Where the dial puts the level, 0-1 of the cue's own: a quiet floor on the lowest notch, the
// full cue at the top of the dial, and one step up in a food's window.
const FLOOR = 0.3, SPAN = 0.55, IN_WINDOW = 0.15;
// The highest level that's still a simmer when the payload doesn't carry its notches.
const SIMMER_TOP = 3;

// Every pan out in the kitchen, as the Stage draws them (not one shut in a cupboard).
export const pansOf = (d) => (d?.area || []).filter((v) => v.look?.vessel && v.look.vessel !== 'bread' && !v.idle && !/^in the /.test(v.place || ''));
// The pan you're working with: the one you picked, else the one on the heat, else the first.
export function activePan(d, panId = null) {
  const vs = pansOf(d);
  return vs.find((v) => panId != null && String(v.id) === String(panId)) || vs.find((v) => v.hot) || vs[0] || null;
}

const SILENT = Object.freeze({ state: null, cue: null, gain: 0, window: false });

// What the hob sounds like. `panId` is the pan the player picked; `level` stands in for the
// dial's while the knob is being turned and the setting hasn't been sent yet.
export function hobSoundState(payload, { panId = null, level = null } = {}) {
  const pan = activePan(payload, panId);
  if (!pan?.hot) return SILENT;
  const dial = (payload?.dials || []).find((x) => x.subjectId != null && String(x.subjectId) === String(pan.id));
  if (!dial || dial.idle) return SILENT;
  const lv = Number.isFinite(level) ? level : Number(dial.level) || 0;
  const foods = (pan.contents || []).filter((c) => c.kind === 'food' && c.look);
  // a pan the server isn't cooking makes no sound: water alone never takes a cook
  if (!(lv > 0) || !foods.some((c) => c.live)) return SILENT;
  let liquid = false, fat = false, spits = false;
  for (const c of foods) {
    const m = matterFor(c.look.profile, c.look.matter), emit = m.cook?.emit || [];
    const sizzles = emit.includes('sizzle') || emit.includes('spatter');
    // oil and batter are liquids that fry; water, stock and milk boil
    if (c.look.profile === 'fat_or_oil' || (m.form?.kind === 'liquid' && sizzles)) fat = true;
    else if (m.form?.kind === 'liquid') liquid = true;
    if (sizzles) spits = true;
  }
  const simmerTop = (dial.notches || []).find((n) => n.name === 'low')?.to ?? SIMMER_TOP;
  const state = liquid && lv > simmerTop ? 'boil' : !liquid && (fat || spits) ? 'dry' : 'wet';
  const window = foods.some((c) => c.cook?.phase === 'window');
  const max = Number(dial.max) || 10;
  const gain = Math.min(1, FLOOR + SPAN * Math.min(1, lv / max) + (window ? IN_WINDOW : 0));
  return { state, cue: HOB_CUES[state], gain: +gain.toFixed(3), window };
}

// The knife stroke for a food's firmness (0-1; a food with none counts as medium).
export function thockFor(firmness) {
  const f = Number.isFinite(firmness) ? firmness : 0.5;
  return THOCKS.find((t) => f < t.below).cue;
}

// Only a fridge or a freezer hums and pops its seal; a cupboard is just a door.
export const boxHums = (box) => !!box?.preserves;

// Held cues faded in and out on an engine (window.AudioEngine, or a fake in the gate). `set`
// says which cues should be sounding and how loud; every other one this mixer started fades out
// and stops once it's silent. A change of cue is a crossfade. `engine` may be a function, for
// an engine that loads later.
export function createLoopMixer({ engine, cueOf, fade = 0.35, later = setTimeout, cancel = clearTimeout }) {
  const live = new Map();   // id -> { gain, stop }
  const eng = () => (typeof engine === 'function' ? engine() : engine);
  function want(id, gain, ramp = fade) {
    const e = eng();
    if (!e) return;
    const g = Math.max(0, Math.min(1, Number(gain) || 0));
    let L = live.get(id);
    if (g > 0) {
      if (L?.stop) { cancel(L.stop); L.stop = null; }
      if (!e.isLooping?.(id)) {
        const def = cueOf(id);
        if (!def) return;
        e.loopSound(def, { whole: true, gain: 0 });
        if (e.isLooping && !e.isLooping(id)) return;   // no voice free: try again next time
        L = { gain: 0, stop: null };
        live.set(id, L);
      }
      if (!L) { L = { gain: -1, stop: null }; live.set(id, L); }
      if (L.gain !== g) { e.setLoopGain(id, g, ramp); L.gain = g; }
    } else if (L && !L.stop) {
      e.setLoopGain(id, 0, ramp);
      L.gain = 0;
      L.stop = later(() => { eng()?.stopLoop(id); live.delete(id); }, (ramp + 0.1) * 1000);
    }
  }
  function set(levels = {}, ramp = fade) {
    for (const id of [...live.keys()]) if (!(levels[id] > 0)) want(id, 0, ramp);
    for (const [id, g] of Object.entries(levels)) if (g > 0) want(id, g, ramp);
  }
  function stopAll() {
    const e = eng();
    for (const [id, L] of live) { if (L.stop) cancel(L.stop); e?.stopLoop(id); }
    live.clear();
  }
  return { set, want, stopAll, live };
}
