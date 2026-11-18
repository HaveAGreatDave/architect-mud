// pets plugin regression suite: run by tests/regress.js, never loaded in production.
//
// What has to hold: every pet row loads and points at an NPC that exists, is flagged as that pet and as an animal; the
// Room Stage draws a pet as a cat and never also as a person; and nothing is special to any one cat.
import { _test as pets } from './index.js';
import { _test as stage } from '../roomstage/index.js';
import { world, getZone } from '../../server/engine/world.js';
import { catLook, EAR_MOODS } from '../../client/game/js/panels/gl/cat-kit.js';
import { CLIP_NAMES } from '../../client/game/js/panels/gl/cat-clips.js';
import { catLife, catPerchOf, catSettle, perchSoft, bowlTimes, bowlLevel, catMeets, catNeeds, catAtBowls, trayTimes, trayState, catAtTray, TRAY_FULL, MEET_KINDS, DAY_MS } from '../../client/shared/cat-life.js';
import { LITTER } from '../../client/game/js/panels/gl/cat-clips.js';
import { query } from '../../server/models/db.js';
import { mainOf } from '../roomstage/index.js';
import { MEET_PLAN } from '../../client/game/js/panels/gl/cat-meet.js';
import { BREEDS } from '../../client/game/js/panels/gl/cat-breeds.js';
import { allExits } from '../../server/engine/exits.js';

