// THE WILDBLOOD COLUMN: three rigs that run the Scarletwastes roads on a timetable.
//
// The Howl, the Slake cart and the hound-runner drive a loop from the Deadleg yard to the Slake and
// up to the North Gate (route.js). It is look only: no raid, no shadowing, nothing to fight. A seat
// sees and hears them through `vehicle.contacts`, the seam that already puts other players' rigs in
// a windscreen and a mirror; somebody on foot gets a line as they pass.
//
// ⚠ NOTHING IS STORED AND NOTHING IS QUERIED. Where the column is comes from the clock (columnAt),
// so the contact feed is arithmetic and the tick reads only the world Maps. The tick goes through
// scheduler.js, idle-gated like every other.
//
// The meshes are content/vehicle_models/mesh_column*.json (class `column`), written by
// scripts/shapes/concepts/wildblood-column.mjs; the engine voice is `rotgas` in seat-audio.js.
import { schedule } from '../../server/engine/scheduler.js';
import { zoneAtTile, getZonePlayers } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { columnAt, STOP_NAMES } from './route.js';

const MAP = 'map_world';

// The contacts within `range` tiles of (x, y), shaped like the podracer's (racerContactsNear).
export function columnContactsNear(x, y, range = 26, nowMs = Date.now()) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
  const out = [];
  for (const r of columnAt(nowMs)) {
    if (Math.hypot(r.x - x, r.y - y) > range) continue;
    out.push({
      id: r.id,
      cls: 'column',
      variant: r.variant,
      x: r.x, y: r.y, hdg: +r.hdg.toFixed(1),
      ias: r.ias,
      alt: 0, band: 'ground', onGround: true, groundZ: 0, altDiff: 0,
      bank: 0, pitch: 0, vs: 0,
      reg: r.name,
    });
  }
  return out;
}

// ── The text rung ─────────────────────────────────────────────────────────────
// When a rig comes onto a tile, whoever is on it hears the rig go by, and whoever is next to it
// hears it close. Plain and short. Nobody in the column explains it.
const ON = {
  column_howl: [
    'The Howl comes through: the stacks first, then the noise, then the rest of it. Somebody up on the hull lifts a hand.',
    'The Howl goes past close enough to feel the heat off the stacks. The skulls on the tail chain knock together.',
  ],
  column_cart: [
    'The Slake cart rolls past behind it, slower, the tank sloshing. The rider on the catwalk watches you the whole way.',
    'The water cart goes by. Somebody has filed the spikes along the tank again.',
  ],
  column_runner: [
    'The hound-runner brings up the rear, the bike popping, the cage behind it rattling and empty.',
    'The hound-runner goes past at a walking pace. The rider looks at you, then at the cage, then away.',
  ],
};
const NEAR = {
  column_howl: 'Close by, something with no muffler goes past. You feel it in your teeth.',
  column_cart: 'A heavy rig grinds past nearby, slower than the first.',
  column_runner: 'A bike pops past nearby, towing something that rattles.',
};
const STOPPED = {
  0: 'The column stands in the yard with the stacks ticking as they cool.',
  3: 'The column has pulled up at the shore. The cart\'s hose is in the water.',
  9: 'The column has stopped at the North Gate. Nobody gets down. The gate stays shut.',
};

const pick = (list, seed) => list[Math.abs(seed) % list.length];
const zoneId = (x, y) => zoneAtTile(MAP, x, y, 0)?.id || null;

// Which tile each rig was last on, so a line goes out once per tile and not every tick.
const lastTile = new Map();
let lastStop = null;

export function columnTick(nowMs = Date.now()) {
  const rigs = columnAt(nowMs);
  const sent = [];
  for (const r of rigs) {
    const tx = Math.round(r.x), ty = Math.round(r.y), key = tx + ',' + ty;
    if (lastTile.get(r.id) === key) continue;
    lastTile.set(r.id, key);
    const here = zoneId(tx, ty);
    if (here) for (const p of getZonePlayers(here)) {
      sendToPlayer(p.id, { type: 'ambient', message: '<span class="msg-ambient">' + pick(ON[r.id], tx * 31 + ty) + '</span>' });
      sent.push([p.id, r.id, 'on']);
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const z = zoneId(tx + dx, ty + dy);
      if (!z) continue;
      for (const p of getZonePlayers(z)) {
        sendToPlayer(p.id, { type: 'ambient', message: '<span class="msg-ambient">' + NEAR[r.id] + '</span>' });
        sent.push([p.id, r.id, 'near']);
      }
    }
  }
  // Somebody arriving at a stop while the column stands there sees it standing.
  const stop = rigs[0].stop;
  if (stop != null && stop !== lastStop) {
    const z = zoneId(Math.round(rigs[0].x), Math.round(rigs[0].y));
    if (z) for (const p of getZonePlayers(z)) { sendToPlayer(p.id, { type: 'ambient', message: '<span class="msg-ambient">' + STOPPED[stop] + '</span>' }); sent.push([p.id, 'column', 'stop']); }
  }
  lastStop = stop;
  return sent;
}

schedule('2s', () => columnTick());

export const hooks = {
  'vehicle.contacts': (x, y, range) => columnContactsNear(x, y, range),
};

export const _test = { columnContactsNear, columnTick, lastTile, STOP_NAMES, resetTicks: () => { lastTile.clear(); lastStop = null; } };
