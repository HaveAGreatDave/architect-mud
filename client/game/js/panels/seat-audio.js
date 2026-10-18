// SEAT AUDIO: where other vehicles' sound comes from, in a GLASS seat.
//
// A seat's world is drawn in 3D and was heard in stereo at best, so an aircraft crossing the nose
// or a rig overtaking on the left made no sound at all. This file gives each nearby contact an
// engine voice placed where the contact is, with doppler, through SIREN's positioned path
// (`position` on loopSound and playSfx, setListenerPose; see docs/systems-procedural-audio.md).
//
// windshield.js calls seatAudioFrame once per paint with the view it is drawing, so every seat
// that paints contacts (the cockpit, the cab, the boats, the podracer) is covered by one call.
//
// THE FRAME. The origin is the player's own vehicle (`acX`/`acY`), the axes are world tiles (x
// east, y south) and z is up in tiles. A contact's dx/dy are already in it, and seatSpot turns an
// absolute tile (a lightning strike, an AA battery) into it. Because the origin moves with the
// vehicle, the listener's velocity is zero and a contact's velocity is the closing speed, which is
// what doppler wants.
//
// The map's y runs south, so the frame is left-handed: the pose passes `right` itself.
//
// BUDGET. The nearest CONTACT_MAX contacts in CONTACT_RANGE get a voice, each one loop on the
// ambient bus at priority 1, so a cue that matters steals it first. The pose and positions are
// sent at most every UPDATE_MS. When the seat stops painting (closed, or a hidden tab that froze
// rAF) the watchdog lets every voice go and resets the pose.

const AE = () => (typeof window !== 'undefined' ? window.AudioEngine : null);

const M_PER_TILE = 17.9;        // a tile is about 18 m (see glass/street-life.js)
const FT_TO_TILES = 0.3048 / M_PER_TILE;
const CONTACT_MAX = 3;
const CONTACT_RANGE = 30;       // tiles
const UPDATE_MS = 33;
const STALE_MS = 700;           // no paint for this long and the seat has gone
const OWNER_MS = 500;           // another view id can take over after the owner goes quiet this long

// One engine voice per kind of vehicle. Two or three layers each, kept cheap: a contact is a
// detail on the horizon most of the time. The attack and release are the fade in and out.
const FADE = { a: 0.8, d: 0, s: 1, r: 0.9 };
const VOICES = {
  prop: [
    { waveform: 'sawtooth', freq: 96, filter: { type: 'lowpass', freq: 650, q: 1 }, tremolo: { rate: 22, depth: 0.4 }, adsr: FADE, gain: 0.12 },
    { waveform: 'noise', noiseMix: 1, noise: 'pink', filter: { type: 'bandpass', freq: 900, q: 0.6 }, adsr: FADE, gain: 0.07 },
  ],
  light: [   // an ultralight's two-stroke: higher, buzzier
    { waveform: 'sawtooth', freq: 150, filter: { type: 'lowpass', freq: 1200, q: 1.2 }, tremolo: { rate: 30, depth: 0.3 }, adsr: FADE, gain: 0.09 },
    { waveform: 'noise', noiseMix: 1, noise: 'pink', filter: { type: 'bandpass', freq: 1400, q: 0.7 }, adsr: FADE, gain: 0.05 },
  ],
  heli: [    // blade slap: a deep amplitude chop on a low body
    { waveform: 'triangle', freq: 62, filter: { type: 'lowpass', freq: 400, q: 1 }, tremolo: { rate: 17, depth: 0.8 }, adsr: FADE, gain: 0.14 },
    { waveform: 'noise', noiseMix: 1, noise: 'pink', filter: { type: 'bandpass', freq: 520, q: 0.7 }, tremolo: { rate: 17, depth: 0.7 }, adsr: FADE, gain: 0.08 },
  ],
  jet: [     // a roar and a thin turbine whine over it
    { waveform: 'noise', noiseMix: 1, noise: 'pink', filter: { type: 'bandpass', freq: 650, q: 0.5 }, adsr: FADE, gain: 0.13 },
    { waveform: 'noise', noiseMix: 1, noise: 'brown', filter: { type: 'lowpass', freq: 280, q: 0.6 }, adsr: FADE, gain: 0.09 },
    { waveform: 'sine', freq: 2400, adsr: FADE, gain: 0.018 },
  ],
  truck: [   // a big diesel's chug, and its tyres on the road
    { waveform: 'sawtooth', freq: 44, filter: { type: 'lowpass', freq: 360, q: 1.2 }, tremolo: { rate: 9, depth: 0.45 }, adsr: FADE, gain: 0.14 },
    { waveform: 'noise', noiseMix: 1, noise: 'brown', filter: { type: 'lowpass', freq: 520, q: 0.7 }, adsr: FADE, gain: 0.09 },
  ],
  boat: [    // an outboard's drone and the spray off the hull
    { waveform: 'sawtooth', freq: 72, filter: { type: 'lowpass', freq: 700, q: 1 }, tremolo: { rate: 14, depth: 0.3 }, adsr: FADE, gain: 0.11 },
    { waveform: 'noise', noiseMix: 1, noise: 'white', filter: { type: 'highpass', freq: 2200, q: 0.5 }, adsr: FADE, gain: 0.035 },
  ],
};
const CLASS_VOICE = {
  ultralight: 'light', grasshopper: 'light',
  prop: 'prop', locust: 'prop', divebomber: 'prop', wreck: 'prop', drake: 'prop',
  heli: 'heli',
  heavy: 'jet', gunship: 'jet',
  truck: 'truck',
  hydro: 'boat',
};
// A contact's voice: its class's, a boat's for any hull, a prop's otherwise.
export function voiceOf(c) {
  const k = CLASS_VOICE[c && c.cls];
  if (k) return k;
  if (c && (c.boat || c.hull || /boat|hull|yacht|skiff/.test(String(c.cls || '')))) return 'boat';
  return 'prop';
}

