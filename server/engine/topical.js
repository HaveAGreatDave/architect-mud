/**
 * Topical contact — a fluid landing ON A BODY, as an engine substrate.
 *
 * The game already knew how to put a fluid in a container (fillable), in a
 * stomach (drink), on a floor (zone stains) and in the sky (precipitation). The
 * one case nothing owned was the direct one: somebody throws a liquid AT you.
 * The crop-duster opened its booms over a tile full of people and the tile got a
 * line of prose.
 *
 * This is a SUBSTRATE, not a system: no verbs, no tick, no table. It owns three
 * things nothing else can —
 *
 *   1. THE LAW. Every liquid wets you. That is not a per-fluid behaviour to be
 *      re-implemented by fuel and then again by beer, it is the one thing being
 *      hit by a liquid always means — so the wetting pass is registered ONCE
 *      (`registerTopicalWetting`, claimed by clothing-wetness, which owns
 *      wetness) and runs for every fluid whose descriptor says `wets`. What a
 *      fluid does BESIDES making you wet is the per-fluid part, and only that.
 *
 *   2. THE REGISTRIES. `registerTopicalEffect(fluid, fn)` is how the system that
 *      owns a consequence claims the fluid that causes it.
 *      `registerFluidResolver(fn)` is the same rule pointed the other way: how a
 *      plugin that owns a CONTAINER schema says what is in it, so nothing here
 *      has to know that a finished cocktail lives on `custom_data.drink` while a
 *      canteen uses `custom_data.fluid_type`. A fluid nobody has claimed still
 *      lands and still wets — it just does nothing else, which is the correct
 *      behaviour for a liquid the game has not yet given a meaning.
 *
 *   3. THE CONSENT GATE. Being doused by another PLAYER is a thing done to you,
 *      so there is a switch for it, and it is checked HERE rather than at each
 *      call site — a gate a caller can forget is not a gate. The gate is
 *      narrower than "topical contact": `actor is a different player`. Nobody
 *      consents to rain, and a bucket you tipped over your own head is your own
 *      business.
 *
 *      It is an OPT OUT, not an opt in (see TOPICAL_CONSENT_FLAG): default-off
 *      would make every liquid in the world inert for everyone who has never
 *      opened a settings page, which reads as broken rather than as respected.
 *
 * A refusing target is NOT told off and the actor is NOT told who has it off —
 * the liquid simply comes to nothing. Refusal shouldn't be a targeting signal.
 *
 * READ TIER: `applyTopical` is awaited from command paths (a spray pass every
 * 2.5s at most, a thrown drink at human speed), never from a per-move/per-swing/
 * per-tick loop. Its only read is `getFlag`, served from the player's hydrated
 * flag cache — no round trip for a live player.
 */
import { getFlag, setFlag } from './flags.js';
import { emit } from './events.js';

// The player_flags key behind the gate.
//
// DEFAULT ON, and stored only when you change it. The alternative (absent = off)
// makes the world's liquids inert for everyone who has never heard of a settings
// page, which is everyone — the duster sprays a crowd and nothing happens, and
// the feature reads as broken rather than as respected. So the gate is an OPT
// OUT: it is there for the person who wants it, and it costs nobody else a
// keystroke. `false` is the only value that turns it off; anything else, absent
// included, is yes.
export const TOPICAL_CONSENT_FLAG = 'topical_consent';
export const TOPICAL_CONSENT_DEFAULT = true;

/**
 * Every liquid the game can currently get onto a person, and how it reads on
 * arrival. `wets` is the law above; `stain` names the contaminant it leaves for
 * hygiene (null = it dries clean); `harmful` is what an NPC or a bystander would
 * call it, and what the `splash` verb warns you about before you ruin a coat.
 *
 * This table is DESCRIPTION only. The consequences are registered by whoever
 * owns them — see `registerTopicalEffect`.
 */
