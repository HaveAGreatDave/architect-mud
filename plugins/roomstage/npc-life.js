// plugins/roomstage/npc-life.js
//
// PEOPLE AT HOME: a resident pottering round their own flat while somebody has its Stage open. Every
// minute or three they get up, walk to something (a seat, the fridge, the window, the bed) and stay
// there a while. The way there is roomPath (client/shared/room-layout.js), so they go round the
// furniture and through the doors.
//
// ⚠ IT'S THE PICTURE'S STATE, LIKE WHERE A PLAYER STANDS. RAM only, no writes, and nothing here touches
// the NPC's posture, so the room text and the AI don't know they've sat down. It runs only in a room
// with a viewer: nobody watching costs nothing, and the next viewer finds them somewhere plausible.
//
// ⚠ THE SERVER PICKS AND THE CLIENT WALKS. A route goes out once in `room_people` as its path and how
// long is left, so everyone with the room open sees the same walk with no stream of positions. A
// viewer who arrives halfway gets the rest of it.
//
// ⚠ THE ENGINE OWNS THE NPC FIRST. Asleep, in a fight, on shift, or sat on something by the engine, and
// `free` is false, so they're drawn as the engine says. home-life.js's trip to the en-suite is a real
// move between zones; the tick notices and walks them through the door after it, and once they're in
// there `shut` tells the client to close it.
//
// A resident who sits facing a set turns it on (`tvOf`), and turns it off when they get up. A banter
// scene (server/engine/npc-banter.js) brings its two together: the words are the engine's and go to the
// whole zone, so the text world reads them, and this only turns the bodies to each other.
//
// A resident taking something (plugins/npc-drugs, 'npc.ritual') gets up, stops where they are and plays
// the clip for each beat. The ritual owns the timing: this only draws it, and they carry on afterwards.

import { getZoneNpcs, world } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { isNpcAsleep, formatChitchat } from '../../server/engine/ai-behaviour.js';
import { isNpcScheduledNow } from '../../server/engine/broadcast-bridge.js';
import { randInt } from '../../server/engine/util.js';
import { roomLayout, roomPath, roomNearFree, roomYaw, pathAt, pathLength, inAnnex, seatsClash } from '../../client/shared/room-layout.js';
import { tripToBathroom } from '../ambient-life/home-life.js';
import { zoneIsDark } from '../ambient-life/blackout.js';
import { HOME_DISHES, dishOf } from '../../client/shared/home-meals.js';
import { feelBand } from '../../client/shared/comfort.js';
import { getDrugCache } from '../../server/engine/drugs.js';
import { KITS, SIT_TAKE, SIT_LINES, DONE_LINES, kitOf, sessionMs } from '../../client/shared/table-stash.js';
import { facing as facingOf } from '../../client/shared/room-layout.js';

const SPEED = 1.1;                         // metres a second, an unhurried walk at home
const FIRST_MS = [20_000, 90_000];         // from the room opening to the first time they move
const REST_MS = [60_000, 170_000];         // between one thing and the next, on top of how long it took
const STAY = { watch: [120_000, 300_000], sit: [60_000, 180_000], lie: [60_000, 150_000], use: [10_000, 30_000], window: [15_000, 45_000], pace: [5_000, 15_000], phone: [20_000, 60_000], smoke: [45_000, 90_000], wait: [15_000, 40_000],
  stretch: [8_000, 16_000], exercise: [20_000, 45_000], tidy: [6_000, 14_000], dance: [15_000, 40_000], think: [8_000, 18_000], fidget: [10_000, 25_000],
  warm: [15_000, 40_000], heater: [40_000, 120_000], cool: [15_000, 40_000], air: [30_000, 80_000] };
const BATHROOM_CHANCE = 0.12;              // of the times they get up, in a flat with an en-suite
const TALK_REACH = 1.6, TALK_GAP = 0.9;    // near enough to talk, and how far apart they stop
const AFTER_TALK_MS = [5_000, 20_000];
const RITUAL_MS = 20_000;                  // longer than any beat: a ritual that never says it ended
const FACING = 0.5;                        // how squarely a seat has to look at a set to count as in front of it
const EMOTE_CHANCE = 0.3, MUTTER_CHANCE = 0.15;
// A meal (client/shared/home-meals.js): out of the fridge, cooked, and eaten, three jobs one after another.
// They cook at the hob. The camping stove on the floor is for a room with no hob, or none they can get to.
const MEAL_CHANCE = 0.22, MEAL_SAY = 0.6;
const MEAL_MS = { get: [6_000, 10_000], cook: [40_000, 80_000], eat: [50_000, 120_000] };
// A session at the table (client/shared/table-stash.js): somebody with a habit, now and then, when the
// room has a table with a free chair at it.
const SESSION_CHANCE = 0.3;
// What a resident's habit is taken by: the drug's flags.taken, or a drink for a booze habit.
function habitOf(n) {
  const f = n.flags || {};
  if (f.booze_habit) return 'drink';
  const name = typeof f.drug_habit === 'string' ? f.drug_habit : typeof f.preshow_habit === 'string' ? f.preshow_habit : null;
  if (!name) return null;
  const d = Object.values(getDrugCache() || {}).find((x) => String(x.name || '').toLowerCase() === name.toLowerCase());
  const k = d?.flags?.taken || 'swallow';
  return KITS[k] ? k : 'swallow';
}

