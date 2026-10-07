// Water supply substrate and the law every water reader obeys.
// See docs/systems-water-supply.md.
//
// Two questions, both owned here so the readers stop answering them separately:
//   - what a water source IS (isWaterSource for washing, isDrinkingSource for drink/fill/cook);
//   - whether it is RUNNING (getWaterSupply, and the law drawWater).
//
// The plant that decides the second answer is a plugin (`waterworks`), and it is the only writer:
// it calls setWaterSupply. Readers never import it.
//
// Synchronous by contract. getWaterSupply is a Map lookup and waterNetworkOf walks a zone's
// parent_zone chain through the world Map (two or three lookups), so drawWater costs no round trip.
// It isn't memoised, so a zone moved or re-flagged by the dev panel is read fresh.

import { getZone, getRegion } from './world.js';
import { emit } from './events.js';
import { registerConditionShape } from './flags.js';

// A network is a region: every mains tap in a region draws from the one supply. The engine names
// no region. A region nobody has registered a plant for is always flowing, which is every region
// until a plugin says otherwise (the waterworks plugin does, from a furniture flag).

const FLOWING = Object.freeze({ state: 'flowing', quality: 'clean', reason: null });
const supply = new Map();        // region id -> { state, quality, reason }

// ── What a water source is ────────────────────────────────────────────────────────────────────
// A shower matches three ways, like a toilet: the type, a flag, or the word in its name.
export const isShower = (f) =>
  f?.object_type === 'shower' || !!f?.flags?.shower || /\bshower\b/i.test(f?.name || '');

// Anything you can wash at: a shower, a sink, or an authored water source.
export const isWaterSource = (f) =>
  isShower(f) || f?.object_type === 'sink' || !!f?.flags?.water_source;

// Water you can drink or fill from: authored `water_source` only. A shower is not a tap.
export const isDrinkingSource = (f) => !!f?.flags?.water_source;

// ── Which network a zone draws from ───────────────────────────────────────────────────────────
// The map tile a zone belongs to decides it: the zone itself if it is on the world map, otherwise
// the facade its parent_zone chain leads to. A zone flagged `water_local` is off-network, and so is
// one with no region (a transient room out in the void).
export function waterNetworkOf(zoneId) {
  if (!zoneId) return null;
  let z = getZone(zoneId);
  if (z?.flags?.water_local) return null;
  for (let hops = 0; z && hops < 8; hops++) {
    if (z.flags?.region_id) return z.flags.region_id;
    z = z.parent_zone ? getZone(z.parent_zone) : null;
  }
  return null;
}

// ── Whether it is running ─────────────────────────────────────────────────────────────────────
export function getNetworkSupply(network) { return supply.get(network) || FLOWING; }

export function getWaterSupply(zoneId) {
  const net = waterNetworkOf(zoneId);
  return net ? getNetworkSupply(net) : FLOWING;
}

const STATES = new Set(['flowing', 'low', 'dry']);
const QUALITIES = new Set(['clean', 'cloudy', 'foul']);

// The one writer. Emits water.supply.changed when the state or quality actually changes.
export function setWaterSupply(network, { state = 'flowing', quality = 'clean', reason = null } = {}) {
  if (!getRegion(network)) throw new Error(`setWaterSupply: unknown region ${network}`);
  if (!STATES.has(state)) throw new Error(`setWaterSupply: bad state ${state}`);
  if (!QUALITIES.has(quality)) throw new Error(`setWaterSupply: bad quality ${quality}`);
  const from = getNetworkSupply(network);
  const to = Object.freeze({ state, quality, reason });
  supply.set(network, to);
  if (from.state !== to.state || from.quality !== to.quality) emit('water.supply.changed', { network, from, to });
  return to;
}

// ── The law ───────────────────────────────────────────────────────────────────────────────────
const DRY_LINES = [
  'The tap coughs, spits a breath of air, and gives nothing.',
  'You open it all the way. The pipe knocks once, somewhere in the wall, and stays dry.',
  'Nothing comes. There is a long sigh from the pipework, and then not even that.',
];
const LOW_LINE = 'The water comes thin and stuttering, a little at a time.';
const CLOUDY_LINE = 'It runs grey and settles slowly in whatever catches it.';
const FOUL_LINE = 'It comes out brown and smells of the Basin.';

// Called by a verb at the moment a player takes water from a source. Off-network sources always
// pass. `f` may be null when a verb only knows the zone (a zone-level water_source). `use` is
// 'drink' (drink, fill, cook) or 'wash' (wash, shower, soap, rinse): foul water still goes in a
// canteen, but nobody gets clean under it.
//   → { ok: false, quality, message }           the verb refuses with the message
//   → { ok: true, quality, note }               note is a line the verb may append (or null)
export function drawWater(f, zoneId, { use = 'drink' } = {}) {
  if (f?.flags?.water_local) return { ok: true, quality: 'clean', note: null };
  const s = getWaterSupply(zoneId);
  if (s.state === 'dry') return { ok: false, quality: s.quality, message: DRY_LINES[Math.floor(Math.random() * DRY_LINES.length)] };
  if (use === 'wash' && s.quality === 'foul') return { ok: false, quality: s.quality, message: `${FOUL_LINE} You'd come out dirtier than you went in.` };
  const note = s.quality === 'foul' ? FOUL_LINE : s.quality === 'cloudy' ? CLOUDY_LINE : s.state === 'low' ? LOW_LINE : null;
  return { ok: true, quality: s.quality, note };
}

// ── The condition ─────────────────────────────────────────────────────────────────────────────
// So a quest's `available.when`, a dialogue option or a script branch can gate on the mains:
//   { water_supply: 'region_coldwater', state: ['low', 'dry'] }
//   { water_supply: 'here', quality: 'foul' }       ('here' is the player's own region)
// `state` and `quality` each take one value or a list; both given means both must match. A region
// with no plant is flowing and clean, like everywhere else in this file. Sync, no query.
const oneOf = (want, have) => want == null || (Array.isArray(want) ? want.includes(have) : want === have);
registerConditionShape('water_supply', (cond, player) => {
  const region = cond.water_supply === 'here' || cond.water_supply === true
    ? waterNetworkOf(player?.current_zone) : cond.water_supply;
  const s = region ? getNetworkSupply(region) : FLOWING;
  return oneOf(cond.state, s.state) && oneOf(cond.quality, s.quality);
});

// Test seam: drop all supply state back to flowing.
export function resetWaterSupply() { supply.clear(); }
