// Per-zone stock of a scavenging table, topped up over time. Shared by fishing,
// mining and scavenging, which each kept an identical copy of this.
//
// This runs on every cast, dig and search, so it's a hot path. The copies it
// replaces did four awaited reads in a row and then one INSERT or UPDATE per
// table entry in a loop: 4 to 15 or more round trips to the remote DB per
// player action. Here the four reads are independent and go out together, and
// each write is one statement for every entry (unnest), so a steady-state
// action is one round trip, two when stock was topped up, and a zone's first
// visit is two.
import { query } from '../models/db.js';

const BASE_TABLE_COLS = ['id', 'name', 'replenish_interval_seconds', 'messages'];

const nowSec = () => Math.floor(Date.now() / 1000);

function pickWeighted(entries) {
  const total = entries.reduce((s, e) => s + Math.max(1, e.weight), 0);
  let r = Math.random() * total;
  for (const e of entries) {
    r -= Math.max(1, e.weight);
    if (r < 0) return e;
  }
  return entries[entries.length - 1];
}

/**
 * → { table, entries } with each entry's current_qty, or null when the table
 * doesn't exist. `extraCols` are extra scavenging_tables columns a caller reads
 * (fishing's monsters and bait catches); they come from code, never input.
 */
export async function loadZoneStock(zoneId, tableId, extraCols = []) {
  const cols = [...BASE_TABLE_COLS, ...extraCols].filter((c) => /^[a-z_]+$/.test(c)).join(', ');
  const [{ rows: tRows }, { rows: entries }, { rows: stateRows }, { rows: stock }] = await Promise.all([
    query(`SELECT ${cols} FROM scavenging_tables WHERE id=$1`, [tableId]),
    query(
      `SELECT si.item_id, si.difficulty, si.weight, si.max_qty, it.name
       FROM scavenging_table_items si JOIN items it ON it.id = si.item_id
       WHERE si.table_id = $1`,
      [tableId]
    ),
    query('SELECT last_replenish FROM scavenging_zone_state WHERE zone_id=$1', [zoneId]),
    query('SELECT item_id, current_qty FROM scavenging_zone_stock WHERE zone_id=$1', [zoneId]),
  ]);
  if (!tRows.length) return null;
  const table = tRows[0];
  if (!entries.length) return { table, entries: [] };

  // First visit to this zone: every entry starts full.
  if (!stateRows.length) {
    const now = nowSec();
    await Promise.all([
      // ON CONFLICT: two first visits at once used to throw out of a cast or dig.
      query('INSERT INTO scavenging_zone_state (zone_id, table_id, last_replenish) VALUES ($1,$2,$3) ON CONFLICT (zone_id) DO NOTHING', [zoneId, tableId, now]),
      query(
        `INSERT INTO scavenging_zone_stock (zone_id, item_id, current_qty)
         SELECT $1, u.item_id, u.qty FROM unnest($2::text[], $3::int[]) AS u(item_id, qty)
         ON CONFLICT (zone_id, item_id) DO NOTHING`,
        [zoneId, entries.map((e) => e.item_id), entries.map((e) => e.max_qty)]
      ),
    ]);
    for (const e of entries) e.current_qty = e.max_qty;
    return { table, entries };
  }
  const lastReplenish = Number(stateRows[0].last_replenish) || 0;

  // An entry added to the table since this zone was stocked starts empty.
  const stockMap = new Map(stock.map((s) => [s.item_id, s.current_qty]));
  const missing = entries.filter((e) => !stockMap.has(e.item_id));
  for (const e of entries) e.current_qty = stockMap.get(e.item_id) ?? 0;
  // Awaited on its own, before the top-up below: that UPDATE only reaches rows
  // that exist. Rare (the table grew since this zone was stocked).
  if (missing.length) {
    await query(
      `INSERT INTO scavenging_zone_stock (zone_id, item_id, current_qty)
       SELECT $1, u.item_id, 0 FROM unnest($2::text[]) AS u(item_id)
       ON CONFLICT (zone_id, item_id) DO NOTHING`,
      [zoneId, missing.map((e) => e.item_id)]
    );
  }
  // Top up one unit per interval elapsed, weighted, never past max.
  const interval = Math.max(1, table.replenish_interval_seconds);
  const now = nowSec();
  const steps = Math.floor((now - lastReplenish) / interval);
  if (steps <= 0) return { table, entries };
  const added = new Map();
  let applied = 0;
  while (applied < steps) {
    const room = entries.filter((e) => e.current_qty < e.max_qty);
    if (!room.length) break;
    const e = pickWeighted(room);
    e.current_qty++;
    added.set(e.item_id, (added.get(e.item_id) || 0) + 1);
    applied++;
  }
  // ⚠ A full zone does NOT bank its refills. The clock used to stay put while
  // everything was full, so after hours full every unit taken came straight
  // back, up to the hours banked: bottomless. Hitting full moves the clock to
  // now; otherwise it moves by the intervals actually used.
  const nextClock = applied < steps ? now : lastReplenish + applied * interval;
  // Claim the clock before adding stock: only the one caller whose UPDATE still
  // sees the old value tops up, so two players arriving together can't both
  // apply the same refill. The loser keeps the stock it read.
  const { rowCount } = await query(
    'UPDATE scavenging_zone_state SET last_replenish=$1 WHERE zone_id=$2 AND last_replenish=$3',
    [nextClock, zoneId, stateRows[0].last_replenish]
  );
  if (!rowCount) {
    for (const e of entries) e.current_qty = stockMap.get(e.item_id) ?? 0;
    return { table, entries };
  }
  if (added.size) {
    // Relative and capped, so a take by another player between our read and
    // this write isn't overwritten (an absolute write used to put it back).
    const ids = [...added.keys()];
    await query(
      `UPDATE scavenging_zone_stock s SET current_qty = LEAST(u.max_qty, s.current_qty + u.delta)
       FROM unnest($2::text[], $3::int[], $4::int[]) AS u(item_id, delta, max_qty)
       WHERE s.zone_id = $1 AND s.item_id = u.item_id`,
      [zoneId, ids, ids.map((id) => added.get(id)), ids.map((id) => entries.find((e) => e.item_id === id).max_qty)]
    );
  }
  return { table, entries };
}
