// THE BOAT REEL'S RULES, shared by the server (plugins/fishing/boat.js) and the seat's minigame
// (client/game/js/panels/boatfish.js). Pure: no DOM, no world, no clock. Every function takes the time
// it needs, so the server can judge a beat with the same arithmetic the client drew it with.
//
// The loop, from the anchored seat (docs/proposals/boat-fishing.md §5):
//
//   cast     bearing and range from the anchor; the lure lands, then sinks.
//   twitch   each tap draws the lure TWITCH_M closer and lifts it. Fish near it grow interested,
//            more so when the taps keep their species' tempo. At REEL_IN_M the line auto-reels and
//            you cast again.
//   take     an interested fish comes to the lure. It mouths it first (the nibbles), then it takes
//            it, each species in its own way (TAKES). Strike on a nibble and you pull the lure out of
//            its mouth; wait too long and it drops it. How well you time it is how well it's hooked.
//   fight    the fish runs left or right; lean the other way, and hold the reel to wind. Let it have
//            line when it runs, wind hard when it swims at you, ease off when it jumps. A line too
//            tight snaps and a line too slack lets the hook fall out.
//   net      tired and inside LAND_M, it's beside the boat. Net it as it rolls past.
//
// Units: metres, kilograms, milliseconds. Bearings in degrees off the bow, starboard positive.

import { SPECIES } from './fish.js';

// ── THE LINE ───────────────────────────────────────────────────────────────────────────────────
export const TWITCH_M = 1.0;          // how far one tap draws the lure in
export const TWITCH_LIFT_M = 0.35;    // how far one tap lifts it
export const TWITCH_MIN_MS = 250;     // taps closer than this are one tap. Four a second at most, so the
// taps and an anchored boat's 1 s sync stay inside the server's 5 commands a second (server/index.js
// CMD_REFILL_PER_SEC). The quickest tempo a fish wants is 300 ms, so nothing is lost.
export const REEL_IN_M = 0.5;         // at this much line out it auto-reels, and you cast again
export const SINK_MPS = 0.6;          // a plain lure's sink rate, until a lure item says otherwise
export const CAST_MIN_M = 6;          // the shortest cast that counts as a cast

// ── THE PAUSE ──────────────────────────────────────────────────────────────────────────────────
// You work a lure the way people do: twitch it, let it sit, twitch it again. Each species wants a
// pause of its own between twitches before it'll come in (`tempo`, ms). Quick fish want a short one;
// sulkers want you to leave it alone a good while. A row may set `tempo` itself; otherwise it follows
// from the fight style. Twitching again too soon does little, and fussing it puts fish off.
const TEMPO_BY_FIGHT = { runner: 1400, jumper: 1800, wriggler: 1200, steady: 2400, sulker: 3500 };
export const tempoOf = (spId) => {
  const sp = SPECIES[spId];
  return (sp && (sp.tempo || TEMPO_BY_FIGHT[sp.fight])) || 2400;
};

/**
 * How good one pause was, 0..1. Short of the species' pause it counts for little; from there to a
 * long wait it's all good; a very long wait is still fine, the lure's just gone a bit dead.
 */
export function pauseQuality(gapMs, spId) {
  if (gapMs == null) return 0.5;
  const r = gapMs / tempoOf(spId);
  if (r < 1) return 0.05 + 0.95 * r * r;
  if (r <= 3) return 1;
  return Math.max(0.6, 1 - (r - 3) * 0.1);
}
/** Back-compat name. */
export const tempoMatch = pauseQuality;

// ── INTEREST AND THE DRAW ──────────────────────────────────────────────────────────────────────
export const NOTICE_M = 7;            // a fish this close to the lure (in 3D) can notice it at first
export const DRAW_MAX = 1;            // a well-worked lure draws fish from NOTICE_M * (1 + DRAW_MAX)
export const BITE_AT = 1;             // interest at which it takes the lure

/**
 * The draw: how far a lure worked well has been noticed, 0..DRAW_MAX. Each good twitch-and-pause adds
 * to it, so more fish gather the longer you work a spot properly; fussing the lure loses it.
 */
export function drawAfter(draw, gapMs, dtMs) {
  const d = (draw || 0) * Math.exp(-Math.max(0, dtMs || 0) / 30000);
  const q = gapMs == null ? 0.5 : Math.min(1, gapMs / 1500);
  return Math.max(0, Math.min(DRAW_MAX, d + (q >= 0.6 ? 0.18 * q : -0.15)));
}
export const noticeM = (draw = 0) => NOTICE_M * (1 + Math.max(0, Math.min(DRAW_MAX, draw)));

