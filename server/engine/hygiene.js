/**
 * Hygiene — filth ON A BODY, as an engine substrate.
 *
 * The zone half of this already existed: `zones.stains` + the STAIN_SMELLS table
 * in commands/world.js answer "what happened on this floor". Nothing answered the
 * other half — you could be caked in shit, blood and three days of sweat and the
 * room smelled of nothing, because contamination was a set of inert flags nobody
 * read back.
 *
 * This is a SUBSTRATE, not a system: it owns no verbs and no tick. It reads state
 * other systems already write (bodily's `clothing_contamination` / `soiled_state`,
 * combat's `covered_in_blood`, MIS's `ejaculate_state`) and turns it into one
 * question — how bad do you smell, and of what — that anything can ask.
 *
 * READ TIER: every export here is SYNC and query-free by contract. `hygieneOf` is
 * called from the smell command, from NPC reaction paths and (eventually) from a
 * price calculation, so it may never await. The one write — stamping a wash —
 * goes through player_flags and is rare by definition.
 */
import { isMisActive } from './mis.js';
import { setFlag } from './flags.js';
import { registerStatusEffect, applyEffect } from './effects.js';
import { emit } from './events.js';

// What a contaminant smells like when it's on a person rather than on the floor.
// Deliberately worded differently from STAIN_SMELLS: a puddle is anonymous, a
// person is not, and "somebody here" is the whole horror of it.
//
// `misOnly` entries are withheld from a viewer who hasn't opted into MIS — the
// smell would otherwise be the tell that the whole surface exists.
export const CONTAMINANT_SMELLS = {
  feces:     { text: 'shit, and it is on somebody in this room',            strength: 9, source: 'feces' },
  urine:     { text: 'piss, soaked into cloth and going stale',             strength: 7, source: 'urine' },
  vomit:     { text: 'vomit dried into somebody\'s clothes',                strength: 7, source: 'vomit' },
  blood:     { text: 'blood, and not from a scratch',                       strength: 6, source: 'blood' },
  ejaculate: { text: 'sex, recent, and nobody opened a window',             strength: 6, source: 'sex', misOnly: true },
  grease:    { text: 'rancid grease worked into somebody\'s sleeves',       strength: 4, source: 'burning' },
  chem:      { text: 'solvent, sharp enough to sit behind the eyes',        strength: 6, source: 'chem' },
  smoke:     { text: 'somebody who has been standing in smoke',             strength: 4, source: 'burning' },
  fish:      { text: 'fish, well past its argument with freshness',         strength: 6, source: 'fish' },
};

// ── Sweat ────────────────────────────────────────────────────────────────────
//
// Runtime-only (`player._sweat`, 0–100) — a sweat level that survived a relog
// would be state pretending to matter. Anything that makes a body work adds to
// it: MIS events, running, the weight bench, heat.

export const SWEAT_MAX = 100;
const SWEAT_COOL_PER_MIN = 20;

export function addSweat(player, amount) {
  if (!player || !amount) return;
  player._sweat = Math.min(SWEAT_MAX, (player._sweat || 0) + amount);
}

// Called from a 1m tick. In memory, no write.
export function coolSweat(player) {
  if (!player?._sweat) return;
  player._sweat = Math.max(0, player._sweat - SWEAT_COOL_PER_MIN);
  if (!player._sweat) delete player._sweat;
}

// ── Sewer grime ──────────────────────────────────────────────────────────────
//
// Same shape as sweat, deliberately: runtime-only, no column, no query. Every
// step through a `flags.district === 'sewer'` zone (checked inline in cmdMove
// off the zone object it already loaded — no extra read) adds a little; it
// decays on the same 1m tick as sweat. A single pass-through barely registers,
// but loitering or crossing it repeatedly does, and it rinses off with the rest
// of you on `markWashed` — no special verb, no soap required.
export const SEWER_GRIME_MAX = 100;
const SEWER_GRIME_COOL_PER_MIN = 12;
export const SEWER_GRIME_PER_STEP = 4;

export function addSewerGrime(player, amount = SEWER_GRIME_PER_STEP) {
  if (!player || !amount) return;
  player._sewerGrime = Math.min(SEWER_GRIME_MAX, (player._sewerGrime || 0) + amount);
}

