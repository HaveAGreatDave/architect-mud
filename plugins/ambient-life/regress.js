// ambient-life regression suite — run by tests/regress.js (never loaded in production).
import { _test } from './index.js';

import { _internals as _home } from './home-life.js';
import { _talk } from './home-talk.js';
import { drinkUp, tipsyOf } from './tipsy.js';
import { _intrusion } from './intrusion.js';
import { _eviction } from './eviction.js';
import { _panic, startPanic, bystanders, knowsAdmin } from './panic.js';
import { _remarks } from './remarks.js';
import { actOfLine } from '../../client/shared/npc-acts.js';
import { _blackout, zoneIsDark } from './blackout.js';
import { isDwellingZone } from '../../server/engine/zone-tags.js';
import { world, getZone, getZoneFurniture } from '../../server/engine/world.js';
import { isToilet, isShower, plumbingOf, npcFixtureFor, npcSitToilet, npcLeaveToilet, npcShowerOn, npcShowerOff, npcDoneWithFixtures } from '../bodily/index.js';

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
  check("match: a routine with no lines at all doesn't throw",
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
    check("home: no beat leaves a {thing} the pools can't fill",
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
    check("home: a sleeping NPC doesn't cook", down({ _ai: { homeSleeping: true } }) === true);
    check("home: an NPC dosed out doesn't cook", down({ _ai: { dosedOut: true } }) === true);
    check("home: anyone lying down doesn't cook", down({ _ai: {}, posture: 'lying' }) === true);

    // A kitchen, not a counter. 110 of the cast have their own workplace as
    // home_zone; without the dwelling test they cooked a meal on the shop floor.
    check('home: a rentable unit is a dwelling', isDwellingZone({ flags: { is_apartment: true } }) === true);
    check('home: an authored dwelling is a dwelling', isDwellingZone({ flags: { is_dwelling: true } }) === true);
    check("home: a shop floor isn't a dwelling", isDwellingZone({ flags: { is_interior: true, is_building: true } }) === false);
    check("home: a street tile isn't a dwelling", isDwellingZone({ flags: { street_life: true } }) === false);
    check("home: a missing zone isn't a dwelling", isDwellingZone(null) === false && isDwellingZone({}) === false);
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

    // What they go in for, and the fixtures they use for it: only what the room has, and the same maps a
    // player's use writes, so the bowl, the water and ROOM's picture all follow an NPC too.
    if (expectBath) {
      const { BATH_USE, pickBathUse, bathDoor, bathroomFree } = _home;
      const npc = { id: '__regress_bather', name: 'Bather' };
      const seen = new Set();
      for (let i = 0; i < 60; i++) { const u = pickBathUse(npc, expectBath, 'morning'); if (u) seen.add(u.intent); }
      const has = (k) => !!npcFixtureFor(expectBath, k);
      check('bath: every intent picked has its fixture in the room', [...seen].every((k) => BATH_USE[k] && has(k)), [...seen].join());
      check('bath: a room with a toilet gets toilet trips', !has('pee') || seen.has('pee'), [...seen].join());
      const door = bathDoor(expectParent, expectBath);
      check('bath: a free en-suite is free to go in', bathroomFree(expectBath, door, npc.id));
      const toilet = npcFixtureFor(expectBath, 'pee');
      if (toilet) {
        npcSitToilet(npc.id, expectBath, toilet.id, 'pee');
        check('bath: an NPC on the toilet is drawn peeing into it', plumbingOf(expectBath)[toilet.id]?.stream?.by === npc.id, JSON.stringify(plumbingOf(expectBath)[toilet.id]));
        check('bath: a seat taken by an NPC is not offered again', npcFixtureFor(expectBath, 'pee')?.id !== toilet.id);
        const flushed = npcLeaveToilet(npc.id, { flush: true }), st = plumbingOf(expectBath)[toilet.id];
        check('bath: getting up and flushing leaves a clean bowl, swirling', flushed && !st?.stream && !st?.level && !!st?.flushed, JSON.stringify(st));
      }
      const shower = npcFixtureFor(expectBath, 'shower');
      if (shower) {
        npcShowerOn(npc.id, expectBath, shower.id);
        check('bath: an NPC turning the shower on runs the water', plumbingOf(expectBath)[shower.id]?.shower === true);
        npcShowerOff(npc.id);
        check('bath: and off', !plumbingOf(expectBath)[shower.id]?.shower);
        npcShowerOn(npc.id, expectBath, shower.id);
        npcDoneWithFixtures(npc.id);
        check('bath: a trip cut short leaves no tap running', !plumbingOf(expectBath)[shower.id]?.shower);
      }
    }
  }

  // ── Somebody let themselves in ──
  // The reaction is only owed by people who LIVE here, and only to somebody who
  // doesn't. Every one of these gates existed as a bug first: a guest NPC
  // objecting to the owner, a corpse speaking, a shopkeeper defending a counter.
  {
    const { residentsOf, INTRUDER_LINES } = _intrusion;
    const ADMIN_LINES = [..._panic.ADMIN_START, ..._panic.ADMIN_KNOWN];
    check('intrusion: an admin gets a fright and then a recognition',
      _panic.ADMIN_START.length >= 3 && _panic.ADMIN_KNOWN.length >= 3 && _panic.ADMIN_KNOWN.some(l => /just you/i.test(l)));
    check('intrusion: intruder lines exist and name the NPC',
      INTRUDER_LINES.length >= 3 && INTRUDER_LINES.every(l => l.includes('{npc}')));
    // An admin is startled, never evicted or reported: the whole point of the split.
    check('intrusion: no admin line throws the player out or calls anybody',
      ADMIN_LINES.every(l => !/\b(out|leave|get out|five seconds|police|cops)\b/i.test(l)), ADMIN_LINES.join(' | '));
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

  // ── Panic and the police call (panic.js) ──
  // The words are what animate a body in ROOM (npc-acts.js reads an act off each line), so every line a
  // frightened NPC says has to name something the body does, and the admin path must never reach the phone.
  {
    const { PULSE, CALL_HOME, CALL_HACK, OPEN_HACK, CALM, clipFor, panics, recognised } = _panic;
    const acted = (l) => actOfLine(l);
    check('panic: every call line reads as a call to the police', [...CALL_HOME, ...CALL_HACK].every((l) => acted(l) === 'callcops' || acted(l) === 'backoff'),
      [...CALL_HOME, ...CALL_HACK].map((l) => `${acted(l)}: ${l}`).join(' | '));
    check('panic: every reaction while you stay is a body act', PULSE.every((l) => !!acted(l) && !!clipFor(l)), PULSE.map((l) => `${acted(l)}/${clipFor(l)}: ${l}`).join(' | '));
    check('panic: the opening and the calming lines animate too', [...OPEN_HACK, ...CALM].every((l) => !!acted(l)), [...OPEN_HACK, ...CALM].map((l) => `${acted(l)}: ${l}`).join(' | '));

    const zoneId = 'zone_panic_test';
    world.zones.set(zoneId, { id: zoneId, name: 'Landing', flags: {}, exits: {}, npcs: new Set(['n_pan', 'n_cop', 'n_cat']), enemies: new Set(), players: new Set() });
    world.npcs.set('n_pan', { id: 'n_pan', name: 'Pam Test', zone_id: zoneId });
    world.npcs.set('n_cop', { id: 'n_cop', name: 'Officer Test', zone_id: zoneId, flags: { police: true } });
    world.npcs.set('n_cat', { id: 'n_cat', name: 'Cat', zone_id: zoneId, flags: { animal: true } });
    const who = bystanders(zoneId).map((n) => n.id);
    check("panic: a cop and a cat don't panic, a bystander does", who.length === 1 && who[0] === 'n_pan', who.join(','));
    // An admin: the fright, then recognised, and after that nothing at all.
    const admin = { id: 'p_panic_admin', handle: 'Boss', role: 'admin' };
    check('panic: an admin startles somebody the first time', startPanic(world.npcs.get('n_pan'), admin, zoneId) === true);
    check('panic: …and is recognised from then on', knowsAdmin(world.npcs.get('n_pan'), admin));
    for (const p of panics.values()) for (const t of p.timers) clearTimeout(t);
    panics.clear();
    check('panic: a recognised admin gets no reaction', startPanic(world.npcs.get('n_pan'), admin, zoneId) === false);
    recognised.clear();
    for (const id of ['n_pan', 'n_cop', 'n_cat']) world.npcs.delete(id);
    world.zones.delete(zoneId);
  }

  // ── Said to you (remarks.js) ──
  // The register follows how well they know you, and what they can see beats small talk.
  {
    const { remarkFor, HELLO, CHAT, ABOUT } = _remarks;
    const npc = { id: 'n_remark', name: 'Rita Test' };
    const stranger = { id: 'p_r1', handle: 'Newbie', hp: 100, hp_max: 100, _relations: new Map() };
    const regular = { ...stranger, id: 'p_r2', handle: 'Regular Joe', _relations: new Map([[npc.id, { familiarity: 30, warmth: 80 }]]) };
    const enemy = { ...stranger, id: 'p_r3', _relations: new Map([[npc.id, { familiarity: 30, warmth: -80 }]]) };
    const all = (o) => Object.values(o).flat();
    check('remarks: every line is speech or an emote', [...all(HELLO), ...all(CHAT), ...all(ABOUT)].every((l) => !!(l.say || l.act)));
    check('remarks: no em dashes in what they say', [...all(HELLO), ...all(CHAT), ...all(ABOUT)].every((l) => !/—/.test(l.say || l.act)));
    check('remarks: a stranger gets no hello', remarkFor(npc, stranger, { hello: true }) === null);
    check('remarks: a regular gets one', !!remarkFor(npc, regular, { hello: true }));
    let hurtSeen = 0, enemyNice = 0;
    for (let i = 0; i < 40; i++) {
      const l = remarkFor(npc, { ...stranger, hp: 10 });
      if (ABOUT.hurt.includes(l)) hurtSeen++;
      if (!CHAT.hostile.includes(remarkFor(npc, enemy, { stars: 3 }))) enemyNice++;
    }
    check('remarks: somebody bleeding mostly gets asked about it', hurtSeen >= 20, hurtSeen);
    check('remarks: somebody who hates you only tells you to go away', enemyNice === 0, enemyNice);
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
    check("evict: a stranger doesn't belong", belongsHere(stranger, npc, zoneId) === false);
    check('evict: an admin is never thrown out',
      belongsHere({ ...stranger, role: 'admin' }, npc, zoneId) === true);
    // A regular is the relations substrate showing up in a doorway.
    const regular = { id: 'p_regular', handle: 'Regular', role: 'player',
      _relations: new Map([[npc.id, { familiarity: 30, warmth: 80 }]]) };
    check('evict: a regular is walked out, not thrown out', belongsHere(regular, npc, zoneId) === true);
    const hated = { id: 'p_hated', handle: 'Hated', role: 'player',
      _relations: new Map([[npc.id, { familiarity: 60, warmth: -80 }]]) };
    check("evict: knowing you well and hating you isn't belonging",
      belongsHere(hated, npc, zoneId) === false);
    // An eviction must never be a way to win a fight.
    check("evict: someone you're fighting isn't teleported away",
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

  // ── …and then the lights went out (blackout.js) ──
  // Three things are worth pinning: which transitions are worth a word at all,
  // who is in a position to say it, and that the three voices are actually
  // different voices rather than one pool with the nouns swapped.
  {
    const { LINES, reactorsIn, placeFor, kindOf } = _blackout;

    // Only the transitions somebody in the room could perceive.
    check('blackout: losing the supply is a beat', kindOf('powered', 'offline') === 'out');
    check('blackout: browning out is a beat', kindOf('powered', 'overloaded') === 'brown');
    check('blackout: coming back is a beat', kindOf('offline', 'powered') === 'back');
    // A zone already powered that the sim re-derives as powered changed nothing.
    check('blackout: powered → powered is not a beat', kindOf('powered', 'powered') === null);
    check('blackout: an unknown status is not a beat', kindOf('powered', 'clearing') === null);

    // Every line names the NPC. An unattributed one reads as the room talking.
    const pools = Object.entries(LINES).flatMap(([where, byKind]) =>
      Object.entries(byKind).map(([kind, lines]) => [`${where}.${kind}`, lines]));
    check('blackout: all nine pools are stocked',
      pools.length === 9 && pools.every(([, l]) => l.length >= 2),
      pools.map(([k, l]) => `${k}:${l.length}`).join(' '));
    check('blackout: every line names the NPC',
      pools.every(([, l]) => l.every(s => s.includes('{npc}'))),
      pools.find(([, l]) => l.some(s => !s.includes('{npc}')))?.[0]);
    // No prose in the game takes an em dash.
    check('blackout: no em dashes in any reaction',
      pools.every(([, l]) => l.every(s => !s.includes('—'))),
      pools.find(([, l]) => l.some(s => s.includes('—')))?.[0]);
    // The whole reason for the split: a shopkeeper must not complain about their
    // heating, and a tenant must not worry about the till.
    const joined = (where, kind) => LINES[where][kind].join(' ').toLowerCase();
    check('blackout: the counter is a work concern only',
      /till|stock|shift|freezer|counter/.test(joined('work', 'out'))
      && !/\btill\b|\bshift\b/.test(joined('home', 'out')), null);
    check('blackout: somebody merely passing through says the least',
      LINES.passing.out.every(l => l.length < 120), null);

    // Who gets to speak. Every gate here was a bad read first: a corpse with an
    // opinion, a shopkeeper narrating while a player is mid-purchase, and — the
    // one this file exists to get right — a sleeper sitting up for a power cut.
    const zoneId = 'zone_blackout_test';
    world.zones.set(zoneId, {
      id: zoneId, npcs: new Set(['b_ok', 'b_dead', 'b_asleep', 'b_shop', 'b_fight', 'b_mute', 'b_elsewhere']),
      enemies: new Set(), players: new Set(),
    });
    world.npcs.set('b_ok',        { id: 'b_ok',        name: 'Awake',   zone_id: zoneId, home_zone: zoneId });
    world.npcs.set('b_dead',      { id: 'b_dead',      name: 'Corpse',  zone_id: zoneId, _dead: true });
    world.npcs.set('b_asleep',    { id: 'b_asleep',    name: 'Sleeper', zone_id: zoneId, _ai: { homeSleeping: true } });
    world.npcs.set('b_shop',      { id: 'b_shop',      name: 'Keeper',  zone_id: zoneId, _ai: { shopPaused: true } });
    world.npcs.set('b_fight',     { id: 'b_fight',     name: 'Fighter', zone_id: zoneId, _combatTargetId: 'x' });
    world.npcs.set('b_mute',      { id: 'b_mute',      name: 'Quiet',   zone_id: zoneId, flags: { no_banter: true } });
    world.npcs.set('b_elsewhere', { id: 'b_elsewhere', name: 'Gone',    zone_id: 'zone_somewhere_else' });

    const ids = reactorsIn(zoneId).map(n => n.id);
    check('blackout: only the one person who could react does',
      ids.length === 1 && ids[0] === 'b_ok', ids.join(','));
    check('blackout: nobody wakes up for a power cut',
      !ids.includes('b_asleep'), ids.join(','));
    // ⚠ NOT eligibleNpcs(): that excludes an NPC on their vendor shift, which is
    // the exact person this feature is for. Pinned so a future tidy-up that
    // "unifies the predicates" fails here rather than silently in a shop.
    world.npcs.set('b_vendor', { id: 'b_vendor', name: 'Grocer', zone_id: zoneId, work_zone_id: zoneId, _ai: { vendor_was_working: true } });
    world.zones.get(zoneId).npcs.add('b_vendor');
    check('blackout: a vendor ON SHIFT is exactly who reacts',
      reactorsIn(zoneId).some(n => n.id === 'b_vendor'), null);
    check('blackout: an unknown zone yields nobody', reactorsIn('zone_nope').length === 0);

    // The trap that would switch off every domestic routine in the world: an
    // unwired zone answers 'unpowered', which is not the same as 'the lights went'.
    check('blackout: a zone with no power_zones row is not dark', zoneIsDark('zone_never_wired') === false);

    check('blackout: home is read off home_zone',
      placeFor({ home_zone: zoneId }, zoneId) === 'home');
    check('blackout: work is read off work_zone_id',
      placeFor({ work_zone_id: zoneId }, zoneId) === 'work');
    check('blackout: living over the shop is still at home in the flat',
      placeFor({ home_zone: zoneId, work_zone_id: zoneId }, zoneId) === 'home');
    check('blackout: anywhere else is passing through',
      placeFor({ home_zone: 'z1', work_zone_id: 'z2' }, zoneId) === 'passing');

    for (const id of ['b_ok', 'b_dead', 'b_asleep', 'b_shop', 'b_fight', 'b_mute', 'b_elsewhere', 'b_vendor']) world.npcs.delete(id);
    world.zones.delete(zoneId);
  }
  // ── Home talk: every topic resolves, forks read the temper, tags land ──
  {
    const a = { id: 'ht_a', name: 'Ada Pell' }, b = { id: 'ht_b', name: 'Bo Grint' }, c = { id: 'ht_c', name: 'Cy Moss' };
    const ctx = { dish: 'stew', drink: 'tea', neighbour: 'Nan', weather: 'this rain', phase: 'night', tv: 'Ring Fenced', team: 'Highlanders', stranger: true };
    const mem = { temper: 0, grudge: 'the soup', joke: 'Doug' };
    let dead = [];
    for (const t of [..._talk.TOPICS, ..._talk.THREE]) {
      t.steps.forEach((st, i) => {
        const alts = Array.isArray(st) ? st : [...st.calm, ...st.hot];
        for (const raw of alts) if (!_talk.resolveLine(raw, i % 2, [a, b, c], ctx, mem)) dead.push(t.id + ':' + raw);
      });
    }
    check('home talk: every line resolves with a full context', dead.length === 0, dead.slice(0, 3).join(' | '));
    const l = _talk.resolveLine('+"Label your own mouth. #grudge"', 1, [a, b], ctx, mem);
    check('home talk: + raises temper, tag parsed, speaker kept', l?.move === 1 && l.tags[0][0] === 'grudge' && l.who === 1 && l.text === '"Label your own mouth."', JSON.stringify(l));
    check('home talk: a missing token skips the line', _talk.resolveLine('"Did you see {team}?"', 0, [a, b], {}, mem) === null);
    check('home talk: {you} is the other one', _talk.resolveLine('"Hi {you}."', 0, [a, b], ctx, mem)?.text === '"Hi Bo."');
    const m = _talk.memoryOf(a, b);
    check('home talk: pair memory is order-free', _talk.memoryOf(b, a) === m);
    m.grudge = 'the rent'; m.temper = 3;
    let opened = 0;
    for (let i = 0; i < 200; i++) if (_talk.pickTopic([a, b], {}, m)?.callback === 'grudge') opened++;
    check('home talk: a grudge gets brought up', opened > 20, opened);
    check('home talk: the grudge topic is not re-picked fresh', !Array.from({ length: 200 }, () => _talk.pickTopic([a, b], {}, { ...m, joke: null, grudge: 'the rent' })).some((t) => t.label === 'the rent'));
    _talk.pairs.clear();
    const sc = _home.soloScene('night', true);
    check('home life: solo scenes come back with beats', Array.isArray(sc.beats) && sc.beats.length > 0 && !!sc.kind, sc.kind);
    // the body goes with the words: a raised line in a hot talk is 'hot', a storm-off is 'storm', a laugh a laugh
    const tone = (raw, temper) => _talk.toneOf(_talk.resolveLine(raw, 0, [a, b], ctx, mem), temper, 0);
    check('home talk: tones', tone('+"Label your own mouth. #grudge"', 2) === 'hot' && tone('+"Label your own mouth."', 0) === 'cross'
      && tone('+"Bed. #storm"', 0) === 'storm' && tone('-laughs. "Fair."', 0) === 'laugh' && tone('-"Good. #make-up"', 0) === 'warm');
    // drink: one at home is tipsy 1, five is 3, and a drunk pair mostly gets the drunk topics
    const sot = {}; drinkUp(sot); const one = tipsyOf(sot); drinkUp(sot, 4);
    check('tipsy: drinks add up', one === 1 && tipsyOf(sot) === 3, [one, tipsyOf(sot)]);
    let drunkTopics = 0;
    for (let i = 0; i < 200; i++) if (_talk.pickTopic([a, b], { tipsy: 2 }, { temper: 0 }).id.startsWith('drunk')) drunkTopics++;
    check('home talk: a drunk pair mostly gets the drunk topics', drunkTopics > 100, drunkTopics);
  }

}
