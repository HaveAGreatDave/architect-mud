/**
 * Intoxication plugin — alcohol drunkenness as a decaying BAC-style meter.
 *
 * Content drives it: a drug row flagged `flags.alcoholic` feeds the meter
 * (`flags.intox_per_dose`, default 22, scaled by potency); a row flagged
 * `flags.sobering` (coffee) drains it (`flags.sober_amount`, default 30). Nothing
 * is hardcoded to "beer" — the flags decide, so the drug editor stays the source
 * of truth. Overdose (both lethal) is pure content on those rows and handled by
 * the engine drug system; this plugin owns only the behavioural layer.
 *
 * The meter (`player.intoxication`, 0–100, in-memory) produces three effects that
 * scale with level:
 *   • slurred speech   — the `speech.transform` hook mangles the spoken line
 *   • wobbly movement  — a `zone.entered` listener staggers drunk arrivals
 *   • blackout         — heavy drunk (≥ BLACKOUT_MIN) rolls a 10–30s blackout:
 *                        client curtain (blackout_start/end) + the engine's
 *                        handleCommand gate refuses every command via
 *                        `player.blackedOutUntil`.
 *
 * State is in-memory and cleared on death/logout (sober on respawn/reconnect),
 * mirroring how trips and the temperature/wetness runtime fields live on the
 * live player object. A single 4s tick (on the shared idle-gated scheduler)
 * decays the meter, narrates band crossings, and runs the blackout lifecycle.
 */
import { getAllLivePlayers } from '../../server/engine/world.js';
import { schedule } from '../../server/engine/scheduler.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { applyMods, reverseMods } from '../../server/engine/statmods.js';
import { registerAction } from '../../server/engine/actions.js';
import { wantsDrugFx } from '../../server/engine/drugs.js';

// --- tunables ----------------------------------------------------------------
const SLUR_MIN     = 30;   // speech starts slurring at/above this
const WOBBLE_MIN   = 40;   // movement starts staggering
const BLACKOUT_MIN = 70;   // blackouts become possible
const DECAY_PER_TICK = 0.15;   // 0.0375/sec → sober from 100 in ~44 min
const TICK_SECONDS   = 4;      // the schedule below; absorption is measured against it
const BLACKOUT_MIN_MS = 10000;
const BLACKOUT_MAX_MS = 30000;

const DEFAULT_INTOX_PER_DOSE = 22;
const DEFAULT_SOBER_AMOUNT   = 30;

// ABSORPTION — the reason it is possible to drink too much.
//
// A dose used to land on the meter whole, the instant it was swallowed, which
// made over-drinking something you could only do on purpose: the feedback was
// immediate and perfect, so you always knew exactly where you were before
// deciding whether to order another. Nobody has ever been caught out by a drink
// that told them the truth straight away.
//
// Alcohol arrives late. A drink taken now is still arriving a quarter of an hour
// from now, and the round you ordered because you felt fine is the round that
// puts you on the floor. So a dose goes into a PENDING pool and bleeds into the
// meter over `flags.absorb_seconds`, read off the drug row like every other
// number here — absent or 0 lands it whole, exactly as before, so nothing else
// that feeds the meter changes.
//
// The pool is deliberately not visible anywhere. A read-out of what is still
// coming would hand back the certainty this exists to take away.
const DEFAULT_ABSORB_SECONDS = 0;

// Bands for threshold narration. Index into BAND_MSG on crossing.
const BANDS = [
  { at: 0,  name: 'sober' },
  { at: 25, name: 'tipsy' },
  { at: 45, name: 'drunk' },
  { at: 70, name: 'wasted' },
];
const BAND_RISE = {
  tipsy:  "A pleasant warmth spreads through you. The edges go soft.",
  drunk:  "The floor has opinions now. You are, it must be said, drunk.",
  wasted: "<span class=\"withdrawal-warning\">You're absolutely hammered. Standing is a project.</span>",
};
const BAND_FALL = {
  drunk:  "The worst of the spins eases off. Still drunk, though.",
  tipsy:  "You're mostly steady again — just a warm buzz left.",
  sober:  "Your head clears. You're sober.",
};
// Mechanical weight of each band, applied through the reversible modifier ledger
// (source 'intox') so it backs out cleanly as you sober up. Early drinks loosen
// you (a little Cool); deeper in, coordination and judgement go. Sober = no mods.
const BAND_MODS = {
  tipsy:  { stat_cool: 1 },
  drunk:  { stat_cool: 1, stat_reflexes: -2, stat_brains: -1 },
  wasted: { stat_reflexes: -4, stat_brains: -3, stat_endurance: -2 },
};