export default async function regress({ check }) {
  const { PETS, petOfNpc, npcBeast } = pets;
  check('pets: the table loads', PETS.size >= 1, `${PETS.size} rows`);

  for (const p of PETS.values()) {
    const npc = world.npcs.get(p.npcId);
    check(`pets: ${p.id} has its NPC`, !!npc, p.npcId);
    if (!npc) continue;
    check(`pets: ${p.id}'s NPC names it in flags.pet`, npc.flags?.pet === p.id, String(npc.flags?.pet));
    check(`pets: ${p.id}'s NPC is an animal`, npc.flags?.animal === true);
    check(`pets: ${p.id} resolves from its NPC`, petOfNpc(npc) === p);
    let ok = true;
    try { catLook(JSON.parse(JSON.stringify(p.look))); } catch { ok = false; }
    check(`pets: ${p.id}'s look is a cat the kit can build`, p.species !== 'cat' || ok);

    // the stage: in its home it's a beast with a cat body, and never also one of the people
    const zone = npc.zone_id || npc.home_zone;
    if (!zone) continue;
    const beasts = stage.beastsIn(zone), people = stage.peopleIn(zone, []);
    const as = beasts.find((b) => b.id === npc.id);
    check(`pets: ${p.id} is drawn as a cat in ${zone}`, !!as?.cat, JSON.stringify(beasts.map((b) => b.id)));
    check(`pets: ${p.id} is not drawn as a person too`, !people.some((x) => x.id === npc.id));
  }

  // a person is never answered for, and an animal that isn't a pet isn't either
  check('pets: a person is no beast', npcBeast({ id: 'npc_nobody', name: 'Nobody', flags: {} }) === null);
  check('pets: an animal with no pet row is no beast', npcBeast({ id: 'npc_nobody', name: 'Nobody', flags: { animal: true } }) === null);

  // its day: the same answer twice, and a real clip or move at every hour
  const ACTS = new Set([...CLIP_NAMES, 'wander', 'zoomies']);
  for (const p of PETS.values()) {
    let ok = true, same = true;
    for (let h = 0; h < 24; h++) for (let k = 0; k < 6; k++) {
      const now = Date.UTC(2026, 10, 14, h, k * 7), a = catLife(p.npcId, now, h, p.personality), b = catLife(p.npcId, now, h, p.personality);
      if (!ACTS.has(a.act) || !a.spot) ok = false;
      if (JSON.stringify(a) !== JSON.stringify(b)) same = false;
    }
    check(`pets: ${p.id}'s day is all clips it has`, ok);
    check(`pets: ${p.id}'s day is the same for everybody`, same);
  }

  // somebody coming in: it greets them at the door they came by (or, asleep or busy, says why not), and the stage gets
  // the beat with the beast
  const { BEATS, STROKES, onEntered, onPetAttempt, setBeat } = pets;
  const first = [...PETS.values()][0], npc = first && world.npcs.get(first.npcId), zone = npc && (npc.zone_id || npc.home_zone);
  const way = zone && allExits(getZone(zone)).find((e) => e.target && !String(e.target).includes(zone));
  if (npc && way) {
    let greeted = null;
    for (let i = 0; i < 40 && !greeted; i++) {
      setBeat(npc, null, zone);
      const actor = { id: `p_pet_test_${i}`, handle: `Tester${i}`, current_zone: zone };
      onEntered({ actor, zone, from: way.target });
      if (BEATS.get(npc.id)?.act === 'greet') greeted = BEATS.get(npc.id);
    }
    check('pets: somebody coming in is greeted, sooner or later', !!greeted);
    check('pets: the greeting goes to the door they came by', greeted?.door === way.dir, `${greeted?.door} vs ${way.dir}`);
    check('pets: the stage gets the beat with the beast', npcBeast(npc)?.beat?.act === 'greet');
    check('pets: the stage gets its nature', typeof npcBeast(npc)?.nature === 'object');

    // the petting ladder: welcome, welcome, a twitch, a look, then the swat
    setBeat(npc, null, zone);
    const hand = { id: 'p_pet_test_hand', handle: 'Hand', current_zone: zone }, said = [];
    for (let i = 0; i < 5; i++) said.push(onPetAttempt({ player: hand, npc: { ...npc }, zoneId: zone })?.message || '');
    check('pets: a stroke is claimed', said.every((s) => s.length > 0), JSON.stringify(said));
    check('pets: the third stroke is the tail twitching', /tail/.test(said[2]), said[2]);
    check('pets: the fourth is the ears and the look', /ears/.test(said[3]), said[3]);
    check('pets: the fifth is the swat', /swats/.test(said[4]), said[4]);
    check('pets: and then it is cross', BEATS.get(npc.id)?.act === 'cross');
    check('pets: the ladder starts again after the swat', !STROKES.has(npc.id + ':' + hand.id));
    check('pets: a pet line never names its owner or itself in code', !said.some((s) => /\$\w/.test(s)));
    setBeat(npc, null, zone);

    // by spot: a long scratch under the chin before he's had enough; the belly is mostly a trap; the same answer again
    // soon is a noop, the picture carrying it
    const { petSpot, STROKE_SAID } = pets, chinHand = { id: 'p_pet_test_chin', handle: 'Chin', current_zone: zone };
    let chinGoes = 0, quiet = 0;
    for (let i = 0; i < 40; i++) {
      const r = onPetAttempt({ player: chinHand, npc: { ...npc }, zoneId: zone, spot: 'chin' });
      if (r?.type === 'noop') quiet++;
      if (BEATS.get(npc.id)?.act === 'cross') break;
      chinGoes++;
    }
    check('pets: under the chin takes a long while to wear thin', chinGoes >= 12, `${chinGoes} strokes`);
    check('pets: steady stroking is mostly quiet in the text', quiet >= 5, `${quiet} noops`);
    setBeat(npc, null, zone); STROKES.clear(); STROKE_SAID.clear();
    let trapped = 0;
    for (let i = 0; i < 6; i++) {
      const h = { id: 'p_pet_test_belly' + i, handle: 'Belly' + i, current_zone: zone };
      petSpot(h, npc, zone, 'belly'); petSpot(h, npc, zone, 'belly');
      if (BEATS.get(npc.id)?.act === 'cross') trapped++;
      setBeat(npc, null, zone);
    }
    check('pets: the belly is a trap', trapped >= 5, `${trapped} of 6`);
    setBeat(npc, null, zone); STROKES.clear(); STROKE_SAID.clear();
  }

  // his bowls: every pet's station loads, its levels are 0..1, the Stage gets them, examine says them, and refill
  // refuses somebody broke and somewhere without bowls
  const { BOWLS, levelsOf, pieceState, describeBowls, cmdRefill } = pets;
  for (const b of BOWLS.values()) {
    const l = levelsOf(b);
    check(`pets: ${b.id}'s levels are 0..1`, l.food >= 0 && l.food <= 1 && l.water >= 0 && l.water <= 1, JSON.stringify(l));
    check(`pets: ${b.id} is drawn with its levels`, typeof pieceState(b.zone)?.[b.id]?.food === 'number');
    check(`pets: examining ${b.id} says how full`, /dish is .* water bowl is/.test(describeBowls({ id: b.id }) || ''));
    const broke = { id: '00000000-0000-0000-0000-000000000000', handle: 'Broke', current_zone: b.zone, credits: 0 };
    const r = await cmdRefill([], 'refill', broke);
    check(`pets: refill by somebody broke is refused, or the bowls are full`, r.type === 'error' ? /₵/.test(r.message) : /full/.test(r.message), r.message);
  }
  check('pets: refill where there are no bowls says so', /nothing here/.test((await cmdRefill([], 'refill', { id: 'x', handle: 'X', current_zone: 'zone_regress_nowhere' })).message));
  if (first) {
    const n0 = world.npcs.get(first.npcId), bb = npcBeast(n0)?.bowls;
    if ([...BOWLS.values()].some((b) => b.pet === first.id)) check('pets: the beast carries its bowls', !!bb?.food && Number.isFinite(bb.food.at));
  }

  // hunger and thirst: worked out from when his bowls were filled. Left two days, he's starving and after food, examine
  // says so and whoever comes in is greeted with a demand; just filled, he's after nothing
  const { hungerOf, describeAnimal } = pets;
  if (first) {
    const n0 = world.npcs.get(first.npcId), b = pets.stationOf(first), zone0 = n0 && (n0.zone_id || n0.home_zone);
    if (n0 && b) {
      const keep = { food: { ...b.food }, water: { ...b.water } }, t0 = Date.now();
      b.food = { at: t0 - 2 * DAY_MS, due: null }; b.water = { at: t0 - 2 * DAY_MS, due: null };
      const n = catNeeds(n0.id, t0, b);
      check('pets: two days without his bowls filled, he is starving and parched', n.hunger > 0.9 && n.thirst > 0.9, JSON.stringify(n));
      check('pets: and he is after food', hungerOf(first, n0, t0) === 'food');
      check('pets: examining him says so', /eaten|hungry/.test(describeAnimal(n0) || ''), describeAnimal(n0));
      let pest = 0;
      for (let t = t0; t < t0 + 3 * 3.6e6; t += 15000) if (catAtBowls(n0.id, t, b)?.pester) pest++;
      check('pets: hungry at an empty dish, he goes back to it between meals', pest >= 4, `${pest} samples in three hours`);
      if (way) {
        let demanded = null;
        for (let i = 0; i < 20 && !demanded; i++) {
          setBeat(n0, null, zone0);
          onEntered({ actor: { id: `p_pet_hungry_${i}`, handle: `Hungry${i}`, current_zone: zone0 }, zone: zone0, from: way.target });
          if (BEATS.get(n0.id)?.hungry) demanded = BEATS.get(n0.id);
        }
        check('pets: hungry, he greets whoever comes in by demanding food', demanded?.hungry === 'food', JSON.stringify(demanded));
        setBeat(n0, null, zone0);
      }
      b.food = { at: t0, due: null }; b.water = { at: t0, due: null };
      check('pets: just filled, he is after nothing', hungerOf(first, n0, t0) === null);
      b.food = keep.food; b.water = keep.water;
    }
  }
  {
    // an ordinary day, the bowls filled each morning: peckish by his next meal at worst, never starving
    const t0 = Date.UTC(2026, 10, 14), bowls = { food: { at: t0, due: null }, water: { at: t0, due: null } };
    let mh = 0;
    for (let t = t0; t < t0 + DAY_MS; t += 600000) mh = Math.max(mh, catNeeds('c', t, bowls).hunger);
    check('pets: fed every day, he is never more than peckish', mh < 0.6, mh.toFixed(2));
  }

  // his tray: about five goes a day, the same twice; left three days it's full and he's gone in front of it, it smells
  // in its room and the room it opens off, it's drawn with what's in it, examine says it, and `scoop` empties it
  {
    const D = trayTimes('c', 0, 10 * DAY_MS);
    check('pets: tray times are the same twice', JSON.stringify(D) === JSON.stringify(trayTimes('c', 0, 10 * DAY_MS)));
    check('pets: about five goes at the tray a day', D.length >= 40 && D.length <= 60, `${D.length} in ten days`);
    check('pets: the tray clips are the tray goes', Object.keys(LITTER).every((k) => D.some((g) => g.kind === k)) && D.every((g) => LITTER[g.kind]));
    const s = trayState('c', { at: 0 }, 3 * DAY_MS);
    check('pets: three days unscooped, the tray is full and the rest is beside it', s.pee + s.poo === TRAY_FULL && s.mess.length > 0, JSON.stringify(s));
    const g = D.find((x) => x.t > 2 * DAY_MS);
    check('pets: at a full tray he goes beside it', catAtTray('c', g.t + 1000, { at: 0 })?.mess === true);
    check('pets: at a clean one he goes in it', catAtTray('c', g.t + 1000, { at: g.t - 1 })?.mess === false);
  }
  const { TRAYS, cmdScoop, describeTray, traySmells, stateOf } = pets;
  for (const t of TRAYS.values()) {
    const keep = t.at, t0 = Date.now();
    t.at = t0 - 3 * DAY_MS;
    check(`pets: ${t.id} is drawn with what's in it`, Array.isArray(pieceState(t.zone)?.[t.id]?.mess) && pieceState(mainOf(t.zone))?.[t.id]?.pee >= 0);
    check(`pets: examining ${t.id} full says he's given up on it`, /given up/.test(describeTray({ id: t.id }) || ''), describeTray({ id: t.id }));
    check(`pets: ${t.id} full smells, and in the room it opens off`, !!traySmells({ id: t.zone })?.length && !!traySmells({ id: mainOf(t.zone) })?.length);
    const r = await cmdScoop([], 'scoop', { id: 'p_pet_test_scoop', handle: 'Scooper', current_zone: mainOf(t.zone) });
    check(`pets: scoop from the room it opens off empties ${t.id}`, stateOf(t).dirt === 0 && /scoop/.test(r.message), r.message);
    check(`pets: ${t.id} scooped smells of nothing`, !traySmells({ id: t.zone }));
    check(`pets: scooping a clean ${t.id} says so`, /clean/.test((await cmdScoop([], 'scoop', { id: 'p_pet_test_scoop', handle: 'Scooper', current_zone: t.zone })).message));
    // put it back as it was, here and in its row
    t.at = keep;
    await query('UPDATE pet_trays SET scooped_at = to_timestamp($2::float8 / 1000) WHERE furniture_id = $1', [t.id, keep]);
    const p = PETS.get(t.pet), npc = p && world.npcs.get(p.npcId);
    if (npc) check(`pets: the beast carries ${t.id}`, npcBeast(npc)?.tray?.id === t.id && Number.isFinite(npcBeast(npc)?.tray?.at));
  }
  check('pets: scoop where there is no tray says so', /no litter tray/.test((await cmdScoop([], 'scoop', { id: 'x', handle: 'X', current_zone: 'zone_regress_nowhere' })).message));

  // the shared day: the bowl schedule, the piece he's up on and the biscuits are the same answer twice, and he only
  // kneads on something soft
  const { layoutOf, nowOf, lineFor } = pets;
  for (const p of PETS.values()) {
    const npc = world.npcs.get(p.npcId), zone = npc && (npc.zone_id || npc.home_zone);
    const L = zone && await layoutOf(zone);
    if (!L) continue;
    let same = true, hardKnead = 0, ups = 0;
    for (let h = 0; h < 24; h++) for (let k = 0; k < 4; k++) {
      const now = Date.UTC(2026, 10, 14, h, k * 13), life = catLife(p.npcId, now, h, p.personality);
      const a = catPerchOf(L, life, p.look), b = catPerchOf(L, life, p.look), s = catSettle(L, life, a);
      if (JSON.stringify(a) !== JSON.stringify(b)) same = false;
      if (a) ups++;
      if (s.act === 'knead' && !(a ? perchSoft(a) : s.rug)) hardKnead++;
    }
    check(`pets: ${p.id} is up on the same piece for everybody`, same);
    check(`pets: ${p.id} gets up on the furniture`, ups > 4, `${ups} of 96`);
    check(`pets: ${p.id} only kneads on something soft`, hardKnead === 0, `${hardKnead}`);
    // his day in words: an hour of it says something, and no line leaves a $ in it
    let was = null, lines = 0, bad = 0;
    const mem = {}, t0 = Date.UTC(2026, 10, 14, 17, 0);
    for (let t = t0; t < t0 + 3600e3; t += 5000) {
      const st = nowOf(p, npc, L, t, 17 + (t - t0) / 3.6e6);
      if (was) { const line = lineFor(was, st, npc, L, mem, t); if (line) { lines++; if (/\$\w/.test(line)) bad++; } }
      was = st;
    }
    check(`pets: ${p.id}'s day is said in words`, lines >= 4, `${lines} lines in an hour`);
    check(`pets: ${p.id}'s lines are all filled in`, bad === 0);
  }
  check('pets: bowl times are the same twice', JSON.stringify(bowlTimes('c', 'food', 0, 3 * DAY_MS)) === JSON.stringify(bowlTimes('c', 'food', 0, 3 * DAY_MS)) && bowlTimes('c', 'food', 0, 3 * DAY_MS).length === 6);
  check('pets: a full bowl is empty after a day and a half', bowlLevel('c', 'water', { at: 0, due: null }, 1.5 * DAY_MS) === 0);

  // the ears have their moods, and a breed is numbers under a cat's own
  check('pets: every ear mood is two ears of three numbers', Object.values(EAR_MOODS).every((m) => m.length === 2 && m.every((e) => e.length === 3 && e.every(Number.isFinite))));
  check('pets: a breed is under the cat and the cat wins', catLook({ breed: 'american_shorthair', build: { head: 1.3 } }).build.head === 1.3 && catLook({ breed: 'american_shorthair' }).build.earRound > 0);
  check('pets: a coat pattern sets the white', catLook({ coat: { pattern: 'tuxedo' } }).coat.white === 0.42);
  check('pets: a coat colour sets the genes under the cat', catLook({ coat: { colour: 'calico' } }).coat.tortie?.col && catLook({ coat: { colour: 'calico', white: 0.3 } }).coat.white === 0.3);
  check('pets: every breed is a cat the kit can build', Object.keys(BREEDS).every((b) => { const l = catLook({ breed: b }); return l.scale > 0.4 && Number.isFinite(l.build.ears); }));
  check('pets: every breed leans a nature', Object.entries(BREEDS).every(([k, b]) => k === 'domestic' || Object.keys(b.nature || {}).length === 5));
  check('pets: a Siamese is pointed', !!catLook({ breed: 'siamese' }).coat.points?.col);

  // two cats: the same answer for everybody, whichever order the room lists them in; both sides of it agree; every
  // clip it stages is a clip; friends get on and rivals don't; and its lines are filled in
  const { MEET_LINE, meetLine } = pets;
  const friendA = { id: 'npc_regress_cat_a', nature: { friendly: 0.85, dominant: 0.45, outgoing: 0.6, impulsive: 0.5, skittish: 0.2 } };
  const friendB = { id: 'npc_regress_cat_b', nature: { friendly: 0.8, dominant: 0.35, outgoing: 0.7, impulsive: 0.6, skittish: 0.3 } };
  const rivalA = { id: 'npc_regress_cat_c', nature: { friendly: 0.3, dominant: 0.8, outgoing: 0.4, impulsive: 0.5, skittish: 0.3 } };
  const rivalB = { id: 'npc_regress_cat_d', nature: { friendly: 0.35, dominant: 0.7, outgoing: 0.5, impulsive: 0.4, skittish: 0.5 } };
  const tally = (pair) => {
    const kinds = {};
    let same = true, agree = true;
    const t0 = Date.UTC(2026, 10, 14);
    for (let t = t0; t < t0 + DAY_MS; t += 20000) {
      const h = ((t - t0) / 3.6e6) % 24, m = catMeets(null, pair, t, h), m2 = catMeets(null, [...pair].reverse(), t, h);
      if (JSON.stringify([...m].sort()) !== JSON.stringify([...m2].sort())) same = false;
      const x = m.get(pair[0].id), y = m.get(pair[1].id);
      if (!!x !== !!y || (x && (x.key !== y.key || x.role === y.role || x.with !== pair[1].id))) agree = false;
      if (x) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
    }
    return { kinds, same, agree };
  };
  const fr = tally([friendA, friendB]), rv = tally([rivalA, rivalB]);
  check('pets: two cats meet the same for everybody', fr.same && rv.same);
  check('pets: both cats agree on what they are doing together', fr.agree && rv.agree);
  check('pets: friends greet, groom, play and sleep in a heap', ['greet', 'groom', 'play', 'pile'].every((k) => fr.kinds[k] > 0), JSON.stringify(fr.kinds));
  check('pets: friends never fall out', !fr.kinds.spat, JSON.stringify(fr.kinds));
  check('pets: rivals fall out and never groom or share a bed', rv.kinds.spat > 0 && !rv.kinds.groom && !rv.kinds.pile, JSON.stringify(rv.kinds));
  check('pets: a cat on a beat is left out', !catMeets(null, [{ ...friendA, busy: true }, friendB], Date.UTC(2026, 10, 14, 7), 7).size);
  const CLIPS = new Set(CLIP_NAMES);
  check('pets: every clip two cats play is a clip', Object.values(MEET_PLAN).every((ph) => ph.every((p) => CLIPS.has(p.a) && CLIPS.has(p.b))));
  check('pets: every kind of meeting has its staging and its words', Object.keys(MEET_KINDS).every((k) => MEET_PLAN[k] && MEET_LINE[k]?.length));
  {
    const na = { name: 'Alpha', sex: 'female' }, nb = { name: 'Beta', sex: 'male' };
    const all = Object.keys(MEET_KINDS).map((kind) => meetLine({ kind, key: kind + ':1', on: null }, na, nb, null));
    check('pets: two-cat lines are all filled in', all.every((s) => s && !/\$/.test(s) && s.includes('Alpha') && s.includes('Beta')), JSON.stringify(all));
  }

  // strays: a batch lands on Coldwater's streets, more to the east, and adopt refuses somebody with no flat
  {
    const S = pets.strays;
    const tiles = S.streetTiles();
    check('pets: strays have street tiles to land on', tiles.length > 50, String(tiles.length));
    const made = await S.generateStrays(12, 4242);
    try {
      check('pets: a batch is twelve strays', made.length === 12, String(made.length));
      check('pets: a batch has twelve names', new Set(made.map((m) => m.name)).size === made.length);
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      const xs = made.map((m) => world.zones.get(m.zone_id)?.grid_x);
      check('pets: strays lean east', mean(xs) > mean(tiles.map((z) => z.grid_x)), `${mean(xs).toFixed(1)} vs ${mean(tiles.map((z) => z.grid_x)).toFixed(1)}`);
      let built = true;
      for (const m of made) {
        const npc = world.npcs.get(S.npcIdOf(m.id));
        if (!npc || !npc.flags?.stray || !npc.flags?.animal || !world.zones.get(npc.zone_id)?.npcs.has(npc.id)) built = false;
        try { catLook(JSON.parse(JSON.stringify(m.look))); } catch { built = false; }
      }
      check('pets: every stray is an animal NPC on its tile with a cat body', built);
      const first = made[0], npc = world.npcs.get(S.npcIdOf(first.id));
      const r = await S.cmdAdopt([], '', { id: 'regress_no_flat', handle: 'Tester', current_zone: npc.zone_id });
      check('pets: adopt with no flat is refused', r?.type === 'error' && /flat|Which one/.test(r.message), r?.message);
      const slumZ = { flags: { district: 'slum' } }, cat = { id: 'npc_stray_t', name: 'Tester', sex: 'female' }, local = { name: 'Mags Doyle', sex: 'female' };
      const said = [];
      for (let t = 0; t < 4000; t++) { const l = S.streetLine(cat, slumZ, t * 5000, 14, false, [local]); if (l) said.push(l); }
      check('pets: a stray speaks now and then, not every tick', said.length > 60 && said.length < 400, String(said.length));
      check('pets: slum locals feed strays by name', said.some((l) => l.includes('Mags Doyle')));
      check('pets: strays hunt birds and drink from puddles', said.some((l) => /pigeon|sparrow/.test(l)) && said.some((l) => /puddle|rain collected|drainpipe/.test(l)));
      check('pets: every street line is filled in', said.every((l) => !l.includes('$') && l.includes('Tester')), said.find((l) => l.includes('$')));
      const uptown = []; for (let t = 0; t < 4000; t++) { const l = S.streetLine(cat, { flags: { district: 'halcyon_fields' } }, t * 5000, 14, false, [local]); if (l) uptown.push(l); }
      check('pets: nobody feeds strays in Halcyon Fields', !uptown.some((l) => l.includes('Mags')));
      const n = made.filter((m) => world.zones.get(m.zone_id)?.flags?.district === 'slum').length;
      check('pets: the slum gets more than its share of strays', n >= 2, String(n));
      const c = await S.census();
      check('pets: the census lists the batch', made.every((m) => c.cats.some((k) => k.id === m.id && !k.adopted)));
    } finally {
      for (const m of made) await S.removeStray(m.id);
    }
    check('pets: removed strays leave the world', made.every((m) => !world.npcs.has(S.npcIdOf(m.id))));
  }
}
