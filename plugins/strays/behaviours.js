// plugins/strays/behaviours.js — everything Cathode does while it is out.
//
// WHY THIS IS CODE AND NOT CONTENT. Every entry is welded to a predicate over
// live world state — the weather right now, whether this room has a vent in it,
// what this particular player has done to it. There is nothing here a content
// author could meaningfully edit without editing the gate next to it, so the
// prose lives beside its condition rather than in a JSON file that would need a
// parallel vocabulary of conditions invented for it.
//
// THE BASELINE IS LOAD-BEARING. Eight of these are just a cat being a cat —
// grooming, yawning, loafing, staring at nothing. They are not filler. Without
// them every appearance is A Bionic Paw Moment and the animal reads as a
// mechanism with fur on it. The paw should be something you notice about a cat,
// not the reason the cat exists.
//
// TONE. It is a stray in a service lane, not a pet and not a mascot. It is not
// cute at the player. It is busy, and you are allowed to watch.
//
// Adding one: give it a unique `key`, a `gate` that must never throw on a
// minimal ctx (regress calls every gate with an empty-ish one), and a `line`
// that returns a full sentence with no leading name — the tick broadcasts the
// string exactly as returned.
//
// A behaviour may ALSO carry `you(ctx)`, a second-person line for `ctx.player`.
// When it does, index.js sends that to the focus player and broadcasts `line` to
// everybody else, so a thing done TO somebody reads as done to them rather than
// as a caption about them. `line` must still stand alone: the focus player can
// leave between the pick and the send, and then only the room line goes out.

// ctx = { cat, zone, zoneId, players, player, env, furniture, mood, tier, name }

const hasFurn = (ctx, re) => (ctx.furniture || []).some((f) => re.test(f?.name || ''));
const terrainIs = (ctx, t) => ctx.zone?.flags?.terrain === t;
const hour = (ctx) => (ctx.env?.hour ?? 12);
const precip = (ctx) => ctx.env?.currentPrecip || 'none';
const windy = (ctx) => (ctx.env?.windKph ?? 0) >= 25;
const handleOf = (ctx) => ctx.player?.handle || 'somebody';

