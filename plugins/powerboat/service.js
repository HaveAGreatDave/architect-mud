// THE BASIN — the hire desk, the three things that wear on a hull, and her paint.
//
// The truck depot's service.js and rental.js, for a boat, in one file because a boat has less of
// each: one hull on the line, one yard, and a bench that is a shipwright rather than a shop.
//
// ── ⚠ HIRE IS A REAL `boats` ROW, STAMPED ────────────────────────────────────
// The trucking rule, for the same reason: a hire hull is made by the same INSERT the dealer uses and
// carries `custom_data.rental`, so she berths, fuels, wrecks and moors through the ordinary code
// with nothing special-cased. The stamp only changes what you may do to her (no paint, no name) and
// when she goes back. The term runs out LAZILY — asked when the marina opens, when you reach for
// the helm, and when you tie up — never on a tick, and a hull out on the water is never taken from
// under you.
//
// ── ⚠ WEAR IS DERIVED, NEVER STORED AS A BAR ─────────────────────────────────
// Three items, three clocks, none of them a tick:
//   OIL is distance: the stamp is `run` (tiles the hull has covered, accrued in RAM from the
//     telemetry and flushed with the tank) when it was last changed.
//   THE PROP is damage: it is a number the aground and slam events take off and the yard puts back,
//     because a propeller is dinged by what you hit, not by how far you went.
//   FOULING is time IN THE WATER: a hull afloat grows weed whether or not anybody drives her, and a
//     hull under the Dock Hall roof or up on a cradle does not. The stamp is when she was last
//     scrubbed; the growth is read off the wall clock at read time.
// ⚠ AND ABSENT MEANS CLEAN. A boat that has never been serviced stores no `svc` and every factor is
// exactly 1, which is what makes this net-zero for every hull already on the water. The helm stamps
// a baseline the first time she is taken out, and the clocks start there.
import { TYPES } from '../../client/game/js/panels/flight-model.js';

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v)));

