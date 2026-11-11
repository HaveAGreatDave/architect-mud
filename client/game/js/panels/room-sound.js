// THE OUTSIDE, HEARD FROM A ROOM. Plays client/shared/room-sfx.js: rain and wind at what `windowMix` says for
// where you're standing, the thunder after the flash, and the birds and the surf round the building
// (room-outdoors.js says what's due, `outsideMix` how much gets through). Nothing here reaches the server;
// it's what's out there, through this room's glass.
//
// ⚠ THIS IS A VIEW'S SOUND, SO IT'S ALL OVER WHEN THE VIEW IS. `stop` has to take every loop with it, and
// a queued thunderclap, or a closed room carries on raining. It runs on top of the zone's own weather beds
// (plugins/audio), which a closed flat barely hears.

import { BUILTINS, ROOM_BEDS, windowMix, outsideMix } from '../../../shared/room-sfx.js';
import { birdCue, shoreLayers } from './field-audio.js';
import { thunderDelay } from '../../../shared/window-sky.js';
import { flybyClass, flybyCue, FLYBY_LOUD, FLYBY_FAR_REFS } from './engine-audio.js';
import { TILE_M } from '../../../shared/world-scale.js';

// how many flights past the window get a voice at once
const FLIGHT_VOICES = 2;

// how often the mix is worked out, and how long a silent bed is kept before it gives its voice back
const MIX_MS = 250, RAMP = 0.9, IDLE_MS = 6000;
// a bird call's level before the glass, as windshield.js's BIRD_CALL_GAIN, and how far out the outside sits
const CALL_GAIN = 0.16, OUT_M = 6;

