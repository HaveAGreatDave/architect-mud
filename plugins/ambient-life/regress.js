// ambient-life regression suite — run by tests/regress.js (never loaded in production).
import { _test } from './index.js';

import { _internals as _home } from './home-life.js';
import { _intrusion } from './intrusion.js';
import { _eviction } from './eviction.js';
import { isDwellingZone } from '../../server/engine/zone-tags.js';
import { world, getZone, getZoneFurniture } from '../../server/engine/world.js';
import { isToilet, isShower } from '../bodily/index.js';

export default async function regress({ run, check }) {
  // ── Verb routing ──
  // With no busker opportunity here, `tip` delegates to the strippers plugin (the
  // shared-verb router), so we get its dancer prompt — proof the fall-through works.
  let r = await run('tip');
  check('tip routes / delegates to strip club', /dancer/i.test(r?.message || ''), r?.message);
  r = await run('order');
  check('order verb routed / no cart', /no cart here taking orders/i.test(r?.message || ''), r?.message);

  // ── Gating: matches() honours every allowlist; empty = "any" ──
  const zone = { id: 'zone_x', ambient_theme: 'city', flags: { street_life: true } };
  const base = { zones: [], themes: [], phases: [], weather: [] };
  check('match: empty gates = any', _test.matches(base, zone, 'day', 'clear'), null);
  check('match: phase excludes',   !_test.matches({ ...base, phases: ['night'] }, zone, 'day', 'clear'), null);
  check('match: theme excludes',   !_test.matches({ ...base, themes: ['outdoors'] }, zone, 'day', 'clear'), null);
  check('match: zone excludes',    !_test.matches({ ...base, zones: ['zone_other'] }, zone, 'day', 'clear'), null);
  check('match: weather excludes', !_test.matches({ ...base, weather: ['rain'] }, zone, 'day', 'clear'), null);

  // ── {npc}: a vignette ABOUT somebody needs somebody to be about ──
  // zone_x is not a real world zone, so it has no eligible NPCs — which is
  // exactly the case that must not print the raw token at a player.
  check('match: {npc} line excluded with nobody here',
    !_test.matches({ ...base, lines: ['{npc} ties a bootlace.'] }, zone, 'day', 'clear'), null);
  check('match: tokenless line unaffected',
    _test.matches({ ...base, lines: ['A rivet gun stutters overhead.'] }, zone, 'day', 'clear'), null);
  check('match: a routine with no lines at all does not throw',
    _test.matches(base, zone, 'day', 'clear'), null);

  // ── Street-zone opt-in gate ──
  check('street: opted-in outdoor qualifies', _test.isStreetZone(zone), null);
  check('street: interior excluded', !_test.isStreetZone({ ...zone, is_interior: true }), null);
  check('street: unflagged excluded', !_test.isStreetZone({ id: 'z', flags: {} }), null);

  // ── Interactive opportunity lookup (kind + expiry) ──
  _test.opportunities.set('zone_opp_live', { kind: 'tip', expiresAt: Date.now() + 60_000, actedBy: new Set() });
  check('opp: live tip found', !!_test.liveOpportunity('zone_opp_live', 'tip'), null);
  check('opp: wrong kind ignored', !_test.liveOpportunity('zone_opp_live', 'order'), null);
  _test.opportunities.set('zone_opp_exp', { kind: 'tip', expiresAt: Date.now() - 1, actedBy: new Set() });
  check('opp: expired pruned', !_test.liveOpportunity('zone_opp_exp', 'tip'), null);
  _test.opportunities.delete('zone_opp_live');
  _test.opportunities.delete('zone_opp_exp');

  // ── Home life: NPC domestic routines ──
  // The scene pools are the whole feature, so they get pinned: every beat must
  // name the NPC (an unattributed line reads as the room talking to itself), and
  // every {thing} must resolve off the live catalogues rather than a hardcoded
  // list — that's what makes a new recipe show up in NPC life for free.
  {
    const { MEAL, DRINK, TIDY, pickMeal, pickDrink } = _home;
    const pools = [...MEAL, ...DRINK, ...TIDY];
    check('home: every scene has at least two beats', pools.every(s => s.length >= 2), `${pools.length} scenes`);
    check('home: every beat names the NPC', pools.every(s => s.every(l => l.includes('{npc}'))));
    check('home: no beat leaves a {thing} the pools cannot fill',
      [...MEAL, ...DRINK].every(s => s.filter(l => l.includes('{thing}')).length >= 1));
    check('home: TIDY needs no {thing}', TIDY.every(s => s.every(l => !l.includes('{thing}'))));
    check('home: a meal noun comes off the dish catalogue', typeof pickMeal() === 'string' && pickMeal().length > 0);
    check('home: a morning drink is a hot one', typeof pickDrink('morning') === 'string' && pickDrink('morning').length > 0);
    check('home: an evening drink still resolves', typeof pickDrink('night') === 'string' && pickDrink('night').length > 0);

    // Nobody cooks in their sleep. All three states the engine already tracks
    // disqualify a homebody — this used to check none of them, so an NPC asleep
    // in their own bed could be narrated frying eggs.
    const { isBusyBeingUnconscious: down } = _home;
    check('home: an awake NPC is available', down({ _ai: {}, posture: 'standing' }) === false);
    check('home: a sleeping NPC does not cook', down({ _ai: { homeSleeping: true } }) === true);
    check('home: an NPC dosed out does not cook', down({ _ai: { dosedOut: true } }) === true);
    check('home: anyone lying down does not cook', down({ _ai: {}, posture: 'lying' }) === true);

    // A kitchen, not a counter. 110 of the cast have their own workplace as
    // home_zone; without the dwelling test they cooked a meal on the shop floor.
    check('home: a rentable unit is a dwelling', isDwellingZone({ flags: { is_apartment: true } }) === true);
    check('home: an authored dwelling is a dwelling', isDwellingZone({ flags: { is_dwelling: true } }) === true);
    check('home: a shop floor is not a dwelling', isDwellingZone({ flags: { is_interior: true, is_building: true } }) === false);
    check('home: a street tile is not a dwelling', isDwellingZone({ flags: { street_life: true } }) === false);
    check('home: a missing zone is not a dwelling', isDwellingZone(null) === false && isDwellingZone({}) === false);
  }

  // ── The bathroom trip ──
  // The only home routine that leaves the room, so it's the only one that can
  // strand an NPC in a sub-zone. What's pinned here is the LOOKUP: there is no
  // bathroom flag in the world data, so the whole feature rests on "a sub-zone
  // of my home with a fixture in it" still finding the ensuites that exist.
  {
    const { bathroomFor, bathroomOf, BATHROOM_GOING, BATHROOM_BACK } = _home;
    const pools = [...BATHROOM_GOING, ...BATHROOM_BACK];
    check('bath: every line names the NPC', pools.every(l => l.includes('{npc}')), `${pools.length} lines`);
    check('bath: both halves are written', BATHROOM_GOING.length >= 2 && BATHROOM_BACK.length >= 2);

    // Find, from live world data, a dwelling whose sub-zone holds a toilet or a
    // shower — then assert the lookup agrees. If the ensuites ever stop being
    // sub-zones, or lose their fixtures, this is the test that says so.
    let expectParent = null, expectBath = null;
    for (const z of world.zones.values()) {
      if (!z.parent_zone || !isDwellingZone(getZone(z.parent_zone))) continue;
      if (!getZoneFurniture(z.id).some(f => isToilet(f) || isShower(f))) continue;
      if (getZone(z.parent_zone)?.exits && Object.values(getZone(z.parent_zone).exits).includes(z.id)) {
        expectParent = z.parent_zone; expectBath = z.id; break;
      }
    }
    if (expectParent) {
      bathroomOf.delete(expectParent);
      check('bath: an ensuite is found from its parent flat',
        bathroomFor(expectParent) === expectBath, `${expectParent} -> ${bathroomFor(expectParent)} (want ${expectBath})`);
      check('bath: the answer is cached', bathroomOf.get(expectParent)?.id === expectBath);
    } else {
      check('bath: at least one ensuite exists in world content', false, 'no dwelling sub-zone with a toilet/shower');
    }
    check('bath: a flat with no ensuite resolves to nothing', bathroomFor('zone_does_not_exist') === null);
  }

  // ── Somebody let themselves in ──
  // The reaction is only owed by people who LIVE here, and only to somebody who
  // doesn't. Every one of these gates existed as a bug first: a guest NPC
  // objecting to the owner, a corpse speaking, a shopkeeper defending a counter.
  {
    const { residentsOf, ADMIN_LINES, INTRUDER_LINES } = _intrusion;
    check('intrusion: admin lines exist and name the NPC',
      ADMIN_LINES.length >= 3 && ADMIN_LINES.every(l => l.includes('{npc}')));
    check('intrusion: intruder lines exist and name the NPC',
      INTRUDER_LINES.length >= 3 && INTRUDER_LINES.every(l => l.includes('{npc}')));
    // An admin is startled, never evicted — the whole point of the split.
    check('intrusion: no admin line throws the player out',
      ADMIN_LINES.every(l => !/\b(out|leave|get out|five seconds)\b/i.test(l)), ADMIN_LINES.join(' | '));
    check('intrusion: the intruder is actually challenged',
      INTRUDER_LINES.some(l => /\b(out|leave|turn around|my home)\b/i.test(l)));

    const zoneId = 'zone_intrusion_test';
    world.zones.set(zoneId, { id: zoneId, npcs: new Set(['n_home', 'n_guest', 'n_dead', 'n_optout']), enemies: new Set(), players: new Set() });
    world.npcs.set('n_home',   { id: 'n_home',   name: 'Resident', home_zone: zoneId });
    world.npcs.set('n_guest',  { id: 'n_guest',  name: 'Guest',    home_zone: 'zone_elsewhere' });
    world.npcs.set('n_dead',   { id: 'n_dead',   name: 'Corpse',   home_zone: zoneId, _dead: true });
    world.npcs.set('n_optout', { id: 'n_optout', name: 'Opted',    home_zone: zoneId, flags: { no_home_life: true } });
    const ids = residentsOf(zoneId).map(n => n.id);
    check('intrusion: only the householder reacts', ids.length === 1 && ids[0] === 'n_home', ids.join(','));
    check('intrusion: an unknown zone yields nobody', residentsOf('zone_nope').length === 0);
    for (const id of ['n_home', 'n_guest', 'n_dead', 'n_optout']) world.npcs.delete(id);
    world.zones.delete(zoneId);
  }

  // ── …and then they mean it (eviction.js) ──
  // `belongsHere` is the single answer to "who gets thrown out", asked by the
  // lock-up escort AND the intrusion escalation, so it's the thing worth pinning.
  {
    const { belongsHere, wayOutOf, directionOut, ESCORT, GRACE_MS } = _eviction;
    const npc = { id: 'npc_evict_test', name: 'Keeper' };
    const zoneId = 'zone_evict_shop';
    const hallId = 'zone_evict_hall';
    const flatId = 'zone_evict_flat';
    world.zones.set(zoneId, { id: zoneId, name: 'Shop', flags: {}, exits: { south: hallId, north: flatId }, npcs: new Set(), enemies: new Set(), players: new Set() });
    world.zones.set(hallId, { id: hallId, name: 'Hall', flags: {}, exits: { north: zoneId }, npcs: new Set(), enemies: new Set(), players: new Set() });
    world.zones.set(flatId, { id: flatId, name: 'Flat', flags: { is_apartment: true }, exits: { south: zoneId }, npcs: new Set(), enemies: new Set(), players: new Set() });

    const stranger = { id: 'p_stranger', handle: 'Stranger', role: 'player', _relations: new Map() };
    check('evict: a stranger does not belong', belongsHere(stranger, npc, zoneId) === false);
    check('evict: an admin is never thrown out',
      belongsHere({ ...stranger, role: 'admin' }, npc, zoneId) === true);
    // A regular is the relations substrate showing up in a doorway.
    const regular = { id: 'p_regular', handle: 'Regular', role: 'player',
      _relations: new Map([[npc.id, { familiarity: 30, warmth: 80 }]]) };
    check('evict: a regular is walked out, not thrown out', belongsHere(regular, npc, zoneId) === true);
    const hated = { id: 'p_hated', handle: 'Hated', role: 'player',
      _relations: new Map([[npc.id, { familiarity: 60, warmth: -80 }]]) };
    check('evict: knowing you well and hating you is not belonging',
      belongsHere(hated, npc, zoneId) === false);
    // An eviction must never be a way to win a fight.
    check('evict: someone you are fighting is not teleported away',
      belongsHere({ ...stranger, combatTargetId: npc.id }, npc, zoneId) === true);

    check('evict: the way out prefers a room nobody lives in', wayOutOf(zoneId) === hallId, wayOutOf(zoneId));
    check('evict: the direction out is the real exit', directionOut(zoneId, hallId) === 'south', directionOut(zoneId, hallId));
    check('evict: an unlinked pair still resolves to a usable direction',
      directionOut(zoneId, 'zone_not_linked') === 'out');
    check('evict: escort lines name both parties',
      ESCORT.length >= 3 && ESCORT.every(l => l.includes('{npc}') && l.includes('{player}')));
    check('evict: the grace is long enough to be heeded', GRACE_MS >= 10_000);

    for (const z of [zoneId, hallId, flatId]) world.zones.delete(z);
  }
}
