/**
 * Overclock — pushing hardware past what it was built to do, and what that costs.
 *
 * Tuning makes a machine work correctly. Overclocking makes it work beyond spec.
 * They are different verbs on purpose and they pull in opposite directions:
 * calibration buys you output AND the headroom to survive it, which is the loop
 * closing — the player who tunes carefully can push harder than the one who
 * doesn't, and both are choosing.
 *
 * THE THREE RULES
 *
 *   1. HEAT NEVER TOUCHES THE DATABASE. It lives in `player._augHeat`, decays
 *      lazily from a timestamp on read (the hygiene `_sweat` idiom) and cools off
 *      entirely on logout. That is correct: heat is a minutes-scale phenomenon.
 *      What SURVIVES is the condition it burned, which is durable and flushed
 *      coalesced by state.js on the existing 1m cadence. Do not add a column.
 *
 *   2. THE ACCRUAL PATH IS SYNC BY CONTRACT. `onStrain` is registered into
 *      server/engine/strain.js and runs per swing and per hit. It touches two
 *      in-memory Maps and nothing else. No await, no query, ever.
 *
 *   3. NO PROSE IN THIS FILE. What a failing hydraulic arm SAYS is authored in
 *      `augments.failure_messages`, because "Bionic malfunction." is not a
 *      sentence anybody should read twice. The generic line below is the fallback
 *      of last resort, and loadAugments() warns at boot — and regress fails — for
 *      any overclockable augment that leans on it.
 */
import { sendToPlayer } from '../../server/engine/messaging.js';
import { rosterOf, catalogSync, markDirty, persistRec, chromeDown, recordOf } from './state.js';

// What each kind of exertion costs a piece of chrome at overclock 0. Scaled by
// the augment's authored heat_rate, so a neural co-processor barely notices a
// punch-up and a hydraulic arm very much does.
export const HEAT_EVENTS = { swing: 1.0, taken: 0.5, sprint: 0.6 };

// Degrees per second shed while you are not working. A hard fight takes a couple
// of minutes to walk off, which is the pacing this is tuned for.
export const HEAT_COOL_PER_SEC = 1.2;

export const HEAT_BANDS = [
  { id: 'extreme',  min: 130, label: 'EXTREME',  cls: 'text-red' },
  { id: 'critical', min: 100, label: 'Critical', cls: 'text-red' },
  { id: 'hot',      min: 70,  label: 'Hot',      cls: 'outcast-warning' },
  { id: 'warm',     min: 40,  label: 'Warm',     cls: '' },
  { id: 'cool',     min: 0,   label: 'Cool',     cls: '' },
];
export const HOT = 70;
export const CRITICAL = 100;

export function heatBand(heat) {
  return HEAT_BANDS.find(b => heat >= b.min) || HEAT_BANDS[HEAT_BANDS.length - 1];
}

/** Current heat, with the cooling since the last touch applied. Never negative. */
export function heatOf(player, augmentId) {
  const rec = player?._augHeat?.get(augmentId);
  if (!rec) return 0;
  const elapsed = (Date.now() - rec.at) / 1000;
  return Math.max(0, rec.heat - HEAT_COOL_PER_SEC * elapsed);
}

// Recompute-then-add. One Map write, no timer, no tick.
function addHeat(player, augmentId, gain) {
  if (!(player._augHeat instanceof Map)) player._augHeat = new Map();
  const current = heatOf(player, augmentId);
  const next = current + gain;
  player._augHeat.set(augmentId, { heat: next, at: Date.now() });
  return { before: current, after: next };
}

function addWear(player, augmentId, delta) {
  if (!(player._augWearPending instanceof Map)) player._augWearPending = new Map();
  player._augWearPending.set(augmentId, (player._augWearPending.get(augmentId) || 0) + delta);
}

function message(aug, key) {
  const m = aug?.failure_messages;
  return (m && typeof m === 'object' && m[key]) || null;
}

/**
 * The one strain contributor. SYNC. Walks the roster already in RAM.
 *
 * An augment with heat_rate 0 never gets a Map entry at all, so the ordinary
 * unchromed and lightly-chromed player costs literally nothing on the hot path.
 */
export function onStrain(player, event) {
  const gainBase = HEAT_EVENTS[event];
  if (!gainBase || chromeDown(player)) return;
  const roster = rosterOf(player);
  if (!roster.size) return;
  const cache = catalogSync();

  for (const rec of roster.values()) {
    const aug = cache[rec.augment_id];
    if (!aug) continue;
    const rate = Number(aug.heat_rate) || 0;
    if (rate <= 0) continue;
    if (Number(rec.condition ?? 1) <= 0) continue;   // dead chrome does no work and makes no heat

    const oc = Math.max(0, Number(rec.overclock_level) || 0);
    const gain = gainBase * rate * Math.pow(1 + oc, 1.6);
    const { before, after } = addHeat(player, rec.augment_id, gain);

    // Warn ONCE per band transition, the announceWear rule. A line every swing is
    // noise the player learns to skip, which defeats the warning.
    const bBefore = heatBand(before).id;
    const bAfter = heatBand(after).id;
    if (bAfter !== bBefore && (bAfter === 'hot' || bAfter === 'critical' || bAfter === 'extreme')) {
      const line = message(aug, 'strain');
      if (line) {
        sendToPlayer(player.id, { type: 'output', message: `<span class="outcast-warning">${line}</span>` });
      }
    }

    // Above Hot, heat starts eating the machine. This is the durable half.
    if (after > HOT) {
      addWear(player, rec.augment_id, ((after - HOT) / 400) * (1 + oc));
    }

    // Failure only at Critical, mitigated by how well it is tuned.
    if (after >= CRITICAL) {
      const cond = Math.max(0, Math.min(1, Number(rec.condition ?? 1)));
      const cal = Math.max(0, Math.min(100, Number(rec.calibration ?? 100)));
      const p = (0.02 + 0.03 * oc + 0.05 * (1 - cond)) * (1 - cal / 200);
      if (Math.random() < p) fireFault(player, rec, aug);
    }
  }
}

