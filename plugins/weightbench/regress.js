// Gym plugin regression suite — run by tests/regress.js (never loaded in
// production). The fake player stands in a zone with no station, so we exercise
// the gated no-mutation paths (no real stat is granted) plus the pure rep curve.
import { _test } from './index.js';
import { STATIONS, STATION_VERBS, repsFor, setFlavor, stationFor } from './stations.js';
import { RAISABLE_STATS } from '../../server/engine/ip.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const bench = STATIONS.lift;

  // ── Rep cost curve (pure) — rises with level, never below base ─────────────
  check('reps at level 0 == base', repsFor(bench, 0) === bench.repsBase);
  check('reps rise with level', repsFor(bench, 5) > repsFor(bench, 1));
  check('reps step is per-level', repsFor(bench, 2) - repsFor(bench, 1) === bench.repsPerLevel);
  check('a negative level never dips below base', repsFor(bench, -3) === bench.repsBase);

  // ── The station table ──────────────────────────────────────────────────────
  // Every station must train a real column and be reachable by its own verb, or
  // the grind 500s on the one set that finally earns the point.
  for (const [verb, s] of Object.entries(STATIONS)) {
    check(`station ${verb} trains a raisable stat`, RAISABLE_STATS.includes(s.stat), s.stat);
    check(`station ${verb}'s key matches its verb`, s.verb === verb, `${s.verb} vs ${verb}`);
    check(`station ${verb} has an interaction key`, !!s.interaction, String(s.interaction));
    check(`station ${verb} burns stamina`, s.staPerSet > 0, String(s.staPerSet));
    check(`station ${verb} has all three fatigue tiers`,
      s.strong?.length && s.labored?.length && s.gassed?.length && s.gain?.length);
  }

  // Two stations sharing an interaction key would make one of them unreachable —
  // the furniture lookup takes the first match and the other verb never fires.
  const keys = STATION_VERBS.map(v => STATIONS[v].interaction);
  check('station interaction keys are unique', new Set(keys).size === keys.length, keys.join(','));
  // Likewise two stations on one stat would just be a slower duplicate.
  const stats = STATION_VERBS.map(v => STATIONS[v].stat);
  check('station stats are unique', new Set(stats).size === stats.length, stats.join(','));

  check('the three stations are the declared verbs',
    STATION_VERBS.join(',') === 'lift,spar,drill', STATION_VERBS.join(','));

  // Flavour must resolve at every tier — an empty tier would send `undefined` to
  // the player mid-set.
  for (const v of STATION_VERBS) {
    for (const frac of [1, 0.5, 0]) {
      check(`${v} flavour at ${frac} tank is a string`, typeof setFlavor(STATIONS[v], frac) === 'string');
    }
  }

  // ── Furniture styles (a heavy bag is `spar` with its own prose) ────────────
  // A style may only swap prose. If it could change the stat or the numbers, a piece of
  // furniture could quietly make one gym cheaper than another.
  for (const v of STATION_VERBS) {
    for (const [name, over] of Object.entries(STATIONS[v].styles || {})) {
      const s = stationFor(v, name);
      check(`${v}/${name} keeps the station's stat and verb`, s.stat === STATIONS[v].stat && s.verb === v, `${s.stat} ${s.verb}`);
      check(`${v}/${name} keeps the station's numbers`,
        s.setMs === STATIONS[v].setMs && s.staPerSet === STATIONS[v].staPerSet && s.repsBase === STATIONS[v].repsBase);
      check(`${v}/${name} has all three fatigue tiers`, s.strong?.length && s.labored?.length && s.gassed?.length && s.gain?.length);
      check(`${v}/${name} swaps the prose`, s.strong !== STATIONS[v].strong && typeof s.startLine('x') === 'string');
      for (const frac of [1, 0.5, 0]) check(`${v}/${name} flavour at ${frac} tank is a string`, typeof setFlavor(s, frac) === 'string');
      check(`${v}/${name} declares nothing a style cannot carry`, !('stat' in over) && !('verb' in over) && !('setMs' in over));
    }
  }
  check('an unknown style is the base station', stationFor('spar', 'no_such_style') === STATIONS.spar);
  check('no style is the base station', stationFor('spar', null) === STATIONS.spar);
  check('the boxing bag style exists', stationFor('spar', 'bag').noun === 'a heavy bag');

  // ── Command gating (no station in the fake player's zone) ──────────────────
  const saved = {
    posture: p.posture, brawn: p.stat_brawn, combat: p.npcCombatTargetId,
    statuses: p.statuses, stamina: p.stamina,
  };

  p.posture = 'standing';
  p.npcCombatTargetId = 'enemy_x';
  for (const v of STATION_VERBS) {
    const r = await run(v);
    check(`${v} blocked mid-combat`, /fight|busy|throwing things|cardio/i.test(r?.message || ''), r?.message);
  }

  p.npcCombatTargetId = null;
  let r = await run('lift');
  check('lift with no bench reports it', /weight bench/i.test(r?.message || ''), r?.message);
  r = await run('spar');
  check('spar with no wall reports it', /rebound wall/i.test(r?.message || ''), r?.message);
  r = await run('drill');
  check('drill with no circuit reports it', /circuit/i.test(r?.message || ''), r?.message);

  // ── Stamina/exhaustion gates (checked before the station lookup) ───────────
  p.statuses = [{ name: 'exhausted', duration: 10 }];
  for (const v of STATION_VERBS) {
    const res = await run(v);
    check(`${v} blocked while exhausted`, /wrecked|exhaust|hanging|wet rope/i.test(res?.message || ''), res?.message);
  }

  p.statuses = [];
  p.stamina = 3;   // below one set's worth — too winded to start
  for (const v of STATION_VERBS) {
    const res = await run(v);
    check(`${v} blocked when winded`, /winded|breath|blowing|tank/i.test(res?.message || ''), res?.message);
  }

  p.statuses = saved.statuses; p.stamina = saved.stamina;
  p.posture = saved.posture; p.stat_brawn = saved.brawn; p.npcCombatTargetId = saved.combat;
}