// What a scene in home-life.js sends them to, so the cooking happens at the cooker. Each is a piece's
// archetype or a job's kind.
const SCENE = { meal: ['hob', 'cold', 'sink'], drink: ['hob', 'cold', 'sink'], tidy: ['sink', 'wardrobe', 'store', 'cabinet', 'tidy'],
  chill: ['heater', 'warm'], heat: ['cool', 'air', 'sink', 'cold'] };
// A room past room temperature (client/shared/comfort.js): how much more often they do something about it,
// and what the body does meanwhile, mild and then harsh.
const TEMP_CLIPS = { cool: ['coldRub', 'coldBlow'], cold: ['shiver', 'coldStamp', 'coldBlow'], warm: ['hotFan', 'hotTug'], hot: ['hotFan', 'hotBrow', 'hotSag', 'hotTug'] };
const TEMP_SAY = 0.5;
const CHANGED = {
  [-2]: ['goes and finds a coat and puts it on indoors.', 'pulls on a coat and a hat and keeps them on.'],
  [-1]: ['pulls on something warmer.', 'goes and finds a jumper.'],
  0: ['changes back into their usual clothes.'],
  1: ['changes into something lighter.', 'takes a layer off.'],
  2: ['strips down to a vest.', 'changes into the least they can get away with.'],
};

// What they're seen doing when they get there. The name goes on the front (formatChitchat).
const DOING = {
  cold: ['opens the {piece}, looks in, and shuts it again.', 'takes a carton out of the {piece}, smells it and puts it back.'],
  hob: ['checks the {piece} is off.', 'wipes the {piece} down with a cloth.'],
  sink: ['runs the tap and fills a glass.', 'rinses a mug and leaves it on the side.'],
  wardrobe: ['goes through the {piece} and takes nothing out.', 'hangs a jacket back in the {piece}.', 'holds a shirt up against themselves at the {piece} and puts it back.'],
  store: ['looks for something in the {piece}.'],
  cabinet: ['looks for something in the {piece}.'],
  window: ['stands at the window for a bit.', 'looks down at the street.'],
  watch: ['sits down to watch the set.', 'sits down and looks up at the screen.'],
  sit: ['sits down and lets out a breath.', 'sits down and checks a tablet.'],
  lie: ['lies down with an arm over their eyes.'],
  pace: ['crosses the room, stops, and goes back for something.', 'walks to the middle of the room and forgets why.'],
  phone: ['thumbs through their phone, frowning.', 'reads something on their phone twice.', 'holds their phone up to the light for a better signal.'],
  smoke: ['lights a cigarette at the window.', 'opens the window a crack and lights up.'],
  wait: ['leans against the wall and stares at nothing.', 'stands with their arms folded, thinking about something.', 'taps a foot and waits for nothing in particular.'],
  stretch: ['stretches until something in their back clicks.', 'stretches both arms over their head and holds it.'],
  exercise: ['does a few slow squats, counting under their breath.', 'does squats until their knees complain.'],
  tidy: ['picks something up off the floor and looks for somewhere to put it.', 'stoops for a sock and carries it about.'],
  dance: ['hums something and sways to it a little.', 'bobs their head to a song only they can hear.'],
  think: ['rubs their eyes with the heel of a hand.', 'cracks their knuckles one hand at a time.'],
  fidget: ['rolls their neck one way and then the other.', 'rocks on their heels with their hands in their pockets.'],
  warm: ['rubs their arms and can\'t find the draught.', 'blows on their hands.', 'stamps their feet to get the feeling back.', 'shivers and folds their arms tighter.'],
  heater: ['stands over the {piece} with their hands out.', 'rubs their hands together over the {piece}.'],
  cool: ['fans themselves with a hand.', 'wipes their forehead on a sleeve.', 'tugs at their collar.', 'peels their shirt away from their back.'],
  air: ['opens the window as far as it goes and stands in front of it.', 'leans out of the window for some air.'],
};
// What they do at a piece when the room's too hot, in place of the usual.
const DOING_HOT = {
  cold: ['stands in front of the open {piece} until it beeps.', 'takes something cold out of the {piece} and holds it against their neck.'],
  sink: ['runs the cold tap over their wrists.', 'fills a glass of water and drinks it in one go.'],
};
const MUTTERS = ['"Where did I put that?"', '"Right. What was I doing?"', '"I should eat something."', '"Is it that late already?"', '"I need to clean this place."',
  '"That tap\'s still dripping."', '"I\'ll do it tomorrow."', '"What\'s that smell?"', '"Rent\'s due again."'];
const MUTTERS_COLD = ['"It\'s cold in here."', '"Is the heating even on?"', '"I can\'t feel my fingers."', '"Where\'s that other jumper?"'];
const MUTTERS_HOT = ['"It\'s too hot in here."', '"I can\'t think in this."', '"Why is it so hot?"', '"I\'m sweating through this."'];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = ([a, b]) => randInt(a, b);

