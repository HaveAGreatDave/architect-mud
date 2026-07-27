// ambient-life — the city's daily routine.
//
// The engine's ambient pool (getRandomAmbient) is a flat, one-shot, theme-keyed
// list with no sense of *when* or *where* something belongs. This plugin is the
// layer that gives street zones a lived-in rhythm: the right vignette in the
// right place at the right time of day. Kids play by daylight; buskers set up at
// dusk; dogs bark two rooms over at any hour; a delivery drone whirs overhead and
// banks north. It's the world breathing.
//
// Content lives in the DB, never here — table `ambient_routines`, loaded into
// `routines` by loadRoutines() (at boot and after a dev edit). Each row is a
// vignette gated by day-phase, ambient_theme, weather, and/or an explicit zone
// allowlist, with an ordered `lines` array (one entry = a one-shot; several = a
// paced scene, like npc-banter). `loudness > 0` makes an audible routine bleed to
// neighbouring rooms through the same sound propagation the rest of the game uses.
// Seed the first library with `node scripts/seed-ambient-life.mjs`.
//
// Zones opt in with `flags.street_life` (the fishing/mining opt-in convention) so
// street life never sprays across the frozen bay or a quiet apartment — only the
// pedestrian hubs feel it.
//
// Two routines are *interactive* (`interactive` = 'tip' | 'order'): firing arms a
// short-lived per-zone opportunity and appends a clickable [Tip]/[Buy] link. The
// `tip` and `order` verbs resolve whatever opportunity is live in the player's
// room — no target to disambiguate, so no SIFT/Action needed.

import { schedule } from '../../server/engine/scheduler.js';
import { world, getZonePlayers } from '../../server/engine/world.js';
import { query } from '../../server/models/db.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { propagateSound } from '../../server/engine/sounds.js';
import { sendToZone, getBroadcast } from '../../server/engine/messaging.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { foodLoad } from '../../server/engine/bodily.js';
import { commands as stripperCommands } from '../strippers/index.js';
import { homeLifeTick } from './home-life.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
const START_CHANCE     = 0.5;             // per eligible zone, per tick
const ZONE_COOLDOWN_MS  = [90_000, 180_000]; // quiet spell after a scene ends (min..max)
const TURN_GAP_MS       = [3500, 6500];   // delay between lines of a paced vignette
const MAX_LINES         = 4;              // cap a vignette's length
const OPPORTUNITY_TTL_MS = 120_000;       // how long a tip/order stays clickable

// Interactive payouts (the mechanic's own flavour + effect — deliberately fixed,
// so the buy result always matches the one interactive busker/cart it belongs to).
const TIP_PRICE   = 5;                     // credits into the busker's case
const TIP_SANITY  = 2;                     // a small moment of grace
const ORDER_PRICE = 3;                     // credits for a hot skewer
const ORDER_HUNGER = 25;                   // hunger it restores

// ── Library (loaded from DB) ────────────────────────────────────────────────────
let routines = [];
let loaded = false; // true once a load has SUCCEEDED (0 rows still counts as loaded)

// Returns true if the query ran (so the tick stops retrying once the table's there,
// even when the library is legitimately empty). The engine loads the banter library
// with an explicit boot call; a plugin can't add one without editing boot, so we
// self-heal in the tick instead — retry until the DB pool is up and the query lands.
export async function loadRoutines() {
  try {
    const { rows } = await query(
      `SELECT id, category, themes, zones, phases, weather, lines, loudness, interactive, weight, enabled
         FROM ambient_routines ORDER BY sort_order, id`);
    routines = rows
      .filter(r => r.enabled !== false && Array.isArray(r.lines) && r.lines.length)
      .map(r => ({
        id: r.id,
        category: r.category,
        themes: Array.isArray(r.themes) ? r.themes : [],
        zones: Array.isArray(r.zones) ? r.zones : [],
        phases: Array.isArray(r.phases) ? r.phases : [],
        weather: Array.isArray(r.weather) ? r.weather : [],
        lines: r.lines,
        loudness: Number(r.loudness) || 0,
        interactive: r.interactive || null,
        weight: Number(r.weight) || 100,
      }));
    return true;
  } catch {
    routines = []; // table not applied / DB not ready yet — try again next tick
    return false;
  }
}
// Dev-edit reload (also flips the loaded flag so a pre-first-tick edit sticks).
export async function reloadRoutines() { loaded = await loadRoutines(); return loaded; }

