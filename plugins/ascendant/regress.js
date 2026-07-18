// plugins/ascendant/regress.js — never loaded in production, only by the harness.
// The campus zones may not be imported in every dev DB, so we test the move-gate
// function directly with mock ctx objects rather than driving real movement.
import { getRegisteredMoveGates } from '../../server/engine/movement-gates.js';
import { thresholdGate } from './index.js';

export default async function regress({ check, getPlayer }) {
  check('threshold gate registered', getRegisteredMoveGates().includes('ascendant:threshold'));

  const player = getPlayer();
  const plain = { flags: {} };
  const gateTile = { flags: { ascendant_campus: true, ascension_gate: true } };
  const inner = { flags: { ascendant_campus: true } };

  // Non-campus destination → gate ignores it.
  check('ignores non-campus tiles',
    (await thresholdGate({ player, from: plain, to: plain })) === undefined);

  // The public Gate face is always enterable.
  check('public Gate face is open',
    (await thresholdGate({ player, from: plain, to: gateTile })) === undefined);

  // Moving within the campus (from an inner tile) is free.
  check('free movement once inside',
    (await thresholdGate({ player, from: inner, to: inner })) === undefined);

  // Entering an inner tile from outside, uncleared → blocked (non-lethal).
  const blocked = await thresholdGate({ player: { ...player, running: false, chromed: false }, from: plain, to: inner });
  check('inner ring refuses the uncleared', blocked?.block === true, blocked?.message);

  // Rushing the line (running) → the escalated turret warning.
  const rushed = await thresholdGate({ player: { ...player, running: true, chromed: false }, from: plain, to: inner });
  check('running the line draws a turret warning',
    rushed?.block === true && /turret/i.test(rushed.message || ''), rushed?.message);

  // Chromed players are always welcome.
  check('chromed players pass freely',
    (await thresholdGate({ player: { ...player, chromed: true }, from: plain, to: inner })) === undefined);

  // Rush escalation: a synthetic id (its own rush counter, no DB row to disturb).
  // First rush → warning, no HP loss; forcing it again → the turrets actually fire.
  const rusher = { id: `ascrush_${player.id}`, running: true, chromed: false, hp: 100, hp_max: 100 };
  const warn = await thresholdGate({ player: rusher, from: plain, to: inner });
  check('first rush is a warning (no damage)', warn?.block === true && rusher.hp === 100, `hp=${rusher.hp}`);
  const fire = await thresholdGate({ player: rusher, from: plain, to: inner });
  check('forcing the line draws turret FIRE (HP taken)',
    fire?.block === true && /fire/i.test(fire.message || '') && rusher.hp < 100,
    `hp=${rusher.hp} msg=${(fire?.message || '').slice(0, 60)}`);
}