export function coolSewerGrime(player) {
  if (!player?._sewerGrime) return;
  player._sewerGrime = Math.max(0, player._sewerGrime - SEWER_GRIME_COOL_PER_MIN);
  if (!player._sewerGrime) delete player._sewerGrime;
}

// ── Time since a proper wash ─────────────────────────────────────────────────
//
// Persisted in player_flags (never a new `players` column). A player who has
// never washed doesn't start filthy — grime accrues from the first time anything
// asks, this session, which keeps the system from ambushing existing characters
// with a debt they had no way to pay.

// TWO clocks, deliberately. A shower cleans the body; it does nothing for the
// coat you put back on. Laundry is the other clock, and keeping them separate is
// what gives a laundromat a job a bathroom can't do.
export const WASH_FLAG    = 'hygiene_washed_at';
export const LAUNDRY_FLAG = 'hygiene_laundered_at';

const GRIME_ONSET_MS = 6 * 60 * 60 * 1000;   // ~6h of real time
const GRIME_FULL_MS  = 24 * 60 * 60 * 1000;
// Cloth holds it longer than skin does — clothes take days to become the problem,
// which is what stops this being a second shower timer.
const LAUNDRY_ONSET_MS = 24 * 60 * 60 * 1000;
const LAUNDRY_FULL_MS  = 5 * 24 * 60 * 60 * 1000;

function clockOf(player, flag, runtimeKey) {
  const raw = player?._flags instanceof Map ? player._flags.get(flag) : undefined;
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n)) return n;
  // Never washed / never laundered doesn't mean filthy since the dawn of time —
  // the clock starts the first time anything asks, this session. Existing
  // characters don't get ambushed with a debt they had no way to pay.
  if (!player[runtimeKey]) player[runtimeKey] = Date.now();
  return player[runtimeKey];
}

export function lastWashedAt(player)    { return clockOf(player, WASH_FLAG, '_hygieneSince'); }
export function lastLaunderedAt(player) { return clockOf(player, LAUNDRY_FLAG, '_laundrySince'); }

const ramp = (since, onset, full) =>
  since <= onset ? 0 : Math.min(1, (since - onset) / (full - onset));

// 0 (just washed) → 1 (as bad as time alone makes you).
export function grimeFactor(player) {
  return ramp(Date.now() - lastWashedAt(player), GRIME_ONSET_MS, GRIME_FULL_MS);
}

// The same shape for what you're wearing. This is the "clothing gets dirty on its
// own timescale" gap: a coat worn for a month used to be as clean as the day it
// was looted, because contamination only ever came from events.
export function laundryFactor(player) {
  return ramp(Date.now() - lastLaunderedAt(player), LAUNDRY_ONSET_MS, LAUNDRY_FULL_MS);
}

// The body write. Every body-cleaning path calls this: bodily's shower, MIS's
// wash, a swim in water that isn't worse than you are.
export async function markWashed(player, { sweat = true } = {}) {
  if (!player?.id) return;
  if (sweat) { delete player._sweat; delete player._sewerGrime; }
  player._hygieneSince = Date.now();
  await setFlag('player', WASH_FLAG, String(Date.now()), player).catch(() => {});
  checkImmaculate(player);
}

// The clothes write. The laundromat calls this; so does anything that genuinely
// launders (a washing machine in a rented unit, eventually).
export async function markLaundered(player) {
  if (!player?.id) return;
  player._laundrySince = Date.now();
  await setFlag('player', LAUNDRY_FLAG, String(Date.now()), player).catch(() => {});
  checkImmaculate(player);
}

// ── Being clean is worth something ───────────────────────────────────────────
//
// The stink penalty had no opposite, which made hygiene a punishment with no
// reward — you could only ever avoid a malus. This is the other end of the dial:
// getting all the way to immaculate (washed AND laundered AND nothing on you) is
// a real, visible buff.
//
// Cool, because that's what being clean actually buys in a room full of people
// who aren't. It stacks with the warmth bonus in adjustRelation, so the same
// state pays socially twice: NPCs read you better and warm to you faster.

export const CLEAN_EFFECT = 'fresh';
export const CLEAN_BAND = 85;          // 'immaculate'
const CLEAN_DURATION_TICKS = 2700;     // 45 min of play, on the 1s effects tick

registerStatusEffect({
  name: CLEAN_EFFECT,
  label: 'So Fresh',
  stats: { stat_cool: 1 },
  onTick: () => undefined,
});