/**
 * A fault. Damages the hardware, drops it out of overclock, and says what
 * happened IN THE HARDWARE'S OWN WORDS. The condition hit is real and immediate
 * rather than pending, because the player is being told about it right now and
 * the number they check next must agree with the sentence they just read.
 */
export function fireFault(player, rec, aug) {
  const before = Number(rec.condition ?? 1);
  const hit = 0.08 + Math.random() * 0.12 + 0.03 * (Number(rec.overclock_level) || 0);
  rec.condition = Math.max(0, before - hit);
  rec.overclock_level = 0;                 // it drops out of spec-breaking on its own
  markDirty(player, rec.augment_id);
  player._augHeat?.set(rec.augment_id, { heat: CRITICAL * 0.6, at: Date.now() });

  const dead = rec.condition <= 0;
  const burnt = !dead && before > 0.15 && rec.condition <= 0.15;
  const key = dead ? 'dead' : burnt ? 'burnout' : 'fault';
  const line = message(aug, key)
    || message(aug, 'fault')
    || `Something in your ${aug.name} lets go, hard.`;

  sendToPlayer(player.id, { type: 'output', message: `<span class="text-red">${line}</span>` });
  if (dead) {
    sendToPlayer(player.id, { type: 'output', message:
      `<span class="outcast-warning">Your ${aug.name} is dead weight now. It is still in you; it is just not doing anything. A surgeon can bring it back.</span>` });
  }
  return { key, condition: rec.condition };
}

/**
 * `augment overclock <name> [level]` — set how far past spec you are running.
 *
 * The ceiling is one authored field, and that field is the entire mechanical
 * statement of the faction split: licensed Ascendant chrome ships 0-1, unlicensed
 * back-alley chrome ships 3. Nothing else in the code knows the difference.
 */
export async function cmdOverclock(args, raw, player) {
  const cache = catalogSync();
  const parts = args.slice();
  let level = null;
  if (parts.length && /^\d+$/.test(parts[parts.length - 1])) level = parseInt(parts.pop(), 10);
  const name = parts.join(' ');

  if (!name) {
    const lines = [];
    for (const rec of rosterOf(player).values()) {
      const aug = cache[rec.augment_id];
      if (!aug || !(Number(aug.overclock_max) > 0)) continue;
      const heat = heatOf(player, rec.augment_id);
      const band = heatBand(heat);
      lines.push(`<span class="zone-name">${aug.name}</span>  output ${100 + 25 * rec.overclock_level}%  `
        + `<span class="${band.cls}">${band.label}</span>  (max ${aug.overclock_max})`);
    }
    if (!lines.length) {
      return { type: 'error', message: 'Nothing you are carrying under the skin can be pushed past spec.' };
    }
    return { type: 'output', message:
      `<span class="skills-header">OVERCLOCK</span>\n\n${lines.join('\n')}\n\n`
      + `<span style="opacity:.7">augment overclock &lt;name&gt; &lt;level&gt; — 0 is spec. Everything above it is yours to answer for.</span>` };
  }

  const aug = Object.values(cache).find(a =>
    a.id.toLowerCase() === name.toLowerCase() || a.name.toLowerCase().includes(name.toLowerCase()));
  if (!aug) return { type: 'error', message: `No such augment: "${name}".` };
  const rec = recordOf(player, aug.id);
  if (!rec) return { type: 'error', message: `You don't have ${aug.name} installed.` };

  const max = Number(aug.overclock_max) || 0;
  if (max <= 0) {
    return { type: 'error', message: `${aug.name} runs at spec and nowhere else. There is no adjustment to make — the governor is part of the casting.` };
  }
  if (Number(rec.condition ?? 1) <= 0) {
    return { type: 'error', message: `${aug.name} is dead. Get it repaired before you ask anything of it.` };
  }
  if (level == null) level = Math.min(max, (rec.overclock_level || 0) + 1);
  if (level < 0 || level > max) {
    return { type: 'error', message: `${aug.name} tops out at ${max}. Past that the controller simply refuses, which is the only part of it that is looking after you.` };
  }

  const prev = rec.overclock_level || 0;
  rec.overclock_level = level;
  await persistRec(player, aug.id);   // deliberate act; written through, not queued

  if (level === 0) {
    return { type: 'output', message: `${aug.name} drops back to spec. The whine falls out of it.` };
  }
  const warn = level >= max
    ? `\n<span class="text-red">That is everything it has. It will run hot and it will not run long.</span>`
    : (level > prev ? `\n<span class="outcast-warning">It runs hotter now.</span>` : '');
  return { type: 'output', message:
    `${aug.name} set to <b>${100 + 25 * level}%</b> output.${warn}` };
}