/**
 * The interest one twitch adds to one fish. `dist3` is metres from lure to fish in 3D; `gapMs` the
 * pause since the last twitch (null for the first); `keen` the species' keenness now (fish.js
 * keenness); `bait` 1 when the bait suits it; `draw` the lure's draw. A fish already following
 * needs only two or three good twitches to take it.
 */
export function interestGain({ dist3, gapMs, spId, keen = 1, bait = 0, draw = 0 }) {
  const reach = noticeM(draw);
  if (!(dist3 < reach)) return 0;
  const near = 0.35 + 0.65 * (1 - dist3 / reach);
  return near * pauseQuality(gapMs, spId) * keen * (1 + 0.6 * bait) * 0.5;
}
/** Interest fades slowly; a fish will wait out a pause. Per ms. */
export const INTEREST_DECAY_MS = 20000;
export const decayInterest = (v, dtMs) => v * Math.exp(-dtMs / INTEREST_DECAY_MS);

// ── THE TAKE ───────────────────────────────────────────────────────────────────────────────────
//
// What the float does between a fish arriving and a fish hooked. It replaces the old rhythm of
// beats (2026-11-05): you're reading the float now, not keeping time.
//
// Each fight style takes a lure in its own way, so you learn the fish by what the float does:
//   slide   mouths it a few times, then draws it slowly under. The forgiving one.
//   slam    one touch if you're lucky, then gone. A short window.
//   lift    a big fish picks the lure up, so the float rises, tips over and lies flat. Slow and
//           easily missed.
//   rattle  a shiver of tiny pulls, then a dip. Hit the shiver and you've missed it.
export const STRIKE_LEAD_MS = 800;    // the first nibble comes about this long after the bite message
export const LATENCY_SLACK_MS = 220;  // what the server adds for the round trip
export const NIBBLE_MS = 300;         // how long one nibble moves the float

export const TAKES = {
  steady:   { kind: 'slide',  nibbles: [2, 3], gap: [700, 1150],  windowMs: 1050, sweet: 0.35 },
  runner:   { kind: 'slam',   nibbles: [0, 1], gap: [420, 700],   windowMs: 620,  sweet: 0.25 },
  jumper:   { kind: 'slam',   nibbles: [1, 2], gap: [480, 800],   windowMs: 680,  sweet: 0.25 },
  sulker:   { kind: 'lift',   nibbles: [1, 2], gap: [1100, 1700], windowMs: 1350, sweet: 0.45 },
  wriggler: { kind: 'rattle', nibbles: [3, 5], gap: [230, 360],   windowMs: 560,  sweet: 0.3 },
};

const u32 = (a) => { a = Math.imul(a ^ (a >>> 15), 2246822519); a = Math.imul(a ^ (a >>> 13), 3266489917); return (a ^ (a >>> 16)) >>> 0; };
// A hash in [0, 1) of a seed and a slot. Integer only, so the server and every browser agree.
const roll = (seed, i) => u32((seed | 0) + Math.imul(i + 1, 0x9e3779b1)) / 4294967296;

/**
 * What this fish does to the float, in ms from the bite: { kind, nibbles: [{ at, size }], takeAt,
 * windowMs, sweetAt }. A pure function of its arguments. The server makes it and sends it, and judges
 * the strike against the same object. A bigger fish takes more deliberately but gives you less time.
 */
export function takeScript(seed, spId, kg = 1) {
  const fight = SPECIES[spId]?.fight;
  const T = TAKES[fight] || TAKES.steady;
  const n = T.nibbles[0] + Math.floor(roll(seed, 0) * (T.nibbles[1] - T.nibbles[0] + 1));
  const nibbles = [];
  let t = STRIKE_LEAD_MS * (0.8 + 0.5 * roll(seed, 1));
  for (let i = 0; i < n; i++) {
    nibbles.push({ at: Math.round(t), size: +(0.3 + 0.4 * roll(seed, 2 + i)).toFixed(2) });
    t += T.gap[0] + (T.gap[1] - T.gap[0]) * roll(seed, 12 + i);
  }
  const takeAt = Math.round(t);
  const windowMs = Math.round(T.windowMs * Math.max(0.6, Math.min(1.1, 1.15 - 0.15 * Math.log2(1 + kg))));
  return { kind: T.kind, nibbles, takeAt, windowMs, sweetAt: Math.round(takeAt + windowMs * T.sweet) };
}

const bump = (u) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u));
const ease = (u) => { const c = u < 0 ? 0 : u > 1 ? 1 : u; return c * c * (3 - 2 * c); };