export function createRoomSound() {
  const eng = () => window.AudioEngine;
  const cue = (id) => window.SFXCatalog?.get?.(id) || BUILTINS.find((d) => d.id === id);
  const live = new Map();   // bed id -> { gain, idleSince }
  const timers = new Set();
  let nextMix = 0, thunder = -1, stopped = false;

  // ⚠ IN 3D, AT THE GLASS. Each bed and clap is placed at the nearest opening (room-stage.js's
  // earPose), so turning your back on the window turns the rain round with you. windowMix already
  // makes it quieter across the room, so the panner only points it (rolloff 0).
  let posed = false;
  const where = (spot, out = 0) => (spot ? { position: [spot.at[0] + spot.out[0] * out, spot.at[1] + spot.out[1] * out, spot.at[2]], rolloff: 0, doppler: false } : {});
  // outside the nearest opening, leaning toward where the thing really is (`dir`, a plan direction)
  const toward = (spot, dir, m = OUT_M) => {
    if (!spot) return {};
    if (!dir) return where(spot, m);
    let u = spot.out[0] + 0.6 * dir[0], v = spot.out[1] + 0.6 * dir[1];
    const l = Math.hypot(u, v) || 1;
    u /= l; v /= l;
    return { position: [spot.at[0] + u * m, spot.at[1] + v * m, spot.at[2] + 0.8], rolloff: 0, doppler: false };
  };
  let surf = null;   // { kind, gain, pos }

  function setSurf(shore, ear, spot) {
    const A = eng();
    const want = shore ? outsideMix(0, shore.level, ear).surf : 0;
    if (!shore || want < 0.01) {
      if (surf) { A.stopLoop('window:surf'); surf = null; }
      return;
    }
    const at = toward(spot, shore.dir, OUT_M * 2);
    if (!surf || surf.kind !== shore.kind) {
      if (surf) A.stopLoop('window:surf');
      const layers = shoreLayers(shore.kind);
      if (!layers) return;
      A.loopSound({ id: 'window:surf', category: 'ambient', priority: 1, config: { gain: 1, layers } }, { whole: true, gain: 0, ...at });
      surf = { kind: shore.kind, gain: -1, pos: at.position?.join() || '' };
    }
    if (at.position && at.position.join() !== surf.pos) { A.moveLoop?.('window:surf', at.position); surf.pos = at.position.join(); }
    if (Math.abs(want - surf.gain) > 0.008) { A.setLoopGain('window:surf', want, RAMP); surf.gain = want; }
  }

  function playCalls(calls, ear, spot) {
    const S = window.ProceduralSFX, A = eng();
    if (!S?.birdCall) return;
    for (const c of calls) {
      const g = CALL_GAIN * outsideMix(c.level, 0, ear).call;
      if (g < 0.004) continue;
      try {
        const def = birdCue(S.birdCall({ voice: c.sp, intensity: 0.55 + 0.35 * c.level, size: ((c.seed >>> 3) % 100) / 100, seed: c.seed }), c.sp, c.seed);
        if (def) A.playSfx(def, g, spot ? toward(spot, c.dir) : {});
      } catch { /* a silent bird is better than a dead frame */ }
    }
  }

  function setBed(id, want, now, spot) {
    const A = eng(), b = live.get(id);
    if (!b) {
      if (want < 0.01) return;
      const def = cue(id);
      if (!def) return;
      A.loopSound({ ...def, id: `window:${id}` }, { whole: true, gain: 0, ...where(spot) });
      live.set(id, { gain: -1, idleSince: 0, spot: spot ? spot.at.join() : '' });
      return setBed(id, want, now, spot);
    }
    if (spot && spot.at.join() !== b.spot) { A.moveLoop?.(`window:${id}`, where(spot).position); b.spot = spot.at.join(); }
    if (Math.abs(want - b.gain) > 0.008) { A.setLoopGain(`window:${id}`, want, RAMP); b.gain = want; }
    if (want >= 0.01) { b.idleSince = 0; return; }
    b.idleSince ||= now;
    if (now - b.idleSince > IDLE_MS) { A.stopLoop(`window:${id}`); live.delete(id); }
  }

  // THE FLIGHTS GOING OVER. Each is the flight sim's own engine for its class (engine-audio.js
  // flybyCue), placed where it really is on the room's plan with its real velocity, so the panner
  // turns it as it crosses and SIREN's doppler drops the pitch as it goes past. Its distance does the
  // level (rolloff 1 from the class's own `ref`); the glass does the rest, muffled and turned down
  // unless you're out on the balcony.
  const flying = new Map();   // loop id -> { muffled }
  function setFlights(list, ear) {
    const A = eng();
    const out = !!ear.out, through = ear.annex ? 0.15 : out ? 1 : 0.3 + 0.5 * Math.max(ear.open || 0, Math.exp(-(ear.near ?? 9) / 5));
    const near = [];
    for (const f of list || []) {
      const ac = flybyClass(f.cls), L = ac && FLYBY_LOUD[ac];
      if (!L) continue;
      const d = Math.hypot(f.pos[0], f.pos[1], f.pos[2]) / TILE_M;
      if (d <= L.hear) near.push([d / L.hear, f, ac, L, d > L.ref * FLYBY_FAR_REFS]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const want = new Set();
    for (const [, f, ac, L, far] of near.slice(0, FLIGHT_VOICES)) {
      const id = `window:air:${f.id}`, muffled = !out || far;
      want.add(id);
      const had = flying.get(id);
      if (had && (had.muffled !== muffled || !A.loopState?.(id))) { A.stopLoop(id); flying.delete(id); }
      if (!flying.has(id)) {
        A.loopSound({ id, category: 'ambient', priority: 1, config: { gain: 1, layers: flybyCue(ac, { muffled }) } },
          { whole: true, gain: through, position: f.pos, ...(f.vel ? { velocity: f.vel } : {}), ref: L.ref * TILE_M, rolloff: 1, maxDistance: L.hear * TILE_M * 2 });
        if (A.loopState?.(id)) flying.set(id, { muffled, gain: through });
      } else {
        A.moveLoop?.(id, f.pos, f.vel || undefined);
        if (Math.abs(had.gain - through) > 0.02) { A.setLoopGain(id, through, RAMP); had.gain = through; }
      }
    }
    for (const id of [...flying.keys()]) if (!want.has(id)) { A.stopLoop(id); flying.delete(id); }
  }

  function later(ms, fn) { const t = setTimeout(() => { timers.delete(t); if (!stopped) fn(); }, ms); timers.add(t); }

  return {
    // once a frame; it only does anything a few times a second. `hear` is room-window.js's.
    // `outdoors` is room-outdoors.js's, or null.
    tick(hear, ear, outdoors = null) {
      if (!eng()?.loopSound || ear.now < nextMix) return;
      nextMix = ear.now + MIX_MS;
      const mix = windowMix(hear, ear);
      if (ear.pose && eng().setListenerPose) { eng().setListenerPose({ ...ear.pose, vel: [0, 0, 0], metresPerUnit: 1 }); posed = true; }
      const spot = posed ? ear.spot : null;
      for (const id of ROOM_BEDS) setBed(id, mix[id] || 0, ear.now, spot);

      // the birds and the surf round the building
      if (outdoors) {
        const o = outdoors.due(Date.now(), ear.hour, ear.wx, hear.wind || 0);
        playCalls(o.calls, ear, spot);
        setSurf(o.shore, ear, spot);
      }

      // the aircraft going over, only once the ear has a pose to place them against
      if (posed) setFlights(hear.flights, ear);

      // the thunder, the time after the flash that its distance says
      const b = hear.thunder;
      if (b && b.seed !== thunder) {
        thunder = b.seed;
        const pan = Math.sin(b.bearing - ear.look), through = ear.annex ? 0.2 : 0.55 + 0.45 * Math.max(ear.open || 0, Math.exp(-ear.near / 5));
        // through the glass: a few metres outside the nearest opening, or panned to its bearing with no window
        const at = spot ? where(spot, 6) : { pan };
        later(thunderDelay(b.dist) * 1000, () => { const def = cue(b.dist < 18 ? 'room-thunder' : 'room-thunder-far'); if (def) eng()?.playSfx(def, through * (0.5 + 0.5 * Math.exp(-b.dist / 30)) * 0.6, at); });
      }
    },
    stop() {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const id of live.keys()) eng()?.stopLoop?.(`window:${id}`);
      live.clear();
      if (surf) { eng()?.stopLoop?.('window:surf'); surf = null; }
      for (const id of flying.keys()) eng()?.stopLoop?.(id);
      flying.clear();
      if (posed) { try { eng()?.setListenerPose?.(null); } catch { /* no audio */ } posed = false; }
    },
  };
}