// ── Live interactive opportunities ──────────────────────────────────────────────
// zoneId → { kind:'tip'|'order', expiresAt, actedBy:Set } while a clickable
// busker/cart is present. Cleared on expiry (lazily) or when the scene rolls over.
const opportunities = new Map();

function liveOpportunity(zoneId, kind) {
  const opp = opportunities.get(zoneId);
  if (!opp || opp.kind !== kind) return null;
  if (opp.expiresAt < Date.now()) { opportunities.delete(zoneId); return null; }
  return opp;
}

// ── Per-zone scene bookkeeping ──────────────────────────────────────────────────
const zoneCooldown = new Map(); // zoneId → ts; no new scene before this
const activeScene  = new Set(); // zoneId with a paced vignette mid-run

const rand    = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const actionLink = (cmd, label) =>
  `<span class="action-link" data-raw-cmd="${cmd}" data-label="${label}">[${label}]</span>`;

// A zone that can host routine life right now: opted in, outdoors, and witnessed.
function isStreetZone(zone) {
  return zone && zone.flags?.street_life && !zone.is_interior && !zone.is_building && !zone.is_apartment;
}

function matches(routine, zone, phase, weather) {
  if (routine.zones.length && !routine.zones.includes(zone.id)) return false;
  if (routine.themes.length && !routine.themes.includes(zone.ambient_theme)) return false;
  if (routine.phases.length && !routine.phases.includes(phase)) return false;
  if (routine.weather.length && !routine.weather.includes(weather)) return false;
  return true;
}

function pickRoutine(zone, phase, weather) {
  const pool = routines.filter(r => matches(r, zone, phase, weather));
  if (!pool.length) return null;
  const total = pool.reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total;
  for (const r of pool) { roll -= r.weight; if (roll <= 0) return r; }
  return pool[pool.length - 1];
}

// Emit one scenery line — through sound propagation if it's audible (so it bleeds
// muffled into neighbouring rooms), otherwise just to the room it happens in.
function emitLine(zoneId, text, loudness) {
  const html = `<span class="msg-ambient">${text}</span>`;
  if (loudness > 0) {
    const broadcast = getBroadcast();
    if (broadcast) propagateSound(zoneId, text, loudness, broadcast);
  } else {
    sendToZone(zoneId, { type: 'ambient', message: html });
  }
}

function startCooldown(zoneId) {
  zoneCooldown.set(zoneId, Date.now() + randInt(ZONE_COOLDOWN_MS[0], ZONE_COOLDOWN_MS[1]));
}

// Play a multi-line vignette line-by-line, re-checking the room still has an
// audience before each line so a scene doesn't perform to an empty street.
function playVignette(zoneId, lines, loudness) {
  activeScene.add(zoneId);
  let i = 0;
  const step = () => {
    if (i >= lines.length || !getZonePlayers(zoneId).length) {
      activeScene.delete(zoneId);
      startCooldown(zoneId);
      return;
    }
    emitLine(zoneId, lines[i++], loudness);
    if (i >= lines.length) { activeScene.delete(zoneId); startCooldown(zoneId); return; }
    setTimeout(step, randInt(TURN_GAP_MS[0], TURN_GAP_MS[1]));
  };
  step();
}

function fireRoutine(zoneId, routine) {
  // Interactive routines are a single setup line + a clickable opportunity.
  if (routine.interactive === 'tip' || routine.interactive === 'order') {
    opportunities.set(zoneId, { kind: routine.interactive, expiresAt: Date.now() + OPPORTUNITY_TTL_MS, actedBy: new Set() });
    const label = routine.interactive === 'tip' ? `Tip ₵${TIP_PRICE}` : `Buy a skewer ₵${ORDER_PRICE}`;
    sendToZone(zoneId, { type: 'ambient', message: `<span class="msg-ambient">${routine.lines[0]} ${actionLink(routine.interactive, label)}</span>` });
    startCooldown(zoneId);
    return;
  }
  const lines = routine.lines.slice(0, MAX_LINES);
  if (lines.length === 1) { emitLine(zoneId, lines[0], routine.loudness); startCooldown(zoneId); return; }
  playVignette(zoneId, lines, routine.loudness);
}

