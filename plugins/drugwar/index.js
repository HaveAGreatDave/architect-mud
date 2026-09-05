/**
 * Drug-war plugin — ambient living-world reactions for the drug districts.
 *
 * A covert dealer runs each district's drug trade (plugins/dealer, seeded by
 * scripts/seed-drugwar-dealers.mjs). They exist independently — this plugin has
 * no ties to any ideology and no territory:
 *   - the old self-running `zone_control` turf tick was retired (territory belongs
 *     to player corps alone), and
 *   - the invisible alignment ledger was removed — a player's ideology stance/path
 *     now moves only through deliberate dialogue/quest choices (the ideologies
 *     plugin), never through incidental drug buys or kills.
 *
 * What remains here is pure atmosphere. DRUGWAR_ZONES is just the set of drug
 * districts the ambient "the machine is watching" beats are grounded in — no
 * controller, no tick.
 */
import { on } from '../../server/engine/events.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { drainZonePower, recomputePower } from '../../server/engine/environment.js';

// The drug districts — grounds the ambient beats below. (Formerly the turf
// board; the factions no longer contest these — they're just the map of where
// the trade lives.)
export const DRUGWAR_ZONES = [
  'zone_district_912_909', 'zone_district_907_908', 'zone_district_894_904', 'zone_district_912_912',
  'zone_mq_pigeon_bar', 'zone_mq_cherry_floor', 'zone_district_902_908', 'zone_mq_sump_bar',
  'zone_district_908_908', 'zone_district_916_909', 'zone_district_908_913', 'zone_district_909_906', 'zone_district_909_907',
];
const DRUGWAR_ZONE_SET = new Set(DRUGWAR_ZONES);

export function isDrugWarZone(zoneId) { return DRUGWAR_ZONE_SET.has(zoneId); }

// ─── Living-world reactions ──────────────────────────────────────────────────
// Ambient, diegetic, never part of any tutorial. All off the event bus, all
// cheap and hard-gated so they read as texture, not spam.

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const ambient = (msg) => ({ type: 'output', message: `<span class="msg-ambient">${msg}</span>` });

// "Police don't save you" (near spawn) and "The machine is watching" (the drug
// districts). Both hang off zone entry, each with its own per-player in-memory
// cooldown (resets on restart — it's flavour) and a hard probability gate.
const POLICE_ZONES = new Set(['zone_start', 'zone_district_918_904']);
const WATCH_ZONES = new Set([...DRUGWAR_ZONES, 'zone_start', 'zone_district_918_904']);
const FAMILY_COOLDOWN_MS = 12 * 60_000;   // per player, per family
const BLACKOUT_COOLDOWN_MS = 45 * 60_000; // server-wide — a blackout is a rare world event
const policeSeen = new Map();             // playerId -> last ts
const watchSeen = new Map();
let lastBlackout = 0;

function offCooldown(map, id, ms) {
  const now = Date.now();
  if (now - (map.get(id) || 0) < ms) return false;
  map.set(id, now);
  return true;
}

// No cop is coming. Reuses no crime rules — just narrates the absence of law.
const POLICE_BEATS = [
  `A woman scrambles across the tile, wallet gone, shouting for a cop. None comes. A Precinct 9 camera swivels to track her, records it, and does nothing else.`,
  `Someone is getting worked over in the mouth of the alley. A patrol drone drifts past, scans the scene, decides it isn't a priority, and moves on. Neither are you — unless you make yourself one.`,
  `A man in a Precinct 9 jacket takes a folded envelope from a hard-looking stranger, pockets it without counting, and finds something fascinating to study in the other direction. That's the law, around here.`,
  `The emergency call-post on the wall has been ringing out for a long time. Nobody's answering. Someone has scratched WHY BOTHER into the casing.`,
];

// The Architect as infrastructure — never a voice, only the machine noticing.
const WATCH_BEATS = [
  `A camera on the corner rotates, slow and deliberate, and settles on you. The little red light holds, and holds.`,
  `The streetlights stutter — off, on, off — in a pattern too even to be a fault, then go steady, as if they'd never done it.`,
  `The departure board overhead cycles through stops that don't exist: THRESHOLD · REROUTED · YOU · —, then resets like you imagined it.`,
  `For half a second every screen on the block shows the same frame of grey static. Then they go back to whatever they were selling.`,
  `Something in the walls clicks and re-clicks, counting, and the hum of the grid shifts a half-tone — as if the whole block just got re-prioritised around you.`,
];

on('zone.entered', ({ actor, zone }) => {
  if (!actor?.id || !zone) return;

  if (POLICE_ZONES.has(zone) && Math.random() < 0.22 && offCooldown(policeSeen, actor.id, FAMILY_COOLDOWN_MS)) {
    sendToPlayer(actor.id, ambient(pick(POLICE_BEATS)));
    return;                                        // one beat per entry
  }

  if (WATCH_ZONES.has(zone) && Math.random() < 0.14 && offCooldown(watchSeen, actor.id, FAMILY_COOLDOWN_MS)) {
    if (Math.random() < 0.06 && Date.now() - lastBlackout > BLACKOUT_COOLDOWN_MS) {
      lastBlackout = Date.now();
      blackout(zone).catch(e => console.error('[drugwar] blackout:', e.message));
    } else {
      sendToPlayer(actor.id, ambient(pick(WATCH_BEATS)));
    }
  }
});

// A rare, genuine, sourceless blackout — the machine "running something." Drains
// the zone's power (silent), narrates it, and restores the grid a minute later.
async function blackout(zoneId) {
  const res = await drainZonePower(zoneId).catch(() => ({ ok: false }));
  if (!res?.ok) return;                            // zone has no power grid — no-op
  sendToZone(zoneId, ambient(
    `Every light on the block dies at once — not a flicker, a decision. The dark holds a moment too long to be an accident. Somewhere, something is running a calculation, and you're inside it.`));
  setTimeout(() => recomputePower().catch(e => console.error('[drugwar] power restore:', e.message)), 60_000);
}

console.log('[drugwar] Plugin loaded.');
