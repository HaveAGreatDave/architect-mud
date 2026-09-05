// plugins/ascendant/regress.js — never loaded in production, only by the harness.
// The campus zones may not be imported in every dev DB, so we test the move-gate
// function directly with mock ctx objects rather than driving real movement.
import { getRegisteredMoveGates } from '../../server/engine/movement-gates.js';
import { getRegisteredSpecializedActions } from '../../server/engine/specializedActions.js';
import { query } from '../../server/models/db.js';
import { world } from '../../server/engine/world.js';
import { thresholdGate, specializedActions, _test } from './index.js';

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

  // ── The Rite of Ascension ──────────────────────────────────────────────────
  //
  // Nothing below ever runs the handler to completion, and that is deliberate:
  // the last thing it does is kill the shared harness player through the real
  // death path. What IS worth pinning is every refusal in front of that, plus
  // the room gate — because the failure mode of this verb is not an exception,
  // it is a player dying in the ordinary way after two quests told them they
  // would not.
  {
    check('the rite is exported for the loader, not self-registered',
      Array.isArray(specializedActions) && specializedActions[0]?.verb === 'ascend');
    const reg = getRegisteredSpecializedActions();
    check('ascend is registered, gated on furniture flags.asc_rite',
      (reg.ascend || []).some(e => e.requiredFlag === 'asc_rite'),
      JSON.stringify(reg.ascend));

    const player = getPlayer();
    const handler = specializedActions[0].handler;

    // The room gate. `requiredFlag` only drives discoverability, so a handler
    // that forgot to check the room would let `ascend` be typed in a bar.
    const savedZone = player.current_zone;
    const EMPTY = 'zone_regress_no_uplink';
    world.zones.set(EMPTY, { id: EMPTY, name: EMPTY, exits: [], npcs: new Set(), enemies: new Set(), players: new Set(), flags: {} });
    try {
      player.current_zone = EMPTY;
      const away = await handler([], 'ascend', player, null);
      check("ascend falls through anywhere there's no Uplink terminal", away === undefined, JSON.stringify(away));
    } finally {
      player.current_zone = savedZone;
      world.zones.delete(EMPTY);
    }

    // The refusal ladder, in order. Each names the missing thing, because a
    // ceremony that hides its cost is the one thing this system must not be.
    const { refusal } = _test.rite;
    const all = { chrome: true, pattern: true, policy: true, clean: true };
    check('no hardware is refused first', /nothing here to copy/i.test(refusal({ ...all, chrome: false }) || ''));
    check('no policy is refused as an empty account', /photograph/i.test(refusal({ ...all, policy: false }) || ''));
    check('no committed pattern is refused and sent to the Registry', /backup/i.test(refusal({ ...all, pattern: false }) || ''));

    // ⚠ THE ONE THAT MATTERS. plugins/augments' respawn hook declines to claim
    // the death of anybody at 1★+, so a wanted player at the Uplink would die
    // UNCLAIMED: no restore, chrome corrupted, quest not advanced. If this
    // refusal ever regresses, the Rite silently becomes a way to lose a
    // character, and it will look exactly like it worked right up until it did.
    check('a WANTED player is refused before the terminal fires',
      /warrant/i.test(refusal({ ...all, clean: false }) || ''), refusal({ ...all, clean: false }));

    check('a ready player is refused nothing', refusal(all) === null);

    // Readiness reads the two tables it claims to. The harness player has no
    // rows in either, so every gate must read false rather than throwing.
    const r = await _test.rite.readiness(player);
    check('readiness reports no chrome for a player with no augments row', r.chrome === false);
    check('readiness reports no policy for a player with no backup row', r.policy === false && r.pattern === false);

    // And the arm-then-run confirm is the Purifier's, not a bespoke one.
    check('the rite arms before it runs', _test.rite.CONFIRM_MS >= 10_000, String(_test.rite.CONFIRM_MS));

    // The terminal is placed. A ritual whose furniture never shipped is a quest
    // objective nobody can finish, and content:lint has no opinion about that.
    const { rows: term } = await query(
      "SELECT id, zone_id FROM furniture WHERE flags->>'asc_rite' = 'true'",
    );
    check('the Uplink terminal exists in the world', term.length >= 1,
      term.map(t => `${t.id}@${t.zone_id}`).join(', ') || 'none');
  }

  // ── Lapsing — the cheap exit ───────────────────────────────────────────────
  // ⚠ NOT DRIVEN END-TO-END ON THE SHARED FAKE PLAYER. `lapse()` deletes augment
  // rows, zeroes standing and clears four flags; running it here would hand the
  // next suite a player who had quietly been stripped. So this exercises the
  // read half — which is where the bug would be — and asserts the seams.
  {
    const { getRegisteredActions } = await import('../../server/engine/actions.js');
    const acts = getRegisteredActions();
    check('ASC_LAPSE is registered', acts.includes('ASC_LAPSE'), acts.length + ' actions');
    check('ASC_LAPSE_QUOTE is registered', acts.includes('ASC_LAPSE_QUOTE'));

    // The quote is what the scene shows a player BEFORE they answer, so it has
    // to survive a player who owns nothing rather than throwing at them.
    const q = await _test.lapse.lapseQuote(player);
    check('the quote answers for a player with no chrome and no cover',
      Array.isArray(q.augments) && q.augments.length === 0 && q.restores === 0, JSON.stringify(q));

    // "What they fitted" is `rep_gate`, and the whole design rests on that
    // column meaning something. If every augment were ungated, lapsing would
    // take nothing back and the exit would be free — silently.
    const { rows: gated } = await query(
      "SELECT COUNT(*)::int AS n FROM augments WHERE COALESCE(rep_gate,'unknown') <> 'unknown'",
    );
    check('the catalog actually gates chrome, or lapsing would cost nothing',
      gated[0].n > 0, `${gated[0].n} gated augments`);

    // …and it must not gate EVERYTHING either, or a lapse strips the back-alley
    // pieces the order never sold you.
    const { rows: open } = await query(
      "SELECT COUNT(*)::int AS n FROM augments WHERE COALESCE(rep_gate,'unknown') = 'unknown'",
    );
    check('…and leaves some chrome ungated, which is what a lapse must not take',
      open[0].n > 0, `${open[0].n} ungated augments`);
  }
}
