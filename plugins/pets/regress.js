// pets plugin regression suite: run by tests/regress.js, never loaded in production.
//
// What has to hold: every pet row loads and points at an NPC that exists, is flagged as that pet and as an animal; the
// Room Stage draws a pet as a cat and never also as a person; and nothing is special to any one cat.
import { _test as pets } from './index.js';
import { _test as stage } from '../roomstage/index.js';
import { world, getZone } from '../../server/engine/world.js';
import { catLook, EAR_MOODS } from '../../client/game/js/panels/gl/cat-kit.js';
import { CLIP_NAMES } from '../../client/game/js/panels/gl/cat-clips.js';
import { catLife, catPerchOf, catSettle, perchSoft, bowlTimes, bowlLevel, DAY_MS } from '../../client/shared/cat-life.js';
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
}
