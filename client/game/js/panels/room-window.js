// WHAT'S GOING ON PAST THE GLASS OF A ROOM, once a frame: the weather as it stands, the sea, the flights
// and any lightning, as the numbers gl/room-sky.js draws and panels/room-sound.js plays.
//
// The server says what the weather is (`room_sky`, every so often, plugins/roomstage) and who's really
// flying. Everything between those is here: the amounts ease so a shower arrives and leaves, and a real
// aircraft is carried along by its own speed until the next word.
//
// ⚠ A DIRECTION GOES OUT IN THE ROOM'S FRAME. The world is east, up and north here and the room's axes
// are its front and right, so `toRoom` is the only place the two meet.
// ⚠ `t` IS THE WALL CLOCK, so two people at one window see one sky. It's kept small for the shader by
// `ROLL`, a whole number of the clock's slots.

import { airTraffic } from '../../../shared/window-sky.js';
import { strikesAfter } from '../../../shared/strike-feed.js';
import { growBolt, boltBright, boltSeed } from '../../../shared/lightning.js';
import { FLIGHT_EYE_H, FLIGHT_CLIMB_LIFT, FLIGHT_HEIGHT_FT } from '../../../shared/flight-height.js';
import { TILE_M, FT_M } from '../../../shared/world-scale.js';

const ROLL = 3600;
// how fast a change in the weather comes through, per second
const EASE = 0.5, WET_UP = 0.25, WET_DOWN = 0.012;
// weather that's a storm with lightning in it, and how much of the sky each word covers
const STORM = { thunderstorm: 0.7, storm: 1, blizzard: 0.25 };
const COVER = { clear: 0.06, sunny: 0.06, fair: 0.14, partly_cloudy: 0.32, cloudy: 0.55, overcast: 0.75, fog: 0.45, haze: 0.3, drizzle: 0.65, rain: 0.8, sleet: 0.8, snow: 0.8, thunderstorm: 0.95, storm: 1, blizzard: 1, acid: 0.85 };
const SNOWY = new Set(['snow', 'blizzard']);
const CLASS = { plane: 'prop', heli: 'heli', jet: 'heavy' };
// a height in tiles as the feet a contact carries (client/shared/flight-height.js, the other way)
const ftOf = (z) => Math.max(0, (z - FLIGHT_EYE_H) / FLIGHT_CLIMB_LIFT) ** 2 * FLIGHT_HEIGHT_FT;
const ease = (a, b, k) => a + (b - a) * Math.min(1, k);

// How near a real strike has to be to light the room, and for how long, in seconds.
const STRIKE_SEEN_TILES = 50, STRIKE_LIT_S = 1.1;