export const BEHAVIOURS = [
  // ── The paw ───────────────────────────────────────────────────────────────
  // Seven, which is a lot, because it is the thing the player came to look at.
  // None of them explain it. Nobody in the game knows who fitted it.
  {
    key: 'paw_flex', weight: 6, gate: () => true,
    line: (c) => `${c.name} spreads the toes of the steel paw, one at a time, and folds them back up. Something inside it whines faintly on the way closed.`,
  },
  {
    key: 'paw_lick', weight: 6, gate: () => true,
    line: (c) => `${c.name} starts washing the metal paw, gets two licks in, and stops. It looks at the paw. It washes the other one instead.`,
  },
  {
    key: 'paw_tap', weight: 5, gate: () => true,
    line: (c) => `${c.name} taps the ground with the steel paw. Tap. Tap. Tap. Perfectly evenly spaced, which is not how a cat does anything.`,
  },
  {
    key: 'paw_spark', weight: 3, gate: () => true,
    line: (c) => `A blue arc jumps a knuckle joint on ${c.name}'s front paw with a snap. ${c.name} leaps sideways, glares at its own leg, and settles back down insulted.`,
  },
  {
    key: 'paw_favour', weight: 5, gate: () => true,
    line: (c) => `${c.name} sits down and holds the steel paw off the ground, unweighted, the way you'd hold a hand you'd rather not use.`,
  },
  {
    key: 'paw_grip', weight: 4, gate: () => true,
    line: (c) => `${c.name} picks up a bottle cap with the metal paw — delicately, servo-slow, more care than the job needs — carries it half a metre, and drops it.`,
  },
  {
    key: 'paw_diagnostic', weight: 3, gate: () => true,
    line: (c) => `An amber light comes on somewhere under the fur of ${c.name}'s front leg and cycles through a pattern. It finishes. Nothing happens. Nobody wrote a manual for it.`,
  },

  // ── Weather ───────────────────────────────────────────────────────────────
  {
    key: 'rain_shelter', weight: 9, gate: (c) => precip(c) === 'rain',
    line: (c) => `${c.name} is flattened into the driest available handspan of ground, ears down, radiating a personal grievance about the rain.`,
  },
  {
    key: 'rain_shake', weight: 8, gate: (c) => precip(c) === 'rain',
    line: (c) => `${c.name} shakes itself out. Three paws stay wet. The fourth sheds every drop at once and comes up dry.`,
  },
  {
    key: 'snow_prints', weight: 9, gate: (c) => precip(c) === 'snow',
    line: (c) => `${c.name} picks its way across the snow, shaking each foot in turn. It leaves four prints: three soft, one pressed deep and square.`,
  },
  {
    key: 'wind_ears', weight: 7, gate: (c) => windy(c),
    line: (c) => `${c.name} sits with its ears flattened back against the wind, tracking something upwind that you cannot hear and probably should.`,
  },

  // ── Time of day ───────────────────────────────────────────────────────────
  {
    key: 'dawn_stretch', weight: 7, gate: (c) => hour(c) >= 5 && hour(c) < 9,
    line: (c) => `${c.name} stretches long and slow, front end down, and holds it. The metal paw judders once at full extension.`,
  },
  {
    key: 'noon_sprawl', weight: 7, gate: (c) => hour(c) >= 11 && hour(c) < 16,
    line: (c) => `${c.name} has found the one warm strip of light in the whole lane and is lying in it, fully melted, taking up as much of it as a cat can.`,
  },
  {
    key: 'dusk_hunt', weight: 8, gate: (c) => hour(c) >= 18 && hour(c) < 22,
    line: (c) => `${c.name}'s pupils have gone wide and black. It is stalking something in absolutely empty air, belly low, deadly serious.`,
  },
  {
    key: 'night_eyes', weight: 8, gate: (c) => hour(c) >= 22 || hour(c) < 5,
    line: (c) => `You can't really see ${c.name}. You can see two eyes catching the light, at ankle height, and hear one small servo click as they turn to follow you.`,
  },

  // ── The room it's standing in ─────────────────────────────────────────────
  {
    key: 'bin_dive', weight: 8, gate: (c) => hasFurn(c, /bin|trash|dumpster|skip|refuse/i),
    line: (c) => `${c.name} goes head-first into the bin. There is a rummaging noise, and a long pause, and then it reverses out with nothing and considerable dignity.`,
  },
  {
    key: 'crate_perch', weight: 7, gate: (c) => hasFurn(c, /crate|pallet|barrel|drum|stack/i),
    line: (c) => `${c.name} takes the high ground in one go — steel paw landing with a distinct clunk — and looks down at everyone from it.`,
  },
  {
    key: 'vent_curl', weight: 7, gate: (c) => hasFurn(c, /vent|pipe|duct|grate|exhaust/i),
    line: (c) => `${c.name} has curled up exactly where the warm air comes out, in a shape approximately the size and mood of a loaf.`,
  },
  {
    key: 'door_scratch', weight: 6, gate: (c) => hasFurn(c, /door|hatch|shutter|gate/i),
    line: (c) => `${c.name} scratches at the door twice and sits back to wait, entirely confident that this is how doors work and someone will be along.`,
  },
  {
    key: 'hardstand_roll', weight: 6, gate: (c) => terrainIs(c, 'road') || terrainIs(c, 'concrete'),
    line: (c) => `${c.name} flops over and rolls in the oil-black grit of the roadway, all four legs in the air, thoroughly pleased with the decision.`,
  },

  // ── What it remembers about YOU ───────────────────────────────────────────
  // These are the whole point. `flee_bolt` is fired directly on surfacing by
  // index.js, not picked from this table — a killer never gets a window.
  {
    key: 'seek_greet', weight: 24, gate: (c) => c.mood === 'seek',
    line: (c) => `${c.name} trots straight over to ${handleOf(c)} without hesitating, headbutts them just above the ankle, and stands there leaning on their shin.`,
  },
  {
    key: 'seek_talk', weight: 14, gate: (c) => c.mood === 'seek',
    line: (c) => `${c.name} looks up at ${handleOf(c)} and makes a small interrogative noise. It is clearly a question. It is unfortunately not in any language.`,
  },
  {
    key: 'seek_gift', weight: 10, gate: (c) => c.mood === 'seek' && (c.pets || 0) >= 10,
    line: (c) => `${c.name} carries a bottle cap over in the steel paw, sets it down in front of ${handleOf(c)} with some ceremony, and steps back to watch them receive it.`,
  },
  // ── Cuddling up ───────────────────────────────────────────────────────────
  // The one thing it does that is unambiguously affection, and the only reason
  // it is not restricted to regulars is that a cat deciding you are furniture is
  // not a reward, it is a cat being warm. `neutral` is "we have met and it went
  // fine", which is exactly the bar. `wary` and `flee` are excluded: a stranger
  // does not get leaned on, and a killer is handled long before this table.
  {
    key: 'cuddle_lean', weight: 18,
    gate: (c) => (c.mood === 'neutral' || c.mood === 'seek') && !!c.player,
    line: (c) => `${c.name} crosses to ${handleOf(c)}, turns twice, and settles hard against their leg with its whole weight behind it.`,
    you: (c) => `${c.name} crosses to you, turns twice, and settles against your leg with its whole weight behind it. The steel paw ends up flat on your boot, warm from being walked on.`,
  },
  {
    key: 'cuddle_lap', weight: 12,
    gate: (c) => (c.mood === 'neutral' || c.mood === 'seek') && !!c.player &&
      (c.player.posture === 'sitting' || c.player.posture === 'lying'),
    line: (c) => `${c.name} steps up onto ${handleOf(c)} without asking, kneads once, and folds itself down into a shape that clearly intends to stay there.`,
    you: (c) => `${c.name} steps up onto you without asking, kneads once — push, push, thump — and folds down into your lap, purring, entirely committed.`,
  },
  {
    key: 'cuddle_headbutt', weight: 10,
    gate: (c) => c.mood === 'seek' && !!c.player,
    line: (c) => `${c.name} winds a full circle around ${handleOf(c)}'s ankles, pressing the length of itself along them, and comes back round for a second lap.`,
    you: (c) => `${c.name} winds around your ankles, pressing the whole length of itself along your shins, and comes back round for a second lap in case you missed it.`,
  },
  {
    key: 'neutral_recognise', weight: 16, gate: (c) => c.mood === 'neutral',
    line: (c) => `${c.name} stops what it's doing and looks at ${handleOf(c)} for a beat longer than an animal that didn't recognise them would. Then it goes back to it.`,
  },
  {
    key: 'wary_watch', weight: 14, gate: (c) => c.mood === 'wary',
    line: (c) => `${c.name} is watching ${handleOf(c)} from exactly as far away as it needs to be, and adjusts when they shift their weight.`,
  },
  {
    key: 'wary_arc', weight: 10, gate: (c) => c.mood === 'wary',
    line: (c) => `${c.name} crosses the lane by the long way round, keeping the full width of it between itself and ${handleOf(c)} the entire time.`,
  },

  // ── Just a cat ────────────────────────────────────────────────────────────
  // The load-bearing baseline. Do not trim these to make room for cleverer ones.
  { key: 'groom',            weight: 10, gate: () => true, line: (c) => `${c.name} washes one shoulder with great thoroughness, as though it has been on the list for a while.` },
  { key: 'yawn',             weight: 10, gate: () => true, line: (c) => `${c.name} yawns enormously, entirely too many teeth for the size of it, and smacks its mouth shut.` },
  { key: 'chirp_at_bird',    weight: 8,  gate: () => true, line: (c) => `${c.name} fixes on something on a ledge overhead and makes a rapid clicking chirp at it. The something does not care.` },
  { key: 'loaf',             weight: 10, gate: () => true, line: (c) => `${c.name} has folded all four legs underneath itself and become a loaf. It intends to remain a loaf.` },
  { key: 'stare_at_nothing', weight: 9,  gate: () => true, line: (c) => `${c.name} is staring intently at a completely unremarkable patch of wall. After a while it looks away, apparently satisfied.` },
  { key: 'knead',            weight: 8,  gate: () => true, line: (c) => `${c.name} kneads at a folded scrap of cardboard, slow and rhythmic, eyes half shut. One paw goes thump, thump instead of push, push.` },
  { key: 'scratch_ear',      weight: 8,  gate: () => true, line: (c) => `${c.name} scratches behind one ear with a back foot, at speed, and nearly falls over.` },
  { key: 'sit_and_blink',    weight: 8,  gate: () => true, line: (c) => `${c.name} sits very upright with its tail curled round its feet and blinks, slowly, at the middle distance.` },
];

// ---------------------------------------------------------------------------
// Selection: gate → drop anything used recently → weighted pick.
//
// The recency ring is what makes this read as an animal rather than a random
// table. A cat that yawns twice in ninety seconds is a slot machine.

export function pickBehaviour(ctx, recent = []) {
  const eligible = BEHAVIOURS.filter((b) => {
    if (recent.includes(b.key)) return false;
    try { return !!b.gate(ctx); } catch { return false; }
  });
  // If recency has starved the pool (a small room, a long window), allow repeats
  // rather than going silent — silence reads as a bug, a repeat reads as a cat.
  const pool = eligible.length ? eligible : BEHAVIOURS.filter((b) => {
    try { return !!b.gate(ctx); } catch { return false; }
  });
  if (!pool.length) return null;

  const total = pool.reduce((sum, b) => sum + (b.weight || 1), 0);
  let roll = Math.random() * total;
  for (const b of pool) {
    roll -= (b.weight || 1);
    if (roll <= 0) return b;
  }
  return pool[pool.length - 1];
}
