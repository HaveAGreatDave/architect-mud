// Prologue plugin regression suite — run by tests/regress.js (never in production).
import { query } from '../../server/models/db.js';
import { getRegisteredMoveGates } from '../../server/engine/movement-gates.js';
import { clearFlag } from '../../server/engine/flags.js';
import { getNetXp } from '../../server/engine/ip.js';
import { _test } from './index.js';

export default async function regress({ check }) {
  const {
    prologueMoveGate, useHolosign, useHolocaster,
    Z_INBETWEEN, Z_LATTICE, Z_BROADCAST,
    ITEM_HOLOCASTER,
    F_ALIGNED, F_INTERFACED, F_BROADCAST,
  } = _test;

  // The stat gift + holocaster grant write player-scoped rows (FKs to players),
  // so this needs a REAL players row — the harness's shared player is in-memory
  // only. Make a throwaway with a known XP budget so the "off the books" check
  // is meaningful.
  const p = { id: `prologue_regress_${process.pid}`, handle: `PrologueRegress${process.pid}` };
  const cleanup = async () => {
    await query('DELETE FROM player_inventory WHERE player_id=$1', [p.id]).catch(() => {});
    await query('DELETE FROM player_flags WHERE player_id=$1', [p.id]).catch(() => {});
    await query('DELETE FROM players WHERE id=$1', [p.id]).catch(() => {});
  };
  const flags = [F_ALIGNED, F_INTERFACED, F_BROADCAST, 'prologue_collapse_open', 'prologue_broadcast_played'];
  await cleanup();
  await query(
    'INSERT INTO players (id, username, handle, password_hash, bonus_xp) VALUES ($1,$2,$3,$4,1800)',
    [p.id, p.id, p.handle, 'x']
  );

  // ── Move gate is wired ─────────────────────────────────────────────────────
  check('prologue move gate registered', getRegisteredMoveGates().includes('prologue'));

  // ── Gate 1: north out of The Inbetween (→ The Lattice) needs alignment ──────
  const g1blocked = await prologueMoveGate({ player: { ...p, current_zone: Z_INBETWEEN }, to: { id: Z_LATTICE } });
  check('inbetween→lattice blocked before alignment', g1blocked?.block === true, JSON.stringify(g1blocked)?.slice(0, 60));

  // ── The holosign self-gates outside the lattice ────────────────────────────
  const wrongZone = await useHolosign(['holosign'], 'use holosign', { ...p, current_zone: Z_INBETWEEN });
  check('use holosign is inert outside the lattice', wrongZone === undefined);

  // ── The gift beat: +1 to every stat (free of XP) + the holocaster ──────────
  const netBefore = await getNetXp(p.id);
  const lp = { ...p, current_zone: Z_LATTICE };
  const interfaced = await useHolosign(['holosign'], 'use holosign', lp);
  check('use holosign returns an emote', interfaced?.type === 'emote', interfaced?.type);

  const g = await query(
    'SELECT stat_brawn, stat_reflexes, stat_endurance, stat_brains, stat_cool, stat_senses, gifted_stat_points FROM players WHERE id=$1',
    [p.id]
  );
  const row = g.rows[0];
  check('every stat raised by 1', ['brawn', 'reflexes', 'endurance', 'brains', 'cool', 'senses'].every(s => row[`stat_${s}`] === 1), JSON.stringify(row));
  check('six gifted stat points recorded', row.gifted_stat_points === 6, row.gifted_stat_points);

  const netAfter = await getNetXp(p.id);
  check('gift costs no Net XP (off the books)', netAfter.net === netBefore.net && netAfter.net === 1800, `${netBefore.net}→${netAfter.net}`);
  check('gift costs no Total XP (off the books)', netAfter.total === 1800, netAfter.total);

  const inv = await query('SELECT item_id FROM player_inventory WHERE player_id=$1', [p.id]);
  check('holocaster granted', inv.rows.some(r => r.item_id === ITEM_HOLOCASTER));
  check('no tablet granted (removed)', !inv.rows.some(r => r.item_id === 'item_prologue_tablet'));

  // Second touch is inert — no double gift.
  const again = await useHolosign(['holosign'], 'use holosign', lp);
  check('second holosign touch is a flavour no-op', again?.type === 'emote');
  const g2 = await query('SELECT stat_brawn, gifted_stat_points FROM players WHERE id=$1', [p.id]);
  check('holosign does not re-gift stats', g2.rows[0].stat_brawn === 1 && g2.rows[0].gifted_stat_points === 6, JSON.stringify(g2.rows[0]));

  // ── Broadcast door was shut; the holocaster opens it and is consumed ───────
  const g2blocked = await prologueMoveGate({ player: { ...p, current_zone: Z_LATTICE }, to: { id: Z_BROADCAST } });
  check('lattice→broadcast blocked before the holocaster', g2blocked?.block === true);

  const used = await useHolocaster(['holocaster'], 'use holocaster', lp);
  check('use holocaster returns an emote', used?.type === 'emote', used?.type);
  const gone = await query('SELECT 1 FROM player_inventory WHERE player_id=$1 AND item_id=$2', [p.id, ITEM_HOLOCASTER]);
  check('holocaster is consumed on use', gone.rows.length === 0);
  const g2open = await prologueMoveGate({ player: { ...p, current_zone: Z_LATTICE }, to: { id: Z_BROADCAST } });
  check('lattice→broadcast opens after holocaster', g2open === undefined);

  // holocaster with none carried falls through to the builtin.
  const noItem = await useHolocaster(['holocaster'], 'use holocaster', lp);
  check('use holocaster without one falls through', noItem === undefined);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  for (const f of flags) await clearFlag('player', f, p).catch(() => {});
  await cleanup();
}
