// THE LONG HAUL — SERVICING: the three things on a truck that wear out whether you hit anything or not.
//
// The damage model (damage.js) is about what HAPPENS to a truck: a kerb, a wall, a bad night on the
// gravel. None of that touched the ordinary cost of keeping one on the road, which is that oil goes
// black, tread goes bald and brake linings go thin just from the miles. So a rig that had never
// been touched by anything came off a four-hundred-mile run exactly as good as it went out, and the
// bench had nothing to sell a careful driver.
//
// ── ⚠ WEAR IS AN ODOMETER READING, NEVER A STORED BAR ────────────────────────
// Each item stores ONE number: the odometer when it was last done. How worn it is now is derived at
// read time from how far the truck has gone since, so there is no tick, no per-tile write and
// nothing a crash can leave half-updated — the same shape as the cooking burner's `heats` log and
// the hygiene stamp. The drive already carries the odometer home on `park`, so wear arrives with it.
//
// ── ⚠ ABSENT MEANS FRESH, AND THAT IS THE MIGRATION INVARIANT ────────────────
// A truck that has never been serviced stores no `svc` at all, and `serviceLife` answers 1.0 for all
// three. So every rig on the road on the day this shipped handles bit-for-bit as it did — until it
// is next mounted, when `stampIfMissing` writes the current odometer as the baseline and the clock
// starts from there. The alternative (reading a missing stamp as zero) would have handed every
// long-serving truck bald tyres and black oil at once, for miles driven before the rule existed.
//
// ── ⚠ IT BITES LATE AND IT NEVER STRANDS ─────────────────────────────────────
// Each item is free down to a threshold and then fades to a floor, the durability plugin's shape:
// "due" is a warning, "overdue" is a real cost, and nothing here can stop a truck moving. Being slow
// is a consequence; being immobile is a bug — `effTruckParams` enforces that floor after this.
import { TRUCK_HORNS, HORN_IDS, hornOf } from '../../client/shared/truck-horns.js';

export const SERVICE = {
  oil: {
    label: 'Oil and filters', every: 2200,
    price: (t) => Math.round(60 + (t.price || 4000) * 0.012),
    desc: 'Black oil costs you pull and makes the engine slow to answer. A change every tank or two.',
    fresh: 'Clean', due: 'Getting dark', over: 'Black and thin',
  },
  tyres: {
    label: 'Tyres', every: 4800,
    price: (t) => Math.round(180 + (t.price || 4000) * 0.05),
    desc: 'Bald tyres let go early in a bend and on anything loose. The dearest of the three and the rarest.',
    fresh: 'Good tread', due: 'Wearing', over: 'Bald',
  },
  pads: {
    label: 'Brake linings', every: 3000,
    price: (t) => Math.round(120 + (t.price || 4000) * 0.025),
    desc: 'Thin linings are a longer stop every time. Nothing warns you before the pedal does.',
    fresh: 'Thick', due: 'Thinning', over: 'Metal on metal',
  },
};
export const SERVICE_IDS = Object.keys(SERVICE);
// A full service is the three together, for less than the three apart — the reason anybody books
// one rather than waiting for each light to come on.
export const FULL_SERVICE_OFF = 0.85;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** How much of each item is left, 0..1, at this odometer. Absent stamp ⇒ fresh (see the header). */
export function serviceLife(cd, odometer) {
  const svc = cd?.svc;
  const odo = Number(odometer) || 0;
  const out = {};
  for (const id of SERVICE_IDS) {
    const at = svc && Number.isFinite(Number(svc[id])) ? Number(svc[id]) : null;
    out[id] = at == null ? 1 : clamp01(1 - Math.max(0, odo - at) / SERVICE[id].every);
  }
  return out;
}

// Where an item starts to cost you, and how far it can take you down.
const BITE = { oil: 0.25, tyres: 0.40, pads: 0.30 };
const FLOOR = { oil: 0.86, tyres: 0.80, pads: 0.72 };
const fade = (id, v) => (v >= BITE[id] ? 1 : FLOOR[id] + (1 - FLOOR[id]) * (v / BITE[id]));

