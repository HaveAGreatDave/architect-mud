// THE BIRDS AND THE SEA ROUND A BUILDING, for the Room Stage to hear through its windows.
//
// The Room Stage gets the world window round its building (`room_outlook`'s map, the same one GLASS
// paints the view out of). From it this works out what GLASS would: the flocks within earshot, by the
// same habitat rules windshield.js uses (placeOf, speciesAt, flocksNear), calling on birds.js's
// clock-driven schedule (callsIn), and the nearest shore (field-audio.js's nearestShore). So the birds
// you hear are the ones a player outside on that tile would hear, and a flat inland hears no sea.
//
// It decides nothing about level or place in the room: room-sound.js takes what's due, puts it at the
// window and sets it through the glass (room-sfx.js's outsideMix).
//
// ⚠ ONE BURST AT A TIME, AND A QUIET AFTER IT. The same rule as windshield.js's BIRD_CALL_GAP: a burst is
// admitted whole or dropped, and nothing new starts for CALL_GAP after one, across every species.

import { flocksNear, speciesAt, placeOf, callsIn, birdDaylight } from '../../../shared/birds.js';
import { nearestShore, shoreKind } from './field-audio.js';

const CALL_RANGE = 13;       // tiles, as BIRD_CALL_RANGE in windshield.js
const CALL_GAP = 20000;      // ms of quiet owed after any burst
const SHORE_R = 9;           // tiles: further than GLASS's 7, because the view out of a high window carries
const WX_WET = /rain|storm|snow|sleet|blizzard/;

export function createRoomOutdoors() {
  let W = null;              // { cell, gx, gy, bearing, anchors, wx }
  const S = { at: null, last: null, burst: null };

  // a compass bearing (degrees) to a plan direction [du, dv] in a room whose front faces `bearing`
  // (room-stage.js: compass = bearing − plan angle, and plan angle θ faces (−sin θ, −cos θ))
  const planDir = (dx, dy) => {
    const c = Math.atan2(dx, -dy), th = W.bearing * Math.PI / 180 - c;
    return [-Math.sin(th), -Math.cos(th)];
  };

  function anchors(wx) {
    if (W.anchors && W.wx === wx) return W.anchors;
    const { cell } = W;
    const placeAt = (x, y) => {
      const c = cell(x, y);
      if (!c) return null;
      let bld = 0, shore = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = cell(x + dx, y + dy);
        if (!n) continue;
        if (n.bt) bld++;
        if (n.kind === 'water') shore = true;
      }
      return placeOf(c.biome, bld, shore);
    };
    const habitatAt = (x, y) => {
      const c = cell(x, y);
      if (!c || c.bt) return false;
      const ground = placeAt(x, y), sp = speciesAt(ground, x, y, { weather: wx, road: !!c.road, airfield: c.kind === 'field' });
      return sp ? { sp, ground } : false;
    };
    W.wx = wx;
    W.anchors = flocksNear(W.gx, W.gy, CALL_RANGE, 1, habitatAt)
      .map((f) => ({ f, d: Math.hypot(f.ax - W.gx, f.ay - W.gy) }))
      .filter((a) => a.d <= CALL_RANGE)
      .sort((a, b) => a.d - b.d);
    return W.anchors;
  }

  return {
    // the building's tile, the map round it (rows centred on gx, gy) and which way its front faces
    setPlace({ map, gx, gy, bearing }) {
      if (!Array.isArray(map) || !map.length || !Number.isFinite(gx) || !Number.isFinite(gy)) { W = null; return; }
      const R = (map.length - 1) / 2;
      const cell = (x, y) => map[y - gy + R]?.[x - gx + R] || null;
      const shore = nearestShore(cell, gx, gy, SHORE_R);
      W = { cell, gx, gy, bearing: bearing || 0, anchors: null, wx: null,
        shore: shore && { ...shore, d: Math.sqrt(shore.d2), dir: null } };
      if (W.shore) W.shore.dir = planDir(shore.x - gx, shore.y - gy);
      S.at = null;
    },
    clear() { W = null; },

    // What's due since the last call. `now` ms (Date.now, the clock birds.js keys on), `hour` the game
    // hour, `wx` the weather word, `wind` 0..1. Returns { calls: [{ sp, seed, level, dir, index }],
    // shore: { kind, level, dir } | null }. `level` is 0..1 before the glass; `dir` a plan direction.
    due(now, hour, wx = '', wind = 0) {
      if (!W) return { calls: [], shore: null };
      const from = S.at == null ? now - 60 : S.at;
      S.at = now;
      const since = S.last == null ? Infinity : now - S.last;
      const calls = [];
      // birds go quiet in the wet, as the street does
      if (!WX_WET.test(wx || '')) {
        for (const { f, d } of anchors(wx || 'clear')) {
          if (Number.isFinite(hour) && !birdDaylight(f.sp || 'goose', hour)) continue;
          for (const c of callsIn(f, from, now, { hour })) {
            const key = (f.sp || 'goose') + ':' + f.ax + ',' + f.ay + ':' + c.burst;
            if (key !== S.burst) {
              if (since < CALL_GAP) continue;
              S.burst = key; S.last = now;
            }
            calls.push({ sp: f.sp || 'goose', index: c.index, level: (1 - d / CALL_RANGE) * (c.index === 0 ? 1 : 0.82),
              seed: (f.ax * 7919 + f.ay * 104729 + c.burst * 31 + c.index) | 0, dir: planDir(f.ax - W.gx, f.ay - W.gy) });
          }
        }
      }
      const sh = W.shore;
      const shore = sh ? { kind: shoreKind(sh, wind * 60), level: Math.max(0, 1 - sh.d / (SHORE_R + 1)), dir: sh.dir } : null;
      return { calls, shore };
    },
  };
}
