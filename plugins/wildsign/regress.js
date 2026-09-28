// wildsign regression suite — run by tests/regress.js, never loaded in production.
//
// What it proves: a red-tail's kill, derived from the clock, is found by `search` on the tile it
// happened on, while it is fresh and later, and not after the sign has gone, not on a failed search,
// not at night and not on the tile next door. It finds the kill by walking the world's own hawks.
import { _test as W } from './index.js';
import { world } from '../../server/engine/world.js';
import { groundKillsSince, flockAt } from '../../client/shared/birds.js';
import { zoneAtTile } from '../../server/engine/world.js';

export default async function regress({ check }) {
  // A world hawk and a kill it made, found by scanning a day of its strikes.
  let found = null;
  for (const z of world.zones.values()) {
    if (found) break;
    if (z.map_id !== 'map_world' || z.grid_x == null) continue;
    if (!flockAt(z.grid_x, z.grid_y, 1, 'hawk')) continue;   // cheap: only where a hawk can roll at all
    const hawks = W.hawksNear(z, '').filter((h) => h.ax === z.grid_x && h.ay === z.grid_y);
    for (const h of hawks) {
      const T = 1e12;
      const kills = groundKillsSince(h, T, 24 * 3600e3, W.preyFor(z, h, T));
      // A kill with no later one on its own tile inside the sign's hour: a hawk that hunts again
      // soon would leave fresh sign where the expiry check below expects none.
      const tile = (q) => `${Math.round(q.x)},${Math.round(q.y)}`;
      const lone = kills.find((q) => !kills.some((o) => o !== q && tile(o) === tile(q) && o.at > q.at && o.at <= q.at + W.SIGN_MS + 120e3));
      if (lone) { found = { h, k: lone, zone: z }; break; }
    }
  }
  check('wildsign: the world has a red-tail that kills something within a day', !!found);
  if (!found) return;

  const { k, zone } = found;
  const killZone = zoneAtTile(zone.map_id, Math.round(k.x), Math.round(k.y), zone.grid_z ?? 0);
  check('wildsign: the kill tile is a real zone', !!killZone);
  if (!killZone) return;

  const realNow = Date.now;
  W.setHour(() => 12);
  const ask = async (t, extra = {}) => {
    Date.now = () => t;
    try { return await W.searchForKill({ zoneId: killZone.id, zone: killZone, margin: 5, success: true, ...extra }); }
    finally { Date.now = realNow; }
  };
  try {
    const fresh = await ask(k.at + 60e3);
    check('wildsign: a fresh kill is found on its own tile', !!(fresh && fresh.found));
    check('wildsign: a fresh kill reads as fresh', !!fresh && fresh.message === (W.LINES[k.kind] || W.LINES.vole)[0], fresh?.message);
    const old = await ask(k.at + W.FRESH_MS + 60e3);
    check('wildsign: an older kill reads as older', !!old && old.message === (W.LINES[k.kind] || W.LINES.vole)[1], old?.message);
    check('wildsign: nothing is left after the sign has gone', !(await ask(k.at + W.SIGN_MS + 60e3)));
    check('wildsign: a failed search finds nothing', !(await ask(k.at + 60e3, { success: false, margin: -3 })));
    check('wildsign: a bare pass finds nothing', !(await ask(k.at + 60e3, { margin: 0 })));
    W.setHour(() => 2);
    check('wildsign: nothing is found at night', !(await ask(k.at + 60e3)));
    W.setHour(() => 12);
    // The tile next door, if it is open ground, holds no sign of this kill.
    const next = zoneAtTile(killZone.map_id, killZone.grid_x + 1, killZone.grid_y, killZone.grid_z ?? 0);
    if (next && !next.flags?.building_type) {
      Date.now = () => k.at + 60e3;
      let r;
      try { r = await W.searchForKill({ zoneId: next.id, zone: next, margin: 5, success: true }); } finally { Date.now = realNow; }
      check('wildsign: the kill is not found on the next tile', !r || r.message !== (W.LINES[k.kind] || W.LINES.vole)[0]);
    }
  } finally {
    Date.now = realNow;
    W.setHour(null);
  }
}