// Called after every cleaning path. Applies the buff and announces the state so
// something (the accolade catalog) can hang off it.
export function checkImmaculate(player) {
  if (!player?.id) return false;
  const { score } = hygieneOf(player);
  if (score < CLEAN_BAND) return false;
  applyEffect(player, CLEAN_EFFECT, CLEAN_DURATION_TICKS);
  emit('hygiene.immaculate', { actor: player, score });
  return true;
}

// The other end. Announced once per descent rather than every time anything asks,
// because `hygieneOf` runs on the smell path and this would otherwise fire on a
// loop. The latch clears the moment you climb back out of the bottom band, so a
// player who gets filthy, washes, and gets filthy again is announced twice.
export const FILTH_BAND = 12;

export function checkFilthy(player) {
  if (!player?.id) return false;
  const { score } = hygieneOf(player);
  if (score > FILTH_BAND) { player._filthAnnounced = false; return false; }
  if (player._filthAnnounced) return false;
  player._filthAnnounced = true;
  emit('hygiene.filthy', { actor: player, score });
  return true;
}

// The mirror of the stink damping in adjustRelation: being visibly clean makes
// people warm to you faster. Read there so both ends live in one seam.
export function warmthMultiplier(player) {
  const { score } = hygieneOf(player);
  if (score >= CLEAN_BAND) return 1.15;
  if (score < 20) return 0.25;
  if (score < 45) return 0.6;
  return 1;
}

// An NPC who is home washes. Called from the AI's home-life pass, rate-limited so
// it isn't doing work on every tick of every NPC standing in their own kitchen.
//
// NPC hygiene is entirely in-memory (no flags row, no write), so "washing" is
// resetting the runtime clock and dropping whatever they were carrying on their
// clothes. Deliberately NOT a player path: a player has to go and find water.
const NPC_WASH_INTERVAL_MS = 30 * 60 * 1000;

export function npcWashAtHome(npc) {
  if (!npc) return false;
  const now = Date.now();
  if (now - (npc._lastHomeWash || 0) < NPC_WASH_INTERVAL_MS) return false;
  npc._lastHomeWash = now;
  npc._hygieneSince = now;
  npc._laundrySince = now;
  delete npc._sweat;
  delete npc._sewerGrime;
  if (npc.clothing_contamination) npc.clothing_contamination = {};
  if (npc.covered_in_blood) npc.covered_in_blood = 0;
  const ad = npc.appearance_data;
  if (ad?.soiled_state || ad?.ejaculate_state) { ad.soiled_state = null; ad.ejaculate_state = null; }
  return true;
}

// ── The question everything asks ─────────────────────────────────────────────

const BANDS = [
  { at: 85, label: 'immaculate' },
  { at: 65, label: 'clean' },
  { at: 45, label: 'lived-in' },
  { at: 25, label: 'rank' },
  { at: 10, label: 'filthy' },
  { at: 0,  label: 'biohazard' },
];

export function hygieneBand(score) {
  return (BANDS.find(b => score >= b.at) || BANDS[BANDS.length - 1]).label;
}

/**
 * Everything wrong with a body, in one sync read.
 * Returns { score (0–100, higher is cleaner), band, sources: [{type, strength}] }.
 *
 * Accepts players and NPCs alike — both carry the same contamination shape, which
 * is exactly why this belongs in the engine and not in bodily.
 */
export function hygieneOf(creature) {
  if (!creature) return { score: 100, band: 'clean', sources: [] };
  const sources = [];
  const seen = new Set();
  const add = (type, bonus = 0) => {
    const s = CONTAMINANT_SMELLS[type];
    if (!s || seen.has(type)) return;
    seen.add(type);
    sources.push({ type, strength: s.strength + bonus, text: s.text, source: s.source, misOnly: !!s.misOnly });
  };

  // Soiled bare skin is the worst of it and bypasses the clothing map entirely.
  const ap = creature.appearance_data || {};
  if (ap.soiled_state) add('feces', 1);
  if (creature.covered_in_blood) add('blood');

  // Anything bodily/MIS stained into clothing.
  for (const type of Object.values(creature.clothing_contamination || {})) add(type);

  // MIS fluid ages out — the appearance note keeps showing it long after the room
  // has stopped being able to tell.
  const at = ap.ejaculate_state?.at;
  if (ap.ejaculate_state && (!at || Date.now() - at < 30 * 60 * 1000)) add('ejaculate');

  const sweat = creature._sweat || 0;
  const sewerGrime = creature._sewerGrime || 0;
  const grime = grimeFactor(creature);
  const laundry = laundryFactor(creature);

  // Score: start clean, subtract the worst contaminant hard and the rest softly,
  // then sweat, sewer muck, plain unwashedness, and clothes nobody has laundered.
  let score = 100;
  const worst = sources.reduce((m, s) => Math.max(m, s.strength), 0);
  score -= worst * 7;
  score -= Math.max(0, sources.length - 1) * 5;
  score -= Math.round((sweat / SWEAT_MAX) * 15);
  score -= Math.round((sewerGrime / SEWER_GRIME_MAX) * 15);
  score -= Math.round(grime * 25);
  score -= Math.round(laundry * 15);
  score = Math.max(0, Math.min(100, score));

  return { score, band: hygieneBand(score), sources, sweat, sewerGrime, grime, laundry };
}

