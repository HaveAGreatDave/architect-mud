// THE WEATHER, HEARD FROM A ROOM. Plays client/shared/room-sfx.js: rain and wind at what `windowMix` says for
// where you're standing, and the thunder after the flash. Nothing here reaches the server; it's what
// room-window.js says is out there, through this room's glass.
//
// ⚠ THIS IS A VIEW'S SOUND, SO IT'S ALL OVER WHEN THE VIEW IS. `stop` has to take every loop with it, and
// a queued thunderclap, or a closed room carries on raining. It runs on top of the zone's own weather beds
// (plugins/audio), which a closed flat barely hears.

import { BUILTINS, ROOM_BEDS, windowMix } from '../../../shared/room-sfx.js';
import { thunderDelay } from '../../../shared/window-sky.js';

// how often the mix is worked out, and how long a silent bed is kept before it gives its voice back
const MIX_MS = 250, RAMP = 0.9, IDLE_MS = 6000;

export function createRoomSound() {
  const eng = () => window.AudioEngine;
  const cue = (id) => window.SFXCatalog?.get?.(id) || BUILTINS.find((d) => d.id === id);
  const live = new Map();   // bed id -> { gain, idleSince }
  const timers = new Set();
  let nextMix = 0, thunder = -1, stopped = false;

  function setBed(id, want, now) {
    const A = eng(), b = live.get(id);
    if (!b) {
      if (want < 0.01) return;
      const def = cue(id);
      if (!def) return;
      A.loopSound({ ...def, id: `window:${id}` }, { whole: true, gain: 0 });
      live.set(id, { gain: -1, idleSince: 0 });
      return setBed(id, want, now);
    }
    if (Math.abs(want - b.gain) > 0.008) { A.setLoopGain(`window:${id}`, want, RAMP); b.gain = want; }
    if (want >= 0.01) { b.idleSince = 0; return; }
    b.idleSince ||= now;
    if (now - b.idleSince > IDLE_MS) { A.stopLoop(`window:${id}`); live.delete(id); }
  }

  function later(ms, fn) { const t = setTimeout(() => { timers.delete(t); if (!stopped) fn(); }, ms); timers.add(t); }

  return {
    // once a frame; it only does anything a few times a second. `hear` is room-window.js's.
    tick(hear, ear) {
      if (!eng()?.loopSound || ear.now < nextMix) return;
      nextMix = ear.now + MIX_MS;
      const mix = windowMix(hear, ear);
      for (const id of ROOM_BEDS) setBed(id, mix[id] || 0, ear.now);

      // the thunder, the time after the flash that its distance says
      const b = hear.thunder;
      if (b && b.seed !== thunder) {
        thunder = b.seed;
        const pan = Math.sin(b.bearing - ear.look), through = ear.annex ? 0.2 : 0.55 + 0.45 * Math.max(ear.open || 0, Math.exp(-ear.near / 5));
        later(thunderDelay(b.dist) * 1000, () => { const def = cue(b.dist < 18 ? 'room-thunder' : 'room-thunder-far'); if (def) eng()?.playSfx(def, through * (0.5 + 0.5 * Math.exp(-b.dist / 30)) * 0.6, { pan }); });
      }
    },
    stop() {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const id of live.keys()) eng()?.stopLoop?.(`window:${id}`);
      live.clear();
    },
  };
}