export const TOPICAL_FLUIDS = {
  water:        { noun: 'water',          arrival: 'cold water breaks over you',                       wets: true,  stain: null,    harmful: false, absorb: 0 },
  dirty_water:  { noun: 'filthy water',   arrival: 'water breaks over you, and it is not clean water',  wets: true,  stain: 'grease', harmful: false, absorb: 0 },
  fuel:         { noun: 'fuel',           arrival: 'raw fuel slaps across you, cold and stinking',      wets: true,  stain: 'fuel',  harmful: true,  absorb: 0.35 },
  acid:         { noun: 'acid',           arrival: 'it lands stinging and keeps stinging',              wets: true,  stain: 'chem',  harmful: true,  absorb: 0.20 },
  booze:        { noun: 'liquor',         arrival: 'liquor breaks over you, sharp and sweet',           wets: true,  stain: 'booze', harmful: false, absorb: 0.02 },
  hot_drink:    { noun: 'a scalding drink', arrival: 'it lands scalding',                               wets: true,  stain: 'grease', harmful: true, hot: true, absorb: 0.02 },
  soft_drink:   { noun: 'a cold drink',   arrival: 'a cold drink breaks over you, and it is sticky',    wets: true,  stain: 'grease', harmful: false, absorb: 0 },
  blood:        { noun: 'blood',          arrival: 'it lands warm, and it is blood',                    wets: true,  stain: 'blood', harmful: false, absorb: 0.05 },
  chem:         { noun: 'chemical',       arrival: 'a bitter chemical mist settles over you',           wets: true,  stain: 'chem',  harmful: true,  absorb: 0.60 },
  // A drug carried in a solvent that WANTS to cross skin — the blotter case. The
  // liquid is inert on its own; what it delivers is whatever `drug` the container
  // resolver hands over, which is why there is no drug id in this table.
  solvent:      { noun: 'a clear solvent', arrival: 'it lands cold and thin, and it does not run off — it sinks in', wets: true, stain: 'chem', harmful: true, absorb: 0.85 },
};

/** Anything not in the table is still a liquid, and the law still applies to it. */
export function fluidInfo(fluid) {
  return TOPICAL_FLUIDS[fluid] || {
    noun: String(fluid || 'liquid').replace(/_/g, ' '),
    arrival: 'it lands wet and cold',
    wets: true, stain: null, harmful: false, absorb: 0,
  };
}
export function isHarmfulFluid(fluid) { return !!fluidInfo(fluid).harmful; }

// ── Absorption ──────────────────────────────────────────────────────────────
//
// The second axis, and the one that makes "a liquid hit me" different from "a
// liquid got INTO me". Being covered in something is not the same as being dosed
// by it: alcohol sits on the skin and evaporates, a solvent carries whatever is
// dissolved in it straight through.
//
//   dose = potency × absorb × skinExposure
//
// `potency` is how much was thrown (the container's business), `absorb` is the
// liquid's permeability (the table above), and `skinExposure` is the fraction
// that reached SKIN rather than stopping in cloth — which the wetting pass
// already computes and used to throw away, because the outside-in layer walk is
// exactly the question "what got through the coat". So a raincoat is chemical
// protection now, for free, and a naked body is the worst case.
//
// Below MIN_SYSTEMIC_DOSE nothing happens at all. This is load-bearing: without
// it, every drink thrown in every bar would apply a rounding-error of alcohol,
// and a thousand nothings would still add up to a tolerance and an addiction.
export const MIN_SYSTEMIC_DOSE = 0.15;
export function systemicDose({ potency = 1, absorb = 0, skinExposure = 1 } = {}) {
  const dose = Math.max(0, potency) * Math.max(0, absorb) * Math.max(0, Math.min(1, skinExposure));
  return dose < MIN_SYSTEMIC_DOSE ? 0 : Math.min(1, dose);
}

// ── The registries ──────────────────────────────────────────────────────────

// fluid → handler(target, ctx). The system that owns the consequence registers it.
const effects = new Map();
export function registerTopicalEffect(fluid, fn) { effects.set(fluid, fn); }
export function hasTopicalEffect(fluid) { return effects.has(fluid); }

// The law: ONE wetting pass, for every fluid that is wet. Claimed by whoever
// owns wetness (clothing-wetness). Registering a second one replaces the first
// rather than stacking, because two systems soaking the same body would each be
// half right.
let wettingPass = null;
export function registerTopicalWetting(fn) { wettingPass = fn; }
export function hasTopicalWetting() { return !!wettingPass; }

// The other single pass: what crosses the skin. Registered once by whoever is
// willing to own a dose (the topical plugin, which routes it into the drugs
// substrate). Same replace-don't-stack rule as the wetting pass.
let dosingPass = null;
export function registerTopicalDosing(fn) { dosingPass = fn; }
export function hasTopicalDosing() { return !!dosingPass; }

// Container → what's in it. Registered by whoever owns the container schema, so
// this file never learns that a cocktail lives somewhere different from water.
// First resolver to answer wins; an unresolved container is simply not a liquid.
const resolvers = [];
export function registerFluidResolver(fn) { resolvers.push(fn); }

/**
 * What liquid is in this thing, and how much of a dousing does it make?
 * Returns { fluid, potency, label } or null when the container holds no liquid.
 * `potency` is 0..1 — a shot glass is not a bucket.
 */
