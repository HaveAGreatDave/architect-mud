/**
 * MIS body mechanics — the parts of sex that happen to a body rather than to a
 * message log. Split out of mis-system.js (prose + arousal state) because none
 * of this is prose: it's refractory timing, exertion cost, what you smell like
 * afterwards, and what you might have caught.
 *
 * Everything here is HOT PATH — it runs on the 8-second event beat. Per the read
 * tiers in docs/architecture.md, that means:
 *   - stamina/thirst move IN MEMORY and ride the existing gameLoop save
 *   - refractory + sweat are runtime-only fields (no `players` column, per the
 *     no-new-sparse-columns rule)
 *   - the infection flag is read off the hydrated `player._flags` cache, never
 *     re-queried; only the rare write (caught it / cured it) touches the DB
 */
import { query } from '../../server/models/db.js';
import { setFlag, clearFlag } from '../../server/engine/flags.js';
import { registerStatusEffect, applyEffect, clearEffect } from '../../server/engine/effects.js';
import { stainClothing } from '../../server/engine/bodily.js';
import { addSweat } from '../../server/engine/hygiene.js';

// ── Refractory period ────────────────────────────────────────────────────────
//
// Climax used to zero the meter and hand you a full-rate rebuild immediately,
// which made the +10 sanity a farmable loop on a 40-second cycle. A body needs a
// minute. Endurance shortens it; nothing removes it.

const REFRACTORY_MALE_MS   = 150_000;
const REFRACTORY_FEMALE_MS = 75_000;
const REFRACTORY_FLOOR_MS  = 25_000;
const REFRACTORY_PER_END   = 8_000;  // per point of Endurance
const REFRACTORY_MIN_RATE  = 0.10;   // arousal multiplier at the instant of climax

export function refractoryMs(player) {
  const base = player?.biological_sex === 'male' ? REFRACTORY_MALE_MS : REFRACTORY_FEMALE_MS;
  const end = Number(player?.stat_endurance) || 0;
  let ms = Math.max(REFRACTORY_FLOOR_MS, base - end * REFRACTORY_PER_END);
  // A drug flagged `refractory_mult` collapses the gap between finishes. Same
  // generic contract as `volume_boost`: the flag is the interface, not the drug.
  for (const d of player?.activeDrugs || []) {
    const m = d?.flags?.refractory_mult ?? d?.refractory_mult;
    if (m) ms *= Number(m) || 1;
  }
  return Math.max(2000, ms);
}

// A drug flagged `forced_erection` holds it up for its whole duration, whatever
// the arousal meter says. Read wherever `erect` would otherwise be recomputed.
export function erectionForced(player) {
  return (player?.activeDrugs || []).some(d => d?.flags?.forced_erection || d?.forced_erection);
}

// Stamped by every climax path. Runtime-only: a refractory period that survived
// a relog would be state pretending to be more important than it is.
export function markClimax(player) {
  if (!player) return;
  player._misRefractoryUntil = Date.now() + refractoryMs(player);
}

export function inRefractory(player) {
  return Date.now() < (player?._misRefractoryUntil || 0);
}

// 1 when fully recovered, ramping up from REFRACTORY_MIN_RATE at the moment of
// climax. A smooth ramp rather than a hard gate: you can keep going, it just
// isn't going anywhere for a while, which is both truer and less annoying than
// a refusal.
export function refractoryFactor(player) {
  const until = player?._misRefractoryUntil || 0;
  const now = Date.now();
  if (now >= until) return 1;
  const total = refractoryMs(player);
  const elapsed = total - (until - now);
  return Math.min(1, REFRACTORY_MIN_RATE + (1 - REFRACTORY_MIN_RATE) * (elapsed / total));
}

export const REFRACTORY_MSGS = [
  `Your body is still somewhere else entirely. Nothing much is happening down there yet.`,
  `You're going through the motions, but the wiring hasn't come back online.`,
  `Willing enough. Capable, not yet.`,
  `Everything below the waist files your request for later consideration.`,
];

// ── Exertion ─────────────────────────────────────────────────────────────────
//
// Sex is physical work. Costs land in memory each beat and ride the existing
// gameLoop save — an awaited UPDATE per 8-second beat per couple is exactly the
// kind of round trip the read tiers exist to forbid.

