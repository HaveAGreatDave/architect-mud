// Climbing plugin regression suite — run by tests/regress.js, never loaded in
// production. Climbing has no player verbs (it is automatic on movement, like
// swimming), so what there is to test is the LAW: which tiles open, for whom, and
// whether the answer is the same every time you ask it.
//
// The suite drives `runMoveGates` rather than the provider alone, because the
// thing being asserted is what a body may do — and the provider is only half of
// that. A test that called `climbCheck` directly would pass just as happily if the
// engine gate had stopped consulting it.
import { climbCost } from './index.js';
import { world, getZone } from '../../server/engine/world.js';
import { runMoveGates, hasClimbProvider } from '../../server/engine/movement-gates.js';
import { query } from '../../server/models/db.js';

const CLIFF = 'zone_regress_climb_cliff';
const SCREE = 'zone_regress_climb_scree';
const GEAR  = 'inv_regress_climb_rack';

export default async ({ check, getPlayer }) => {
  const player = getPlayer();
  const prevCliff = world.zones.get(CLIFF), prevScree = world.zones.get(SCREE);
  const savedStamina = player.stamina;

  // Synthetic tiles. `propsOf` falls back to a zone's own flags when there is no
  // derived row (the transient-zone rung), and both keys are in PROP_DEFAULTS, so
  // these resolve exactly as a painted cliff and a painted scree slope do without
  // needing a build to have run.
  const mk = (id, name, flags) => world.zones.set(id, {
    id, name, description: '', map_id: 'map_world', grid_x: 4000, grid_y: 4000,
    exits: {}, flags, players: new Set(), npcs: new Set(), enemies: new Set(),
  });

  try {
    mk(CLIFF, 'Regress Cliff', { passable: false });
    mk(SCREE, 'Regress Scree', { passable: false, climbable: true });

    check('the engine climb seam is filled — the plugin actually registered',
      hasClimbProvider());

    // ── The cost curve ────────────────────────────────────────────────────────
    // Pure math, so it is asserted directly rather than inferred from a stamina bar.
    check('a climb costs something at zero skill', climbCost(0) > 20, climbCost(0));
    check('…less as the skill rises', climbCost(8) < climbCost(0), `${climbCost(8)} < ${climbCost(0)}`);
    check('…and never falls below the floor, however good you get',
      climbCost(999) === climbCost(500) && climbCost(999) >= 5, climbCost(999));
    check('…monotonically, with no rung out of order',
      Array.from({ length: 20 }, (_, i) => climbCost(i)).every((c, i, a) => i === 0 || a[i - 1] >= c));

    const gate = async (to) => await runMoveGates({
      player, from: getZone(player.current_zone), to: world.zones.get(to), direction: 'north', door: null, opts: {},
    });

    // ── ⚠ THE INVARIANT THE WHOLE FEATURE RESTS ON ────────────────────────────
    // A bare cliff is absolutely impassable and NO GEAR OPENS ONE. If this ever
    // goes green-to-red, the map has stopped meaning what it draws: every funnel,
    // every wall, every "the only way in is the gate" in the world is soft. It is
    // asserted before and after the gear exists precisely so the gear cannot be
    // what makes it pass.
    const bareNoGear = await gate(CLIFF);
    check('a bare cliff refuses a body with no gear',
      bareNoGear?.block && /sheer/i.test(bareNoGear.message || ''), bareNoGear?.message);

    const screeNoGear = await gate(SCREE);
    check('a scree slope also refuses one — the terrain is not a doorway',
      !!screeNoGear?.block, screeNoGear?.message);
    // …but it refuses DIFFERENTLY, and that difference is the whole reason the
    // terrain is painted rather than being a flag on a cliff. A player who walks
    // into one has to be able to learn what it is from the refusal alone.
    check('…and it says what is missing rather than "no way up", which would teach nothing',
      /kit|hands/i.test(screeNoGear?.message || '') && !/sheer/i.test(screeNoGear?.message || ''),
      screeNoGear?.message);

    // ── With the rack in your hands ────────────────────────────────────────────
    await query(
      `INSERT INTO player_inventory (id, player_id, item_id, quantity, container_id)
       VALUES ($1,$2,'item_climbing_rack',1,NULL) ON CONFLICT (id) DO NOTHING`,
      [GEAR, player.id]
    ).catch(() => {});
    player.stamina = 100;

    const screeGear = await gate(SCREE);
    check('THE FEATURE: a scree slope opens for somebody carrying the gear', !screeGear?.block,
      screeGear?.message);

    const bareGear = await gate(CLIFF);
    check('⚠ …and the same gear still does NOTHING to a bare cliff',
      bareGear?.block && /sheer/i.test(bareGear.message || ''), bareGear?.message);

    // ── It is never a roll ────────────────────────────────────────────────────
    // The rule this feature had to survive is that "a wall you can sometimes get
    // over is not a funnel, it is a difficulty check". Twenty identical asks must
    // give twenty identical answers, or the map has stopped being plannable.
    const answers = new Set();
    for (let i = 0; i < 20; i++) answers.add(!!(await gate(SCREE))?.block);
    check('a climb is deterministic — same body, same rock, same answer every time',
      answers.size === 1 && !answers.has(true), [...answers].join(','));

    // ── Too tired to climb ────────────────────────────────────────────────────
    // Not a roll either: a hard number, and it refuses in the body's words. The
    // reserve is what stops the system stranding somebody halfway up its own map.
    player.stamina = 1;
    const spent = await gate(SCREE);
    check('an empty body is refused even holding the rack',
      !!spent?.block && /left in you|arms/i.test(spent.message || ''), spent?.message);
    check('…and that refusal is not the cliff line — it names the body, not the rock',
      !/sheer/i.test(spent?.message || ''), spent?.message);
  } finally {
    await query('DELETE FROM player_inventory WHERE id=$1', [GEAR]).catch(() => {});
    player.stamina = savedStamina;
    if (prevCliff) world.zones.set(CLIFF, prevCliff); else world.zones.delete(CLIFF);
    if (prevScree) world.zones.set(SCREE, prevScree); else world.zones.delete(SCREE);
  }
};