// Smell contributions for the creatures in a room. Sync, query-free — called
// from cmdSmell's creature pass.
//
// `viewer` gates the MIS-only entries. Self is excluded by the caller: you do not
// get to smell yourself in a room report (see `bodyOdourSelf`).
export function creatureFilthSmells(creatures, viewer, acuity = 0) {
  const out = [];
  const best = new Map(); // type → strongest contribution seen
  for (const c of creatures) {
    const { sources, sweat, sewerGrime, grime, laundry } = hygieneOf(c);
    if (laundry > 0.6 || (acuity >= 1 && laundry > 0.3)) {
      const prev = best.get('_laundry');
      const strength = Math.min(6, 2 + Math.round(laundry * 4));
      if (!prev || strength > prev.strength) {
        best.set('_laundry', { text: 'clothes that have not been off somebody in weeks', strength, source: 'bodies' });
      }
    }
    for (const s of sources) {
      if (s.misOnly && !isMisActive(viewer)) continue;
      const prev = best.get(s.type);
      if (!prev || s.strength > prev.strength) best.set(s.type, s);
    }
    // Sweat and plain grime are only worth reporting on a sharpened nose, or when
    // they're bad enough that they aren't really "sweat" anymore.
    if (sweat > 40 || (acuity >= 1 && sweat > 20)) {
      const prev = best.get('_sweat');
      const strength = Math.min(7, 2 + Math.round(sweat / 20));
      if (!prev || strength > prev.strength) {
        best.set('_sweat', { text: 'fresh sweat, the working kind', strength, source: 'sweat' });
      }
    }
    if (sewerGrime > 40 || (acuity >= 1 && sewerGrime > 20)) {
      const prev = best.get('_sewer');
      const strength = Math.min(7, 2 + Math.round(sewerGrime / 20));
      if (!prev || strength > prev.strength) {
        best.set('_sewer', { text: 'the drains — grease-skinned water, still wet on somebody', strength, source: 'sewer' });
      }
    }
    if (grime > 0.5 || (acuity >= 1 && grime > 0.2)) {
      const prev = best.get('_grime');
      const strength = Math.min(8, 3 + Math.round(grime * 4));
      if (!prev || strength > prev.strength) {
        best.set('_grime', {
          text: grime > 0.8
            ? 'somebody in here has not washed in a long time, and it has stopped being their own business'
            : 'unwashed skin and old clothes',
          strength,
          source: 'bodies',
        });
      }
    }
  }
  for (const s of best.values()) out.push({ text: s.text, strength: s.strength, source: s.source });
  return out;
}

// What YOU smell of — used by the self-directed sense and by examine. Separate
// from the room pass because the wording is second-person and because you never
// need the MIS gate on yourself (you opted in or the state can't exist).
export function bodyOdourSelf(player) {
  const { band, sources, sweat, sewerGrime, grime } = hygieneOf(player);
  if (!sources.length && sweat < 30 && sewerGrime < 30 && grime < 0.3) return null;
  const bits = sources.map(s => s.source).filter(Boolean);
  if (sweat >= 30) bits.push('sweat');
  if (sewerGrime >= 30) bits.push('the drains');
  if (grime >= 0.3) bits.push('yourself, unwashed');
  if (!bits.length) return null;
  return `You smell ${band === 'biohazard' ? 'like a crime scene' : `of ${bits.join(', ')}`}.`;
}