const STAMINA_PER_BEAT_BASE = 6;
const STAMINA_PER_END       = 0.4;
const STAMINA_FLOOR_COST    = 2;
const THIRST_PER_BEAT       = 0.8;
const SWEAT_PER_BEAT        = 12;   // engine hygiene owns the meter and its decay

// Returns { collapsed } — true on the beat the actor runs out of body. The
// caller ends the event; we don't reach into the event registry from here.
export function exert(player, intensity = 1) {
  if (!player) return { collapsed: false };
  const end = Number(player.stat_endurance) || 0;
  const cost = Math.max(STAMINA_FLOOR_COST, (STAMINA_PER_BEAT_BASE - end * STAMINA_PER_END) * intensity);
  const max = player.stamina_max ?? 100;
  const cur = player.stamina ?? max;
  player.stamina = Math.max(0, cur - cost);

  // Thirst is a hydration meter (100 = watered), so exertion subtracts. Sweat is
  // ours, runtime-only, and is what the smell hook actually reads.
  player.thirst = Math.max(0, (player.thirst ?? 100) - THIRST_PER_BEAT * intensity);
  addSweat(player, SWEAT_PER_BEAT * intensity);

  return { collapsed: player.stamina <= 0 };
}

export const COLLAPSE_MSGS = [
  `Your legs give out from under you. Whatever that was, it's over now.`,
  `You run entirely out of body. You stop, shaking, and stay stopped.`,
  `Your arms fold. Enthusiasm was never the problem — fuel was.`,
];

// ── Fluid: it dries, it soils, it smells ─────────────────────────────────────
//
// `appearance_data.ejaculate_state` used to be a bare list of body sites that
// sat there, inert and odourless, until washed. It now carries `at`, which is
// all three of those things: how it reads on examine, whether it soaked into
// clothing, and how loudly the room can smell it.

const FRESH_MS  = 10 * 60 * 1000;   // wet
const DRY_MS    = 30 * 60 * 1000;   // dried; still visible, no longer smells

export function fluidAgeMs(player) {
  const at = player?.appearance_data?.ejaculate_state?.at;
  return at ? Date.now() - at : null;
}

export function fluidIsFresh(player) {
  const age = fluidAgeMs(player);
  return age !== null && age < FRESH_MS;
}

// Fluid that lands on a clothed slot soaks in rather than sitting on skin —
// same rule bodily already applies to piss and vomit, and it means a change of
// trousers is part of cleaning up.
// Only slots actually wearing something get stained — fluid on bare skin is the
// appearance note's job, not the laundry's. One query, and never on a beat:
// climax is already writing the player row when this runs.
export async function soakClothing(player, slots) {
  if (!slots?.length) return [];
  const { rows } = await query(
    `SELECT DISTINCT slot FROM player_inventory
      WHERE player_id=$1 AND is_equipped=1 AND slot = ANY($2)`,
    [player.id, slots]
  );
  const worn = rows.map(r => r.slot);
  if (worn.length) await stainClothing(player, worn, 'ejaculate').catch(() => {});
  return worn;
}

// NOTE: there is deliberately no smell hook here. Fluid and sweat are ordinary
// contaminants as far as the room is concerned, so they're declared in the
// engine's hygiene substrate (server/engine/hygiene.js) alongside blood and
// vomit — including the `misOnly` flag that withholds the sex note from anyone
// who hasn't opted in. MIS's job is to CREATE the state, not to describe it.

// ── Fit ──────────────────────────────────────────────────────────────────────
//
// Whether the thing fits, and what it costs both parties when it doesn't quite.
//
// The ENGINE half only: this computes a ratio, a band, and the mechanical
// consequences. Every line of prose is authored content, edited in the dev panel
// (`mis_fit_lines`) — an unauthored band falls back to the ordinary act text, so
// the system is fully functional with nothing written at all.
//
// Capacity is derived from appearance the player already has, not a new stat:
//   pussy  — `labia_style` sets the baseline, so a character's own description
//            decides what fits, and STRETCH accumulates on top of it.
//   ass    — a much tighter fixed baseline, stretches more slowly, recovers.
//   mouth  — does NOT stretch. Size decides how much of it is filled, and past
//            capacity you're into the throat, which is its own problem.

