// A room's decor objects as pieces you can move (the arrange mode), as plants.js does for the plants and the rug.
//
// The things in flags.room.decor that stand on the floor or hang on a wall as one object (a picture, a mirror, a
// sign, a payphone, a standard lamp, a heap of rubbish) are taken out of the decor and sent as pieces, id
// `decor:<key>:<i>` and form 'decor' (a hung one 'walldecor'), carrying their own entry. gl/room-decor.js draws the
// piece by drawing that one entry where the piece stands. The finish (cladding, ceilings, paint, pipes, lights on
// the ceiling, columns, shut doors) stays decor: it's the building, not what's in it.
// Where an owner puts them is runtime state, the `decor` column of `room_plants`, { "<key>:<i>": spot }, read once at
// boot and laid over the authored entries. The zone file is never written. An override for an index the file no
// longer has is dropped.

import { query } from '../../server/models/db.js';

const WALLS = new Set(['left', 'right', 'front', 'back']);
const fin = (x) => Number.isFinite(Number(x));
const num = (x, d) => (fin(x) ? Number(x) : d);

// The kinds that move, and how big each is in metres [w, d, h]. `flat` lies on the floor and nothing minds it (a
// rug's rule); `wall` hangs; the rest stand. A wall kind's width comes from its own entry where it has one.
const FLOOR = {
  pumps: { dims: () => [0.9, 0.6, 0.55], name: 'pump' },
  hatstand: { dims: () => [0.5, 0.5, 1.8], name: 'hatstand' },
  standards: { dims: () => [0.45, 0.45, 1.6], name: 'standard lamp' },
  rubbish: { dims: (c) => [2 * num(c.r?.[0], 0.6), 2 * num(c.r?.[1], 0.6), 0.05], name: 'heap of rubbish', flat: true },
  litter: { dims: (c) => [2 * num(c.r?.[0], 0.6), 2 * num(c.r?.[1], 0.6), 0.03], name: 'litter', flat: true },
  mags: { dims: () => [0.6, 0.5, 0.05], name: 'pile of magazines', flat: true },
};
const textW = (c, h) => Math.max(0.3, String(c.text || '').length * h * 0.7);
const WALL = {
  art: { w: (c) => num(c.w, 1.2), h: (c) => num(c.h, 1.5), name: 'picture' },
  salon: { w: (c) => num(c.w, 1.5), h: (c) => num(c.h, 1.2), name: 'picture' },
  mirrors: { w: (c) => num(c.w, 1), h: (c) => num(c.y1, 2) - num(c.y0, 1), name: 'mirror' },
  chalk: { w: (c) => num(c.w, 1.2), h: (c) => num(c.h, 0.9), name: 'chalkboard' },
  piclights: { w: (c) => num(c.w, 1.2), h: (c) => num(c.h, 1.5), name: 'picture' },
  screens: { w: (c) => num(c.w, 0.6), h: (c) => num(c.h, 0.36), name: 'screen', along: true },
  signs: { w: (c) => textW(c, num(c.h, 0.12)), h: (c) => num(c.h, 0.12) * 1.8, name: 'sign', along: true },
  neon: { w: (c) => textW(c, num(c.h, 0.3)), h: (c) => num(c.h, 0.3), name: 'neon sign' },
  lamps: { w: () => 0.15, h: () => 0.15, name: 'warning lamp', along: true },
  payphone: { w: () => 0.45, h: () => 0.7, name: 'payphone' },
  trophy: { w: () => 0.6, h: () => 0.5, name: 'trophy' },
  clocks: { w: (c) => Math.max(0.4, (Array.isArray(c.list) ? c.list.length : 1) * num(c.gap, 0.46)), h: () => 0.5, name: 'row of clocks' },
  directory: { w: () => 0.9, h: () => 1.1, name: 'directory board' },
};
export const DECOR_KINDS = [...Object.keys(FLOOR), ...Object.keys(WALL)];

const MOVED = new Map();   // zone id → { "<key>:<i>": spot }