/**
 * The float at `t` ms after the bite, for both drawings of it (the close-up and the 3-D float):
 * { dip, lift, tilt, shiver, under }. `dip` is 0 at rest and 1 gone; `lift` raises it out of the
 * water, 0..1; `tilt` is radians off upright; `shiver` 0..1 is how hard it's trembling; `under` is
 * true once a fish has it. Fills `out` when given, so a frame allocates nothing.
 */
export function floatPose(S, t, out = {}) {
  let dip = 0, lift = 0, tilt = 0, shiver = 0;
  for (const n of S.nibbles) {
    const u = (t - n.at) / NIBBLE_MS;
    if (u <= 0 || u >= 1) continue;
    dip = Math.max(dip, n.size * bump(u));
    if (S.kind === 'rattle') shiver = Math.max(shiver, bump(u));
    if (S.kind === 'lift') { lift = Math.max(lift, 0.3 * bump(u)); dip *= 0.5; }
  }
  const k = t - S.takeAt;
  if (k >= 0) {
    if (S.kind === 'slam') dip = ease(k / 110);
    else if (S.kind === 'slide') dip = ease(k / 420);
    else if (S.kind === 'rattle') { dip = ease(k / 220); shiver = Math.max(shiver, 1 - ease(k / 400)); }
    else {
      // A fish lifting the lure takes the weight off the float: up it comes and over it goes, and
      // only late does it slide away.
      lift = ease(k / 320);
      tilt = 1.35 * ease(k / 420);
      dip = ease((k - S.windowMs * 0.62) / 300);
      if (dip > 0) lift *= 1 - dip;
    }
  }
  out.dip = dip; out.lift = lift; out.tilt = tilt; out.shiver = shiver;
  out.under = k >= 0;
  return out;
}

/**
 * Judge a strike `hitMs` after the bite: { ok, why, set }. `why` is 'early' or 'late' when it failed;
 * `set` is how well the hook went in, 0.15..1, best on the script's `sweetAt`. `slack` widens the
 * window for the server.
 */
export function judgeStrike(hitMs, S, slack = 0) {
  if (!(hitMs >= S.takeAt - slack)) return { ok: false, why: 'early', set: 0 };
  if (hitMs > S.takeAt + S.windowMs + slack) return { ok: false, why: 'late', set: 0 };
  const off = Math.abs(hitMs - S.sweetAt) / (S.windowMs * 0.8);
  return { ok: true, why: null, set: +Math.max(0.15, Math.min(1, 1 - off)).toFixed(2) };
}

/** What a hook set of `set` reads as, for the status line and the log. */
export const setWords = (set) => (set >= 0.75 ? 'solid' : set >= 0.4 ? 'good' : 'lip');

// ── THE FIGHT ──────────────────────────────────────────────────────────────────────────────────
//
// The fight is played on the client, as every minigame here is: winning it is the gate, and the
// server checks it was possible. `fightBoard` is a fish's figures, `stepFight` the physics and
// `minFightMs` the server's check. It's here rather than in the HUD so scripts/fish/fight-sim.mjs can
// play it with a simulated angler. Run that after changing any number below.
//
// Two inputs. `lean` is the rod's side strain, -1 port to 1 starboard; lean against the fish and it
// tires. `wind` is the reel handle; only winding brings line back. Tension settles toward a target
// made of those and what the fish is doing, so it's the mix of the two that keeps it in the green:
//
//   pulling   lean against it and wind.
//   a run     the drag's slipping. Stop winding and let it go, or the line goes. It tires itself.
//   a charge  it swims at the boat and the line falls slack. Wind hard, or the hook drops out.
//   a jump    it's on top of the water, shaking. Ease off the lean, or it tears the hook free.
export const LAND_M = 6;              // tired and this close, it's beside the boat, ready for the net
export const SLACK_AT = 0.12;         // tension under this is slack line
export const TENSION_TAU = 0.55;      // seconds for tension to settle toward its target
export const JUMP_MS = 650;
export const NET_TRIES = 3;           // how many goes at the net before the hook pulls
export const NET_PERIOD_MS = 1700;    // one roll past the net and back

const BY_FIGHT = {
  //          side-change  run every  run lasts   charge every  jump every
  runner:   { switchMs: 1150,  runEvery: 3400, runMs: 1300, chargeEvery: 9000,  jumpEvery: 0 },
  jumper:   { switchMs: 1300, runEvery: 5200, runMs: 1000, chargeEvery: 8000,  jumpEvery: 4600 },
  wriggler: { switchMs: 760,  runEvery: 4200, runMs: 700,  chargeEvery: 6500,  jumpEvery: 0 },
  sulker:   { switchMs: 2600, runEvery: 5200, runMs: 1900, chargeEvery: 24000, jumpEvery: 0 },
  steady:   { switchMs: 1700, runEvery: 7000, runMs: 1000, chargeEvery: 15000, jumpEvery: 0 },
};

