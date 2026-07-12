/**
 * AA sites on foot.
 *
 * An anti-aircraft emplacement (`aa_sites`) sits on a real surface tile — its
 * `zone_id` is a walkable map cell. From the air the flight system draws it as a
 * radar-dish SAM turret and fires it on wanted overflights; on the GROUND, though,
 * the tile said nothing about the guns. This plugin makes the emplacement a place
 * you can walk to and read:
 *
 *   - a `zone.describeRoom` panel on the site's tile — the battery's name, faction,
 *     and live status: MANNED (idle), ● FIRING (engaging a contact right now), or a
 *     torn-open ruin once a strafing run has silenced it;
 *   - a throttled room broadcast when the guns actually open up (driven by the flight
 *     tick's `flight.aaFired`), so anyone standing in the pit feels it cut loose;
 *   - the crew are ordinary NPCs stationed on the tile (content), so they already
 *     show in the room look AND already eat fire when an aircraft strafes the tile —
 *     no special-case death code here.
 *
 * Firing state is transient runtime memory (last-fired timestamps); the site roster
 * is read from `aa_sites` on a short cache. Nothing is written back.
 */
import { query } from '../../server/models/db.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';

const FIRING_WINDOW_MS = 12000;   // the look reads ● FIRING for this long after the last shot
const AA_BROADCAST_MS = 8000;     // cap the "guns erupt" room line to at most this often per site
const CACHE_TTL_MS = 5000;        // aa_sites roster cache (sites are static content)

const lastFired = new Map();      // siteId → ms of last engagement
const lastBroadcast = new Map();  // siteId → ms of last room "erupts" line
let cache = { at: 0, byZone: new Map() };

async function siteByZone() {
  const now = Date.now();
  if (now - cache.at < CACHE_TTL_MS) return cache.byZone;
  const byZone = new Map();
  try {
    const { rows } = await query('SELECT id, name, faction, active, zone_id FROM aa_sites');
    for (const r of rows) byZone.set(r.zone_id, r);
  } catch { /* table absent in a bare test DB → no panels, that's fine */ }
  cache = { at: now, byZone };
  return byZone;
}

// Pure: the on-foot emplacement panel for a site row + whether it's firing right now.
// Exported for tests so the render logic is checkable without a DB.
function panelFor(site, firing) {
  const factionTag = site.faction ? ` <span class="text-dim">(${site.faction})</span>` : '';
  if (!site.active) {
    return `<span class="furniture-label">Emplacement:</span> <span class="text-dim">${site.name}${factionTag} — a torn-open ruin of scorched steel and slag, the mount canted and cold. These guns will never track again.</span>`;
  }
  const status = firing
    ? '<span class="text-red">● FIRING</span> <span class="text-red">— barrels up and hammering at a contact overhead, the whole pit ringing with it and spent casings raining down the mount.</span>'
    : '<span class="text-green">● MANNED</span> <span class="text-dim">— the crew works the guns, barrels cold, scanning the sky for a contact.</span>';
  return `<span class="furniture-label">Emplacement:</span> <span class="text-amber">${site.name}</span>${factionTag}\n${status}`;
}

// zone.describeRoom: append the emplacement panel on an AA site's tile. Returns
// undefined for every other zone so the elevator/airfield hooks (and plain rooms)
// are unaffected — fireHook keeps the last defined result.
async function describeRoom(zone) {
  if (!zone?.id) return undefined;
  const site = (await siteByZone()).get(zone.id);
  if (!site) return undefined;
  return panelFor(site, Date.now() - (lastFired.get(site.id) || 0) < FIRING_WINDOW_MS);
}

// The flight tick fires this the moment a battery engages an overflight. Stamp the
// firing state (drives the ● FIRING look) and — throttled — let the people in the
// pit hear the guns cut loose.
on('flight.aaFired', ({ zoneId, siteId }) => {
  if (!siteId) return;
  const now = Date.now();
  lastFired.set(siteId, now);
  if (!zoneId || now - (lastBroadcast.get(siteId) || 0) < AA_BROADCAST_MS) return;
  lastBroadcast.set(siteId, now);
  sendToZone(zoneId, { type: 'zone_event',
    message: '<span class="text-red">The crew swings the barrels skyward and the battery erupts — cannon fire hammering up at a contact in the sky, the mount shuddering and spent casings clattering down around you.</span>' });
});

// A strafing run has silenced the guns. Drop the roster cache so the look flips to
// the ruined panel immediately (the pilot's own strafe already broadcast the blast).
on('flight.aaSilenced', ({ siteId }) => {
  if (siteId) { cache.at = 0; lastFired.delete(siteId); lastBroadcast.delete(siteId); }
});

export const hooks = {
  'zone.describeRoom': describeRoom,
};

export const _test = { panelFor };

console.log('[aa-sites] Plugin loaded.');