export function describeContainerFluid(item) {
  if (!item) return null;
  for (const fn of resolvers) {
    let d = null;
    try { d = fn(item); } catch { d = null; }
    if (!d || !d.fluid) continue;
    return {
      fluid: d.fluid,
      potency: Math.max(0, Math.min(1, d.potency ?? 1)),
      label: d.label || fluidInfo(d.fluid).noun,
      // What is dissolved in the carrier, if anything. Named by the resolver,
      // never by the fluid table — the same solvent carries different cargo.
      drug: d.drug || null,
      potencyMult: Number(d.potencyMult) || 1,
      // How the container is left afterwards — the resolver owns emptying it,
      // since it is the only thing that knows which keys hold the liquid.
      empty: d.empty || null,
    };
  }
  return null;
}

// ── Consent ─────────────────────────────────────────────────────────────────
export async function getTopicalConsent(player) {
  if (!player?.id) return TOPICAL_CONSENT_DEFAULT;
  const raw = await getFlag('player', TOPICAL_CONSENT_FLAG, player);
  if (raw == null || raw === '') return TOPICAL_CONSENT_DEFAULT;
  return String(raw) !== 'false';
}

export async function setTopicalConsent(player, on) {
  await setFlag('player', TOPICAL_CONSENT_FLAG, on ? 'true' : 'false', player);
  return !!on;
}

/**
 * Does `actor` need `target`'s consent to douse them?
 * Only a player dousing a DIFFERENT player. Weather, NPCs, hazards and your own
 * hand are the world happening to you, not a person choosing you.
 */
export function needsTopicalConsent(target, actor) {
  return !!(actor && actor.id && target && target.id && actor.id !== target.id);
}

/**
 * Land `fluid` on one body.
 *
 * ctx: { fluid, potency (0..1), actor, source (short prose for the log),
 *        broadcast }.
 *
 * Order is the law first, the fluid second: everything wet makes you wet, and
 * then acid does the acid part. An effect that wants the last word returns its
 * own `message`.
 *
 * Returns { applied, reason, message, info }.
 */
export async function applyTopical(target, ctx = {}) {
  const { fluid = 'water', potency = 1, actor = null, source = null } = ctx;
  if (!target?.id) return { applied: false, reason: 'no_target' };

  if (needsTopicalConsent(target, actor) && !(await getTopicalConsent(target))) {
    return {
      applied: false,
      reason: 'no_consent',
      // Deliberately physical, not administrative: the world doesn't lecture.
      message: `<span class="text-dim">${source || 'Something wet'} comes at you and comes to nothing.</span>`,
    };
  }

  const info = fluidInfo(fluid);
  const inner = { ...ctx, fluid, potency, info };

  let message = null;
  // 1. THE LAW. It also answers the question absorption depends on — how much of
  // this got past the clothes — so the wetting pass runs first and hands back
  // `skinExposure` rather than only prose.
  let skinExposure = 1;
  if (info.wets && wettingPass) {
    const wetRes = await wettingPass(target, inner);
    if (wetRes && wetRes.message) message = wetRes.message;
    if (wetRes && typeof wetRes.skinExposure === 'number') skinExposure = wetRes.skinExposure;
  }
  inner.skinExposure = skinExposure;

  // 2. WHAT CROSSED. A liquid that carries something (`ctx.drug`, supplied by the
  // container resolver — the substrate names no drug ids) doses at the absorbed
  // fraction, through the skin route. Everything else computes a zero here and
  // costs nothing.
  const dose = systemicDose({ potency, absorb: info.absorb, skinExposure });
  inner.dose = dose;
  if (dose > 0 && ctx.drug && dosingPass) {
    const dosed = await dosingPass(target, inner);
    if (dosed && dosed.message) message = dosed.message;
  }

  // 3. THE FLUID'S OWN CONSEQUENCE, which gets the last word.
  const fn = effects.get(fluid);
  if (fn) {
    const res = await fn(target, inner);
    if (res && res.message) message = res.message;
  }

  if (!message) {
    const lead = source ? `${source} — ` : '';
    message = `<span class="text-cyan">${lead}${info.arrival}.</span>`;
  }

  emit('topical.applied', {
    playerId: target.id, fluid, potency, dose, skinExposure,
    drug: ctx.drug || null, actorId: actor?.id || null,
  });
  return {
    applied: true,
    reason: fn ? 'effect' : (info.wets && wettingPass ? 'wet' : 'inert'),
    message, info, dose, skinExposure,
  };
}

/** Land a fluid on everyone in a list, honouring each person's own answer. */
export async function applyTopicalToAll(targets, ctx = {}) {
  const out = [];
  for (const t of targets) out.push({ target: t, result: await applyTopical(t, ctx) });
  return out;
}
