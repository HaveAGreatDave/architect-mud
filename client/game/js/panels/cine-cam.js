// LOCKED CINEMATIC SHOTS on foot in GLASS (freelook-view.js owCineTick): now and then the camera is taken off you for a
// few seconds and set where a shot wants it, in first person (your own eyes, aimed) or third (stood back from you and
// looking at you), and handed back where you were looking when it's over. Walking and looking are held while it runs;
// Escape ends it. This file is pure: a list of keys in, a pose for a time out. It draws nothing and knows no place.
//
// A sequence is keys in time order, each { t, ...fields }, eased between with smoothstep:
//   t        seconds from the start
//   pitch    degrees, up positive (the free camera takes radians: owCineTick converts); null is where you were looking when it started
//   yaw      degrees added to where you were facing when it started
//   back     metres the camera stands behind you (0 is your eyes: first person)
//   up       metres it stands above your eyes
//   form     0 to 1, anything a shot wants faded in (the In Between's outline forming); held, not eased, past the last key
//   clip     the clip your body plays from this key on (not eased; its phase runs from the key's own t)
//   cut      true: jump to this key, no easing from the one before
// The last key's t is the end. A key leaving a field out keeps the one before's.
const FIELDS = ['pitch', 'yaw', 'back', 'up', 'form'];
const smooth = (x) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };

export function cinePose(keys, t, from = { pitch: 0 }) {
  if (!keys?.length) return null;
  const end = keys[keys.length - 1].t;
  if (t >= end) return null;
  // every key filled in from those before it, so easing never reads a hole
  const full = [];
  let prev = { pitch: null, yaw: 0, back: 0, up: 0, form: 1, clip: null, clipT: 0 };
  for (const k of keys) {
    const f = { ...prev, t: k.t, cut: !!k.cut };
    for (const n of FIELDS) if (k[n] !== undefined) f[n] = k[n];
    if (k.clip !== undefined) { f.clip = k.clip; f.clipT = k.t; }
    full.push(f); prev = f;
  }
  let i = 0;
  while (i < full.length - 1 && full[i + 1].t <= t) i++;
  const a = full[i], b = full[i + 1] || a;
  const e = b === a || b.cut ? 0 : smooth((t - a.t) / Math.max(1e-6, b.t - a.t));
  const P = (k) => (k.pitch == null ? from.pitch || 0 : k.pitch);
  const mix = (x, y) => x + (y - x) * e;
  return { pitch: mix(P(a), P(b)), yaw: mix(a.yaw, b.yaw), back: mix(a.back, b.back), up: mix(a.up, b.up), form: mix(a.form, b.form),
    clip: a.clip, clipAt: t - a.clipT, t, end };
}

// A VOID ROOM'S ARRIVAL (gl/room-void.js, 12 s; the In Between's, `flags.room.cine: 'arrival'`): the points gather into
// a body 2.4 m ahead of you for ten seconds and rush into your eyes at 10 to 11.6. You watch it level and still; as it comes into you the camera tips down to your own
// hands held out in front of you, and your outline prints in over them from the fingertips back. Then it stands back
// behind you and a little up, so you see the whole of you standing in the white with the attendant ahead, and comes
// back into your eyes.
export const ARRIVAL_SHOTS = Object.freeze([
  { t: 0, pitch: 0, form: 0 },
  { t: 9.8, pitch: 0 },
  { t: 10.2, clip: 'handsOut' },
  { t: 11.4, pitch: -50, form: 0 },
  { t: 13.6, form: 1 },
  { t: 15.2, pitch: -52 },
  { t: 15.2, cut: true, back: 2.6, up: 0.5, pitch: -12, yaw: 28, clip: null },
  { t: 18.4, back: 3.2, up: 0.7, pitch: -14, yaw: 10 },
  { t: 19.6, back: 0, up: 0, pitch: 0, yaw: 0 },
  { t: 19.7 },
]);

// the sequences a room can name (`flags.room.cine`)
export const CINE_SHOTS = Object.freeze({ arrival: ARRIVAL_SHOTS });