export async function loadDecor() {
  const { rows } = await query('SELECT zone_id, decor FROM room_plants WHERE decor IS NOT NULL');
  MOVED.clear();
  for (const r of rows) if (r.decor && typeof r.decor === 'object') MOVED.set(r.zone_id, r.decor);
  return rows.length;
}

// Where an entry stands, as a spot: a wall kind { wall, along }, a floor kind { at, turn }. Null if it has none.
function spotOfEntry(key, c) {
  if (WALL[key]) {
    const a = WALL[key].along ? c?.along : c?.at;
    return c && WALLS.has(c.wall) && fin(a) ? { wall: c.wall, along: Number(a) } : null;
  }
  if (Array.isArray(c)) return c.length >= 2 && fin(c[0]) && fin(c[1]) ? { at: [Number(c[0]), Number(c[1])], turn: 0 } : null;
  return Array.isArray(c?.at) && c.at.length === 2 && c.at.every(fin) ? { at: [Number(c.at[0]), Number(c.at[1])], turn: 0 } : null;
}
// The entry moved to `spot`, everything else about it the file's.
export function entryAt(key, c, spot) {
  if (WALL[key]) return spot?.wall ? { ...c, wall: spot.wall, [WALL[key].along ? 'along' : 'at']: spot.along } : c;
  if (!Array.isArray(spot?.at)) return c;
  if (Array.isArray(c)) { const out = c.slice(); out[0] = spot.at[0]; out[1] = spot.at[1]; return out; }
  return { ...c, at: [spot.at[0], spot.at[1]] };
}

// Takes the movable entries out of a spec's decor: { decor (what stays), list: [{ key, i, entry }] }, each entry
// where the owner put it. The kinds' arrays are left empty, so a room that's drawn from the spec alone draws none.
export function decorOf(zoneId, decor) {
  if (!decor || typeof decor !== 'object') return { decor, list: [] };
  const moved = MOVED.get(zoneId) || {}, list = [];
  let out = decor;
  for (const key of DECOR_KINDS) {
    const arr = [].concat(decor[key] || []);
    if (!arr.length) continue;
    const keep = [];
    arr.forEach((c, i) => {
      const at = spotOfEntry(key, c);
      if (!at) { keep.push(c); return; }
      const m = moved[`${key}:${i}`], ok = m && (WALL[key] ? WALLS.has(m.wall) && fin(m.along) : Array.isArray(m.at) && m.at.every(fin));
      // an art entry's look comes from its place in the list when it has no seed of its own
      const own = key === 'art' && !fin(c.seed) ? { ...c, seed: 7 + i * 31 } : c;
      list.push({ key, i, entry: ok ? entryAt(key, own, m) : own });
    });
    if (out === decor) out = { ...decor };
    out[key] = keep;
  }
  return { decor: out, list };
}

// Each entry as a piece.
export function decorPieces(list, movable) {
  return list.map(({ key, i, entry }) => {
    const spot = spotOfEntry(key, entry), W = WALL[key], F = FLOOR[key];
    const dims = W ? [Math.max(0.1, W.w(entry)), 0.08, Math.max(0.1, W.h(entry))] : F.dims(entry);
    return {
      id: `decor:${key}:${i}`, name: (W || F).name, arche: W ? 'cabinet' : 'prop', form: W ? 'walldecor' : 'decor',
      decor: { key, entry }, dims, spot, acts: [], ...(F?.flat ? { flat: true } : {}), ...(movable ? { placed: true } : {}),
    };
  });
}

export const isDecorId = (id) => /^decor:[a-z]+:\d+$/.test(String(id));

// One write for the room: every decor piece's spot that moved, laid over what's kept already.
export async function saveDecor(zoneId, moves) {
  const next = { ...(MOVED.get(zoneId) || {}) };
  for (const { id, spot } of moves) next[String(id).slice(6)] = spot;
  await query('INSERT INTO room_plants (zone_id, decor, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (zone_id) DO UPDATE SET decor = EXCLUDED.decor, updated_at = now()', [zoneId, JSON.stringify(next)]);
  MOVED.set(zoneId, next);
}

export const _decorTest = { MOVED };
