// Prologue plugin regression suite — run by tests/regress.js (never in production).
import { query } from '../../server/models/db.js';
import { getRegisteredMoveGates } from '../../server/engine/movement-gates.js';
import { clearFlag } from '../../server/engine/flags.js';
import { _test } from './index.js';

export default async function regress({ check, getPlayer }) {
  const {
    prologueMoveGate, onVisibilityPerceive, useHolosign, useHolocaster,
    Z_INBETWEEN, Z_SYNAPSE, Z_LATTICE, Z_BROADCAST,
    ITEM_HOLOCASTER, ITEM_TABLET,
    F_ALIGNED, F_INTERFACED, F_BROADCAST,
  } = _test;

  // The interface beat writes player_skills (FK to players), so it needs a REAL
  // players row — the harness's shared player is in-memory only. Make a throwaway.
  const p = { id: `prologue_regress_${process.pid}`, handle: `PrologueRegress${process.pid}` };
  const cleanup = async () => {
    await query('DELETE FROM player_skills WHERE player_id=$1', [p.id]).catch(() => {});
    await query('DELETE FROM player_inventory WHERE player_id=$1', [p.id]).catch(() => {});
    await query('DELETE FROM player_flags WHERE player_id=$1', [p.id]).catch(() => {});
    await query('DELETE FROM players WHERE id=$1', [p.id]).catch(() => {});
  };
  const flags = [F_ALIGNED, F_INTERFACED, F_BROADCAST, 'prologue_collapse_open', 'prologue_broadcast_played'];
  await cleanup();
  await query(
    'INSERT INTO players (id, username, handle, password_hash) VALUES ($1,$2,$3,$4)',
    [p.id, p.id, p.handle, 'x']
  );

  // ── Move gate is wired ─────────────────────────────────────────────────────
  check('prologue move gate registered', getRegisteredMoveGates().includes('prologue'));

  // ── Visibility hook: prologue zones are seen, others untouched ──────────────
  const litVoid = onVisibilityPerceive(p, {}, { flags: { prologue: true } });
  check('void rooms are forced visible', litVoid?.category === 'clear', JSON.stringify(litVoid));
  check('non-prologue zones untouched by visibility hook', onVisibilityPerceive(p, {}, { flags: {} }) === undefined);

  // ── Gate 1: north out of The Inbetween needs alignment ─────────────────────
  const g1blocked = await prologueMoveGate({ player: { ...p, current_zone: Z_INBETWEEN }, to: { id: Z_SYNAPSE } });
  check('inbetween→synapse blocked before alignment', g1blocked?.block === true, JSON.stringify(g1blocked)?.slice(0, 60));

  // ── The holosign self-gates outside the lattice ────────────────────────────
  const wrongZone = await useHolosign(['holosign'], 'use holosign', { ...p, current_zone: Z_INBETWEEN });
  check('use holosign is inert outside the lattice', wrongZone === undefined);

  // ── The interface beat: first IP + tablet + holocaster ─────────────────────
  const lp = { ...p, current_zone: Z_LATTICE };
  const interfaced = await useHolosign(['holosign'], 'use holosign', lp);
  check('use holosign returns an emote', interfaced?.type === 'emote', interfaced?.type);
  const ip = await query("SELECT ip FROM player_skills WHERE player_id=$1 AND skill_id='architect_interface'", [p.id]);
  check('first Architect Interface IP granted', (ip.rows[0]?.ip || 0) === 1, ip.rows[0]?.ip);
  const inv = await query('SELECT item_id FROM player_inventory WHERE player_id=$1 AND item_id IN ($2,$3)', [p.id, ITEM_TABLET, ITEM_HOLOCASTER]);
  check('tablet granted', inv.rows.some(r => r.item_id === ITEM_TABLET));
  check('holocaster granted', inv.rows.some(r => r.item_id === ITEM_HOLOCASTER));

  // Second touch is inert (no double grant).
  const again = await useHolosign(['holosign'], 'use holosign', lp);
  check('second holosign touch is a flavour no-op', again?.type === 'emote');
  const ip2 = await query("SELECT ip FROM player_skills WHERE player_id=$1 AND skill_id='architect_interface'", [p.id]);
  check('holosign does not re-grant IP', (ip2.rows[0]?.ip || 0) === 1, ip2.rows[0]?.ip);

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
