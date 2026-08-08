// Slots plugin regression — seeds a throwaway slot machine + a throwaway player
// (with a real players row so the credit debit/payout actually writes) and drives
// the real `spin` verb end-to-end: no-machine error, bet bounds, the guarded
// debit, and the win/loss net. Isolated from the shared harness player.
import { query } from '../../server/models/db.js';
import { insertFurniture, deleteFurniture, world } from '../../server/engine/world.js';
import { commands } from './index.js';

export default async function regress({ check }) {
  const Z = 'zone_slots_regress';
  const EMPTY = 'zone_slots_regress_empty';
  const FURN = 'furn_slots_regress';
  const PID = `slots_regress_${process.pid}`;
  const noop = () => {};
  const spin = (input, p) => commands.spin(input.split(/\s+/).filter(Boolean).slice(1), input, p, noop);
  const dbCredits = async () => Number((await query('SELECT credits FROM players WHERE id=$1', [PID])).rows[0]?.credits);

  const player = { id: PID, handle: 'SlotRegressor', current_zone: EMPTY, credits: 0 };
  world.players.set(PID, player);

  try {
    // Real players row so adjustCredits' guarded UPDATE has something to hit.
    await query('DELETE FROM players WHERE id=$1', [PID]).catch(() => {});
    await query('INSERT INTO players (id, username, handle, password_hash) VALUES ($1,$1,$2,$3)', [PID, player.handle, 'x']);
    await query('UPDATE players SET credits=100000 WHERE id=$1', [PID]);

    await insertFurniture({
      id: FURN, name: 'test bandit', description: 'a test slot machine', object_type: 'furniture',
      zone_id: Z, flags: JSON.stringify({ slot_machine: true, slot_min: 5, slot_max: 100, slot_default: 10, interactions: ['spin'] }),
    }, 'ON CONFLICT (id) DO UPDATE SET flags=EXCLUDED.flags, zone_id=EXCLUDED.zone_id');

    // No machine in the room → clean error.
    player.current_zone = EMPTY;
    let r = await spin('spin', player);
    check('spin with no machine errors cleanly', r?.type === 'error', JSON.stringify(r));

    player.current_zone = Z;

    // Bet below the minimum → error, no charge.
    let before = await dbCredits();
    r = await spin('spin 1', player);
    check('below-min bet is rejected', r?.type === 'error', JSON.stringify(r)?.slice(0, 120));
    check('rejected bet takes no credits', (await dbCredits()) === before, 'credits changed on a rejected bet');

    // Bet above the max → error.
    r = await spin('spin 999', player);
    check('above-max bet is rejected', r?.type === 'error', JSON.stringify(r)?.slice(0, 120));

    // A valid pull always resolves to the cabinet payload and always moves the
    // balance: a loss costs the bet, a win pays ≥2× the bet, so credits can never
    // land back on `before` regardless of the RNG outcome.
    //
    // `message` is asserted alongside the type on purpose. It is the RECORD — the
    // character box that always prints whether or not the graphical cabinet
    // opens — so a payload that stopped carrying it would leave the bottom
    // Display Mode rung with a spin it was never told the result of.
    before = await dbCredits();
    r = await spin('spin 5', player);
    check('valid spin returns a rendered machine', r?.type === 'slots_spin' && /pre/.test(r.message || ''), JSON.stringify(r)?.slice(0, 120));
    check('the cabinet payload carries the server-rolled reels', Array.isArray(r?.reels) && r.reels.length === 3, JSON.stringify(r?.reels));
    check('the marquee is the cabinet name, not a hardcoded venue', r?.marquee === 'TEST BANDIT', String(r?.marquee));
    const after = await dbCredits();
    check('a pull always moves the balance (win pays, loss costs)', after !== before, `before=${before} after=${after}`);
    check('a loss costs exactly the bet', after >= before || before - after === 5, `before=${before} after=${after}`);

    // Bare `spin` uses the machine default bet.
    r = await spin('spin', player);
    check('bare spin uses the default bet', r?.type === 'slots_spin', JSON.stringify(r)?.slice(0, 120));

    // Broke → the guarded debit rejects the pull.
    await query('UPDATE players SET credits=0 WHERE id=$1', [PID]);
    r = await spin('spin 5', player);
    check('a broke player cannot spin', r?.type === 'error', JSON.stringify(r)?.slice(0, 120));
    check('failed pull leaves the balance at zero', (await dbCredits()) === 0, 'credits moved on a failed pull');
  } finally {
    await deleteFurniture(FURN).catch(() => {});
    await query('DELETE FROM players WHERE id=$1', [PID]).catch(() => {});
    world.players.delete(PID);
  }
}
