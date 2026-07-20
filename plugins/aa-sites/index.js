/**
 * AA sites on foot.
 *
 * An anti-aircraft emplacement (`aa_sites`) is a two-part installation: an EXPOSED
 * gun deck on a real surface tile (its `zone_id` — the walkable map cell the flight
 * system fires from, draws the turret on, and rakes on a strafing run) and, one level
 * DOWN a hatch, a sheltered BUNKER / engineering space where the reload gear and the
 * battery's engineer live. This plugin makes the installation a place you can walk to
 * and read, and it runs the repair loop that keeps a strafed battery from being dead
 * forever:
 *
 *   - a `zone.describeRoom` panel on the deck tile — the battery's name, faction, and
 *     live status: MANNED (idle), ● FIRING (engaging a contact right now), OFF-LINE &
 *     UNDER REPAIR (strafed, the engineer below hauling it back), or a cold ruin when
 *     the gun is down AND there's no living engineer to fix it;
 *   - a throttled room broadcast when the guns actually open up (driven by the flight
 *     tick's `flight.aaFired`), so anyone standing on the deck feels it cut loose;
 *   - the REPAIR LOOP: a strafing run flips the battery to `active=0` (guns silent, the
 *     3D turret drops from every pilot's picture). If the site's engineer is alive down
 *     in the bunker, they patch and re-arm it — after `REPAIR_MS` of work the battery
 *     flips back to `active=1` and the guns come up again. Kill the engineer on foot and
 *     the timer freezes: the only way to keep a battery down is to keep its bunker crew
 *     down. Nothing else here writes back to the DB.
 *
 * The exposed gunners are ordinary NPCs stationed on the deck tile (content), so they
 * show in the room look AND eat fire when an aircraft strafes the tile — no special-case
 * death code. The engineer is a bunker NPC flagged `aa_engineer:<siteId>`, sheltered
 * from the strafe (interior zone), and is the gate on the repair loop.
 */
import { query } from '../../server/models/db.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { schedule } from '../../server/engine/scheduler.js';
import { on, emit } from '../../server/engine/events.js';
import { getNpcsByFlag } from '../../server/engine/world.js';

const FIRING_WINDOW_MS = 12000;   // the look reads ● FIRING for this long after the last shot
const AA_BROADCAST_MS = 8000;     // cap the "guns erupt" room line to at most this often per site
const CACHE_TTL_MS = 5000;        // aa_sites roster cache (sites are static content)
const REPAIR_MS = 150000;         // engineer work to bring a strafed battery back online (2.5 min)

const lastFired = new Map();      // siteId → ms of last engagement
const lastBroadcast = new Map();  // siteId → ms of last room "erupts" line
const damaged = new Map();        // siteId → { at, zoneId, name } for batteries under repair
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

// The living engineer stationed in a site's bunker, or null. getNpcsByFlag returns
// dead instances too (they linger in world.npcs after a kill), so filter `_dead`.
function livingEngineer(siteId) {
  return getNpcsByFlag('aa_engineer').find(n => n.flags.aa_engineer === siteId && !n._dead) || null;
}

// Pure: the on-foot emplacement panel for a site row. `firing` = shot in the last window;
// `repairing` = down but a living engineer is bringing it back. Exported for tests so the
// render logic is checkable without a DB.
function panelFor(site, firing, repairing) {
  const factionTag = site.faction ? ` <span class="text-dim">(${site.faction})</span>` : '';
  if (!site.active) {
    if (repairing) {
      return `<span class="furniture-label">Emplacement:</span> <span class="text-amber">${site.name}</span>${factionTag}\n<span class="text-amber">● OFF-LINE — UNDER REPAIR</span> <span class="text-dim">— the mount hangs slewed and smoking from a gun run, but the crew below are hauling it back into the fight. Give them a few minutes and the barrels come up again.</span>`;
    }
    return `<span class="furniture-label">Emplacement:</span> <span class="text-dim">${site.name}${factionTag} — a torn-open ruin of scorched steel and slag, the mount canted and cold and no one left below to work it. These guns stay silent until someone mans the bunker again.</span>`;
  }
  const status = firing
    ? '<span class="text-red">● FIRING</span> <span class="text-red">— barrels up and hammering at a contact overhead, the whole pit ringing with it and spent casings raining down the mount.</span>'
    : '<span class="text-green">● MANNED</span> <span class="text-dim">— the crew works the guns, barrels cold, scanning the sky for a contact. A hatch drops into the bunker below.</span>';
  return `<span class="furniture-label">Emplacement:</span> <span class="text-amber">${site.name}</span>${factionTag}\n${status}`;
}