const LABIA_CAPACITY = {
  'tight': 9, 'small': 11, 'average': 14, 'full': 16, 'loose': 19, 'gaped': 23,
};
const DEFAULT_PUSSY_CM = 14;
const ASS_BASE_CM = 9;
const MOUTH_CAPACITY_CM = 15;   // beyond this you are past the mouth

// Permanent-ish stretch, stored on appearance_data so it rides the existing save
// and shows up in descriptions. Sub-linear: each stretching act does less than
// the last, so nobody reaches the cap in an evening.
const STRETCH_PER_ACT = 0.35;
const STRETCH_CAP_CM = 10;
const STRETCH_RECOVER_PER_DAY = 0.6;

export function capacityOf(receiver, hole) {
  const ap = receiver?.appearance_data || {};
  const stretch = stretchOf(receiver, hole);
  if (hole === 'ass') return ASS_BASE_CM + stretch;
  if (hole === 'mouth' || hole === 'throat') return MOUTH_CAPACITY_CM;
  const base = LABIA_CAPACITY[ap.labia_style] ?? DEFAULT_PUSSY_CM;
  return base + stretch;
}

// Lazily recovered, never ticked — the same trick relations.js uses for decay.
export function stretchOf(receiver, hole) {
  const rec = receiver?.appearance_data?.stretch?.[hole];
  if (!rec) return 0;
  const days = Math.max(0, (Date.now() - (rec.at || 0)) / 86_400_000);
  return Math.max(0, Math.min(STRETCH_CAP_CM, (rec.cm || 0) - days * STRETCH_RECOVER_PER_DAY));
}

// Authored range is 0.25in–15in (0.6–38.1cm), so the fit model has to stay sane
// at both ends: a micropenis reads `cavernous` against everything (including the
// tightest ass), and 38.1cm is `impossible` for every capacity in the table
// except a mouth, which gags instead of refusing. Both are intended outcomes.
export const MIN_SIZE_CM = 0.6;
export const MAX_SIZE_CM = 38.1;

export function sizeOf(giver) {
  const cm = Number(giver?.appearance_data?.penis_length_cm);
  if (!Number.isFinite(cm)) return 13;
  return Math.max(MIN_SIZE_CM, Math.min(MAX_SIZE_CM, cm));
}

/**
 * The whole model in one call.
 * Returns { ratio, band, canProceed, giverMult, receiverMult, painChance, stretches }.
 *
 * ratio < 1  → room to spare;  ratio ≈ 1 → snug;  ratio > 1 → more than it holds.
 */
export const FIT_BANDS = ['cavernous', 'loose', 'comfortable', 'snug', 'tight', 'straining', 'impossible'];

export function fitOf(giver, receiver, hole) {
  const size = sizeOf(giver);
  const cap = capacityOf(receiver, hole);
  const ratio = cap > 0 ? size / cap : 1;

  let band;
  if (ratio < 0.55) band = 'cavernous';
  else if (ratio < 0.8) band = 'loose';
  else if (ratio < 1.0) band = 'comfortable';
  else if (ratio < 1.15) band = 'snug';
  else if (ratio < 1.4) band = 'tight';
  else if (ratio < 1.8) band = 'straining';
  else band = 'impossible';

  // A mouth doesn't stretch, so "too big" means depth rather than damage: it
  // stops being the mouth's problem and becomes the throat's.
  const oral = hole === 'mouth' || hole === 'throat';

  return {
    ratio, band, size, capacity: cap,
    // Too much is genuinely too much — for everything except a mouth, which gags
    // rather than refuses.
    canProceed: band !== 'impossible' || oral,
    // Arousal rates. A snug fit is the best of both; either extreme costs the
    // party it costs.
    giverMult:    band === 'cavernous' ? 0.6 : band === 'loose' ? 0.85 : band === 'snug' ? 1.2 : band === 'tight' ? 1.3 : band === 'straining' ? 1.15 : 1,
    receiverMult: band === 'cavernous' ? 0.5 : band === 'loose' ? 0.8 : band === 'snug' ? 1.25 : band === 'tight' ? 1.1 : band === 'straining' ? 0.6 : 1,
    // Only the stretching holes can hurt you, and only past snug.
    painChance: oral ? 0 : band === 'tight' ? 0.1 : band === 'straining' ? 0.35 : band === 'impossible' ? 0.6 : 0,
    // What actually changes the receiver, permanently-ish.
    stretches: !oral && (band === 'tight' || band === 'straining' || band === 'impossible'),
    oralDepth: oral ? Math.min(1, ratio) : null,
  };
}

