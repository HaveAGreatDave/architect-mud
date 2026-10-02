// Guest plugin regression suite, run by tests/regress.js (never in production).
// Covers the verb gate, name rules, claim, and that a purge leaves nothing.
import { query } from '../../server/models/db.js';
import { world } from '../../server/engine/world.js';
import { handleProblem, handleTaken, insertNewPlayer, purgePlayers } from '../../server/engine/new-player.js';
import { claimGuestAccount } from '../../server/api/routes.js';
import { sweepGuests } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  // ── The verb gate, on the fake player wearing the guest role ──
  const p = getPlayer();
  const savedRole = p.role;
  p.role = 'guest';
  try {
    for (const cmd of ['give bat to bob', 'pay bob 5', 'tag wall', 'trade bob', 'corp create x', 'bounty bob 500', 'rent']) {
      const r = await run(cmd);
      check(`guest refused: ${cmd}`, r?.type === 'error' && /Guests can't/.test(r.message || ''), r?.message);
    }
    const look = await run('look');
    check('guest can still look', look && !/Guests can't/.test(look.message || ''), look?.type);
    const claim = await run('register');
    check('register opens the form for a guest', claim?.type === 'claim_form', claim?.type);
  } finally {
    p.role = savedRole;
  }
  const notGuest = await run('register');
  check('register refuses a full account', notGuest?.type === 'error', notGuest?.type);

  // ── Name rules ──
  check('handle: markup refused', !!handleProblem('<b>x</b>'));
  check('handle: one letter refused', !!handleProblem('a'));
  check('handle: reserved word refused', !!handleProblem('Admin'));
  check('handle: "me" refused', !!handleProblem('me'));
  check('handle: plain name allowed', handleProblem('Kestrel Vane 9') === null, handleProblem('Kestrel Vane 9'));
  const npcName = [...world.npcs.values()].find(n => n?.name && /^[A-Za-z0-9][A-Za-z0-9 _.'-]{1,23}$/.test(n.name))?.name;
  if (npcName) check(`handle: NPC name refused (${npcName})`, !!handleProblem(npcName.toUpperCase()));

  // ── A real row: create, case-insensitive clash, claim, purge ──
  const handle = `Regress Guest ${process.pid % 100000}`;
  let id = null;
  try {
    id = await insertNewPlayer({ username: `guest_regress_${process.pid}`, handle, role: 'guest' });
    check('guest row created with the guest role',
      (await query('SELECT role FROM players WHERE id=$1', [id])).rows[0]?.role === 'guest');
    check('handle clash is case-insensitive', await handleTaken(handle.toUpperCase()));

    const short = await claimGuestAccount(id, { username: `rg${process.pid}`, password: 'short', email: 'x@example.test' });
    check('claim refuses a short password', !short.ok, JSON.stringify(short));
    const ok = await claimGuestAccount(id, { username: `rg${process.pid}`, password: 'longenough1', email: 'x@example.test' });
    const row = (await query('SELECT role, handle, username FROM players WHERE id=$1', [id])).rows[0];
    check('claim makes it a player and keeps the handle', ok.ok && row?.role === 'player' && row?.handle === handle, JSON.stringify({ ok, row }));
    const again = await claimGuestAccount(id, { username: `rg2${process.pid}`, password: 'longenough1', email: 'x@example.test' });
    check('a claimed character cannot be claimed twice', !again.ok);

    // Per-player rows in tables with and without a real FK, then the purge.
    await query("INSERT INTO player_flags (player_id, flag_key, flag_value) VALUES ($1,'regress_guest','1')", [id]);
    await query("INSERT INTO player_skills (player_id, skill_id, rank, ip) VALUES ($1,'regress_skill',0,1)", [id]);
    const gone = await purgePlayers([id]);
    const left = await query(
      `SELECT (SELECT COUNT(*) FROM players WHERE id=$1) + (SELECT COUNT(*) FROM player_flags WHERE player_id=$1)
            + (SELECT COUNT(*) FROM player_skills WHERE player_id=$1) AS n`, [id]);
    check('purge removes the row and its per-player rows', gone === 1 && Number(left.rows[0].n) === 0, JSON.stringify({ gone, left: left.rows[0] }));
    id = null;

    // The sweep takes an expired guest and leaves a fresh one.
    const oldId = await insertNewPlayer({ username: `guest_rgold_${process.pid}`, handle: `Regress Old ${process.pid % 100000}`, role: 'guest' });
    const newId = await insertNewPlayer({ username: `guest_rgnew_${process.pid}`, handle: `Regress New ${process.pid % 100000}`, role: 'guest' });
    await query('UPDATE players SET last_seen = EXTRACT(EPOCH FROM NOW()) - 8*86400 WHERE id=$1', [oldId]);
    await sweepGuests();
    const ids = (await query('SELECT id FROM players WHERE id = ANY($1)', [[oldId, newId]])).rows.map(r => r.id);
    check('sweep purges a guest unseen for a week, keeps a fresh one', !ids.includes(oldId) && ids.includes(newId), JSON.stringify(ids));
    await purgePlayers([oldId, newId]);
  } finally {
    if (id) await purgePlayers([id]).catch(() => {});
  }
}