// zone.describeRoom: append the emplacement panel on an AA site's DECK tile. Returns
// undefined for every other zone so the elevator/airfield hooks (and plain rooms)
// are unaffected — fireHook keeps the last defined result.
async function describeRoom(zone) {
  if (!zone?.id) return undefined;
  const site = (await siteByZone()).get(zone.id);
  if (!site) return undefined;
  const firing = Date.now() - (lastFired.get(site.id) || 0) < FIRING_WINDOW_MS;
  const repairing = damaged.has(site.id) && !!livingEngineer(site.id);
  return panelFor(site, firing, repairing);
}

// The flight tick fires this the moment a battery engages an overflight. Stamp the
// firing state (drives the ● FIRING look) and — throttled — let the people on the
// deck hear the guns cut loose.
on('flight.aaFired', ({ zoneId, siteId }) => {
  if (!siteId) return;
  const now = Date.now();
  lastFired.set(siteId, now);
  if (!zoneId || now - (lastBroadcast.get(siteId) || 0) < AA_BROADCAST_MS) return;
  lastBroadcast.set(siteId, now);
  sendToZone(zoneId, { type: 'zone_event',
    message: '<span class="text-red">The crew swings the barrels skyward and the battery erupts — cannon fire hammering up at a contact in the sky, the mount shuddering and spent casings clattering down around you.</span>' });
});

// A strafing run has silenced the guns (flight flipped active=0). Track it for the repair
// loop, drop the roster cache so the deck look flips immediately, and rattle the bunker so
// the engineer scrambles to the damage-control panel.
on('flight.aaSilenced', ({ siteId, zoneId }) => {
  if (!siteId) return;
  cache.at = 0; lastFired.delete(siteId); lastBroadcast.delete(siteId);
  damaged.set(siteId, { at: Date.now(), zoneId, name: null });
  const eng = livingEngineer(siteId);
  if (eng?.zone_id) sendToZone(eng.zone_id, { type: 'zone_event',
    message: '<span class="text-amber">The deck above takes hits — the mount screams and goes dead. The engineer swears, grabs the toolkit, and scrambles for the ladder to bring the gun back up.</span>' });
});

// Repair loop: for each downed battery, if a living engineer is on it, count down the work;
// when it's done, flip the guns back on. No engineer ⇒ the timer freezes (killing the bunker
// crew is the only way to keep a battery dead). Cheap — usually nothing is damaged.
async function repairTick() {
  if (!damaged.size) return;
  const now = Date.now();
  for (const [siteId, d] of damaged) {
    const eng = livingEngineer(siteId);
    if (!eng) { d.at = now; continue; }          // no one to fix it → restart the clock
    if (now - d.at < REPAIR_MS) continue;
    try { await query('UPDATE aa_sites SET active=1 WHERE id=$1', [siteId]); }
    catch { continue; }                          // DB hiccup → try again next tick
    damaged.delete(siteId);
    cache.at = 0;                                 // deck look flips back to MANNED
    if (eng.zone_id) sendToZone(eng.zone_id, { type: 'zone_event',
      message: '<span class="text-green">The engineer slams the access panel shut, wipes their hands, and thumps the housing twice. Overhead the mount whirs back to life — the battery is online.</span>' });
    if (d.zoneId) sendToZone(d.zoneId, { type: 'zone_event', refresh: true,
      message: '<span class="text-green">With a grinding whir the gun jerks back to life, barrels rising to scan the sky. Repaired — the battery is hot again.</span>' });
    emit('flight.aaRepaired', { siteId, zoneId: d.zoneId });
  }
}

// Seed the damaged set from any batteries already down in the DB (server restart mid-repair)
// so the loop picks them back up. Table may be absent in a bare test DB — that's fine.
(async () => {
  try {
    const { rows } = await query('SELECT id, zone_id FROM aa_sites WHERE active=0');
    const now = Date.now();
    for (const r of rows) damaged.set(r.id, { at: now, zoneId: r.zone_id, name: null });
  } catch { /* no aa_sites table → nothing to seed */ }
})();

schedule('15s', () => { repairTick().catch(() => {}); });

export const hooks = {
  'zone.describeRoom': describeRoom,
};

export const _test = { panelFor, livingEngineer, damaged };

console.log('[aa-sites] Plugin loaded.');
