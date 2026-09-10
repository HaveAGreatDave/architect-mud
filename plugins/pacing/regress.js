/**
 * pacing regress — run by tests/regress.js (never loaded in production).
 *
 * The cadence gate is tested directly (fabricated ctx) so it doesn't depend on the
 * fake player's exit layout; the sprint toggle is driven through real dispatch.
 * We cancel any armed drain timer after the queue asserts so no real setTimeout
 * fires mid-suite.
 */
import { cadenceGate, _test } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const saved = { sprinting: p._sprinting, winded: p._winded, last: p._lastStepAt, stamina: p.stamina };

  // ── Cadence gate: a too-fast step is QUEUED (silent block), not rejected ────
  _test.cancelQueue(p);
  p._sprinting = false;
  p._lastStepAt = Date.now();
  let v = cadenceGate({ player: p, direction: 'north', opts: {} });
  check('too-fast step is silently blocked', v?.block === true && v?.silent === true, JSON.stringify(v));
  check('too-fast step is enqueued', p._moveQueue?.length === 1, JSON.stringify(p._moveQueue));

  // A second one stacks; the queue caps at MAX_QUEUE with a real (non-silent) message.
  for (let i = 0; i < _test.MAX_QUEUE + 3; i++) cadenceGate({ player: p, direction: 'north', opts: {} });
  check('queue caps at MAX_QUEUE', p._moveQueue.length === _test.MAX_QUEUE, String(p._moveQueue.length));
  v = cadenceGate({ player: p, direction: 'north', opts: {} });
  check('full queue blocks with a visible message', v?.block === true && !v?.silent && /queued/i.test(v?.message || ''), JSON.stringify(v));
  _test.cancelQueue(p);

  // Old enough → passes immediately (no queue).
  p._lastStepAt = Date.now() - (_test.WALK_COOLDOWN_MS + 50);
  check('cadence passes after cooldown elapses', cadenceGate({ player: p, direction: 'north', opts: {} }) === undefined);
  check("a ready step doesn't enqueue", (p._moveQueue?.length || 0) === 0);

  // ── Drained + system steps skip the queue entirely ─────────────────────────
  p._lastStepAt = Date.now();
  check("drained step (_pacingDrain) isn't re-queued",
    cadenceGate({ player: p, direction: 'north', opts: { _pacingDrain: true } }) === undefined);
  check("bypassEncumbrance step isn't queued",
    cadenceGate({ player: p, direction: 'north', opts: { bypassEncumbrance: true } }) === undefined);
  check('neither exempt step enqueued anything', (p._moveQueue?.length || 0) === 0);

  // ── Road speedup: roads (and arteries) carry a ×ROAD_SPEEDUP movement factor ──
  check('road_ tile is ×ROAD_SPEEDUP', _test.roadSpeedFactor({ flags: { icon: 'road_ns' } }) === _test.ROAD_SPEEDUP);
  check('runway_ tile is ×ROAD_SPEEDUP', _test.roadSpeedFactor({ flags: { icon: 'runway_18' } }) === _test.ROAD_SPEEDUP);
  check('marked artery is ×ROAD_SPEEDUP', _test.roadSpeedFactor({ flags: { artery: ['Haul Road'] } }) === _test.ROAD_SPEEDUP);
  check('plain tile is ×1', _test.roadSpeedFactor({ flags: {} }) === 1);
  check('missing/water tile is ×1 (not sped up)', _test.roadSpeedFactor(null) === 1 && _test.roadSpeedFactor({ flags: { terrain: 'water' } }) === 1);

  // ── Sprint toggle ──────────────────────────────────────────────────────────
  p._winded = false;
  p.stamina = 100;
  let r = await run('sprint on');
  check('sprint on confirms', r?.type !== 'error' && p._sprinting === true, r?.message);

  r = await run('sprint off');
  check('sprint off confirms', r?.type !== 'error' && p._sprinting === false, r?.message);

  // ── Sprint refused below the floor ─────────────────────────────────────────
  p._sprinting = false;
  p._winded = false;
  p.stamina = _test.SPRINT_FLOOR - 1;
  r = await run('sprint on');
  check('sprint refused when below floor', r?.type === 'error' && p._sprinting === false, r?.message);

  // ── Sprint refused while winded until recovery threshold ───────────────────
  p._winded = true;
  p.stamina = _test.WINDED_RECOVER - 1;
  r = await run('sprint on');
  check('sprint refused while winded below recover', r?.type === 'error' && p._sprinting === false, r?.message);

  p.stamina = _test.WINDED_RECOVER;
  r = await run('sprint on');
  check('sprint allowed once recovered from winded', p._sprinting === true && p._winded === false, r?.message);

  _test.cancelQueue(p);
  Object.assign(p, { _sprinting: saved.sprinting, _winded: saved.winded, _lastStepAt: saved.last, stamina: saved.stamina });
}