/**
 * What the wear does to the physics, as multipliers `effTruckParams` applies.
 * All exactly 1 above the thresholds, so a serviced truck is provably the truck it always was.
 */
export function serviceFx(life) {
  const oil = fade('oil', life?.oil ?? 1), tyres = fade('tyres', life?.tyres ?? 1), pads = fade('pads', life?.pads ?? 1);
  return {
    thrust: oil,
    // Black oil is a lazy engine as well as a weak one — a slower answer to the pedal.
    lag: 1 + (1 - oil) * 2,
    brake: pads,
    // `tread` scales the SURFACE's grip in stepTruck, so on dry tarmac a bald tyre still turns in and
    // it is on dirt, gravel and the verge that it goes.
    tread: tyres,
  };
}

/** A word for how an item is doing, and a band key the panel colours by. */
export function serviceBand(id, v) {
  const s = SERVICE[id];
  if (v >= 0.5) return { key: 'fresh', label: s.fresh };
  if (v >= BITE[id]) return { key: 'due', label: s.due };
  return { key: 'over', label: s.over };
}

export function servicePrice(type, what) {
  if (what === 'all') return Math.round(SERVICE_IDS.reduce((a, id) => a + SERVICE[id].price(type), 0) * FULL_SERVICE_OFF);
  return SERVICE[what] ? SERVICE[what].price(type) : null;
}

/** A copy of `cd` with the chosen items stamped done at this odometer. */
export function stampService(cd, odometer, which = 'all') {
  const svc = { ...(cd?.svc || {}) };
  const odo = Math.round(Number(odometer) || 0);
  for (const id of (which === 'all' ? SERVICE_IDS : [which])) svc[id] = odo;
  return { ...(cd || {}), svc };
}

/** A baseline for a truck that has none — see the migration note in the header. Null when present. */
export function stampIfMissing(cd, odometer) {
  if (cd?.svc && SERVICE_IDS.every((id) => Number.isFinite(Number(cd.svc[id])))) return null;
  const svc = { ...(cd?.svc || {}) };
  const odo = Math.round(Number(odometer) || 0);
  for (const id of SERVICE_IDS) if (!Number.isFinite(Number(svc[id]))) svc[id] = odo;
  return { ...(cd || {}), svc };
}

/** The whole service picture for one truck, in the shape the panel draws. */
export function serviceSheet(type, cd, odometer) {
  const life = serviceLife(cd, odometer);
  const items = SERVICE_IDS.map((id) => {
    const band = serviceBand(id, life[id]);
    return { id, label: SERVICE[id].label, desc: SERVICE[id].desc, life: +life[id].toFixed(3),
      band: band.key, bandLabel: band.label, price: servicePrice(type, id),
      // Miles left before it starts to cost you, which is the number a driver plans a run by.
      left: Math.max(0, Math.round((life[id] - BITE[id]) * SERVICE[id].every)) };
  });
  return { items, full: servicePrice(type, 'all'), anyDue: items.some((i) => i.band !== 'fresh') };
}

// ── The horn shelf, in the panel's shape ─────────────────────────────────────
export function hornCatalogue() {
  return HORN_IDS.map((id) => ({ id, name: TRUCK_HORNS[id].name, price: TRUCK_HORNS[id].price, desc: TRUCK_HORNS[id].desc }));
}
/** What swapping to `id` costs: nothing if it is stock or already in this truck's drawer. */
export function hornPrice(cd, id) {
  if (!TRUCK_HORNS[id]) return null;
  if (id === 'stock') return 0;
  const owned = Array.isArray(cd?.owned_horns) ? cd.owned_horns : [];
  return owned.includes(id) ? 0 : TRUCK_HORNS[id].price;
}
export { hornOf, TRUCK_HORNS, HORN_IDS };