// Apply the consequence. Called once per act, never on a beat.
export async function applyStretch(receiver, hole, fit) {
  if (!fit?.stretches || !receiver?.id) return 0;
  const ap = receiver.appearance_data || {};
  ap.stretch = ap.stretch || {};
  const current = stretchOf(receiver, hole);
  const gain = STRETCH_PER_ACT * Math.max(0, fit.ratio - 1) * (1 - current / STRETCH_CAP_CM);
  const next = Math.max(0, Math.min(STRETCH_CAP_CM, current + gain));
  ap.stretch[hole] = { cm: next, at: Date.now() };
  receiver.appearance_data = ap;
  await query('UPDATE players SET appearance_data=$1 WHERE id=$2',
    [JSON.stringify(ap), receiver.id]).catch(() => {});
  return next - current;
}

// ── Volume ───────────────────────────────────────────────────────────────────
//
// Ejaculate used to be binary: a first finish after three days read exactly like
// the fourth in ten minutes. This is the scalar that makes it a quantity, and
// every consumer already exists — how many sites get covered, how many clothing
// slots soak, whether it reaches the floor, how loudly the room smells it, how
// long before it dries, and what examine says.
//
// All four inputs are meters the game already tracks. Nothing new is stored on
// the player except the last-climax stamp.

const VOLUME_BANDS = [
  { at: 0.85, key: 'flood',  adj: 'an obscene amount of' },
  { at: 0.60, key: 'heavy',  adj: 'a heavy load of' },
  { at: 0.35, key: 'normal', adj: '' },
  { at: 0.15, key: 'light',  adj: 'a thin trace of' },
  { at: 0,    key: 'spent',  adj: 'barely anything —' },
];

export function volumeBand(v) {
  return (VOLUME_BANDS.find(b => v >= b.at) || VOLUME_BANDS[VOLUME_BANDS.length - 1]).key;
}
export function volumeAdjective(v) {
  return (VOLUME_BANDS.find(b => v >= b.at) || VOLUME_BANDS[VOLUME_BANDS.length - 1]).adj;
}

// Full recovery takes about four hours of not finishing. The curve is the whole
// point of the refractory period cutting BOTH ways: it isn't only a penalty, it's
// also what refills the tank.
const VOLUME_FULL_MS = 4 * 60 * 60 * 1000;

export function volumeOf(player) {
  if (!player) return 0.5;

  // 1. Abstinence — the dominant term. Never seen finishing = full.
  const since = player._lastClimaxAt ? Date.now() - player._lastClimaxAt : VOLUME_FULL_MS;
  let v = Math.min(1, since / VOLUME_FULL_MS);

  // 2. Hydration. `thirst` is a 0–100 hydration meter that MIS itself drains, so
  //    a long session dries you out and it shows.
  const hydration = Math.max(0, Math.min(100, player.thirst ?? 100)) / 100;
  v *= 0.55 + 0.45 * hydration;

  // 3. Arousal overshoot. The meter caps at 120 but climax triggers at 100, so
  //    riding past the edge before letting go was already tracked and did nothing.
  const overshoot = Math.max(0, Math.min(20, (player.horniness || 0) - 100)) / 20;
  v *= 1 + 0.20 * overshoot;

  // 4. Condition — Endurance and a good meal, each worth a little.
  const end = Math.max(0, Math.min(10, Number(player.stat_endurance) || 0)) / 10;
  v *= 0.9 + 0.2 * end;
  if ((player.statuses || []).some(s => s.name === 'well_fed')) v *= 1.1;

  // 5. Whatever is in you. Any active drug flagged `volume_boost` multiplies it —
  //    read off the live activeDrugs array, so this is sync and costs nothing.
  //    Deliberately generic: the flag is the contract, not the drug.
  for (const d of player.activeDrugs || []) {
    const boost = d?.flags?.volume_boost ?? d?.volume_boost;
    if (boost) v *= Number(boost) || 1;
  }

  // …and whatever it has cost you. `burn` is the hidden counterweight: it never
  // appears in any UI, is never explained, and only ever subtracts. See
  // ampouleBurn() for why.
  v *= 1 - burnOf(player);

  return Math.max(0, Math.min(1, v));
}

