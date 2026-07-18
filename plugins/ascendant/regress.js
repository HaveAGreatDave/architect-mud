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
}