// ── HIRE ─────────────────────────────────────────────────────────────────────
export const BOAT_RENT_TERM_MS = 2 * 60 * 60 * 1000;
export const BOAT_RENT_RATE = 0.045;
export const boatRentFee = (type) => Math.max(250, Math.round((type?.price || 14500) * BOAT_RENT_RATE));
export const boatRental = (row) => row?.custom_data?.rental || null;
export const boatRentalExpired = (row, now = Date.now()) => { const r = boatRental(row); return !!r && Number(r.until) <= now; };
export const boatRentalLeft = (row, now = Date.now()) => { const r = boatRental(row); return r ? Math.max(0, Number(r.until) - now) : null; };
export function fmtLeft(ms) {
  if (ms == null) return '';
  const m = Math.ceil(ms / 60000);
  if (m <= 0) return 'due back now';
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m left` : `${m}m left`;
}
export const BOAT_RENT_REFUSE = "She is a hire boat. The desk wants her back the colour she went out, with the name she went out under.";

// ── WEAR ─────────────────────────────────────────────────────────────────────
export const BOAT_SERVICE = {
  oil: {
    label: 'Engine oil', every: 900,
    price: (t) => Math.round(120 + (t.price || 14500) * 0.01),
    desc: 'A blown V8 eats its oil. Black oil is a motor that will not pull the hump.',
    fresh: 'Clean', due: 'Getting dark', over: 'Black',
  },
  prop: {
    label: 'The prop', price: (t) => Math.round(260 + (t.price || 14500) * 0.03),
    desc: 'Every time she touches the bottom the blades pay for it. A dinged prop is thrust you are not getting.',
    fresh: 'True', due: 'Nicked', over: 'Chewed',
  },
  scrub: {
    label: 'The bottom', price: (t) => Math.round(90 + (t.price || 14500) * 0.006),
    desc: 'Weed grows on anything left in the water. Under cover or on a cradle, it does not.',
    fresh: 'Clean', due: 'Slimy', over: 'A garden',
  },
};
export const BOAT_SERVICE_IDS = Object.keys(BOAT_SERVICE);
// How long a hull left afloat takes to foul right up. Three real days: a boat tied at the float for
// a weekend comes back sluggish, and one kept in the shed never does.
export const FOUL_FULL_MS = 3 * 24 * 3600 * 1000;
// How much one grounding takes off the prop, and one slam.
export const PROP_KNOCK = { aground: 0.14, slam: 0.03 };

/** 0..1 for each item. `afloat` is whether she has been lying in the water since the last scrub. */
export function boatServiceLife(cd, now = Date.now()) {
  const svc = cd?.svc;
  if (!svc) return { oil: 1, prop: 1, scrub: 1 };
  const run = Number(cd.run) || 0;
  const oil = Number.isFinite(Number(svc.oil)) ? clamp01(1 - Math.max(0, run - Number(svc.oil)) / BOAT_SERVICE.oil.every) : 1;
  const prop = Number.isFinite(Number(cd.prop)) ? clamp01(cd.prop) : 1;
  // Fouling accrues only while she lies afloat: `wetSince` is stamped when she goes into the water
  // and cleared when she is lifted out, and the growth up to the last lift is banked in `foul`.
  const banked = Number(svc.foul) || 0;
  const wet = Number(svc.wetSince) ? Math.max(0, now - Number(svc.wetSince)) / FOUL_FULL_MS : 0;
  const scrub = clamp01(1 - banked - wet);
  return { oil, prop, scrub };
}

const BITE = { oil: 0.25, prop: 0.8, scrub: 0.6 };
const FLOOR = { oil: 0.84, prop: 0.72, scrub: 0.80 };
const fade = (id, v) => (v >= BITE[id] ? 1 : FLOOR[id] + (1 - FLOOR[id]) * (v / BITE[id]));

/**
 * The hull's `p` with the wear applied — what `stepBoat` is handed on both rungs. Every factor is
 * exactly 1 above its threshold, so a serviced boat is provably the boat that shipped.
 */
export function effBoatParams(typeId, cd = {}, now = Date.now()) {
  const base = TYPES[typeId]?.water ? TYPES[typeId] : TYPES.hydro;
  const life = boatServiceLife(cd, now);
  const oil = fade('oil', life.oil), prop = fade('prop', life.prop), scrub = fade('scrub', life.scrub);
  if (oil === 1 && prop === 1 && scrub === 1) return base;
  return {
    ...base,
    thrustMax: base.thrustMax * oil * prop,
    // Weed is DRAG, which is the honest statement of it: she still makes the revs and the water
    // holds her back, so the top end goes and the bottom end mostly does not.
    dragP: base.dragP / scrub,
    waterFric: base.waterFric * (1 + (1 - scrub) * 0.8),
  };
}

export function boatServiceBand(id, v) {
  const s = BOAT_SERVICE[id];
  if (v >= (id === 'prop' ? 0.9 : 0.5)) return { key: 'fresh', label: s.fresh };
  if (v >= BITE[id]) return { key: 'due', label: s.due };
  return { key: 'over', label: s.over };
}

export function boatServicePrice(type, what) {
  if (what === 'all') return Math.round(BOAT_SERVICE_IDS.reduce((a, id) => a + BOAT_SERVICE[id].price(type), 0) * 0.85);
  return BOAT_SERVICE[what] ? BOAT_SERVICE[what].price(type) : null;
}

export function boatServiceSheet(typeId, cd, now = Date.now()) {
  const type = TYPES[typeId] || TYPES.hydro;
  const life = boatServiceLife(cd, now);
  const items = BOAT_SERVICE_IDS.map((id) => {
    const b = boatServiceBand(id, life[id]);
    return { id, label: BOAT_SERVICE[id].label, desc: BOAT_SERVICE[id].desc, life: +life[id].toFixed(3),
      band: b.key, bandLabel: b.label, price: boatServicePrice(type, id) };
  });
  return { items, full: boatServicePrice(type, 'all'), anyDue: items.some((i) => i.band !== 'fresh') };
}

/** A copy of `cd` with the chosen work done. `afloat` is where she is lying right now. */
export function stampBoatService(cd, which, { afloat = false, now = Date.now() } = {}) {
  const run = Number(cd?.run) || 0;
  const svc = { ...(cd?.svc || {}) };
  const out = { ...(cd || {}) };
  const all = which === 'all';
  if (all || which === 'oil') svc.oil = run;
  if (all || which === 'prop') out.prop = 1;
  if (all || which === 'scrub') { svc.foul = 0; svc.wetSince = afloat ? now : 0; }
  out.svc = svc;
  return out;
}

/** A baseline for a hull with none — see the header. Null when she already has one. */
export function stampBoatIfMissing(cd, { afloat = false, now = Date.now() } = {}) {
  if (cd?.svc) return null;
  return { ...(cd || {}), svc: { oil: Number(cd?.run) || 0, foul: 0, wetSince: afloat ? now : 0 } };
}

/**
 * She has gone into the water, or come out of it. Banks the growth so far when she is lifted, and
 * starts the clock when she is launched — the only two moments fouling's clock changes state.
 */
export function wetChange(cd, afloat, now = Date.now()) {
  if (!cd?.svc) return null;
  const svc = { ...cd.svc };
  const wet = Number(svc.wetSince) || 0;
  if (afloat && !wet) svc.wetSince = now;
  else if (!afloat && wet) { svc.foul = Math.min(1, (Number(svc.foul) || 0) + (now - wet) / FOUL_FULL_MS); svc.wetSince = 0; }
  else return null;
  return { ...cd, svc };
}

// ── PAINT ────────────────────────────────────────────────────────────────────
// A boat's livery is the same object an aircraft's is (`liveryPalette` in aircraft3d.js): a base and
// a trim the hull's paint slots map onto, and a `decal` from the signwriter's family that
// `drawBoatHullArt` lays on her topsides. `factory` is the absence of a choice — the colours her
// mesh file paints — and is stored as nothing, like the truck's stock horn.
export const BOAT_SCHEMES = [
  { id: 'factory',  label: 'As she came',   livery: null },
  { id: 'redline',  label: 'Red line',      livery: { base: '#b3261e', trim: '#f1ede4', finish: 'gloss' } },
  { id: 'navy',     label: 'Ivory and navy', livery: { base: '#f0ece2', trim: '#1c2e52', finish: 'gloss' } },
  { id: 'gold',     label: 'Black and gold', livery: { base: '#121316', trim: '#c9a13b', finish: 'metallic' } },
  { id: 'rescue',   label: 'Rescue orange', livery: { base: '#ee6a1f', trim: '#232629', finish: 'satin' } },
  { id: 'glass',    label: 'Glasshouse',    livery: { base: '#cfd9e2', trim: '#6fa9c7', finish: 'pearl' } },
];
// The signwriter's art, the same ids `drawBoatHullArt` looks up in the door-art family. ⚠ ITS OWN
// SHORT LIST, NOT trucking's ARTS: the README's rule is that neither plugin imports the other, and a
// go-fast boat's topsides want the flames and the skull more than a haulage crest or a route shield.
export const BOAT_DECALS = [
  { id: 'none', label: 'Bare' },
  { id: 'flames', label: 'Flames' },
  { id: 'skull', label: 'Skull and pistons' },
  { id: 'wolf', label: "Wolf's head" },
  { id: 'eagle', label: 'Spread eagle' },
  { id: 'dice', label: 'Lucky dice' },
  { id: 'pinup', label: 'Pin-up' },
  { id: 'eye', label: "The Architect's eye" },
];
export const BOAT_PAINT_PRICE = 1800;
export const BOAT_DECAL_PRICE = 650;

/** The livery a stored custom_data resolves to, or null for the factory colours. */
export function boatLiveryOf(cd) {
  const lv = cd?.livery;
  if (!lv || typeof lv !== 'object') return null;
  return lv;
}
export function schemeOf(cd) {
  const lv = boatLiveryOf(cd);
  if (!lv) return 'factory';
  return BOAT_SCHEMES.find((s) => s.livery && s.livery.base === lv.base && s.livery.trim === lv.trim)?.id || 'custom';
}