export function createRoomWindow() {
  let at = null;            // { gx, gy, eyeZ, eyeX, eyeY, fields }
  let word = 'clear', wantRain = 0, wantSnow = 0, windKph = 0, windDir = 220, storm = 0;
  let rain = 0, snow = 0, wet = 0, wind = 0, cover = 0.1, seaShare = 0, lastT = 0, strikeSeq = 0, strike = null, bolt = null, told = false;
  const hear = { rain: 0, snow: 0, wind: 0, storm: 0, thunder: null, sea: 0, flights: [] };
  let flightsAt = 0;

  function weather(sky) {
    if (!sky) return;
    word = String(sky.weather || word).toLowerCase();
    if (Number.isFinite(sky.wind)) windKph = sky.wind;
    const dir = sky.windDir ?? sky.field?.wind?.dir;
    if (Number.isFinite(dir)) windDir = dir;
    const type = String(sky.here?.precipType || 'none'), rate = Number(sky.here?.precipRate) || 0, snowy = SNOWY.has(type) || type === 'sleet' && rate < 0.3;
    wantRain = snowy ? 0 : rate;
    wantSnow = snowy ? rate : 0;
    storm = STORM[word] ?? (sky.event?.type === 'ion_storm' ? 0.5 : 0);
    // a room opened in a storm is in it already: only a change comes through slowly
    if (!told) { told = true; settle(); }
  }
  function settle() { rain = wantRain; snow = wantSnow; wind = Math.min(1, windKph / 70); cover = COVER[word] ?? 0.4; wet = Math.min(1, rain * 1.4 + snow * 0.5); }

  // The eye and the room's axes turn a world direction into the room's.
  const toRoom = (E, U, N, L, bearing) => {
    const r = bearing * Math.PI / 180, s = Math.sin(r), c = Math.cos(r), fw = s * E + c * N, rt = c * E - s * N, F = L.f, R = L.r;
    return [F[0] * fw + R[0] * rt, U, F[2] * fw + R[2] * rt];
  };
  const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  // The timetable as contacts, which GLASS draws as it draws anybody flying: a real model with real lights.
  function flightsNow() {
    if (!at) return [];
    return airTraffic(at.fields, at.gx, at.gy, Date.now() / 1000).map((f) => ({
      id: 'sched_' + f.id, x: f.x, y: f.y, alt: ftOf(f.z), hdg: Math.atan2(f.vx, -f.vy) * 180 / Math.PI, ias: Math.hypot(f.vx, f.vy) * 20,
      cls: CLASS[f.kind], reg: '', bank: 0, pitch: f.pitch, vs: f.vz, hullPct: 100, band: 'mid',
    }));
  }

  // The timetable as room-sound.js hears it: each flight's place and velocity in metres on the room's
  // floor plan (u across, v back from the front glass, z up), the frame its listener pose is in. The
  // front looks out on `bearing`, so out of the front is −v and its right is +u.
  function heardFlights(t, bearing) {
    if (!at) return [];
    const b = (bearing || 0) * Math.PI / 180, s = Math.sin(b), c = Math.cos(b);
    const plan = (e, n) => [c * e - s * n, -(s * e + c * n)];
    const sched = airTraffic(at.fields, at.gx, at.gy, t).map((f) => {
      const [u, v] = plan((f.x - at.gx) * TILE_M, (at.gy - f.y) * TILE_M), [du, dv] = plan(f.vx * TILE_M, -f.vy * TILE_M);
      return { id: f.id, cls: CLASS[f.kind], pos: [u, v, ftOf(f.z) * FT_M], vel: [du, dv, 0] };
    });
    // …and whatever the server put in the sky (a pilot, a helicopter going over): absolute tiles,
    // carried along between its words, so no `vel` and SIREN works the speed out from the moves
    let live = [];
    try { live = (pilotsOf?.() || []).filter((c) => c && c.id != null && Number.isFinite(c.dx) && Number.isFinite(c.dy)).map((c) => {
      const [u, v] = plan((c.dx - at.gx) * TILE_M, (at.gy - c.dy) * TILE_M);
      return { id: 'live_' + c.id, cls: c.cls, pos: [u, v, (c.groundZ === 0 ? 0 : +c.altDiff || 0) * FT_M], vel: null };
    }); } catch { /* the sky is never load-bearing */ }
    return sched.concat(live);
  }
  let pilotsOf = null;

  // The strike lighting the sky now: its picture is painted once, when it starts.
  function boltAt(t) {
    if (!at) { bolt = null; strike = null; hear.thunder = null; return null; }
    for (const s of strikesAfter(strikeSeq)) {
      strikeSeq = s.seq;
      const dist = Math.hypot(s.gx - at.gx, s.gy - at.gy);
      if (dist >= STRIKE_SEEN_TILES) continue;
      const seed = boltSeed(s.gx, s.gy, s.at);
      strike = { seed, dist, at: s.at / 1000, bearing: Math.atan2(s.gx - at.gx, at.gy - s.gy) };
      bolt = growBolt(seed, { gens: 2, segs: 6 });
      hear.thunder = strike;
    }
    if (!strike) return null;
    const age = t - strike.at;
    if (age >= STRIKE_LIT_S) { strike = null; bolt = null; return null; }
    return { flash: Math.max(bolt ? boltBright(bolt, age * 1000).ch * 0.6 : 0, Math.exp(-age * 3.6) * 0.5) * (0.45 + 0.55 * Math.exp(-strike.dist / 26)) };
  }
  return {
    weather, flightsNow, hear, settle,
    // who's really flying, for the hearing: a function returning the contacts as absolute tiles in dx/dy
    hearPilots(fn) { pilotsOf = fn; },
    // where the eye is, in the world: a room's tile, and `fields` for its flights
    setPlace(p) { at = { ...(at || {}), ...p }; },
    // how much of the view is the sea, once the shots are in: it's what you hear from the water
    setSeaShare(k) { seaShare = k; },
    // one frame's numbers. `h` is the hour, `day` 0..1. Returns the `outside` gl/room.js takes.
    frame(now, h, day, L, bearing) {
      const t = (Date.now() / 1000), dt = Math.min(0.25, lastT ? t - lastT : 0.05), k = EASE * dt;
      lastT = t;
      rain = ease(rain, wantRain, k); snow = ease(snow, wantSnow, k);
      wind = ease(wind, Math.min(1, windKph / 70), k);
      cover = ease(cover, COVER[word] ?? 0.4, k * 0.5);
      wet = rain + snow > wet ? ease(wet, Math.min(1, rain * 1.4 + snow * 0.5), WET_UP * dt) : Math.max(0, wet - WET_DOWN * dt);
      const r = windDir * Math.PI / 180, windV = [Math.sin(r), Math.cos(r)];
      // the sun's bearing through the day, or the moon's round the other way
      const sunUp = Math.sin((h - 6) / 12 * Math.PI), az = (h - 12) / 12 * Math.PI;
      const up = Math.max(0.08, Math.abs(sunUp)), hx = Math.sqrt(1 - up * up), sunW = [Math.sin(az) * hx * (sunUp > 0 ? 1 : -1), up, Math.cos(az) * hx * (sunUp > 0 ? 1 : -1)];
      const clear = 1 - 0.8 * cover, glint = sunUp > 0 ? [1.6, 1.42, 1.12] : [0.32, 0.36, 0.46];
      const g = day * (1 - cover * 0.55), ck = 0.1 + 0.72 * g;
      const b = boltAt(t), flash = b?.flash ?? 0;
      hear.rain = rain; hear.snow = snow; hear.wind = wind; hear.storm = storm; hear.sea = seaShare;
      if (t - flightsAt > 0.2) { flightsAt = t; hear.flights = heardFlights(t, bearing); }
      return {
        t: t % ROLL, fall: [rain, snow, wet, wind], windV,
        tint: [ck * 0.92 + 0.12, ck * 0.94 + 0.12, ck + 0.12], flash,
      };
    },
    // the day through the glass under this much cloud, and a lightning flash in the room
    dimOf: () => 1 - cover * 0.5,
  };
}
