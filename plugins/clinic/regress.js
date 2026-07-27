// Clinic plugin regression suite — run by tests/regress.js (never loaded in production).
import { dispatchAction } from '../../server/engine/actions.js';
import { treatmentQuote } from './index.js';

export default async function regress({ check, getPlayer }) {
  const p = getPlayer();
  p.hp_max = p.hp_max || 100;

  const treat = (params = {}) => dispatchAction({ type: 'CLINIC_TREAT', actor: p, params });

  // ── Quote maths (pure — no credits, no DB) ────────────────────────────────
  p.hp = p.hp_max;
  p.statuses = [];
  check('unhurt player is quoted nothing', treatmentQuote(p).cost === 0, JSON.stringify(treatmentQuote(p)));

  p.hp = p.hp_max - 40;
  check('quote scales with missing HP', treatmentQuote(p, { rate: 2, minimum: 10 }).cost === 80,
    `got ${treatmentQuote(p, { rate: 2, minimum: 10 }).cost}`);

  p.hp = p.hp_max - 1;
  check('quote floors at the minimum', treatmentQuote(p, { rate: 2, minimum: 10 }).cost === 10,
    `got ${treatmentQuote(p, { rate: 2, minimum: 10 }).cost}`);

  p.statuses = [{ name: 'bleeding', duration: 10 }];
  check('bleeding adds the surcharge', treatmentQuote(p, { rate: 2, minimum: 10, bleed_fee: 25 }).cost === 35,
    `got ${treatmentQuote(p, { rate: 2, minimum: 10, bleed_fee: 25 }).cost}`);

  // ── The Action itself ─────────────────────────────────────────────────────
  // `free` is used throughout: the fake player has no `players` row, so the
  // guarded credit UPDATE affects zero rows and every paid path correctly
  // refuses. That refusal is asserted on its own below.
  p.hp = p.hp_max;
  p.statuses = [];
  const unhurt = await treat({ free: true });
  check('CLINIC_TREAT returns a dialogue line', unhurt?.type === 'dialogue_line', JSON.stringify(unhurt)?.slice(0, 120));
  check('CLINIC_TREAT no-ops on an unhurt player', p.hp === p.hp_max, `hp ${p.hp}/${p.hp_max}`);

  p.hp = 12;
  p.statuses = [{ name: 'bleeding', duration: 10 }];
  p.healOverTime = [{ perTick: 5, ticksRemaining: 5 }];
  const done = await treat({ free: true });
  check('CLINIC_TREAT restores full HP', p.hp === p.hp_max, `hp ${p.hp}/${p.hp_max}`);
  check('CLINIC_TREAT stops the bleed', !p.statuses.some(s => s.name === 'bleeding'), JSON.stringify(p.statuses));
  check('CLINIC_TREAT clears pending heal-over-time', (p.healOverTime || []).length === 0, JSON.stringify(p.healOverTime));
  check('CLINIC_TREAT narrates the patch-up', /whole/i.test(done?.text || ''), (done?.text || '').slice(0, 120));

  // Unaffordable treatment must refuse WITHOUT healing — the guarded debit
  // fails for the fake player, which is exactly the broke-player path.
  p.hp = 12;
  p.statuses = [];
  const broke = await treat({ rate: 2, minimum: 10 });
  check('unaffordable treatment refuses', broke?.type === 'dialogue_line', JSON.stringify(broke)?.slice(0, 120));
  check('unaffordable treatment does not heal', p.hp === 12, `hp ${p.hp}`);
}