// ── Tick ────────────────────────────────────────────────────────────────────────
let ticking = false;
function routineTick() {
  if (ticking) return;
  // First ticks after boot: keep trying to load until the query lands, then act.
  if (!loaded) { loadRoutines().then(ok => { loaded = ok; }); return; }
  if (!routines.length) return;
  ticking = true;
  try {
    const now = Date.now();
    const { timePhase, weatherType } = getEnvironmentState();

    // Only zones with a player in them are candidates (someone to witness it).
    const candidates = new Set();
    for (const player of world.players.values()) {
      if (player.current_zone) candidates.add(player.current_zone);
    }

    for (const zoneId of candidates) {
      if (activeScene.has(zoneId)) continue;                 // a vignette is mid-run
      if ((zoneCooldown.get(zoneId) ?? 0) > now) continue;   // resting
      const zone = world.zones.get(zoneId);
      if (!isStreetZone(zone) || !getZonePlayers(zoneId).length) continue;
      if (Math.random() > START_CHANCE) continue;
      const routine = pickRoutine(zone, timePhase, weatherType);
      if (routine) fireRoutine(zoneId, routine);
    }
  } finally {
    ticking = false;
  }
}

// Home life rides the same tick, so it inherits the same idle gating: no
// players anywhere means no candidates and no work for either half.
schedule('30s', () => { routineTick(); homeLifeTick(); });

// ── Interactive verbs ─────────────────────────────────────────────────────────
// `order` resolves the food-cart opportunity in the room. `tip` is shared with the
// strippers plugin — a busker on the street and a dancer on a stage are the same
// verb in mutually-exclusive places. We win the verb (manifest `after:["strippers"]`)
// and delegate to the strip club when there's no busker here (the gametable `watch`
// router pattern — delegate by context, don't duplicate).

async function cmdBuskerTip(player, broadcast) {
  const opp = liveOpportunity(player.current_zone, 'tip');
  if (!opp) return { type: 'error', message: `There's no one here worth tipping.` };
  if (opp.actedBy.has(player.id)) return { type: 'error', message: `You've already tipped the busker.` };
  if (!(await adjustCredits(player, -TIP_PRICE, undefined, 'ambient:tip'))) return { type: 'error', message: `You dig for change and come up empty.` };
  opp.actedBy.add(player.id);
  player.sanity = Math.min(player.sanity_max ?? 100, (player.sanity ?? 0) + TIP_SANITY);
  await query('UPDATE players SET sanity=$1 WHERE id=$2', [player.sanity, player.id]).catch(() => {});
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} flips a few credits into the busker's open case.` }, player.id);
  return {
    type: 'tip',
    message: `You drop ₵${TIP_PRICE} into the case. The busker catches your eye and bends the next phrase just for you. (+${TIP_SANITY} Sanity)`,
    player_update: { credits: player.credits, sanity: player.sanity },
  };
}

async function cmdOrder(player, broadcast) {
  const opp = liveOpportunity(player.current_zone, 'order');
  if (!opp) return { type: 'error', message: `There's no cart here taking orders.` };
  if (!(await adjustCredits(player, -ORDER_PRICE, undefined, 'ambient:order'))) return { type: 'error', message: `You're a few credits short.` };
  player.hunger = Math.min(100, (player.hunger ?? 0) + ORDER_HUNGER);
  player.digestive_load = Math.min(120, (player.digestive_load ?? 0) + foodLoad(ORDER_HUNGER));
  await query('UPDATE players SET hunger=$1, digestive_load=$2 WHERE id=$3', [player.hunger, player.digestive_load, player.id]).catch(() => {});
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} buys a skewer off the cart and eats on the spot.` }, player.id);
  return {
    type: 'order',
    message: `You hand over ₵${ORDER_PRICE}. The skewer is charred, greasy, and exactly what you needed. (+${ORDER_HUNGER} Hunger)`,
    player_update: { hunger: player.hunger, credits: player.credits },
  };
}

export const commands = {
  // Busker tip if one's playing here; otherwise fall through to the strip club's tip.
  tip: (args, raw, player, broadcast) => {
    if (liveOpportunity(player.current_zone, 'tip')) return cmdBuskerTip(player, broadcast);
    if (stripperCommands?.tip) return stripperCommands.tip(args, raw, player, broadcast);
    return cmdBuskerTip(player, broadcast); // strippers absent → the busker miss line
  },
  order: (args, raw, player, broadcast) => cmdOrder(player, broadcast),
};

// Exposed for the regress suite.
export const _test = { matches, pickRoutine, liveOpportunity, opportunities, zoneCooldown, isStreetZone, setRoutines: (r) => { routines = r; } };

console.log('[ambient-life] Plugin loaded.');