/** The fight's starting figures for a fish. `skill` is the player's fishing skill, `set` the hook set. */
export function fightBoard({ kg, difficulty, fight, skill = 4, lineM, set = 0.6 }) {
  const edge = skill - difficulty;
  const F = BY_FIGHT[fight] || BY_FIGHT.steady;
  return {
    stamina: 1,
    tension: 0.3,
    lineM,
    set,
    // How hard it pulls.
    pull: Math.min(1, 0.35 + Math.cbrt(kg) * 0.22 + difficulty * 0.03),
    ...F,
    // Stamina lost per second while you lean right.
    tire: Math.max(0.035, 0.10 + edge * 0.012 - Math.cbrt(kg) * 0.018),
    // How much of a mistake reaches the line: an outclassed angler has less to spare.
    strain: Math.min(0.9, 0.28 + difficulty * 0.03 - edge * 0.015),
    // Line won per second while you wind; line lost while it runs.
    // A light fish comes in quicker: a herring is a few turns of the handle, not a fight.
    gainMps: 1.9 + Math.max(0, edge) * 0.1 + Math.max(0, 1 / Math.cbrt(kg) - 1) * 1.2,
    runMps: 0.8 + Math.cbrt(kg) * 0.5,
    jumps: F.jumpEvery > 0,
    // An outclassed fish keeps a little strain on whatever you do.
    heavy: Math.max(0, difficulty - skill) * 0.044,
    // How long slack line can last before the hook falls out. A lip hook doesn't last long.
    slackHoldMs: 450 + 1000 * set,
    // How wide the net's window is, as a share of the fish's roll.
    netWidth: 0.2 + 0.14 * set,
  };
}

/** The fight's moving parts, at the start. `rnd` is a 0..1 source. */
export function fightState(b, rnd = Math.random) {
  return {
    stamina: b.stamina, tension: b.tension, lineM: b.lineM, lineCap: b.lineM * 1.4 + 6,
    side: rnd() < 0.5 ? -1 : 1, mag: 0, pull: 0, lean: 0, wind: 0,
    switchIn: b.switchMs, runIn: b.runEvery * (0.5 + 0.5 * rnd()), chargeIn: b.chargeEvery * (0.6 + 0.6 * rnd()),
    jumpIn: b.jumpEvery ? b.jumpEvery * (0.5 + 0.5 * rnd()) : Infinity,
    runLeft: 0, chargeLeft: 0, jumpLeft: 0, slackMs: 0, mode: 'pull',
  };
}

const LEAN_RATE = 10;   // how fast the rod's lean follows the input, per second

/**
 * One step of the fight. `input` is { lean: -1..1, wind: bool }, `dt` in seconds. Mutates `F` and
 * returns 'snap', 'thrown' or 'tired' when the fight ends, else null. `F.mode` says what the fish is
 * doing ('pull', 'run', 'charge', 'jump', 'spent') and `F.fired` names the mode it just began, once.
 */