// ── The cost nobody tells you about ──────────────────────────────────────────
//
// The grey ampoule works. It also, past a certain number of doses, quietly stops
// giving back what it takes — the reservoir never quite refills again, and every
// further dose makes the floor lower.
//
// DESIGN INTENT, and the reason this reads oddly: the player is never told. There
// is no withdrawal message naming a cause, no tooltip, no stat. The drug's own
// description says nothing about what it does in either direction. All the player
// ever gets is the symptom line below, which describes a sensation and never an
// explanation, and the slow discovery that a long abstinence doesn't produce what
// it used to. Working it out is the content.
//
// The counter is a player_flag so it survives a relog (the whole point is that it
// is permanent-ish); the derived burn is computed, never stored.
export const AMPOULE_FLAG = 'mis_grey_doses';
const BURN_FREE_DOSES = 5;      // the first few genuinely are free
const BURN_PER_DOSE = 0.06;
const BURN_MAX = 0.75;          // it can gut you, never quite zero you

export function ampouleDoses(player) {
  const raw = player?._flags instanceof Map ? player._flags.get(AMPOULE_FLAG) : undefined;
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function burnOf(player) {
  const over = Math.max(0, ampouleDoses(player) - BURN_FREE_DOSES);
  return Math.min(BURN_MAX, over * BURN_PER_DOSE);
}

export async function recordAmpouleDose(player) {
  if (!player?.id) return 0;
  const next = ampouleDoses(player) + 1;
  await setFlag('player', AMPOULE_FLAG, String(next), player).catch(() => {});
  return next;
}

// Sensation, never diagnosis. Fires occasionally once the burn has set in, and
// says nothing a player could look up.
export const BURN_SYMPTOMS = [
  `Something low in you aches, briefly and deeply, and then doesn't.`,
  `A cold thread of sweat goes down your spine for no reason you can name.`,
  `You feel oddly hollowed out, in a place you don't have a word for.`,
  `Your body sends up a complaint with no return address.`,
];

// Stamped at every climax so the abstinence term has something to measure.
export function markClimaxVolume(player) {
  if (player) player._lastClimaxAt = Date.now();
}

// How far it reaches. Low volume stays on the body; high volume overruns the
// clothes and hits the floor, which is what turns a private act into a stain the
// room can smell tomorrow.
export function overflowsToZone(volume) { return volume >= 0.6; }
export function soakSlotsFor(volume) {
  if (volume >= 0.85) return ['legs', 'torso', 'feet'];
  if (volume >= 0.6) return ['legs', 'torso'];
  return ['legs'];
}

// Somebody else finished on/in you. Their volume becomes YOUR fluid state, which
// is what makes the receiver the one who smells of it, shows it on examine, and
// has to go and wash — previously only the giver ever carried the evidence.
export async function markReceived(target, part, volume) {
  if (!target?.id) return;
  const ad = target.appearance_data || {};
  const site = part === 'throat' ? 'mouth' : part;
  const locations = new Set([...(ad.ejaculate_state?.locations || []), site]);
  if (volume >= 0.6) locations.add('torso');
  if (volume >= 0.85) locations.add('legs');
  ad.ejaculate_state = { locations: [...locations], at: Date.now(), volume };
  target.appearance_data = ad;
  await query('UPDATE players SET appearance_data=$1 WHERE id=$2',
    [JSON.stringify(ad), target.id]).catch(() => {});
  if (volume >= 0.6) await soakClothing(target, soakSlotsFor(volume));
}

// ── Infection ────────────────────────────────────────────────────────────────
//
// A consequence with a cure and a way to avoid it. Lives in `player_flags` (not
// a new `players` column, and not a status effect — a status is measured in
// seconds and this is measured in days). The status effect below is only the
// *symptom*, refreshed while the flag is set.

export const STI_FLAG = 'mis_sti';

const STRAINS = [
  { key: 'rustrot',   label: 'Rust Rot',      line: `Something down there burns when you piss. It has been getting worse.` },
  { key: 'greyscale', label: 'Greyscale',     line: `The rash has spread again overnight. It itches in a way that makes you want to leave your own body.` },
  { key: 'kissflu',   label: "Chandler's Flu", line: `Aching joints, low fever, and you know exactly where you picked it up.` },
];

export const STI_SYMPTOM_EFFECT = 'sti_symptoms';

registerStatusEffect({
  name: STI_SYMPTOM_EFFECT,
  label: 'Infected',
  stats: { stat_cool: -1 },   // you know, and it shows
  onTick: () => undefined,    // the misery is the messages + the Cool hit, not a drip
});

// Sync read off the hydrated flag cache — safe on the event beat. Falls back to
// "clean" if flags failed to hydrate, which is the degraded-not-broken rule.
export function stiOf(player) {
  const raw = player?._flags instanceof Map ? player._flags.get(STI_FLAG) : undefined;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function isInfected(player) { return !!stiOf(player); }

export function strainLabel(key) {
  return STRAINS.find(s => s.key === key)?.label || 'something';
}

export function strainLine(key) {
  return STRAINS.find(s => s.key === key)?.line || `Something you caught is making itself known.`;
}

export async function infect(player, strainKey = null) {
  if (!player || isInfected(player)) return null;
  const strain = strainKey
    ? STRAINS.find(s => s.key === strainKey) || STRAINS[0]
    : STRAINS[Math.floor(Math.random() * STRAINS.length)];
  await setFlag('player', STI_FLAG, JSON.stringify({ strain: strain.key, since: Date.now() }), player);
  return strain;
}

export async function cureSti(player) {
  if (!isInfected(player)) return false;
  await clearFlag('player', STI_FLAG, player);
  clearEffect(player, STI_SYMPTOM_EFFECT);
  return true;
}

// Keeps the symptom badge lit while the flag is set. Called from the 1m tick, so
// a 90s duration always outlives the gap.
export function refreshSymptoms(player) {
  if (isInfected(player)) applyEffect(player, STI_SYMPTOM_EFFECT, 90);
}

// The incubation window: you don't know the night it happened. Symptom lines
// only start once it's had a day to declare itself.
const INCUBATION_MS = 20 * 60 * 1000;

export function symptomDue(player) {
  const sti = stiOf(player);
  if (!sti) return false;
  return Date.now() - (sti.since || 0) > INCUBATION_MS;
}

// ── Protection ───────────────────────────────────────────────────────────────

const TRANSMIT_UNPROTECTED = 0.14;
const TRANSMIT_PROTECTED   = 0.01;   // it can fail, and that's the story

// One carried item tagged `condom`, consumed per act. A DB read, but only at the
// START of an act — never on the beat.
export async function takeProtection(player) {
  const { rows } = await query(
    `SELECT pi.id, pi.quantity FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id = $1 AND jsonb_exists(i.tags, 'condom') LIMIT 1`,
    [player.id]
  );
  if (!rows.length) return false;
  const row = rows[0];
  if (row.quantity > 1) await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [row.id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [row.id]);
  return true;
}

export function transmits(isProtected) {
  return Math.random() < (isProtected ? TRANSMIT_PROTECTED : TRANSMIT_UNPROTECTED);
}

// Whether an NPC is carrying something. Deterministic per NPC for the life of the
// process (hashed off the id) rather than rolled per act — so an NPC is
// consistently clean or not, which is the only way "ask around about them" could
// ever become a real play. Transient by design: it is not the NPC's business to
// have this in the database.
const NPC_INFECTED_RATE = 0.18;

export function npcInfected(npc) {
  if (!npc?.id) return false;
  if (npc._misSti === undefined) {
    if (npc.flags?.mis_clean) { npc._misSti = false; return false; }
    if (npc.flags?.mis_infected) { npc._misSti = true; return true; }
    let h = 0;
    for (let i = 0; i < npc.id.length; i++) h = (h * 31 + npc.id.charCodeAt(i)) >>> 0;
    npc._misSti = (h % 1000) / 1000 < NPC_INFECTED_RATE;
  }
  return npc._misSti;
}