const S = { owner: null, ownerAt: 0, lastAt: 0, sentAt: 0, ox: 0, oy: 0, live: false, voices: new Map(), dog: null };

// A contact's position in the frame, in tiles.
function contactPos(c) {
  const z = c.groundZ === 0 ? 0 : (+c.altDiff || 0) * FT_TO_TILES;
  return [+c.dx || 0, +c.dy || 0, z];
}

function stopVoice(id) {
  const ae = AE();
  try { ae?.stopLoop?.(id); } catch { /* audio is never load-bearing */ }
  S.voices.delete(id);
}

export function seatAudioStop() {
  for (const id of [...S.voices.keys()]) stopVoice(id);
  if (S.dog) { clearInterval(S.dog); S.dog = null; }
  S.live = false; S.owner = null;
  try { AE()?.setListenerPose?.(null); } catch { /* no audio */ }
}

function watchdog() {
  if (S.dog) return;
  S.dog = setInterval(() => {
    if (performance.now() - S.lastAt > STALE_MS) seatAudioStop();
  }, 250);
}

// One paint of a seat's view. `id` is the windshield's view id; `vw` the view it is drawing (with
// its look direction already in `heading`). A mirror (`bare`) never drives the listener.
export function seatAudioFrame(id, vw, now = performance.now()) {
  const ae = AE();
  if (!ae?.setListenerPose || !vw || vw.bare) return;
  if (S.owner && S.owner !== id && now - S.ownerAt < OWNER_MS) return;
  S.owner = id; S.ownerAt = now; S.lastAt = now;
  if (now - S.sentAt < UPDATE_MS) return;
  S.sentAt = now;
  S.ox = +vw.acX || 0; S.oy = +vw.acY || 0;
  const h = (+vw.heading || 0) * Math.PI / 180, sh = Math.sin(h), ch = Math.cos(h);
  try {
    ae.setListenerPose({ pos: [0, 0, 0], fwd: [sh, -ch, 0], up: [0, 0, 1], right: [ch, sh, 0], vel: [0, 0, 0], metresPerUnit: M_PER_TILE });
  } catch { return; }
  S.live = true;
  watchdog();

  // The nearest few contacts with an id, in range.
  const want = new Map();
  const list = Array.isArray(vw.contacts) ? vw.contacts : [];
  const near = [];
  for (const c of list) {
    if (!c || c.id == null) continue;
    const r = Number.isFinite(c.rng) ? c.rng : Math.hypot(+c.dx || 0, +c.dy || 0);
    if (r <= CONTACT_RANGE) near.push([r, c]);
  }
  near.sort((a, b) => a[0] - b[0]);
  for (const [, c] of near.slice(0, CONTACT_MAX)) want.set('seat-ct-' + c.id, c);

  for (const id2 of [...S.voices.keys()]) if (!want.has(id2)) stopVoice(id2);
  for (const [lid, c] of want) {
    const pos = contactPos(c);
    const kind = voiceOf(c);
    const had = S.voices.get(lid);
    // a different kind, or a loop the pool stole: start it again
    if (had && (had !== kind || !ae.loopState?.(lid))) stopVoice(lid);
    if (!S.voices.has(lid)) {
      try {
        ae.loopSound({ id: lid, category: 'ambient', priority: 1, config: { gain: 1, layers: VOICES[kind] } },
          { position: pos, ref: 1.5, rolloff: 1, maxDistance: CONTACT_RANGE * 2 });
        // a full pool drops it; it's asked for again next frame
        if (ae.loopState?.(lid)) S.voices.set(lid, kind);
      } catch { /* no audio */ }
    } else {
      try { ae.moveLoop(lid, pos); } catch { /* no audio */ }
    }
  }
}

// An absolute world tile as a `position` option in the seat's frame, or null when no seat is
// painting (the caller then plays it the old way). `z` is in tiles.
export function seatSpot(x, y, z = 0) {
  if (!S.live || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x - S.ox, y - S.oy, z];
}
// Whether a seat is painting, for a caller that already has a position in the frame.
export const seatLive = () => S.live;

// For a console check: what the seat is voicing.
if (typeof window !== 'undefined') window.__seatAudio = { state: () => ({ owner: S.owner, live: S.live, voices: [...S.voices] }), VOICES, CLASS_VOICE };