// `viewers` zone -> Set of player ids, and the plugin's own functions for the rest.
// `feelOf(main)` is how the room feels, -1 cold to 1 hot (client/shared/comfort.js); none given, it's always mild.
export function createNpcLife({ viewers, annexOf, mainOf, specOf, roomPieces, sendPeople, busy, tvOn, feelOf = () => 0 }) {
  const tvBy = new Map();   // main -> the resident who put the set on
  const bandSeen = new Map();   // main -> the temperature band its residents last dressed for
  const say = (n, main, line) => { const msg = formatChitchat(n.name, line); for (const id of viewers.get(main) || []) sendToPlayer(id, msg); };
  // Free to use: nobody in it, and nobody lying along the piece it's on, or sitting where you'd lie.
  const seatFree = (L, i, taken) => !taken.seats.has(i) && !taken.pieces.has(L.seats[i].piece) && ![...taken.seats].some((j) => seatsClash(L.seats[i], L.seats[j]));
  const setOf = (L) => L.placed.find((p) => p.arche === 'screen' && !p.annex);
  // How squarely a seat looks at a set: 1 straight at it.
  function facing(L, s, set) {
    const du = set.u - s.u, dv = set.v - s.v, d = s.dir || [0, 0];
    return (d[0] * du + d[1] * dv) / ((Math.hypot(du, dv) || 1) * (Math.hypot(d[0], d[1]) || 1));
  }
  // npcId -> { main, at, yaw, seat, on, pose, kind, route: { path, len, t0, ms }, job, next, want, inside }
  const lives = new Map();
  const seen = new Map();   // zoneId -> who was there at the last look
  const using = new Map();  // npcId -> { clip, until }, while a ritual has them
  const clipOfUse = (id) => { const u = using.get(id); if (u && u.until <= Date.now()) using.delete(id); return using.get(id)?.clip || null; };

  const here = (main) => { const annex = annexOf(main); return [...getZoneNpcs(main), ...(annex ? getZoneNpcs(annex.id) : [])]; };
  const free = (n, main) => !n._dead && !n._combatTargetId && !n.flags?.no_home_life && !n.onFurniture && !n.sittingOn
    && (n.posture || 'standing') === 'standing' && !n._ai?.dosedOut && !isNpcAsleep(n) && !isNpcScheduledNow(n.id)
    && !!n.home_zone && mainOf(n.home_zone) === main;

  async function layoutOf(main) {
    const spec = specOf(main);
    if (!spec) return null;
    const pieces = await roomPieces(main, spec);
    return { L: roomLayout(spec, pieces), pieces };
  }

  // Everything somebody could go and do in this room, from the seats nobody's in.
  function jobsIn(L, taken, want, feel = 0) {
    const named = new Map(L.placed.map((p) => [p.id, p])), out = [], main = L.bounds, k = Math.abs(feel), harsh = k >= 0.5;
    const add = (weight, job) => { if (job.stand) out.push({ weight, ...job }); };
    L.seats.forEach((s, i) => {
      if (inAnnex(L, s.v) || s.v < 0 || !seatFree(L, i, taken)) return;
      add(s.lie ? 1 : 3, { kind: s.lie ? 'lie' : 'sit', seat: i, on: s.piece, pose: s.lie ? 'lying' : 'sitting', arche: named.get(s.piece)?.arche, name: named.get(s.piece)?.name, stand: roomNearFree(L, s.u, s.v, 1.8, main) });
    });
    for (const st of L.stations) {
      const p = named.get(st.piece);
      if (!p || !DOING[p.arche] || inAnnex(L, st.v)) continue;
      const stand = roomNearFree(L, st.u, st.v, 1.8, main);
      // too hot, the tap and the fridge are where they go
      const cooling = feel > 0 && !!DOING_HOT[p.arche];
      add(cooling ? 2 + 4 * k : 2, { kind: 'use', arche: p.arche, name: p.name, stand, face: st.at, ...(cooling ? { hot: true } : {}) });
    }
    const glass = () => roomNearFree(L, ((L.spec.window?.[0] ?? 0) + (L.spec.window?.[1] ?? 0)) / 2, 0.5, 1.8, main), outward = Math.atan2(L.f[0], L.f[2]);
    const floor = () => roomNearFree(L, main[0] + Math.random() * (main[1] - main[0]), main[2] + Math.random() * (main[3] - main[2]), 1.8, main);
    const turn = () => Math.random() * Math.PI * 2;
    add(1, { kind: 'window', stand: glass(), yaw: outward });
    add(1, { kind: 'smoke', stand: glass(), yaw: outward, clip: 'smoke' });
    add(1, { kind: 'pace', stand: floor() });
    add(2, { kind: 'phone', stand: floor(), yaw: turn(), clip: 'phone' });
    add(1, { kind: 'wait', stand: floor(), yaw: turn(), clip: pick(['wait', 'idleTap']) });
    add(0.7, { kind: 'stretch', stand: floor(), yaw: turn(), clip: 'idleStretch' });
    add(0.4, { kind: 'exercise', stand: floor(), yaw: turn(), clip: 'squats' });
    add(0.8, { kind: 'tidy', stand: floor(), yaw: turn(), clip: 'pickUp' });
    add(0.4, { kind: 'dance', stand: floor(), yaw: turn(), clip: 'dance' });
    add(0.7, { kind: 'think', stand: floor(), yaw: turn(), clip: pick(['idleRub', 'idleKnuckles']) });
    add(0.7, { kind: 'fidget', stand: floor(), yaw: turn(), clip: pick(['idleRoll', 'idleRock']) });
    // past room temperature they do something about it, and more often the further past it is
    if (feel < 0) {
      const h = L.placed.find((p) => (p.form === 'heater' || p.arche === 'fireplace') && !p.annex);
      if (h) add(2 + 8 * k, { kind: 'heater', name: h.name, stand: roomNearFree(L, h.u, h.v, 1.8, main), face: [h.u, h.v], clip: 'coldRub' });
      add(1 + 6 * k, { kind: 'warm', stand: floor(), yaw: turn(), clip: pick(TEMP_CLIPS[harsh ? 'cold' : 'cool']) });
    } else if (feel > 0) {
      add(1 + 6 * k, { kind: 'cool', stand: floor(), yaw: turn(), clip: pick(TEMP_CLIPS[harsh ? 'hot' : 'warm']) });
      add(1 + 4 * k, { kind: 'air', stand: glass(), yaw: outward, clip: 'hotFan' });
    }
    const asked = want ? out.filter((j) => SCENE[want]?.some((x) => x === j.arche || x === j.kind)) : [];
    return asked.length ? asked : out;
  }
  function chooseJob(L, taken, want, from = null, feel = 0) {
    // somewhere else: a job on the spot they already stand on is no walk at all
    const all = jobsIn(L, taken, want, feel), away = from ? all.filter((j) => Math.hypot(j.stand[0] - from[0], j.stand[1] - from[1]) > 0.5) : all, jobs = away.length ? away : all;
    let roll = Math.random() * jobs.reduce((n, j) => n + j.weight, 0);
    for (const j of jobs) if ((roll -= j.weight) <= 0) return j;
    return jobs[0] || null;
  }

  // A set's on: the free seat that looks at it most squarely, or failing that any free seat. Null with
  // nowhere to sit, and they carry on as they were.
  function watchJob(L, taken) {
    const set = setOf(L);
    if (!set) return null;
    let best = null, top = -Infinity;
    L.seats.forEach((s, i) => {
      if (s.lie || inAnnex(L, s.v) || s.v < 0 || !seatFree(L, i, taken)) return;
      const score = facing(L, s, set);
      if (score <= top) return;
      const stand = roomNearFree(L, s.u, s.v, 1.8, L.bounds);
      if (stand) { top = score; best = { kind: 'watch', seat: i, on: s.piece, pose: 'sitting', stand }; }
    });
    return best;
  }

  // A chair pulled up to a table: a free seat whose front looks over a table's top. Null without one.
  // `at` is the place on the top in front of them, where the kit goes (gl/room-stash.js).
  function sessionJob(n, life, L, taken) {
    const k = habitOf(n);
    if (!k) return null;
    const tables = L.placed.filter((p) => p.arche === 'table' && !p.annex);
    let best = null, far = Infinity;
    L.seats.forEach((s, i) => {
      if (s.lie || inAnnex(L, s.v) || s.v < 0 || !seatFree(L, i, taken) || !s.dir) return;
      const reach = [s.u + s.dir[0] * 0.45, s.v + s.dir[1] * 0.45];
      for (const p of tables) {
        const [fu, fv] = facingOf(p.turn), du = reach[0] - p.u, dv = reach[1] - p.v;
        const x = du * -fv + dv * fu, z = du * fu + dv * fv;
        if (Math.abs(x) > p.w / 2 + 0.05 || Math.abs(z) > p.d / 2 + 0.05) continue;
        const d = Math.hypot(s.u - life.at[0], s.v - life.at[1]);
        if (d >= far) continue;
        const stand = roomNearFree(L, s.u, s.v, 1.8, L.bounds);
        if (!stand) continue;
        // the spot on the top: a little in from its edge, in front of the chair
        const cx = Math.max(-p.w / 2 + 0.15, Math.min(p.w / 2 - 0.15, x)), cz = Math.max(-p.d / 2 + 0.12, Math.min(p.d / 2 - 0.12, z));
        const at = [+(p.u + -fv * cx + fu * cz).toFixed(2), +(p.v + fu * cx + fv * cz).toFixed(2), +((p.y0 || 0) + p.h).toFixed(3)];
        const kit = kitOf(k);
        far = d;
        best = { kind: 'session', seat: i, on: s.piece, pose: 'sitting', stand, name: p.name || 'table', stash: { k, of: randInt(kit.of[0], kit.of[1]), beat: kit.beat, at } };
      }
    });
    return best;
  }

  // Where everyone else in the room stands, or will once they get there.
  const spotsOf = (main, me) => [...lives.values()].filter((l) => l !== me && l.main === main && !Number.isInteger(l.seat))
    .map((l) => l.job?.stand || l.at).filter(Boolean);
  // A standing job moved off anyone else's spot: a step to the side of it, or null when the floor round it is full.
  const ROOM_APART = 0.6;
  function apart(job, L, main, me) {
    if (!job?.stand || job.seat !== undefined) return job;
    const others = spotsOf(main, me), clear = (s) => s && others.every((o) => Math.hypot(o[0] - s[0], o[1] - s[1]) >= ROOM_APART);
    if (clear(job.stand)) return job;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, s = roomNearFree(L, job.stand[0] + Math.cos(a) * ROOM_APART, job.stand[1] + Math.sin(a) * ROOM_APART, 0.3, L.bounds);
      if (clear(s)) return { ...job, stand: s };
    }
    return null;
  }

  // Lands them where a job puts them.
  function settle(life, job, L, now) {
    life.at = job.stand; life.route = null; life.job = null; life.kind = job.kind;
    life.seat = job.seat ?? null; life.on = job.on ?? null; life.pose = job.pose ?? null; life.clip = job.clip ?? null;
    if (job.face) life.yaw = roomYaw(L, job.face[0] - job.stand[0], job.face[1] - job.stand[1]);
    else if (job.yaw !== undefined) life.yaw = job.yaw;
    life.next = life.talk ? Infinity : now + between(STAY[job.kind] || STAY.pace) + between(REST_MS);
    // a session runs its own length: every one on the table taken, and a while sat back after
    life.stash = job.stash ? { ...job.stash, t0: now } : null;
    if (life.stash && !life.talk) life.next = now + sessionMs(life.stash);
    // a meal's step goes on to the next with no rest between: nobody leaves the pan to sit down
    if (job.meal && life.meal) {
      life.meal.stage = job.meal;
      if (job.stove) life.meal.stove = job.stove;
      if (job.pan) life.meal.pan = job.pan;
      if (!life.talk) life.next = now + between(MEAL_MS[job.meal]);
    }
  }

  // The next step of a meal, or its start. Null when it can't go on here, and the meal's over.
  function mealJob(n, life, L, taken) {
    const named = new Map(L.placed.map((p) => [p.id, p])), main = L.bounds, m = life.meal;
    const stationOf = (arches) => L.stations.find((st) => { const p = named.get(st.piece); return p && arches.includes(p.arche) && p.form !== 'microwave' && !inAnnex(L, st.v); });
    if (!m) {
      const st = stationOf(['cold']) || stationOf(['store', 'cabinet']);
      const stand = st && roomNearFree(L, st.u, st.v, 1.8, main);
      if (!stand) return null;
      life.meal = { dish: HOME_DISHES[Math.floor(Math.random() * HOME_DISHES.length)].id, stage: 'get', piece: named.get(st.piece)?.name || 'fridge' };
      return { kind: 'meal', meal: 'get', stand, face: st.at, clip: 'rummage' };
    }
    if (m.stage === 'get') {
      // the hob whenever there's one to stand at; the floor only when there isn't
      const hob = stationOf(['hob']);
      const stand = hob && roomNearFree(L, hob.u, hob.v, 1.8, main);
      if (stand) {
        // the pan on the hob's top, a little in from its front edge
        const p = named.get(hob.piece), pan = [+(hob.u + (hob.at[0] - hob.u) * 0.55).toFixed(2), +(hob.v + (hob.at[1] - hob.v) * 0.55).toFixed(2), +((p?.h || 0.92) + 0.005).toFixed(3)];
        return { kind: 'meal', meal: 'cook', stand, face: hob.at, clip: 'stir', pan };
      }
      // somewhere clear on the floor for the stove, and a spot half a metre off it to squat at
      for (let k = 0; k < 8; k++) {
        const s = roomNearFree(L, main[0] + 0.5 + Math.random() * Math.max(0, main[1] - main[0] - 1), main[2] + 0.5 + Math.random() * Math.max(0, main[3] - main[2] - 1), 1.2, main);
        if (!s) continue;
        const a = Math.random() * Math.PI * 2, stand = roomNearFree(L, s[0] + Math.cos(a) * 0.5, s[1] + Math.sin(a) * 0.5, 0.2, main);
        if (!stand || Math.hypot(stand[0] - s[0], stand[1] - s[1]) < 0.4) continue;
        return { kind: 'meal', meal: 'cook', stand, face: s, clip: 'squatStir', stove: [+s[0].toFixed(2), +s[1].toFixed(2)] };
      }
      return null;
    }
    if (m.stage === 'cook') {
      // sat down to it on the nearest free seat, or stood up where they are
      let best = null, far = Infinity;
      L.seats.forEach((s, i) => {
        if (s.lie || inAnnex(L, s.v) || s.v < 0 || !seatFree(L, i, taken)) return;
        const d = Math.hypot(s.u - life.at[0], s.v - life.at[1]);
        if (d >= far) return;
        const stand = roomNearFree(L, s.u, s.v, 1.8, main);
        if (stand) { far = d; best = { kind: 'meal', meal: 'eat', seat: i, on: s.piece, pose: 'sitting', stand, clip: 'sitEat' }; }
      });
      if (best) return best;
      const stand = roomNearFree(L, life.at[0] + (Math.random() - 0.5), life.at[1] + (Math.random() - 0.5), 1.2, main);
      return stand ? { kind: 'meal', meal: 'eat', stand, yaw: Math.random() * Math.PI * 2, clip: 'eat' } : null;
    }
    return null;
  }

  // Sets off for a job. False when there's no way there from here.
  function walk(n, life, L, job, main, now) {
    const path = roomPath(L, life.at, job.stand);
    if (!path) return false;
    const len = pathLength(path);
    life.seat = null; life.on = null; life.pose = null; life.clip = null; life.stash = null;
    // on the way to the hob with what they took out, or to a seat with the plate
    if (job.meal && life.meal) life.meal.stage = job.meal === 'get' ? 'get' : job.meal === 'cook' ? 'carry' : 'serve';
    // the last point exact: rounded, a spot against the counter can land a few millimetres inside it
    life.route = { path: path.map(([u, v], i) => (i === path.length - 1 ? [u, v] : [+u.toFixed(2), +v.toFixed(2)])), len, t0: now, ms: len / SPEED * 1000 };
    life.job = job;
    const t = setTimeout(() => arrive(n, life, L, main), life.route.ms + 30);
    t.unref?.();
    return true;
  }
  function arrive(n, life, L, main) {
    if (lives.get(n.id) !== life || !life.job) return;
    const job = life.job;
    settle(life, job, L, Date.now());
    const lit = setTvOn(n, life, L, main);
    if (viewers.get(main)?.size) { if (!lit) remark(n, job, main); sendPeople(main).catch(() => {}); }
  }
  // Sat down in front of a set that's off: they put it on, and stay for a while.
  function setTvOn(n, life, L, main) {
    const s = life.seat !== null ? L.seats[life.seat] : null, set = setOf(L);
    if (!s || s.lie || !set || life.talk || life.stash || tvBy.has(main) || tvOn(main) || facing(L, s, set) < FACING || zoneIsDark(main)) return false;
    tvBy.set(main, n.id);
    life.kind = 'watch';
    life.next = Date.now() + between(STAY.watch);
    say(n, main, `picks up the remote and puts the ${set.name || 'set'} on.`);
    for (const l of lives.values()) if (l !== life && l.main === main && !l.route && !l.talk) l.next = 0;
    return true;
  }
  // Now and then they do it where you can read it, and now and then they say something.
  function remark(n, job, main) {
    if (job.kind === 'talk') return;
    if (job.stash) { say(n, main, pick(SIT_LINES[job.stash.k] || SIT_LINES.swallow).replace(/\{table\}/g, job.name || 'table')); return; }
    if (job.meal) {
      const life = lives.get(n.id), d = life?.meal && dishOf(life.meal.dish);
      if (d && Math.random() < MEAL_SAY) say(n, main, (job.meal === 'get' ? d.get : job.meal === 'cook' ? d.cooking : d.eat).split('{piece}').join(life.meal.piece || 'fridge'));
      return;
    }
    const feel = feelOf(main), about = job.kind === 'warm' || job.kind === 'heater' || job.kind === 'cool' || job.kind === 'air' || job.hot;
    const roll = Math.random(), lines = job.hot ? DOING_HOT[job.arche] : DOING[job.arche in DOING && job.kind === 'use' ? job.arche : job.kind];
    // what they say is about the temperature half the time it's wrong, and what they do about it is said more often
    const mutters = feel && Math.random() < TEMP_SAY ? (feel < 0 ? MUTTERS_COLD : MUTTERS_HOT) : MUTTERS;
    const line = roll < MUTTER_CHANCE ? pick(mutters) : roll < MUTTER_CHANCE + (about ? TEMP_SAY : EMOTE_CHANCE) && lines ? pick(lines).replace(/\{piece\}/g, job.name || 'cupboard') : null;
    if (!line) return;
    say(n, main, line);
  }

  // A route's end passing with nobody listening still lands them.
  function catchUp(life, now) {
    if (life.route && life.job && now >= life.route.t0 + life.route.ms) settle(life, life.job, life.L, now);
  }

  // On their feet and still, wherever they've got to.
  function stopFor(life, now) {
    const r = life.route;
    if (r) { life.at = pathAt(r.path, Math.min(r.len, (now - r.t0) / r.ms * r.len)).at; life.route = null; life.job = null; }
    life.seat = null; life.on = null; life.pose = null; life.clip = null; life.stash = null;
  }

  // What peopleIn draws for this NPC, or null when the engine has them.
  function stageOf(n, main) {
    const life = lives.get(n.id);
    if (!life || life.main !== main || !free(n, main)) return null;
    const now = Date.now();
    catchUp(life, now);
    const use = clipOfUse(n.id);
    // a ritual's beat stops them where they are, unless they're sat in a chair to do it (table-stash.js SIT_TAKE)
    const sat = life.seat !== null && !life.route && !!SIT_TAKE[use];
    if (use && !life.talk && !sat) stopFor(life, now);
    const r = life.route;
    // what they're cooking or eating, and where the stove and the pan are (gl/room-meals.js)
    const m = life.meal, meal = m ? { d: m.dish, s: m.stage, ...(m.stove ? { stove: m.stove } : {}), ...(m.pan && m.stage === 'cook' ? { pan: m.pan } : {}) } : null;
    if (r) {
      const gone = Math.min(r.len, (now - r.t0) / r.ms * r.len), q = pathAt(r.path, gone);
      return { at: q.at.map((x) => +x.toFixed(2)), yaw: life.yaw || 0, route: { path: [q.at, ...r.path.slice(q.leg)], ms: Math.max(0, Math.round(r.ms - (now - r.t0))) }, ...(meal ? { meal } : {}) };
    }
    // at the table: the kit and the clock it's taken on (client/shared/table-stash.js); the client works out the clip
    const stash = life.stash ? { k: life.stash.k, of: life.stash.of, beat: life.stash.beat, at: life.stash.at, gone: now - life.stash.t0 } : null;
    const seatClip = use ? SIT_TAKE[use] : stash ? null : life.clip;
    if (life.seat !== null) return { posture: life.pose, on: life.on, seat: life.seat, ...(seatClip ? { clip: seatClip } : {}), ...(meal ? { meal } : {}), ...(stash ? { stash } : {}) };
    const shut = life.inside && n.zone_id === annexOf(main)?.id;
    const clip = life.talk ? 'listen' : use || life.clip;
    return { at: life.at.map((x) => +x.toFixed(2)), yaw: life.yaw || 0, ...(clip ? { clip } : {}), ...(shut ? { shut: true } : {}), ...(meal ? { meal } : {}) };
  }

  // The room's opening: everyone at home is already somewhere, not queued by the door.
  async function settleIn(main) {
    const folk = here(main).filter((n) => free(n, main) && lives.get(n.id)?.main !== main);
    if (!folk.length) return;
    const lay = await layoutOf(main);
    if (!lay) return;
    const now = Date.now(), taken = busy(main, lay.pieces), feel = feelOf(main);
    if (!bandSeen.has(main)) bandSeen.set(main, feelBand(feel));
    for (const n of folk) {
      const life = { main, L: lay.L, yaw: 0, inside: false };
      let job = null;
      for (let k = 0; k < 4 && !job; k++) job = apart(chooseJob(lay.L, taken, null, null, feel), lay.L, main, life);
      if (!job) continue;
      settle(life, job, lay.L, now);
      life.next = now + between(FIRST_MS);
      lives.set(n.id, life);
      if (job.seat !== undefined) { taken.seats.add(job.seat); }
    }
  }

  async function tickRoom(main) {
    const now = Date.now(), folk = here(main), annex = annexOf(main);
    const ids = folk.map((n) => n.id + (n.zone_id === annex?.id ? '+' : '')).sort().join();
    let changed = ids !== seen.get(main);
    seen.set(main, ids);
    for (const [id, life] of lives) if (life.main === main && !folk.some((n) => n.id === id)) { lives.delete(id); changed = true; }
    // whoever put the set on has gone, or the engine has them: it goes off
    const owner = tvBy.has(main) ? folk.find((n) => n.id === tvBy.get(main)) : null;
    if (tvBy.has(main) && (!owner || !free(owner, main))) { tvBy.delete(main); changed = true; tvChanged(main); }
    // the room's gone past room temperature, or come back: they change for it (the look is index.js's and
    // gl/room-people.js's), one of them says so, and whoever's on their feet goes and does something about it
    const feel = feelOf(main), band = feelBand(feel), was = bandSeen.get(main);
    bandSeen.set(main, band);
    if (was !== undefined && was !== band) {
      changed = true;
      const home = folk.filter((n) => free(n, main) && lives.get(n.id)?.main === main && !lives.get(n.id).talk);
      if (home.length) say(pick(home), main, pick(CHANGED[band]));
      for (const n of home) { const l = lives.get(n.id); if (!l.route && l.seat === null && band) { l.want = band < 0 ? 'chill' : 'heat'; l.next = Math.min(l.next, now + randInt(2_000, 20_000)); } }
    }
    const due = folk.filter((n) => {
      if (!free(n, main) || clipOfUse(n.id)) return false;
      const life = lives.get(n.id);
      if (!life || life.main !== main) return true;
      catchUp(life, now);
      return !life.route && (life.inside !== (n.zone_id === annex?.id) || life.next <= now);
    });
    if (due.length) {
      const lay = await layoutOf(main);
      if (lay) {
        const { L, pieces } = lay, n = due[0], taken = busy(main, pieces);
        let life = lives.get(n.id);
        if (!life || life.main !== main) {
          // home while the room's open: in by the door
          life = { main, yaw: 0, inside: false, at: [((L.spec.door?.[0] ?? 0.7) + (L.spec.door?.[1] ?? 1.6)) / 2, L.d - 0.6], seat: null, on: null, pose: null, next: 0 };
          lives.set(n.id, life);
        }
        life.L = L;
        const nowIn = n.zone_id === annex?.id;
        let job;
        if (life.inside !== nowIn) {
          // through the en-suite's door, after the move the engine has already made
          life.inside = nowIn;
          const a = L.annex, door = L.spec.annex?.door;
          job = nowIn && a && door ? { kind: 'use', stand: roomNearFree(L, (door[0] + door[1]) / 2, a.v0 + 0.9, 1.8) } : chooseJob(L, taken, null, null, feel);
        } else if (!nowIn) {
          // getting up from a set they put on: it goes off, and anyone else watching gets up too
          if (tvBy.get(main) === n.id) { tvBy.delete(main); changed = true; say(n, main, 'turns the set off.'); tvChanged(main); }
          const tv = tvOn(main) || tvBy.has(main);
          // a session at the table over: they say so, and the kit goes with them
          if (life.stash) { say(n, main, pick(DONE_LINES[life.stash.k] || DONE_LINES.swallow)); life.stash = null; changed = true; }
          // somebody with a habit sits down at the table to it now and then (client/shared/table-stash.js)
          const session = !life.meal && !tv && !life.want && life.kind !== 'session' && Math.random() < SESSION_CHANCE ? sessionJob(n, life, L, taken) : null;
          if (session) job = session;
          // halfway through a meal they carry on with it; a meal scene (home-life.js) or a roll starts one
          else if (life.meal ||(!tv && (life.want === 'meal' || (!life.want && Math.random() < MEAL_CHANCE)))) {
            job = mealJob(n, life, L, taken);
            if (!job) { life.meal = null; job = chooseJob(L, taken, null, life.at, feel); }
          } else if (annex && !life.want && !tv && Math.random() < BATHROOM_CHANCE && tripToBathroom(main, n)) job = null;
          // a resident already sat watching stays there
          else job = tv && life.kind === 'watch' ? null : (tv && !life.want && watchJob(L, taken)) || chooseJob(L, taken, life.want, life.at, feel);
          life.want = null;
        }
        // nobody stands in somebody else: a step aside, or another job, or they stay put this time
        if (job?.stand && job.seat === undefined) job = apart(job, L, main, life) || apart(chooseJob(L, taken, null, life.at, feel), L, main, life);
        if (job?.stand && walk(n, life, L, job, main, now)) changed = true;
        else life.next = now + between(REST_MS);
      }
    }
    if (changed) await sendPeople(main);
  }

  // Not whoever put it on: their own viewers registering is a change too, and they'd get up and turn it off.
  function tvChanged(main) { const by = lives.get(tvBy.get(main)); for (const l of lives.values()) if (l !== by && l.main === main && !l.route && !l.talk) l.next = 0; }
  const spotOf = (l) => (l.seat !== null ? [l.L.seats[l.seat].u, l.L.seats[l.seat].v] : l.at);

  return {
    stageOf, settleIn, lives, tvBy, bandSeen, mealJob, jobsIn, sessionJob,
    tvOf: (main) => tvBy.has(main),
    async tick() { for (const [main, set] of [...viewers]) if (set.size) await tickRoom(main).catch((e) => console.error('[roomstage] npc life:', e.message)); },
    // A set in this room came on or went off: they go and sit down for it, or get up after it.
    tvChanged,
    // Two residents have started talking: whoever's on their feet goes over, and both stay until it ends.
    talkStart({ zoneId, participants }) {
      const main = mainOf(zoneId), both = participants.map((id) => ({ n: world.npcs.get(id), l: lives.get(id) }));
      if (!viewers.get(main)?.size || both.length !== 2 || both.some(({ n, l }) => !n || !l || l.main !== main || l.route || !l.L)) return;
      for (const { l } of both) { l.talk = true; l.next = Infinity; }
      const [a, b] = both, mover = a.l.seat === null ? a : b.l.seat === null ? b : null, other = mover === a ? b : a;
      if (mover) {
        const L = mover.l.L, there = spotOf(other.l), from = mover.l.at, d = Math.hypot(from[0] - there[0], from[1] - there[1]) || 1;
        const look = (l, to, at) => { l.yaw = roomYaw(L, to[0] - at[0], to[1] - at[1]); };
        const stand = d > TALK_REACH ? roomNearFree(L, there[0] + (from[0] - there[0]) / d * TALK_GAP, there[1] + (from[1] - there[1]) / d * TALK_GAP, 1.8, L.bounds) : null;
        if (!stand || !walk(mover.n, mover.l, L, { kind: 'talk', stand, face: there }, main, Date.now())) look(mover.l, there, from);
        if (other.l.seat === null) look(other.l, stand || from, there);
      }
      sendPeople(main).catch(() => {});
    },
    talkEnd({ participants }) {
      const touched = new Set();
      for (const id of participants) {
        const l = lives.get(id);
        if (!l?.talk) continue;
        l.talk = false; l.next = Date.now() + between(AFTER_TALK_MS);
        touched.add(l.main);
      }
      for (const main of touched) sendPeople(main).catch(() => {});
    },
    // A ritual's beat: 'clip' is what the body does now, and null is the end of it.
    ritual({ npc, clip }) {
      if (clip) using.set(npc.id, { clip, until: Date.now() + RITUAL_MS }); else using.delete(npc.id);
      const main = mainOf(npc.zone_id);
      if (viewers.get(main)?.size) sendPeople(main).catch(() => {});
    },
    // A scene has started in home-life.js: they go and do it, at the next tick.
    scene({ zoneId, npcId, kind }) {
      const life = lives.get(npcId);
      if (life && !life.route && life.main === mainOf(zoneId)) { life.want = kind; life.next = 0; }
    },
  };
}