const SELF_WOBBLE = [
  "The room tilts as you move, and you lurch to keep up with it.",
  "You set off, overcorrect, and rebound off nothing in particular.",
  "The floor pitches like a deck. You stagger through it.",
  "You weave your way along, more or less in the intended direction.",
];
const ROOM_STUMBLE = [
  "stumbles in, ricochets off the doorframe, and steadies themselves.",
  "lurches into the room, wobbling like a newborn deer.",
  "weaves in, overcorrects, and nearly goes down.",
  "staggers in and grabs at the air for balance.",
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const bandIndex = (lvl) => { let i = 0; for (let b = 0; b < BANDS.length; b++) if (lvl >= BANDS[b].at) i = b; return i; };

// The band name for a meter level, for anything that wants to READ the state
// rather than change it (the tablet Vitals app). Exported so a read-out can't
// grow its own thresholds and drift from the narration above.
export function intoxBand(level) { return BANDS[bandIndex(Math.round(level || 0))].name; }

// --- meter ingestion ---------------------------------------------------------

function addIntoxication(player, amount) {
  const before = player.intoxication || 0;
  player.intoxication = Math.max(0, Math.min(100, before + amount));
  return player.intoxication;
}

// Queue a dose to arrive over `seconds` instead of landing whole. Rate is per
// second and the pool is a running total, so a second drink while the first is
// still coming stacks rather than replacing it — which is the case the whole
// mechanic is about.
function queueAbsorption(player, amount, seconds) {
  if (!(seconds > 0) || amount <= 0) return false;
  player._intoxPending = (player._intoxPending || 0) + amount;
  player._intoxRate = (player._intoxRate || 0) + amount / seconds;
  return true;
}

// Bleed the pending pool into the meter. Returns what landed this tick.
// Sobering up drains what is still in the pool first: coffee against a drink
// you have not finished absorbing should take the drink, not just the part of
// it that has already arrived.
function absorbTick(player, elapsedSec) {
  const pending = player._intoxPending || 0;
  if (pending <= 0) { player._intoxPending = 0; player._intoxRate = 0; return 0; }
  const landed = Math.min(pending, (player._intoxRate || 0) * elapsedSec);
  player._intoxPending = pending - landed;
  if (player._intoxPending <= 0.01) { player._intoxPending = 0; player._intoxRate = 0; }
  return landed;
}

function drainPending(player, amount) {
  const pending = player._intoxPending || 0;
  if (pending <= 0 || amount <= 0) return 0;
  const taken = Math.min(pending, amount);
  player._intoxPending = pending - taken;
  if (player._intoxPending <= 0.01) { player._intoxPending = 0; player._intoxRate = 0; }
  return taken;
}

// ── What being drunk LOOKS like ──────────────────────────────────────────────
//
// The meter is the authority on this, not the drug's phase arc. A pint's phases
// run for half an hour whatever else you have had; the meter knows you are eight
// drinks in, and eight drinks is the thing you can see. So the screen symptoms
// ladder off the same three bands the speech, movement and blackout rules use —
// no fourth set of thresholds to keep in step.
//
//   tipsy    the room leans and lets go
//   drunk    ...and you cannot fix your eyes on it
//   wasted   ...and there are two of everything, and the edges are going
//
// ⚠ NO `profile` in this payload. The windscreen warp is claimed by the separate
// `setDrugFx('intox', 'drunk', …)` call the client already makes off `level`, and
// two claims on one surface is the arc-flattening bug the trip plugin hit.
function drunkScreenFx(lvl) {
  if (lvl < SLUR_MIN) return null;
  const screen = ['sway'];
  if (lvl >= WOBBLE_MIN) screen.push('blur');
  if (lvl >= BLACKOUT_MIN) screen.push('double', 'narrow');
  return {
    screen,
    field: 'swim',
    // Scaled from the band it STARTS at, not from zero, so crossing into tipsy
    // is a visible change rather than an invisible one that ramps up later.
    intensity: Math.max(0.2, Math.min(1, (lvl - SLUR_MIN) / (100 - SLUR_MIN))),
    palette: 'blue',
  };
}

// Stream the drunkenness level to the client (drives the drunk flight-view warp
// and the screen FX above). Change-gated so it's near-silent while sober or
// steady, then follows the meter.
function pushIntoxFx(player) {
  const lvl = Math.round(player?.intoxication || 0);
  if (lvl === (player._intoxFxSent ?? -1)) return;
  player._intoxFxSent = lvl;
  // The log rung gets the level (the flight warp is the client's own call off it)
  // but never the screen symptoms — see `wantsDrugFx` in engine/drugs.js for why
  // blurring and ghosting the log is the one thing that rung must not do.
  sendToPlayer(player.id, { type: 'intox_fx', level: lvl, fx: wantsDrugFx(player) ? drunkScreenFx(lvl) : null });
}

on('player.drugUsed', ({ player, drug, potency }) => {
  if (!player || !drug?.flags) return;
  const p = Math.max(0.5, potency ?? 1);
  if (drug.flags.alcoholic) {
    const per = Number(drug.flags.intox_per_dose) || DEFAULT_INTOX_PER_DOSE;
    const dose = Math.round(per * p);
    const absorb = Number(drug.flags.absorb_seconds) || DEFAULT_ABSORB_SECONDS;
    if (queueAbsorption(player, dose, absorb)) return;   // arrives over the next few minutes
    const lvl = addIntoxication(player, dose);
    narrateBand(player, lvl);
    pushIntoxFx(player);
  } else if (drug.flags.sobering) {
    const amt = Number(drug.flags.sober_amount) || DEFAULT_SOBER_AMOUNT;
    const before = player.intoxication || 0;
    const stillComing = drainPending(player, amt);
    if (before > 0 || stillComing > 0) {
      const lvl = addIntoxication(player, -(amt - stillComing));
      sendToPlayer(player.id, { type: 'output', message: 'The caffeine cuts through the fog a little. You feel a touch more clear-headed.' });
      narrateBand(player, lvl);
      pushIntoxFx(player);
    }
  }
});

// Narrate a band crossing (rise or fall) relative to the player's last band.
function narrateBand(player, lvl) {
  const idx = bandIndex(lvl);
  const prev = player._intoxBand ?? 0;
  if (idx === prev) return;
  const name = BANDS[idx].name;
  const line = idx > prev ? BAND_RISE[name] : BAND_FALL[name];
  player._intoxBand = idx;
  // Impairment tracks the band, through the ledger so it reverses on the way down.
  if (BAND_MODS[name]) applyMods(player, 'intox', BAND_MODS[name]);
  else reverseMods(player, 'intox');   // sober
  if (line) sendToPlayer(player.id, { type: 'output', message: line });
}

// --- slurred speech (speech.transform hook) ----------------------------------

// Mangle a spoken line by intoxication level. Guarantees a visible change once
// the player is over SLUR_MIN so the effect (and its test) is deterministic.
function slur(text, level) {
  const p = Math.min(1, (level - SLUR_MIN) / 55); // 0 at SLUR_MIN, 1 near wasted
  if (p <= 0) return text;
  let out = text
    .replace(/s/g, (m) => (Math.random() < p * 0.6 ? 'sh' : m))
    .replace(/([aeiou])/gi, (m) => (Math.random() < p * 0.45 ? m + m.toLowerCase() : m));
  if (Math.random() < p * 0.5) {
    const words = out.split(' ');
    words.splice(Math.min(words.length, 1 + Math.floor(Math.random() * words.length)), 0, '*hic*');
    out = words.join(' ');
  }
  // Guarantee a change so slurring is never silently a no-op.
  if (out === text) out = /[aeiou]/i.test(text) ? text.replace(/([aeiou])/i, '$1$1') : text + '...';
  return out;
}

export const hooks = {
  'speech.transform': ({ player, text }) => {
    const lvl = player?.intoxication || 0;
    if (lvl < SLUR_MIN) return undefined;
    return slur(text, lvl);
  },
};

// --- wobbly movement (zone.entered) ------------------------------------------

on('zone.entered', ({ actor }) => {
  const lvl = actor?.intoxication || 0;
  if (lvl < WOBBLE_MIN) return;
  sendToPlayer(actor.id, { type: 'output', message: pick(SELF_WOBBLE) });
  // The drunker you are, the likelier the room sees you stumble in.
  if (Math.random() < (lvl - WOBBLE_MIN) / 90) {
    sendToZone(actor.current_zone, { type: 'zone_event', message: `${actor.handle} ${pick(ROOM_STUMBLE)}` }, actor.id);
  }
});

// --- blackout lifecycle ------------------------------------------------------

const blackoutChance = (lvl) => Math.max(0, (lvl - BLACKOUT_MIN) / 30) * 0.12; // per tick, up to ~12% at 100

function startBlackout(player) {
  const ms = BLACKOUT_MIN_MS + Math.floor(Math.random() * (BLACKOUT_MAX_MS - BLACKOUT_MIN_MS));
  player.blackedOutUntil = Date.now() + ms;
  player._blackoutActive = true;
  sendToPlayer(player.id, { type: 'blackout_start' });
  sendToPlayer(player.id, { type: 'output', message: '<span class="overdose-warning">The lights go out. You black out.</span>' });
  sendToZone(player.current_zone, { type: 'zone_event', message: `${player.handle} sways, glassy-eyed, and sags where they stand.` }, player.id);
}

function endBlackout(player) {
  player._blackoutActive = false;
  player.blackedOutUntil = 0;
  sendToPlayer(player.id, { type: 'blackout_end' });
  sendToPlayer(player.id, { type: 'output', message: 'You come to, head pounding, with no idea how long you were out.' });
}

function clearAll(player) {
  if (!player) return;
  if (player._blackoutActive) endBlackout(player);
  player.intoxication = 0;
  player._intoxBand = 0;
  player._intoxPending = 0;   // a drink still arriving does not survive death or a logout either
  player._intoxRate = 0;
  reverseMods(player, 'intox');   // drop any drunk stat impairment
  pushIntoxFx(player);   // → level 0, clears the drunk flight-view warp
}

on('player.death',  ({ player }) => clearAll(player));
on('player.logout', ({ id })     => { const p = getAllLivePlayers().find(x => x.id === id); clearAll(p); });

// --- tick: decay + band narration + blackout rolls ---------------------------

let ticking = false;
function intoxTick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const player of getAllLivePlayers()) {
      if (player._blackoutActive && now >= (player.blackedOutUntil || 0)) endBlackout(player);
      // Absorption first, and BEFORE the sober check — a player reading 0 with a
      // drink still coming is the exact case this exists for, and skipping them
      // would strand the pool forever.
      const arriving = absorbTick(player, TICK_SECONDS);
      const lvl = Math.min(100, (player.intoxication || 0) + arriving);
      if (lvl <= 0) continue;
      if (lvl >= BLACKOUT_MIN && !player._blackoutActive && Math.random() < blackoutChance(lvl)) startBlackout(player);
      // Decay only runs against what has actually landed. While a dose is still
      // arriving the meter climbs, which is what makes the drink you had a
      // quarter of an hour ago the one that catches you.
      const next = Math.max(0, lvl - DECAY_PER_TICK);
      player.intoxication = next;
      narrateBand(player, next);
      pushIntoxFx(player);
    }
  } finally {
    ticking = false;
  }
}

schedule('4s', () => { try { intoxTick(); } catch (e) { console.error('[intoxication] tick error:', e.message); } });

// Blacking out is this plugin's mechanic, but alcohol isn't the only thing that
// can do it — a survivable overdose should drop you too. Exposed as an Action so
// the drugs plugin can trigger it through the registry rather than importing
// across plugins. Idempotent: already-out stays out, it doesn't stack.
registerAction({
  type: 'blackout.begin',
  handler: ({ actor: player }) => {
    if (!player) return { ok: false };
    if (player.blackedOutUntil && Date.now() < player.blackedOutUntil) return { ok: true, already: true };
    startBlackout(player);
    return { ok: true };
  },
});

// Exposed for the regression suite.
export const _test = { slur, addIntoxication, narrateBand, blackoutChance, BAND_MODS, SLUR_MIN, BLACKOUT_MIN,
  queueAbsorption, absorbTick, drainPending, TICK_SECONDS, DECAY_PER_TICK };
