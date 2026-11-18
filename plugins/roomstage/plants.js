// A room's potted plants as pieces you can move (the arrange mode).
//
// The plants are authored as decor (flags.room.decor.plants, [u, v, s] each, drawn by gl/room-decor.js). The Stage
// takes them out of the decor and sends each as a piece (form 'planter', id `plant:<i>`), so the arrange mode drags
// them like any furniture. Where an owner puts them is runtime state in `room_plants`, one row per room, read once at
// boot into MOVED and laid over the authored list. The zone file is never written: content is git's alone.
// The index i is the authored list's own, so an override with a different count is dropped and the file wins.

import { query } from '../../server/models/db.js';

const MOVED = new Map();   // zone id → [[u, v, s], ...]
const SIZE = 0.68, TALL = 1.15;   // a pot of size 1 is 0.32 m round; its foliage stands about this tall

export async function loadPlants() {
  const { rows } = await query('SELECT zone_id, plants FROM room_plants');
  MOVED.clear();
  for (const r of rows) if (Array.isArray(r.plants)) MOVED.set(r.zone_id, r.plants);
  return rows.length;
}

const ok = (c) => Array.isArray(c) && c.length >= 2 && c.slice(0, 3).every((x) => x === undefined || Number.isFinite(x));

// The room's plants where they stand now: the owner's, if they match the authored list, else the authored.
export function plantsOf(zoneId, authored) {
  const base = (Array.isArray(authored) ? authored : []).filter(ok);
  const m = MOVED.get(zoneId);
  if (!m || m.length !== base.length) return base.map((c) => c.slice(0, 3));
  return base.map((c, i) => (ok(m[i]) ? [m[i][0], m[i][1], c[2] || 1] : c.slice(0, 3)));
}

// Each plant as a piece, its footprint the pot's (decorSolids' own box).
export function plantPieces(pots, movable) {
  return pots.map(([u, v, s = 1], i) => ({
    id: `plant:${i}`, name: 'potted plant', arche: 'prop', form: 'planter', size: s,
    dims: [SIZE * s, SIZE * s, TALL * s], spot: { at: [u, v], turn: 0 }, acts: [], ...(movable ? { placed: true } : {}),
  }));
}

export const isPlantId = (id) => /^plant:\d+$/.test(String(id));

// One write for the room: the whole list, so a later load is the room as it was saved.
export async function savePlants(zoneId, pots) {
  const list = pots.map(([u, v, s]) => [Math.round(u * 1000) / 1000, Math.round(v * 1000) / 1000, s]);
  await query('INSERT INTO room_plants (zone_id, plants, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (zone_id) DO UPDATE SET plants = EXCLUDED.plants, updated_at = now()', [zoneId, JSON.stringify(list)]);
  MOVED.set(zoneId, list);
}

export const _plantsTest = { MOVED };

// ── the rug ─────────────────────────────────────────────────────────────────────────────────────────
// A room's authored rug (flags.room.decor.rug as { at, w, d, style }) goes the same way: sent as a piece (form 'rug',
// id `rug`) the owner can drag, its new place the `rug` column of the same row, [u, v, turn]. Its size and style stay
// the file's. Only a rug with a place of its own is movable; the default one laid by the rules stays decor.
const RUGS = new Map();   // zone id → [u, v, turn]

export async function loadRugs() {
  const { rows } = await query('SELECT zone_id, rug FROM room_plants WHERE rug IS NOT NULL');
  RUGS.clear();
  for (const r of rows) if (ok(r.rug)) RUGS.set(r.zone_id, r.rug);
  return rows.length;
}

export const rugMovable = (rug) => !!rug && typeof rug === 'object' && Array.isArray(rug.at) && Number(rug.w) > 0 && Number(rug.d) > 0;

// The rug as it lies now: the owner's place over the file's.
export function rugOf(zoneId, rug) {
  const m = RUGS.get(zoneId);
  return { ...rug, at: m ? [m[0], m[1]] : rug.at.slice(0, 2), turn: m ? m[2] || 0 : 0 };
}

export function rugPiece(rug, movable) {
  return {
    id: 'rug', name: rug.style === 'persian' ? 'Persian rug' : 'rug', arche: 'prop', form: 'rug', style: rug.style || null,
    dims: [Number(rug.w), Number(rug.d), 0.01], spot: { at: rug.at.slice(0, 2), turn: rug.turn || 0 }, acts: [], ...(movable ? { placed: true } : {}),
  };
}

export const isRugId = (id) => String(id) === 'rug';

export async function saveRug(zoneId, u, v, turn) {
  const at = [Math.round(u * 1000) / 1000, Math.round(v * 1000) / 1000, turn || 0];
  await query('INSERT INTO room_plants (zone_id, rug, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (zone_id) DO UPDATE SET rug = EXCLUDED.rug, updated_at = now()', [zoneId, JSON.stringify(at)]);
  RUGS.set(zoneId, at);
}
