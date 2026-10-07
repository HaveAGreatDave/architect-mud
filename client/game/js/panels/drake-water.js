// The Drake on the water: a boat hull, with the rear rotor for a screw.
//
// Every water landing is made GEAR UP, on the hull. Feet out on the water dig in: above a crawl they
// tear off. Once she is down and floating, the mode selector's BOAT gate (cockpit.js) puts the tail
// rotor to work as a pusher and she runs along the surface; in deep enough water the SUB gate floods
// the ballast.
//
//   air        flying, over water or land
//   float      on the water on her hull (gear up): drag, a rocking ride, wave strikes
//   dig        on the water with the feet out: heavy drag
//   submerged  under (the server says so: plugins/submersible)
//
// What hurts:
//   · the feet SNAP (off until a hangar repairs them) on a gear-down water touchdown above a crawl;
//   · the HULL takes a fast or hard arrival and every hard wave strike while she is moving.
// The server owns the hull (flightevent wave / footsnap); this file only decides what happened.
//
// ⚠ THE SEA IS THE ONE THE RENDERER DRAWS. Heights and slopes come from client/shared/sea-swell.js
// with the renderer's own amplitudes (seaAmpsNow, scaled by the mesh's gain where she floats) and
// the shared clock (seaClock), sampled in the MAP WINDOW'S frame, not the world's (seaFramePos).
import { seaHeight, seaSlope, seaClock } from '../../../shared/sea-swell.js';

// Below this she has stopped and floats.
export const FLOAT_KT = 12;
// Height under which the feet come out by themselves over LAND (there is no hull to land on there).
export const SKI_AGL_FT = 60;
// Under this speed a hull arrival never costs anything and neither does a wave. Only a
// ditching-grade drop still counts.
export const SLOW_SAFE_KT = 35;
// Knots over which feet out on the water tear off at touchdown.
export const FEET_WATER_KT = 15;
// Sink rate over which any water arrival is a ditching.
export const DITCH_FPM = 1600;
// BOAT MODE: the tail rotor as a pusher. Top speed on the surface and under it, knots.
export const BOAT_MAX_KT = 48, SUB_MAX_KT = 14;
// Tiles per second of vertical closing speed between hull and water that a strike starts to hurt.
// At 0.10 an ordinary swell hurt her every second she was moving; only a real sea should.
const WAVE_FREE = 0.30;
// How far the wall clock may run past the frame's dt, in seconds, before the water under her is a
// jump rather than a frame: the bar stepBoat (flight-model.js) uses for the hydro.
const SEA_JUMP_S = 0.1;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Where she is in the frame the sea is drawn in. gl/water.js and gl/floor.js sample the swell at
// window-relative positions (`uA + aOff`, no window centre added), which is the cockpit's
// `mapOffset`: her world tile less the map window's centre.
export function seaFramePos(F) {
  const c = F.mapCenter;
  return { x: F.pos.x - (c?.x || 0), y: F.pos.y - (c?.y || 0) };
}

// The sea state as one number 0..1 off the amplitudes (the swell dominates what a hull feels).
export function seaRough(amps) {
  if (!amps) return 0;
  return clamp((amps.roll || 0) * 2.2 + (amps.wind || 0) * 1.4 + (amps.chop || 0) * 0.8, 0, 1);
}

// The water under a point: height, the slope along a heading, and how fast the surface is rising
// there, all in tiles. `hdg` in degrees, world +y is south as everywhere in the sim.
export function seaUnder(x, y, hdg, amps, nowMs) {
  const t = seaClock(nowMs), r = amps?.roll || 0, w = amps?.wind || 0, a = amps?.chop || 0;
  const h = seaHeight(x, y, t, r, a, w);
  const h2 = seaHeight(x, y, t + 0.05, r, a, w);
  const sl = seaSlope(x, y, t, r, a, w);
  const hd = hdg * Math.PI / 180, fx = Math.sin(hd), fy = -Math.cos(hd);
  const along = (sl?.[0] || 0) * fx + (sl?.[1] || 0) * fy;
  const across = (sl?.[0] || 0) * -fy + (sl?.[1] || 0) * fx;
  return { h, rise: (h2 - h) / 0.05, along, across };
}

// Judge a touchdown on the water. Returns what happened; the caller applies it.
//   { ditch }            — too hard: a ditching like any other aircraft
//   { snap, hullPct }    — the feet were out and tore off
//   { hullPct }          — hull damage (a fast or rough arrival)
//   {}                   — a clean landing
export function judgeWaterTouchdown({ sinkFpm, kt, gearDown, feetGone, rough }) {
  if (sinkFpm > DITCH_FPM) return { ditch: true };
  if (gearDown && !feetGone && kt > FEET_WATER_KT) return { snap: true, hullPct: Math.round(4 + kt / 10) };
  if (kt < SLOW_SAFE_KT && sinkFpm < 600) {
    const wear = Math.round(rough * 5 + Math.max(0, sinkFpm - 300) / 100 * rough);
    return wear >= 1 ? { hullPct: wear } : {};
  }
  if (kt < SLOW_SAFE_KT) return {};
  const pct = Math.round(2 + Math.max(0, sinkFpm - 150) / 60 + rough * 10 + Math.max(0, kt - 40) / 8);
  return { hullPct: clamp(pct, 1, 40) };
}