export function stepFight(F, b, input, dt, rnd = Math.random) {
  const ms = dt * 1000;
  F.fired = null;
  F.lean += Math.max(-LEAN_RATE * dt, Math.min(LEAN_RATE * dt, (input.lean || 0) - F.lean));
  F.wind = input.wind ? 1 : 0;
  const alive = F.stamina > 0;
  if (alive) {
    F.switchIn -= ms; F.runIn -= ms; F.chargeIn -= ms; F.jumpIn -= ms;
    if (F.switchIn <= 0) { F.side = -F.side; F.switchIn = b.switchMs * (0.75 + 0.5 * rnd()); F.switched = 240; }
    const busy = F.runLeft > 0 || F.chargeLeft > 0 || F.jumpLeft > 0;
    if (!busy) {
      if (F.jumpIn <= 0) { F.jumpLeft = JUMP_MS; F.jumpIn = b.jumpEvery * (0.75 + 0.5 * rnd()); F.fired = 'jump'; }
      else if (F.chargeIn <= 0) { F.chargeLeft = 900 + 700 * rnd(); F.chargeIn = b.chargeEvery * (0.75 + 0.5 * rnd()); F.fired = 'charge'; }
      else if (F.runIn <= 0) { F.runLeft = b.runMs * (0.8 + 0.4 * rnd()); F.runIn = b.runEvery * (0.75 + 0.5 * rnd()); F.fired = 'run'; }
    }
  } else { F.runLeft = 0; F.chargeLeft = 0; F.jumpLeft = 0; }
  F.runAge = F.runLeft > 0 ? (F.runAge || 0) + ms : 0;
  F.runLeft = Math.max(0, F.runLeft - ms);
  F.chargeLeft = Math.max(0, F.chargeLeft - ms);
  F.jumpLeft = Math.max(0, F.jumpLeft - ms);
  F.switched = Math.max(0, (F.switched || 0) - ms);
  const run = F.runLeft > 0, charge = F.chargeLeft > 0, jump = F.jumpLeft > 0;
  F.mode = !alive ? 'spent' : jump ? 'jump' : charge ? 'charge' : run ? 'run' : 'pull';

  const mag = alive ? b.pull * (0.45 + 0.55 * F.stamina) * (run ? 1.3 : 1) : 0;
  // The side shows at once (the player reacts to it); only the strength eases in.
  F.mag += (mag - F.mag) * Math.min(1, dt * 8);
  F.pull = F.side * F.mag;
  const q = Math.max(0, Math.min(1, -F.lean * F.side));       // leaning against it
  const wrong = Math.max(0, Math.min(1, F.lean * F.side));
  const turning = F.switched > 0;                             // it's only just changed side
  const w = F.wind;

  let target;
  if (!alive) target = 0.2 + 0.32 * w;
  else if (jump) target = 0.3 + 0.66 * q + 0.3 * wrong + 0.2 * w + b.heavy;
  else if (charge) target = 0.03 + 0.44 * w;
  else {
    target = 0.24 + 0.30 * mag + 0.2 * w + b.heavy - 0.14 * q + (turning ? 0 : (0.4 + 0.6 * b.strain) * wrong * mag);
    // The drag takes the first of a run. Keep winding through it and the load comes on over a moment.
    if (run) target += 0.06 + (0.3 + 0.45 * b.strain) * w * Math.min(1, F.runAge / 600);
  }
  F.tension += (target - F.tension) * (1 - Math.exp(-dt / TENSION_TAU));

  // Stamina: leaning against it, and it spends itself when it runs or jumps.
  if (alive) {
    let loss = 0;
    if (q > 0.25) loss += b.tire * q * (w ? 1.2 : 1);
    if (run) loss += b.tire * 0.5;
    if (jump) loss += b.tire * 0.7;
    F.stamina = loss ? Math.max(0, F.stamina - loss * dt) : Math.min(1, F.stamina + 0.015 * dt);
  }
  // The line.
  if (!alive) { if (w) F.lineM -= b.gainMps * 1.1 * dt; }
  else if (run) F.lineM += b.runMps * mag * 1.5 * dt;
  else if (charge) { if (w) F.lineM -= b.gainMps * 1.7 * dt; }
  else if (w && q > 0.25) F.lineM -= b.gainMps * (0.4 + 0.6 * q) * dt;
  else if (!turning && q <= 0.25) F.lineM += b.runMps * mag * (w ? 0.2 : 0.5) * dt;
  F.lineM = Math.max(0, F.lineM);
  if (F.lineM > F.lineCap) { F.lineM = F.lineCap; F.tension += 0.6 * dt; }

  if (F.tension >= 1) { F.tension = 1; return 'snap'; }
  F.tension = Math.max(0, F.tension);
  F.slackMs = alive && F.tension < SLACK_AT ? F.slackMs + ms : Math.max(0, F.slackMs - ms * 2);
  if (F.slackMs >= b.slackHoldMs) return 'thrown';
  if (!alive && F.lineM <= LAND_M) return 'tired';
  return null;
}

/**
 * Where the tired fish is as it rolls past the net, -1..1, at `ms` into the netting. Zero is over the
 * net. It rolls slower as it gives up.
 */
export const netSwing = (ms, tries = 0) => Math.sin((ms / (NET_PERIOD_MS * (1 + 0.15 * tries))) * Math.PI * 2);

/** The shortest a fair fight could be, in ms: the server refuses a win faster than this. */
export function minFightMs({ kg, difficulty, skill = 4, lineM }) {
  const b = fightBoard({ kg, difficulty, fight: 'steady', skill, lineM });
  const tireS = 1 / (b.tire * 1.2), reelS = Math.max(0, lineM - LAND_M) / (b.gainMps * 1.7);
  return Math.round(Math.max(tireS, reelS) * 1000 * 0.55);
}