// BUOYANCY CONTROL (B on the water, D.stab; on unless switched off): the trim tanks fight the swell,
// so the hull follows only a small, slow share of it and the cockpit stops see-sawing. The sea is
// still the renderer's, and wave strikes still hurt; only the ride the eye feels is damped.
export const STAB_TILT = 0.2, STAB_HEAVE = 0.35, STAB_TAU_S = 1.6;
function stabilise(W, raw, dt) {
  const r = W.stab || (W.stab = { heave: raw.heave * STAB_HEAVE, pitch: 0, roll: 0 });
  const k = 1 - Math.exp(-Math.max(0, dt) / STAB_TAU_S);
  r.heave += (raw.heave * STAB_HEAVE - r.heave) * k;
  r.pitch += (raw.pitch * STAB_TILT - r.pitch) * k;
  r.roll += (raw.roll * STAB_TILT - r.roll) * k;
  return { heave: r.heave, pitch: r.pitch, roll: r.roll };
}

// One frame of the Drake on (or over) the water. Returns what the cockpit should apply:
// { drag (kt/s off airspeed), hullPct, snap, ride {heave, pitch, roll}, autoGearDown, gearWarn }.
// `tilesPerKt` is how far one knot carries her in a second on the surface.
export function drakeWaterFrame(F, s, dt, nowMs, amps, tilesPerKt) {
  const D = F.dk;
  const W = D.water || (D.water = { phase: 'air', hitCd: 0 });
  // `waterBelow` (cockpit.js) is the server's biome OR the client's own seabed depth: off the edge of the
  // authored map the server's answer is empty, and the sea there is still sea.
  const overWater = (F.waterBelow ?? F.biomeBelow === 'water') && !F.onYacht;
  const gearDown = !F.gearRetract || !F.gearUp;
  const feetGone = !!D.feetGone;
  const kt = Math.max(0, s.airspeed || 0);
  const agl = (s.altitude || 0) - (s.groundFt || 0);
  const out = { drag: 0, hullPct: 0, snap: false, ride: null, autoGearDown: false, gearWarn: false };
  W.hitCd = Math.max(0, W.hitCd - dt);

  if (!overWater || !s.onGround) W.phase = 'air';
  else W.phase = gearDown && !feetGone ? 'dig' : 'float';
  if (D.submerged > 0 && overWater && s.onGround) W.phase = 'submerged';
  D.onWater = overWater && s.onGround;
  // Over land the feet come out by themselves for a landing; over water they must be UP.
  if (!overWater && !s.onGround && !feetGone && F.gearRetract && F.gearUp && agl < SKI_AGL_FT && (s.vs || 0) < -150) out.autoGearDown = true;
  if (overWater && !s.onGround && gearDown && !feetGone && agl < SKI_AGL_FT && (s.vs || 0) < -150) out.gearWarn = true;

  if (!D.onWater) return out;
  // Under water the pusher drives her in BOAT/SUB; otherwise the water stops her.
  if (W.phase === 'submerged') { out.drag = D.boat ? 0 : 6 + kt * 0.6; return out; }
  out.drag = D.boat && W.phase === 'float' ? 0 : W.phase === 'dig' ? 10 + kt * 0.3 : 6 + kt * 0.12;

  // ⚠ IN THE MAP WINDOW'S FRAME, NOT THE WORLD'S. Sampled at `F.pos`, her world tile, she rode a
  // stretch of sea nobody draws, in phase with the picture only by luck (boat-view.js had the same).
  const at = seaFramePos(F);
  const sea = seaUnder(at.x, at.y, s.heading || 0, amps, nowMs);
  // `rise` is the sea's own rate at one instant, never a difference across frames, so neither a
  // recentre nor a hitch can read as a steep rise here: the strike needs no guard.
  const closing = sea.rise + kt * (tilesPerKt || 0) * sea.along;
  const rel = Math.abs(closing);
  if (rel > WAVE_FREE && W.hitCd <= 0 && kt >= SLOW_SAFE_KT) {
    W.hitCd = 1.1;
    out.hullPct = clamp(Math.round((rel - WAVE_FREE) * 60), 1, 15);
  }
  const raw = { heave: sea.h, pitch: Math.atan(sea.along) * 180 / Math.PI * 0.8, roll: Math.atan(sea.across) * 180 / Math.PI * 0.8 };
  // ⚠ A RECENTRE OR A HITCH IS A NEW SEA UNDER HER. The drawn sea jumps when the map window
  // recentres (it's in the window's frame) and when the wall clock runs past a capped dt. The
  // stabiliser is the one thing here that remembers the water, and it eased her toward the new sea
  // over STAB_TAU_S while the picture had already jumped. So it moves by its share of the jump and
  // she keeps her attitude to the water, as shiftBoatOrigin (flight-model.js) keeps the hydro's height.
  const cx = F.mapCenter?.x || 0, cy = F.mapCenter?.y || 0;
  if (W.stab && W.raw && (cx !== W.cx || cy !== W.cy || Math.abs((nowMs - W.nowMs) / 1000 - dt) > SEA_JUMP_S)) {
    W.stab.heave += (raw.heave - W.raw.heave) * STAB_HEAVE;
    W.stab.pitch += (raw.pitch - W.raw.pitch) * STAB_TILT;
    W.stab.roll += (raw.roll - W.raw.roll) * STAB_TILT;
  }
  W.raw = raw; W.cx = cx; W.cy = cy; W.nowMs = nowMs;
  out.ride = D.stab === false ? raw : stabilise(W, raw, dt);
  return out;
}

// The feet's anim channels for the mesh (mesh_drake.json: ski, paddle, paddleL, feetGone). The feet
// neither ski nor paddle any more, so those channels are held at the mesh's rest pose.
export function drakeFeetAnim(D) {
  return { ski: 0, paddle: 0.3, paddleL: 0.3, feetGone: D.feetGone ? 1 : 0, brake: 0, skid: 0 };
}
