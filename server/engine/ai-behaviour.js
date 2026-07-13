import { world, getLivePlayer, getDoorForExit, setDoorCache, getZone, getZonePlayers, getPlayerMembership, isEnterableFacade, getMapByParentZone } from './world.js';
import { isSanctuary } from './zone-tags.js';
import { zoneDanger, DANGER_RANK } from './danger.js';
import { allExits, neighborZoneIds, exitTargets } from './exits.js';
import { findPath as findPathRaw, getZonesInRadius } from './pathfinding.js';
import { enemyAttackPlayer, enemyAttackNpc, enemyAttackEnemy } from './combat.js';
import { getEnvironmentState } from './environment.js';
import { gameMsToReal } from './gametime.js';
import { dispatchAction } from './actions.js';
import { isNpcScheduledNow, getNpcStudioZone, isZoneWatched } from './broadcast-bridge.js';
import { getShopperForNpc, closeShopSession, didBuyThisSession } from './vendor-session.js';
import { getNpcChitchat } from './npc-personality.js';
import { OPPOSITE as OPPOSITE_DIR } from './directions.js';
import { setPosture } from './posture.js';

// Breaking contact to flee is a competence check, not a given. An entity's flee
// skill (`flags.flee_skill`, else its combat `dodge`, else 1) is rolled against a
// 2d8−2d8 swing (−14..+14, mean 0); it gets away only if skill + swing clears
// this bar. Tuned so weak early enemies (dodge 1–2) usually botch the break and
// stay cornered, while nimbler things (higher dodge) slip away reliably.
const FLEE_DIFFICULTY = 6;
const d8 = () => 1 + Math.floor(Math.random() * 8);

// Vendor closing-time farewells — picked when the vendor shuts up shop while a
// player is mid-session. Warm if they bought, needling if they didn't.
const VENDOR_CLOSE_HAPPY = [
  `Hope you're happy with your purchase. Come back soon, yeah?`,
  `Pleasure doing business. Enjoy it while it lasts.`,
  `Good doing business with you. Don't be a stranger.`,
  `That's me done for the day. Thanks for the custom.`,
];
const VENDOR_CLOSE_WHINE = [
  `All that browsing and you buy nothing? Get out, I'm closing.`,
  `Tch. Window shopper. My time's worth more than this.`,
  `Come in, poke around, buy nothing. Story of my life. We're closed.`,
  `Not even one credit? Don't let the door hit you.`,
];

// ── Vendor schedule helpers ──────────────────────────────────────────────────

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Zones an NPC advances toward its workplace per wander tick while commuting.
// >1 keeps far-flung workers from spending most of the morning in transit.
const COMMUTE_STEPS_PER_TICK = 4;

/**
 * Check whether a vendor NPC should be working right now.
 * Returns { working, dayHasSchedule, referenceRange }
 *   working        — true if current hour falls in a scheduled block today
 *   dayHasSchedule — true if today has any scheduled blocks at all
 *   referenceRange — on a day-off, the first block of the most recent scheduled day
 *                    (used for HAVE_LIFE hours on off-days); null if none found
 */
export function isVendorWorkTime(npc, env) {
  const schedule = npc.vendor_schedule || {};
  const dayOfWeek = env.dayOfWeek; // 1=Mon … 7=Sun (ISO)
  const hour = env.hour ?? 0;

  // Convert ISO dayOfWeek (1=Mon…7=Sun) to our DAY_KEYS index (0=Sun…6=Sat)
  const todayIdx = dayOfWeek % 7; // 1→1(Mon)…6→6(Sat)…7→0(Sun)
  const todayKey = DAY_KEYS[todayIdx];
  const todayBlocks = schedule[todayKey] || [];

  const dayHasSchedule = todayBlocks.length > 0;

  const inBlock = (blocks, h) => blocks.some(b => h >= (b.from ?? 0) && h < (b.to ?? 24));

  if (dayHasSchedule) {
    return { working: inBlock(todayBlocks, hour), dayHasSchedule: true, referenceRange: null };
  }

  // Day off — look back up to 6 days for the most recent scheduled day
  for (let i = 1; i <= 6; i++) {
    const idx = ((todayIdx - i) + 7) % 7;
    const blocks = schedule[DAY_KEYS[idx]] || [];
    if (blocks.length) {
      return { working: false, dayHasSchedule: false, referenceRange: blocks[0] };
    }
  }

  return { working: false, dayHasSchedule: false, referenceRange: null };
}

// ── Chitchat ────────────────────────────────────────────────────────────────

export const DEFAULT_CHITCHAT_LINES = [
  'mutters something about the radiation levels.',
  'checks a flickering wrist terminal.',
  'cracks their knuckles.',
  'hums an off-key tune.',
  'glances at the nearest exit.',
  'adjusts their collar.',
  'stares blankly at the wall for a moment.',
  'mumbles a complaint about the recycled air.',
  'taps a foot impatiently.',
  'sighs and checks the time.',
  'scratches at an old scar.',
  'cracks a thin, joyless smile.',
];

const DEFAULT_HOME_ACTIVITIES = [
  'putters around the apartment, tidying up.',
  'stares out the window at the neon-lit streets below.',
  'microwaves something that smells questionable.',
  'flips through channels on a battered holoscreen.',
  'does a few half-hearted push-ups.',
  'rummages through a cabinet looking for something.',
  'leans against the wall, staring at nothing.',
  'pours a drink and takes a long sip.',
  'stretches and cracks their neck.',
  'sits on the edge of the bed and checks their terminal.',
  'mutters to themselves and shuffles to the kitchen.',
  'taps at a broken light fixture without fixing it.',
];

// Returns the real (wall-clock) ms timestamp to wake up before the next scheduled
// shift, or null. The shift schedule is keyed to GAME day-of-week + game hours —
// the same clock isVendorWorkTime reads — so the gap is computed in game-minutes
// and converted to real ms via the game-speed knob. (Previously it walked the real
// calendar, which desynced from the game clock at any speed ≠ 1×.)
function getNextShiftWakeMs(entity) {
  const schedule = entity.vendor_schedule;
  const env = getEnvironmentState();
  const nowMinutes = env.minutes;             // game minute-of-day, 0..1439
  const todayIdx = env.dayOfWeek % 7;         // ISO 1=Mon…7=Sun → 0=Sun…6=Sat (DAY_KEYS)
  const WAKE_LEAD_MIN = 60;                    // wake one game-hour before the shift
  const MIN_GAP_MIN = 2;                       // ignore shifts essentially upon us

  // gap = game-minutes from now until the wake moment; convert to a real deadline.
  const realDeadline = (gapGameMin) => Date.now() + gameMsToReal(gapGameMin * 60_000);

  if (schedule && Object.keys(schedule).length) {
    for (let dayOffset = 0; dayOffset <= 6; dayOffset++) {
      const blocks = schedule[DAY_KEYS[(todayIdx + dayOffset) % 7]] || [];
      for (const block of blocks) {
        const wakeMin = (block.from ?? 10) * 60 - WAKE_LEAD_MIN;
        const gap = dayOffset * 1440 + wakeMin - nowMinutes;
        if (gap > MIN_GAP_MIN) return realDeadline(gap);
      }
    }
  }
  // No vendor schedule — wake at 07:00 game time (today if still ahead, else tomorrow).
  let gap = 7 * 60 - nowMinutes;
  if (gap <= MIN_GAP_MIN) gap += 1440;
  return realDeadline(gap);
}

// Format a chitchat line the same way as enemy battlecries:
//   "quoted text"  → yellow say bubble    e.g. "You need something?"
//   unquoted text  → zone_event emote      e.g. drums fingers on the counter.
// A "says" line is ONLY a line that is a single quoted span end-to-end. A line
// with an action verb outside the quote — `mutters: "..."`, or the over-quoted
// `"mutters: "...""` — is an emote (`Name mutters: "..."`), not a says-bubble.
export function formatChitchat(name, line) {
  const t = line.trim();
  const wrapped = t.length >= 2 && t.startsWith('"') && t.endsWith('"');
  if (wrapped && !t.slice(1, -1).includes('"')) {
    return { type: 'output', message: `<span style="color:var(--yellow)">${name} says: ${t}</span>` };
  }
  // Emote: prepend the name. Strip a stray outer wrap so an over-quoted action
  // line still reads `Name mutters: "..."` rather than keeping the outer quotes.
  const body = wrapped ? t.slice(1, -1).trim() : t;
  return { type: 'zone_event', message: `${name} ${body}` };
}

// Whether an NPC is currently ON THE CLOCK at their workplace — the gate that
// decides work vs. life chitchat (and is exported for behaviours like the stripper
// dance). Per the design: "in the work zone AND on shift", no exceptions.
//   • Studio/broadcast actors: standing in their studio zone AND in an active slot.
//   • Vendors: at their (immobile) stall during their open hours.
//   • Anyone with an explicit work_zone_id: standing in it during open hours.
//   • Everyone else has no workplace → never "at work" (always life chitchat).
export function isNpcAtWork(entity) {
  if (!entity || isEnemy(entity)) return false;
  const hereId = entityZone(entity);
  const studioZone = entity.studio_zone_id || getNpcStudioZone(entity.id);
  if (studioZone) return hereId === studioZone && isNpcScheduledNow(entity.id);
  if (entity.npc_type === 'vendor' || entity.work_zone_id) {
    if (entity.work_zone_id && hereId !== entity.work_zone_id) return false;
    return !!isVendorWorkTime(entity, getEnvironmentState()).working;
  }
  return false;
}

function pickChitchatLine(entity, mode) {
  // Work vs. life pool, chosen by the NPC's current on-shift state unless a caller
  // forces a mode. NPC's own override wins, else the archetype default (getNpcChitchat).
  // Enemies have no personality archetype, so this falls through to their own
  // chitchat array or null.
  const m = mode || (isNpcAtWork(entity) ? 'work' : 'life');
  const lines = getNpcChitchat(entity, m) || (Array.isArray(entity.chitchat) ? entity.chitchat : []);
  if (lines.length) return lines[Math.floor(Math.random() * lines.length)];
  return null; // SAY case falls back to the literal smoking line when this returns null
}

// ── Blackboard ────────────────────────────────────────────────────────────────

export function initBlackboard() {
  return {
    currentNode:  null,  // persistent execution cursor — resume point for next tick
    waitUntil:    null,  // timestamp — WAIT node suspend
    patrolTarget: null,  // zone_id currently walking toward
    patrolPath:   [],    // remaining BFS path steps
    patrolMode:   'walk',
    patrolIndex:  0,     // index into PATROL.waypoints
    alertCooldown: 0,    // timestamp — CALL_BACKUP debounce
    lastSay:      0,     // timestamp — SAY debounce
    flags:        {},    // SET_FLAG scope:self values
    _roamNextAt:  0,     // timestamp — ROAM cooldown
    vendor_was_working: false,  // true while vendor NPC is on a scheduled shift
    vendor_carrying:    0,      // credits extracted from safe, en route to ATM
    vendor_atm_zone:    null,   // cached nearest ATM zone for deposit run
    homeSleeping:       false,  // true while NPC is asleep at home (AT_HOME_LIFE)
    lastHomeSay:        0,      // timestamp — passive home activity cooldown
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function entityZone(entity) {
  return entity.zoneId ?? entity.zone_id;
}

function isEnemy(entity) {
  return entity.instanceId != null;
}

// Entity pathing over the zone graph. NPCs walk the road grid (roads-preferring search) so
// they commute/patrol along streets instead of cutting through buildings; enemies keep the
// direct BFS line — a chase shouldn't take the scenic route. Falls through to plain BFS when
// the entity is unknown. Shadows the raw findPath import for every AI call site below.
function findPath(fromId, toId, entity) {
  return findPathRaw(fromId, toId, entity && !isEnemy(entity) ? { roads: true } : {});
}

// Pick a random zone the talk-show guest can plausibly "appear" in unseen: within a short
// walk of the studio, but out on the public map (not inside the studio building), with no
// players present and no camera/planted device watching. Returns a zone id, or null if the
// area's too crowded/surveilled (caller falls back to the studio's exterior tile).
function pickUnobservedZoneNear(studioZone, entity) {
  const sz = getZone(studioZone);
  const studioMap = sz?.map_id ?? null;
  const reach = getZonesInRadius(studioZone, 8);    // Map<zone_id, distance> — kept tight so the
                                                     // guest has a SHORT commute and reaches the stage
                                                     // before the interview segment (it airs live).
  const cands = [];
  for (const [zid, dist] of reach) {
    if (zid === studioZone || dist < 2) continue;              // not on-stage; a few tiles out
    const z = getZone(zid);
    if (!z) continue;
    if (studioMap != null && z.map_id === studioMap) continue; // stay out of the studio building
    if (z.flags?.no_spawn) continue;
    if (getZonePlayers(zid).length) continue;                  // no player watching it arrive
    if (isZoneWatched(zid)) continue;                          // no camera / sticky-cam watching
    cands.push([zid, dist]);
  }
  if (!cands.length) return null;
  // Bias to the CLOSEST unobserved zones: with zero lead time (the show goes to air the moment
  // the guest starts walking), a distant origin left it still commuting when the interview began,
  // breaking the segment to technical difficulties. Pick randomly among the nearest few.
  cands.sort((a, b) => a[1] - b[1]);
  const nearest = cands.slice(0, Math.min(3, cands.length));
  return nearest[Math.floor(Math.random() * nearest.length)][0];
}

// Returns true if the move succeeded, false if blocked by a locked door.
export function moveEntity(entity, newZoneId, broadcast, query) {
  const oldZoneId = entityZone(entity);
  if (oldZoneId === newZoneId) return true;

  // Facade pass-through (mirrors cmdMove's revolving door): NPCs/enemies never
  // stand on an enterable facade either — entering forwards to the interior
  // entry zone, exiting lands on the front-door street tile. The front door's
  // lock is checked HERE because after the swap the generic pair-lookup below
  // can't see it (there's no direct exit between origin and final zone).
  // Pathfinding self-heals: the path's next node after the facade is the entry
  // zone, which the entity now already occupies — a no-op step.
  const facadeZone = getZone(newZoneId);
  if (facadeZone && isEnterableFacade(facadeZone)) {
    const interior = getMapByParentZone(facadeZone.id);
    const fromInside = getZone(oldZoneId)?.map_id === interior.id;
    const finalId = fromInside ? facadeZone.flags?.world_exit_zone : interior.entry_zone_id;
    if (finalId && finalId !== oldZoneId && getZone(finalId)) {
      const fd = getDoorForExit(facadeZone.id, 'in', interior.entry_zone_id)
              || getDoorForExit(interior.entry_zone_id, 'out', facadeZone.id) || null;
      if (fd && fd.hp > 0 && fd.lock_state === 'locked') {
        const ownsFrontDoor = !isEnemy(entity) &&
          [entity.home_zone, entity.work_zone_id].some(z => z && (z === oldZoneId || z === finalId || z === facadeZone.id));
        if (!ownsFrontDoor) return false; // blocked — a locked front door stops NPCs and chasing enemies alike
      }
      newZoneId = finalId;
      if (oldZoneId === newZoneId) return true;
    }
  }

  const departDir = exitDirection(oldZoneId, newZoneId);

  // ── Door handling ────────────────────────────────────────────────────────────
  let doorWasClosed = false;
  // Set once the home-lock or shop lock/unlock steps below have taken charge of
  // the door, so the generic "close behind them" step doesn't then clobber a
  // shop the NPC just opened for business or double-announce a home they secured.
  let doorHandled = false;
  if (departDir) {
    const door = getDoorForExit(oldZoneId, departDir, newZoneId)
              || getDoorForExit(newZoneId, OPPOSITE_DIR[departDir], oldZoneId)
              || null;

    if (door && door.hp > 0) {
      if (door.lock_state === 'locked') {
        // An NPC carries the key to its own home or workplace, so it can pass its
        // own lock — e.g. a vendor returning to a shop that auto-locked while they
        // were away. Anyone else's lock still blocks it.
        const ownsThisDoor = !isEnemy(entity) &&
          (entity.home_zone === oldZoneId || entity.home_zone === newZoneId ||
           entity.work_zone_id === oldZoneId || entity.work_zone_id === newZoneId);
        if (!ownsThisDoor) return false; // blocked — entity can't pass
      }

      if (!door.is_open) {
        doorWasClosed = true;
        door.is_open = 1;
        setDoorCache(door.id, door);
        if (query) query('UPDATE doors SET is_open=1 WHERE id=$1', [door.id]).catch(() => {});
        broadcast(oldZoneId, { type: 'zone_event', message: `${entity.name} opens the door.`, refresh: true });
      }
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  const arriveDir = exitDirection(newZoneId, oldZoneId);
  const departMsg = departDir ? `${entity.name} heads ${departDir}.` : `${entity.name} leaves.`;
  const sourceZoneName = getZone(oldZoneId)?.name || 'inside';
  let arriveMsg;
  if (arriveDir === 'out')       arriveMsg = `${entity.name} arrives from outside.`;
  else if (arriveDir === 'in')   arriveMsg = `${entity.name} emerges from ${sourceZoneName}.`;
  else if (arriveDir === 'up')   arriveMsg = `${entity.name} descends the stairs.`;
  else if (arriveDir === 'down') arriveMsg = `${entity.name} climbs the stairs.`;
  else if (arriveDir)            arriveMsg = `${entity.name} arrives from the ${arriveDir}.`;
  else                           arriveMsg = `${entity.name} arrives.`;

  // Captured before the shop session is torn down below; used by the shop-close
  // branch for the vendor's farewell line (happy if they bought, whiny if not).
  let shopperId = null, shopperBought = false;

  if (isEnemy(entity)) {
    world.zones.get(oldZoneId)?.enemies.delete(entity.instanceId);
    entity.zoneId = newZoneId;
    world.zones.get(newZoneId)?.enemies.add(entity.instanceId);
    broadcast(newZoneId, { type: 'zone_event', message: arriveMsg, refresh: true });
    broadcast(oldZoneId, { type: 'zone_event', message: departMsg, refresh: true });
  } else {
    // If a player has this NPC's shop open, close it before the NPC leaves.
    shopperId = getShopperForNpc(entity.id);
    if (shopperId) {
      shopperBought = didBuyThisSession(shopperId);
      closeShopSession(shopperId);
      broadcast(null, { type: 'dialogue_end', message: `${entity.name} has walked away.` }, null, shopperId);
    }
    world.zones.get(oldZoneId)?.npcs.delete(entity.id);
    entity.zone_id = newZoneId;
    world.zones.get(newZoneId)?.npcs.add(entity.id);
    broadcast(newZoneId, { type: 'zone_event', message: arriveMsg, refresh: true });
    broadcast(oldZoneId, { type: 'zone_event', message: departMsg, refresh: true });
  }

  // Lock the door when an NPC arrives at their home zone
  if (!isEnemy(entity) && entity.home_zone && entity.home_zone === newZoneId && departDir) {
    const homeDoor = getDoorForExit(newZoneId, OPPOSITE_DIR[departDir], oldZoneId)
                  || getDoorForExit(oldZoneId, departDir, newZoneId)
                  || null;
    if (homeDoor && homeDoor.tags && Object.keys(homeDoor.tags).some(k => k.startsWith('lock:'))) {
      homeDoor.is_open = 0;
      homeDoor.lock_state = 'locked';
      setDoorCache(homeDoor.id, homeDoor);
      if (query) query("UPDATE doors SET is_open=0, lock_state='locked' WHERE id=$1", [homeDoor.id]).catch(() => {});
      broadcast(newZoneId, { type: 'zone_event', message: `The lock clicks as ${entity.name} secures the door.`, refresh: true });
      doorHandled = true;
    }
  }

  // Vendor shops lock up when the vendor leaves work and reopen when they return.
  // Keyed on the entrance door of the NPC's work_zone_id — so it only fires for
  // genuine storefronts (which have such a door), never public hubs that don't.
  if (!isEnemy(entity) && entity.work_zone_id && departDir) {
    const arrivingAtWork = newZoneId === entity.work_zone_id;
    const leavingWork    = oldZoneId === entity.work_zone_id;
    if (arrivingAtWork || leavingWork) {
      const shopDoor = getDoorForExit(newZoneId, OPPOSITE_DIR[departDir], oldZoneId)
                    || getDoorForExit(oldZoneId, departDir, newZoneId)
                    || null;
      if (shopDoor && shopDoor.hp > 0 &&
          shopDoor.tags && Object.keys(shopDoor.tags).some(k => k.startsWith('lock:'))) {
        if (arrivingAtWork && shopDoor.lock_state === 'locked') {
          shopDoor.lock_state = null;
          setDoorCache(shopDoor.id, shopDoor);
          if (query) query('UPDATE doors SET lock_state=NULL WHERE id=$1', [shopDoor.id]).catch(() => {});
          broadcast(newZoneId, { type: 'zone_event', message: `${entity.name} unlocks the shop and opens up for business.` });
          broadcast(oldZoneId, { type: 'zone_event', message: `${entity.name} unlocks the shop.` });
          doorHandled = true;   // leave it open for business — don't close behind them
        } else if (leavingWork && shopDoor.lock_state !== 'locked') {
          shopDoor.is_open = 0;
          shopDoor.lock_state = 'locked';
          setDoorCache(shopDoor.id, shopDoor);
          if (query) query("UPDATE doors SET is_open=0, lock_state='locked' WHERE id=$1", [shopDoor.id]).catch(() => {});
          broadcast(oldZoneId, { type: 'zone_event', message: `${entity.name} pulls the shop door shut and locks it on the way out.`, refresh: true });
          broadcast(newZoneId, { type: 'zone_event', message: `${entity.name} locks up the shop.`, refresh: true });
          doorHandled = true;
          // If someone was shopping as the vendor closed up, send them off — warm
          // if they bought something, sour if they wasted the vendor's time.
          if (shopperId) {
            const lines = shopperBought ? VENDOR_CLOSE_HAPPY : VENDOR_CLOSE_WHINE;
            const line = lines[Math.floor(Math.random() * lines.length)];
            broadcast(oldZoneId, { type: 'output', message: `<span style="color:var(--yellow)">${entity.name} says, "${line}"</span>` });
          }
        }
      }
    }
  }

  // Close the door behind them — but only a plain transit door. If the home-lock
  // or shop steps already took charge (secured home / opened shop / locked shop
  // up), leave their result alone.
  if (doorWasClosed && !doorHandled) {
    const door = getDoorForExit(oldZoneId, departDir)
              || getDoorForExit(newZoneId, OPPOSITE_DIR[departDir]);
    if (door) {
      door.is_open = 0;
      setDoorCache(door.id, door);
      if (query) query('UPDATE doors SET is_open=0 WHERE id=$1', [door.id]).catch(() => {});
      broadcast(newZoneId, { type: 'zone_event', message: 'The door closes behind them.', refresh: true });
    }
  }

  // Drag along any players following this entity. Fire-and-forget + dynamic
  // import to keep moveEntity synchronous and avoid a circular import.
  if (departDir) {
    import('./commands/movement.js')
      .then(({ dragFollowers }) => dragFollowers(entity.id, oldZoneId, departDir, broadcast))
      .catch(() => {});
  }

  return true;
}

// Find which exit direction connects fromZone → toZone, or null if none.
function exitDirection(fromZoneId, toZoneId) {
  const zone = world.zones.get(fromZoneId);
  return allExits(zone).find(e => e.target === toZoneId)?.dir || null;
}

// Resolve an edge from a node (looks up fromNode+fromPort in edges array).
function resolveEdge(edges, fromNode, fromPort) {
  return edges.find(e => e.fromNode === fromNode && e.fromPort === fromPort)?.toNode || null;
}

// Convert DB-format graph (inline connections + flat data) to runtime format
// (edges array + node.data). Called once per entity and cached on the object.
// DB format from toAiGraph: { _start, nodes: { id: { type, condition_type, next, ... } } }
// Runtime format:           { _start, nodes: { id: { type, data: {...} } }, edges: [...] }
function normalizeGraph(graph) {
  if (!graph || !graph.nodes) return graph;
  if (graph._normalized) return graph;

  const edges = [];
  const nodes = {};

  for (const [id, node] of Object.entries(graph.nodes)) {
    const { type, next, ifTrue, ifFalse, goToWork, haveLife, endShift, offWork, _vine, ...fields } = node;

    if (next)      edges.push({ fromNode: id, fromPort: 'next',      toNode: next });
    if (ifTrue)    edges.push({ fromNode: id, fromPort: 'ifTrue',    toNode: ifTrue });
    if (ifFalse)   edges.push({ fromNode: id, fromPort: 'ifFalse',   toNode: ifFalse });
    if (goToWork)  edges.push({ fromNode: id, fromPort: 'goToWork',  toNode: goToWork });
    if (haveLife)  edges.push({ fromNode: id, fromPort: 'haveLife',  toNode: haveLife });
    if (endShift)  edges.push({ fromNode: id, fromPort: 'endShift',  toNode: endShift });
    if (offWork)   edges.push({ fromNode: id, fromPort: 'offWork',   toNode: offWork });

    for (const k of Object.keys(fields)) {
      if (k.startsWith('branch_') && fields[k]) {
        edges.push({ fromNode: id, fromPort: k, toNode: fields[k] });
        delete fields[k];
      }
    }

    nodes[id] = { type: type || 'action', data: fields };
  }

  return { _start: graph._start, nodes, edges, _normalized: true };
}

// ── Plugin node registries ────────────────────────────────────────────────────
// Plugins add behaviour-tree node types without editing the switches below
// (docs/proposals/engine-plugin-boundary.md, E3). The broadcast plugin's
// schedule/viewer nodes are the first users.
//
// Conditions are SYNC by contract (the evaluator is synchronous — read caches,
// never the DB): fn(entity, params, { zone, zoneId }) → boolean.
// Actions may be async: fn(entity, params, ctx) → port-string | 'RUNNING' |
// undefined (undefined = continue to the node's default next edge). ctx
// carries { broadcast, query, ai, zone, zoneId, node }.

const pluginConditions = new Map();
const pluginActions = new Map();

export function registerAICondition(type, fn) {
  if (!type || typeof fn !== 'function') throw new Error('registerAICondition: type and fn required');
  pluginConditions.set(type, fn);
}

export function registerAIAction(type, fn) {
  if (!type || typeof fn !== 'function') throw new Error('registerAIAction: type and fn required');
  pluginActions.set(type, fn);
}

export function getRegisteredAINodes() {
  return { conditions: [...pluginConditions.keys()], actions: [...pluginActions.keys()] };
}

// ── Condition evaluation ──────────────────────────────────────────────────────

function evalCondition(node, entity) {
  const { condition_type: type, params = {} } = node.data;
  const zoneId = entityZone(entity);
  const zone = world.zones.get(zoneId);

  switch (type) {
    case 'HAS_TARGET':
      return !!entity.targetId;

    case 'HP_BELOW':
      return (entity.hp / entity.hp_max) * 100 < (params.pct ?? 30);

    case 'HP_ABOVE':
      return (entity.hp / entity.hp_max) * 100 > (params.pct ?? 70);

    case 'IN_ZONE':
      return zoneId === params.zone_id;

    case 'PLAYER_IN_ZONE':
      return (zone?.players.size ?? 0) >= (params.min ?? 1);

    // Like PLAYER_IN_ZONE but respects ignores_admins / attacks_npcs / attacks_enemies flags.
    // True only if at least one non-admin (or NPC/enemy) target is present.
    case 'TARGETABLE_IN_ZONE': {
      if (!zone) return false;
      let players = [...zone.players].map(id => getLivePlayer(id)).filter(Boolean);
      if (entity.flags?.ignores_admins) players = players.filter(p => p.role !== 'admin');
      if (players.length) return true;
      if (entity.flags?.attacks_npcs && [...zone.npcs].some(id => { const n = world.npcs.get(id); return n && !n._dead; })) return true;
      if (entity.flags?.attacks_enemies && [...zone.enemies].some(id => { const e = world.enemies.get(id); return e && !e._dead && e.instanceId !== entity.instanceId; })) return true;
      return false;
    }

    case 'TARGET_HP_BELOW': {
      const target = getLivePlayer(entity.targetId);
      if (!target) return false;
      return (target.hp / target.hp_max) * 100 < (params.pct ?? 30);
    }

    case 'FACTION_MATCH': {
      // True if the target player is a member of the org (corp or player-joinable
      // faction) named by params.faction. Members of NPC factions don't exist in
      // Phase 0, so this fires for player crews; NPC-faction-vs-player reactions
      // key off reputation instead (a future async REP condition).
      const target = getLivePlayer(entity.targetId);
      if (!target || !params.faction) return false;
      return getPlayerMembership(target.id)?.org_id === params.faction;
    }

    case 'FLAG_SET':
      if (params.scope === 'self') return !!entity._ai?.flags?.[params.flag];
      // world flag — checked via world_flags table; use blackboard as fallback
      return !!entity._ai?.flags?.[params.flag];

    case 'RANDOM_CHANCE':
      return Math.random() < (params.chance ?? 0.5);

    case 'IS_DAYTIME': {
      const { timePhase } = getEnvironmentState();
      return timePhase === 'day' || timePhase === 'dawn' || timePhase === 'dusk';
    }

    // CHANNEL_HAS_VIEWERS / IS_BROADCAST_SCHEDULED / AT_WORK_ZONE are
    // registered by the broadcast plugin via registerAICondition.

    case 'HOUR_RANGE': {
      const { hour } = getEnvironmentState();
      if (hour == null) return false;
      const from = params.from ?? 0, to = params.to ?? 23;
      return from <= to ? (hour >= from && hour <= to) : (hour >= from || hour <= to);
    }

    case 'IS_VENDOR_WORK_TIME': {
      const env = getEnvironmentState();
      return isVendorWorkTime(entity, env).working;
    }

    case 'AT_HOME':
      return !!(entity.home_zone && zoneId === entity.home_zone);

    default: {
      const fn = pluginConditions.get(type);
      if (fn) {
        try { return !!fn(entity, params, { zone, zoneId }); }
        catch (e) { console.error(`[ai:condition:${type}] ${e.message}`); return false; }
      }
      return false;
    }
  }
}

// ── Action execution ──────────────────────────────────────────────────────────

async function execAction(node, entity, ctx) {
  const { broadcast, query } = ctx;
  const { action_type: type, params = {} } = node.data;
  const ai = entity._ai;
  const zoneId = entityZone(entity);
  const zone = world.zones.get(zoneId);

  switch (type) {
    case 'ATTACK': {
      if (!entity.targetId) break;
      // Check if target is another enemy instance
      const enemyTarget = entity.flags?.attacks_enemies ? world.enemies.get(entity.targetId) : null;
      if (enemyTarget) {
        if (enemyTarget._dead || enemyTarget.zoneId !== zoneId) {
          entity.targetId = null;
          if (ai) ai.patrolPath = [];
          break;
        }
        enemyAttackEnemy(entity, enemyTarget).then(result => {
          if (!result) return;
          broadcast(zoneId, { type: 'zone_event', message: result.message, refresh: result.killed });
          if (result.killed) {
            entity.targetId = null;
            if (ai) ai.patrolPath = [];
          }
        }).catch(() => {});
        break;
      }
      // Check if target is an NPC (when attacks_npcs flag is set)
      const npcTarget = entity.flags?.attacks_npcs ? world.npcs.get(entity.targetId) : null;
      if (npcTarget) {
        if (npcTarget._dead || npcTarget.zone_id !== zoneId) {
          entity.targetId = null;
          if (ai) ai.patrolPath = [];
          break;
        }
        enemyAttackNpc(entity, npcTarget).then(result => {
          if (!result) return;
          if (result.hit) {
            broadcast(zoneId, { type: 'zone_event', message: result.message });
            if (result.npcSpeech) {
              const verb = result.npcSpeech.shout ? 'shouts' : 'says';
              broadcast(zoneId, { type: 'zone_event', message: `${npcTarget.name} ${verb}, "${result.npcSpeech.line}"` });
            }
          }
          if (result.killed) {
            entity.targetId = null;
            if (ai) ai.patrolPath = [];
            broadcast(zoneId, { type: 'zone_event', message: `${npcTarget.name} has been killed.`, refresh: true });
          }
        }).catch(() => {});
        break;
      }
      const target = getLivePlayer(entity.targetId);
      if (!target || target.current_zone !== zoneId) {
        entity.targetId = null;
        if (ai) ai.patrolPath = [];
        break;
      }
      const firstStrikeDelay = entity.flags?.first_strike_delay_ms || 0;
      if (firstStrikeDelay > 0 && entity.lastAttack === 0) {
        const elapsed = Date.now() - (entity.aggroedAt || Date.now());
        if (elapsed < firstStrikeDelay) break;
      }
      enemyAttackPlayer(entity, target).then(async result => {
        if (!result) return;
        if (result.hit) {
          target.hp = Math.max(0, target.hp - result.damage);
          query('UPDATE players SET hp=$1 WHERE id=$2', [target.hp, target.id]).catch(() => {});
          broadcast(null, { type: 'combat_incoming', message: result.message, player_update: { hp: target.hp, hp_max: target.hp_max } }, null, target.id);
          if (target.hp <= 0) {
            const { handlePlayerDeath } = await import('./gameLoop.js');
            await handlePlayerDeath(target, entity);
          } else {
            if (!target.combatTargetId && !((target.disengagedUntil || 0) > Date.now())) target.combatTargetId = entity.instanceId;
          }
        } else {
          broadcast(null, { type: 'combat_miss', message: result.message }, null, entity.targetId);
        }
      }).catch(() => {});
      break;
    }

    case 'ACQUIRE_TARGET': {
      if (!zone) break;
      let players = [...zone.players].map(id => getLivePlayer(id)).filter(Boolean);
      if (entity.flags?.ignores_admins) players = players.filter(p => p.role !== 'admin');
      const npcs = entity.flags?.attacks_npcs
        ? [...zone.npcs].map(id => world.npcs.get(id)).filter(n => n && !n._dead)
        : [];
      const enemies = entity.flags?.attacks_enemies
        ? [...zone.enemies].map(id => world.enemies.get(id)).filter(e => e && !e._dead && e.instanceId !== entity.instanceId)
        : [];
      const pool = [...players, ...npcs, ...enemies];
      if (!pool.length) break;
      if (params.prefer === 'lowest_hp') {
        pool.sort((a, b) => (a.hp ?? 0) - (b.hp ?? 0));
        entity.targetId = pool[0].id;
      } else {
        entity.targetId = pool[Math.floor(Math.random() * pool.length)].id;
      }
      entity.aggroedAt = Date.now();
      break;
    }

    case 'DROP_TARGET':
      entity.targetId = null;
      entity.aggroedAt = null;
      if (ai) { ai.patrolPath = []; ai.patrolTarget = null; }
      break;

    case 'PATROL': {
      if (!ai) break;
      const waypoints = Array.isArray(params.waypoints) ? params.waypoints : [];
      if (!waypoints.length) break;

      const loop = params.loop !== false;
      const mode = params.mode || 'walk';

      // Advance waypoint index if we've arrived at the current target
      if (ai.patrolTarget && zoneId === ai.patrolTarget) {
        ai.patrolPath = [];
        ai.patrolTarget = null;
        if (loop) {
          ai.patrolIndex = (ai.patrolIndex + 1) % waypoints.length;
        } else {
          ai.patrolIndex = Math.min(ai.patrolIndex + 1, waypoints.length - 1);
        }
      }

      const target = waypoints[ai.patrolIndex % waypoints.length];
      if (!target || zoneId === target) break;

      if (mode === 'teleport') {
        moveEntity(entity, target, broadcast); // teleport ignores doors
        ai.patrolTarget = null;
        ai.patrolPath = [];
        break;
      }

      // Walk mode: BFS path, step one zone per tick
      if (!ai.patrolPath.length || ai.patrolTarget !== target) {
        const path = findPath(zoneId, target, entity);
        if (!path || path.length < 2) break;
        ai.patrolPath = path.slice(1); // skip current zone
        ai.patrolTarget = target;
        ai.patrolMode = mode;
      }

      const nextZone = ai.patrolPath.shift();
      if (nextZone) {
        const moved = moveEntity(entity, nextZone, broadcast, query);
        if (!moved) {
          // Locked door blocking the path — abandon this route and recompute next tick
          ai.patrolPath = [];
          ai.patrolTarget = null;
          break;
        }
        return 'RUNNING'; // still en route — stay at PATROL node next tick
      }
      break;
    }

    case 'FLEE': {
      if (!ai) break;
      const targetPlayer = getLivePlayer(entity.targetId);
      const targetZoneId = targetPlayer?.current_zone;
      const exits = neighborZoneIds(zone);
      if (!exits.length) break;

      // Roll to actually break contact. Weak enemies routinely fail and stay
      // cornered (keeping aggro so they re-try next tick); tough ones get away.
      const fleeSkill = Number(entity.flags?.flee_skill ?? entity.dodge ?? 1);
      if (fleeSkill + (d8() + d8()) - (d8() + d8()) < FLEE_DIFFICULTY) {
        broadcast(zone.id, { type: 'output', message: `<span style="color:var(--yellow)">${entity.name} scrabbles for a way out but can't break away!</span>` });
        break;
      }

      // Move to any adjacent zone that doesn't contain the target
      const safeExits = exits.filter(z => z !== targetZoneId);
      const dest = safeExits.length
        ? safeExits[Math.floor(Math.random() * safeExits.length)]
        : exits[Math.floor(Math.random() * exits.length)];

      const moved = moveEntity(entity, dest, broadcast, query);
      if (!moved) break; // locked door — stay put
      // Clear target after fleeing
      entity.targetId = null;
      entity.aggroedAt = null;
      break;
    }

    // ROAM: move to a random adjacent zone every N seconds, looking for targets.
    // Used by enemies like Arbiters that hunt by wandering rather than fixed patrols.
    // Params: { interval_s: 10 }
    case 'ROAM': {
      if (!ai) break;
      const intervalMs = (params.interval_s ?? 10) * 1000;
      const now = Date.now();
      if (ai._roamNextAt && now < ai._roamNextAt) break; // still waiting

      // Check for targetable entities in current zone before moving.
      // Respects ignores_admins — admin-only zones are treated as empty.
      const curZone = world.zones.get(zoneId);
      let roamPlayers = curZone ? [...(curZone.players || [])].map(id => getLivePlayer(id)).filter(Boolean) : [];
      if (entity.flags?.ignores_admins) roamPlayers = roamPlayers.filter(p => p.role !== 'admin');
      const hasTarget = roamPlayers.length > 0 ||
        (entity.flags?.attacks_npcs && curZone && [...(curZone.npcs || [])].some(id => { const n = world.npcs.get(id); return n && !n._dead; })) ||
        (entity.flags?.attacks_enemies && curZone && [...(curZone.enemies || [])].some(id => { const e = world.enemies.get(id); return e && !e._dead && e.instanceId !== entity.instanceId; }));
      if (hasTarget) {
        // Found a target — don't move, let combat nodes handle aggro
        ai._roamNextAt = now + intervalMs;
        break;
      }

      // No target — step to a random adjacent zone
      const exits = neighborZoneIds(curZone);
      if (exits.length) {
        const dest = exits[Math.floor(Math.random() * exits.length)];
        moveEntity(entity, dest, broadcast, query);
      }
      ai._roamNextAt = now + intervalMs;
      break;
    }

    case 'SAY': {
      if (!ai) break;
      const cooldown = (params.cooldown_s ?? 30) * 1000;
      if (params.once && ai.lastSay > 0) break;
      if (Date.now() - ai.lastSay < cooldown) break;

      // Studio NPCs away from their assigned studio never deliver authored lines —
      // they fall back to idle chitchat (or a generic smoking emote) instead.
      if (entity.studio_zone_id && zoneId !== entity.studio_zone_id) {
        const line = pickChitchatLine(entity);
        ai.lastSay = Date.now();
        broadcast(zoneId, line
          ? { type: 'output', message: `<span style="color:var(--yellow)">${entity.name} says: "${line}"</span>` }
          : { type: 'output', message: `<span style="color:var(--text-dim);font-style:italic">${entity.name} smokes a cigarette.</span>` });
        break;
      }

      const msg = params.message || '';
      if (!msg) break;
      ai.lastSay = Date.now();
      broadcast(zoneId, {
        type: 'output',
        message: `<span style="color:var(--yellow)">${entity.name} says: "${msg}"</span>`,
      });
      break;
    }

    case 'CALL_BACKUP': {
      if (!ai) break;
      const radius = params.radius ?? 2;
      const factionOnly = params.faction_only !== false;
      if (Date.now() - ai.alertCooldown < 30000) break; // 30s cooldown
      ai.alertCooldown = Date.now();

      const reach = getZonesInRadius(zoneId, radius);
      for (const [reachZoneId] of reach) {
        const rZone = world.zones.get(reachZoneId);
        if (!rZone) continue;
        for (const eid of rZone.enemies) {
          const ally = world.enemies.get(eid);
          if (!ally || ally.instanceId === entity.instanceId) continue;
          if (factionOnly && ally.faction !== entity.faction) continue;
          if (!ally.targetId && entity.targetId) {
            ally.targetId = entity.targetId;
            ally.aggroedAt = Date.now();
          }
        }
        for (const nid of rZone.npcs) {
          const ally = world.npcs.get(nid);
          if (!ally || ally.id === entity.id) continue;
          if (factionOnly && ally.faction !== entity.faction) continue;
          if (!ally.targetId && entity.targetId) {
            ally.targetId = entity.targetId;
          }
        }
      }
      break;
    }

    case 'TELEPORT': {
      const dest = params.zone_id;
      if (!dest) break;
      moveEntity(entity, dest, broadcast);
      if (ai) { ai.patrolPath = []; ai.patrolTarget = null; }
      break;
    }

    case 'IDLE':
      break;

    case 'GO_TO_WORK': {
      if (!ai) break;
      const { zone_id, arrive_by, depart_early_minutes = 0 } = params;
      const workZone = zone_id || entity.work_zone_id || entity.studio_zone_id || getNpcStudioZone(entity.id);
      if (!workZone) break;

      // Already at work — let graph continue to work activity nodes
      if (zoneId === workZone) break;

      // Explicit timing params: hold off until the commute window opens.
      // No params (e.g. driven by CHECK_WORK, which already decided it's time): walk immediately.
      if (zone_id && arrive_by != null) {
        const path = findPath(zoneId, workZone, entity);
        if (!path || path.length < 2) return 'RUNNING'; // unreachable — hold and retry
        const { minutes } = getEnvironmentState();
        const travelMinutes = path.length - 1;
        const arriveByMinutes = (arrive_by * 60) - depart_early_minutes;
        const departMinutes = (arriveByMinutes - travelMinutes + 1440) % 1440;
        const minutesUntilDept = (departMinutes - minutes + 1440) % 1440;
        // Not time to leave yet — hold here so work activities don't start early
        if (minutesUntilDept > travelMinutes + 5) return 'RUNNING';
      }

      // Time to commute — walk toward destination. Cover several zones per wander
      // tick (a brisk commute) rather than one-zone-per-game-minute, so a worker
      // far from their shop isn't stuck crossing town for half the day.
      if (!ai.patrolPath.length || ai.patrolTarget !== workZone) {
        const path = findPath(zoneId, workZone, entity);
        if (!path || path.length < 2) return 'RUNNING';
        ai.patrolPath = path.slice(1);
        ai.patrolTarget = workZone;
        ai.patrolMode = 'walk';
      }
      for (let step = 0; step < COMMUTE_STEPS_PER_TICK && ai.patrolPath.length; step++) {
        const nextZone = ai.patrolPath.shift();
        const moved = moveEntity(entity, nextZone, broadcast, query);
        if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; break; }
        if (entityZone(entity) === workZone) break; // arrived — let the graph advance
      }
      return 'RUNNING';
    }

    // CHECK_WORK: branch to goToWork or haveLife based on the NPC's current schedule.
    case 'CHECK_WORK': {
      const studioZone = entity.studio_zone_id || getNpcStudioZone(entity.id);
      if (!studioZone) return 'haveLife';
      return isNpcScheduledNow(entity.id) ? 'goToWork' : 'haveLife';
    }

    // BROADCAST_SAY is registered by the broadcast plugin via registerAIAction.

    case 'START_QUEST': {
      // Offer a quest to players sharing this entity's zone. Per-player, per-quest
      // cooldown (blackboard) so it fires once rather than every tick. The quests
      // plugin's START_QUEST handler is a no-op if the player already has it.
      if (!ai) break;
      const questId = params.quest_id;
      if (!questId || !zone) break;
      const cooldown = (params.cooldown_s ?? 60) * 1000;
      const offers = ai.questOffers || (ai.questOffers = {});
      const players = [...zone.players].map(id => getLivePlayer(id)).filter(Boolean);
      for (const p of players) {
        const key = `${questId}:${p.id}`;
        if (Date.now() - (offers[key] || 0) < cooldown) continue;
        offers[key] = Date.now();
        dispatchAction({ type: 'START_QUEST', actor: p, params: { quest_id: questId } }).catch(() => {});
      }
      break;
    }

    case 'GO_HOME': {
      if (!ai) break;
      const home = entity.home_zone;
      if (!home || zoneId === home) break; // already home

      if (!ai.patrolPath.length || ai.patrolTarget !== home) {
        const path = findPath(zoneId, home, entity);
        if (!path || path.length < 2) return 'RUNNING';
        ai.patrolPath = path.slice(1);
        ai.patrolTarget = home;
      }

      const nextZone = ai.patrolPath.shift();
      if (!nextZone) return 'RUNNING';
      const moved = moveEntity(entity, nextZone, broadcast, query);
      if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
      return 'RUNNING';
    }

    case 'SET_FLAG': {
      if (!ai) break;
      if (params.scope === 'self') {
        ai.flags[params.flag] = params.value ?? 'true';
      }
      // world scope: would need async world_flags DB write — skip for now
      break;
    }

    case 'EMOTE': {
      const msg = params.message || '';
      if (!msg) break;
      // Emit the same shape as every other emote (formatChitchat, home-life) so
      // it renders in the shared dim-italic .msg-zone-event colour — not a
      // one-off inline yellow that made VINE emotes stand out from the rest.
      broadcast(zoneId, { type: 'zone_event', message: `${entity.name} ${msg}` });
      break;
    }

    // HAVE_LIFE: do a life activity — skipped when NPC is scheduled to work
    case 'HAVE_LIFE': {
      if (!ai) break;
      if (isNpcScheduledNow(entity.id)) {
        ai._lifeActivity = null; // clear so next off-schedule period re-rolls
        break;
      }
      // Studio actors off-shift never linger in the building: if still inside
      // the studio (same interior map as their studio zone), walk out to the
      // exterior world tile first, one step per tick, before any random life
      // activity begins. Once outside, this block is skipped and the normal
      // wander below takes over. Studio zone resolves via the broadcast bridge
      // (same lookup CHECK_WORK/AT_WORK use); non-studio NPCs skip it entirely.
      const studioZone = entity.studio_zone_id || getNpcStudioZone(entity.id);
      if (studioZone) {
        const sz = world.zones.get(studioZone);
        const cur = world.zones.get(zoneId);
        if (sz && cur && sz.map_id && cur.map_id === sz.map_id) {
          const exit = sz.flags?.world_exit_zone || exitTargets(sz, 'out')[0] || null;
          if (exit) {
            if (!ai.patrolPath.length || ai.patrolTarget !== exit) {
              const path = findPath(zoneId, exit, entity);
              if (path && path.length >= 2) {
                ai.patrolPath = path.slice(1);
                ai.patrolTarget = exit;
              }
            }
            const exitNext = ai.patrolPath.shift();
            if (exitNext) {
              const moved = moveEntity(entity, exitNext, broadcast, query);
              if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
              ai._lifeActivity = null; // re-roll wander once clear of the building
              break; // still exiting — don't start a life activity this tick
            }
          }
        }
      }
      // Small per-tick chance to emote or say a chitchat line, independent of movement.
      if (Date.now() - ai.lastSay > 20000 && Math.random() < 0.05) {
        ai.lastSay = Date.now();
        const line = pickChitchatLine(entity, 'life'); // HAVE_LIFE only runs off-shift
        broadcast(zoneId, line
          ? formatChitchat(entity.name, line)
          : { type: 'zone_event', message: `${entity.name} smokes a cigarette.` });
      }
      // Roll a random activity if none is set or we've arrived at the destination
      if (!ai._lifeActivity || (!ai.patrolPath.length && zoneId === ai.patrolTarget)) {
        ai._lifeActivity = Math.random() < 0.5 ? 'patrol' : 'home';
        ai.patrolPath = [];
        ai.patrolTarget = null;
      }
      let hlife_dest = null;
      if (ai._lifeActivity === 'home') {
        hlife_dest = entity.home_zone || null;
      } else {
        // patrol: pick a destination zone.
        // Unemployed NPCs with a haunt_zone (or haunt_zones array) prefer their hang-out spot 70% of the time.
        if (!ai.patrolTarget) {
          const hauntZone = entity.npc_type === 'unemployed'
            ? (Array.isArray(entity.flags?.haunt_zones) && entity.flags.haunt_zones.length
                ? entity.flags.haunt_zones[Math.floor(Math.random() * entity.flags.haunt_zones.length)]
                : (entity.flags?.haunt_zone || null))
            : null;

          if (hauntZone && Math.random() < 0.7) {
            ai.patrolTarget = hauntZone;
          } else {
            const safe = [];
            const safeOnly = entity.flags?.safe_zones_only;
            for (const [sid, sz] of world.zones) {
              if (sz.map_id !== 'map_world') continue;
              if (sz.flags?.is_interior || sz.flags?.is_apartment) continue;
              // Never TARGET an enterable facade — forwarding would strand the
              // wanderer in the lobby with `zoneId === patrolTarget` never true
              // (walking through one mid-path is fine and self-heals).
              if (isEnterableFacade(sz)) continue;
              // Inferred danger. (The old set included 'very_high'/'extreme',
              // values that never existed — lethal zones were never avoided.)
              if (safeOnly ? !isSanctuary(sz) : DANGER_RANK[zoneDanger(sz)] >= DANGER_RANK.high) continue;
              safe.push(sid);
            }
            ai.patrolTarget = safe.length ? safe[Math.floor(Math.random() * safe.length)] : entity.home_zone;
          }
        }
        hlife_dest = ai.patrolTarget;
      }
      if (!hlife_dest || zoneId === hlife_dest) { ai._lifeActivity = null; break; }
      if (!ai.patrolPath.length || ai.patrolTarget !== hlife_dest) {
        const path = findPath(zoneId, hlife_dest, entity);
        if (!path || path.length < 2) { ai._lifeActivity = null; break; }
        ai.patrolPath = path.slice(1);
        ai.patrolTarget = hlife_dest;
      }
      const hlife_next = ai.patrolPath.shift();
      if (hlife_next) {
        const moved = moveEntity(entity, hlife_next, broadcast, query);
        if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; ai._lifeActivity = null; }
      }
      break; // does NOT return RUNNING — graph continues to GO_TO_WORK each tick
    }

    // AT_WORK: hold at studio while scheduled; fall through when shift ends so graph routes to GO_HOME.
    case 'AT_WORK': {
      if (isNpcScheduledNow(entity.id)) {
        // On the clock at the studio — occasional WORK chitchat (venue/job flavour).
        if (ai && Date.now() - ai.lastSay > 20000 && Math.random() < 0.05) {
          ai.lastSay = Date.now();
          const line = pickChitchatLine(entity, 'work');
          if (line) broadcast(zoneId, formatChitchat(entity.name, line));
        }
        return 'RUNNING';
      }
      // Shift ended — fall through to 'next' so the graph can route to GO_HOME
      break;
    }

    // ── Vendor-specific actions ──────────────────────────────────────────────

    // CHECK_VENDOR_WORK: 4-way branch for any scheduled NPC's daily routine
    // (vendors and other employed NPCs alike — driven by entity.vendor_schedule).
    // Ports: goToWork | haveLife | endShift | offWork
    case 'CHECK_VENDOR_WORK': {
      const env = getEnvironmentState();
      const { working, dayHasSchedule, referenceRange } = isVendorWorkTime(entity, env);
      const hour = env.hour ?? 0;

      if (working) {
        if (!entity.work_zone_id) return 'haveLife';
        ai.vendor_was_working = true;
        return 'goToWork';
      }

      // Shift just ended
      if (ai.vendor_was_working) {
        ai.vendor_was_working = false;
        return 'endShift';
      }

      // Day off — use reference range to decide have-life vs off-work hours
      if (!dayHasSchedule && referenceRange) {
        const { from = 0, to = 24 } = referenceRange;
        if (hour >= from && hour < to) return 'haveLife';
      }

      return 'offWork';
    }

    // VENDOR_CHITCHAT: say a random chitchat line from entity.chitchat (60s cooldown).
    case 'VENDOR_CHITCHAT': {
      if (!ai) break;
      if (Date.now() - ai.lastSay < 60000) break;
      const line = pickChitchatLine(entity);
      if (!line) break;
      ai.lastSay = Date.now();
      broadcast(zoneId, formatChitchat(entity.name, line));
      break;
    }

    // AT_HOME_LIFE: NPC does home activities and can fall asleep until near their next shift.
    case 'AT_HOME_LIFE': {
      if (!ai) break;
      const zoneId = entityZone(entity);
      const now = Date.now();

      // Waking up from sleep — waitUntil was already cleared by the tick
      if (ai.homeSleeping) {
        ai.homeSleeping = false;
        setPosture(entity, 'standing');
        broadcast(zoneId, { type: 'zone_event', message: `${entity.name} stirs and wakes up.` });
        break;
      }

      // Activities are handled by the passive home-life ticker in tickEntityAI.
      // This node only manages the sleep cycle so the graph can loop back to check_work.

      // ~15% chance to fall asleep per tick
      if (Math.random() < 0.15) {
        const wakeMs = getNextShiftWakeMs(entity);
        if (wakeMs !== null && wakeMs > now + 120000) {
          // Find something to sleep on in the zone (prefer furniture, floor fallback)
          let bedName = null;
          try {
            const BED_WORDS = /\b(bed|cot|couch|mattress|sofa|futon|bunk|hammock)\b/i;
            const { rows: furnRows } = await query(
              `SELECT name FROM furniture WHERE zone_id=$1 LIMIT 20`, [zoneId]
            );
            const bedFurn = furnRows.find(f => BED_WORDS.test(f.name));
            if (bedFurn) bedName = bedFurn.name;
          } catch (_) {}
          const sleepOn = bedName ? `the ${bedName}` : 'the floor';
          ai.homeSleeping = true;
          ai.waitUntil = wakeMs;
          // Real posture, same substrate as players: lying, bound to the furniture
          // (sittingOn = furniture name, or null for the ground).
          setPosture(entity, 'lying', { sittingOn: bedName });
          broadcast(zoneId, { type: 'zone_event', message: `${entity.name} lies down on ${sleepOn} and falls asleep.` });
          return 'RUNNING';
        }
      }
      break;
    }

    // VENDOR_COLLECT_SAFE: find linked safe in work zone, take 25% of vendor_credits.
    case 'VENDOR_COLLECT_SAFE': {
      if (!ai) break;
      const workZone = entity.work_zone_id;
      if (!workZone) break;

      try {
        // Find the safe linked to this NPC in the work zone
        const { rows: safeRows } = await query(
          `SELECT id, flags FROM furniture WHERE zone_id=$1 AND flags @> $2 LIMIT 1`,
          [workZone, JSON.stringify({ vendor_safe: true, vendor_npc_id: entity.id })]
        );
        if (!safeRows.length) break;

        const { rows: npcRows } = await query(
          'SELECT vendor_credits FROM npcs WHERE id=$1', [entity.id]
        );
        if (!npcRows.length || !npcRows[0].vendor_credits) break;

        const total = npcRows[0].vendor_credits;
        const amount = Math.floor(total * 0.25);
        if (amount <= 0) break;

        await query('UPDATE npcs SET vendor_credits = vendor_credits - $1 WHERE id=$2', [amount, entity.id]);
        ai.vendor_carrying = amount;
        ai.vendor_atm_zone = null; // reset so VENDOR_GO_TO_ATM re-queries

        broadcast(workZone, {
          type: 'output',
          message: `<span style="color:var(--text-dim);font-style:italic">${entity.name} opens the safe, counts out their cut, and closes it again.</span>`,
        });
      } catch (e) {
        // Non-fatal — continue graph even if safe interaction fails
      }
      break;
    }

    // VENDOR_GO_TO_ATM: find nearest non-broken ATM and walk toward it. RUNNING until arrived.
    case 'VENDOR_GO_TO_ATM': {
      if (!ai) break;

      // Find nearest ATM zone if not already cached
      if (!ai.vendor_atm_zone) {
        try {
          const { rows: atmRows } = await query(
            `SELECT f.zone_id FROM furniture f
             JOIN atm_units a ON a.id = f.id
             WHERE f.flags @> '{"atm":true}' AND a.is_broken = 0`
          );
          const candidateZones = atmRows.map(r => r.zone_id).filter(Boolean);
          if (!candidateZones.length) break;

          // BFS to find closest
          let bestZone = null, bestDist = Infinity;
          for (const z of candidateZones) {
            const path = findPath(zoneId, z, entity);
            if (path && path.length - 1 < bestDist) {
              bestDist = path.length - 1;
              bestZone = z;
            }
          }
          if (!bestZone) break;
          ai.vendor_atm_zone = bestZone;
        } catch (e) {
          break;
        }
      }

      const atmZone = ai.vendor_atm_zone;
      if (!atmZone || zoneId === atmZone) {
        ai.vendor_atm_zone = null; // arrived — clear for next time
        break;
      }

      if (!ai.patrolPath.length || ai.patrolTarget !== atmZone) {
        const path = findPath(zoneId, atmZone, entity);
        if (!path || path.length < 2) return 'RUNNING';
        ai.patrolPath = path.slice(1);
        ai.patrolTarget = atmZone;
      }

      const nextZone = ai.patrolPath.shift();
      if (!nextZone) return 'RUNNING';
      const moved = moveEntity(entity, nextZone, broadcast, query);
      if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
      return 'RUNNING';
    }

    // VENDOR_DEPOSIT: add carried credits to vendor bank balance.
    case 'VENDOR_DEPOSIT': {
      if (!ai || ai.vendor_carrying <= 0) break;
      const amount = ai.vendor_carrying;
      try {
        await query(
          'UPDATE npcs SET vendor_bank_credits = vendor_bank_credits + $1 WHERE id=$2',
          [amount, entity.id]
        );
      } catch (e) {
        // Non-fatal
      }
      ai.vendor_carrying = 0;
      broadcast(zoneId, {
        type: 'output',
        message: `<span style="color:var(--text-dim);font-style:italic">${entity.name} finishes at the ATM terminal.</span>`,
      });
      break;
    }

    // Walk to the studio zone the NPC is scheduled at (derived from broadcast schedule)
    case 'GO_TO_STUDIO': {
      if (!ai) break;
      const studioZone = entity.studio_zone_id || getNpcStudioZone(entity.id);
      if (!studioZone || zoneId === studioZone) break; // already there or unscheduled

      if (!ai.patrolPath.length || ai.patrolTarget !== studioZone) {
        const path = findPath(zoneId, studioZone, entity);
        if (!path || path.length < 2) return 'RUNNING';
        ai.patrolPath = path.slice(1);
        ai.patrolTarget = studioZone;
      }

      const nextZone = ai.patrolPath.shift();
      if (!nextZone) return 'RUNNING';
      const moved = moveEntity(entity, nextZone, broadcast, query);
      if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
      return 'RUNNING';
    }

    // ── Talk-show guest lifecycle ────────────────────────────────────────────
    // The reusable guest lives off-world in a hidden backstage zone (entity.home_zone)
    // between episodes. When the show is on the clock it MATERIALISES into a random
    // unobserved zone near the studio (no players, no camera/sticky-cam watching) — so a
    // player never witnesses it "appear" — and the stock GO_TO_WORK then walks it onstage.
    case 'TALKSHOW_APPEAR': {
      if (!ai) break;
      const home = entity.home_zone;
      const here = entityZone(entity);
      if (!home || here !== home) break;   // already out in the world — commute handles the rest
      const studioZone = entity.work_zone_id || entity.studio_zone_id || getNpcStudioZone(entity.id);
      if (!studioZone) break;
      const origin = pickUnobservedZoneNear(studioZone, entity)
        || getZone(studioZone)?.flags?.world_exit_zone
        || exitTargets(getZone(studioZone), 'out')[0]
        || null;
      if (origin && origin !== home) {
        moveEntity(entity, origin, broadcast, query);   // non-adjacent → teleports it into the world
        ai.patrolPath = []; ai.patrolTarget = null;
      }
      break;   // next tick: GO_TO_WORK commutes it to the stage
    }

    // Off the clock: slip out and VANISH back to backstage the instant nobody's watching.
    // If standing somewhere unobserved, disappear now; otherwise walk one step toward the
    // studio's exterior (away from the on-camera stage) and re-check next tick.
    case 'TALKSHOW_HIDE': {
      if (!ai) break;
      const home = entity.home_zone;
      const here = entityZone(entity);
      if (!home || here === home) break;   // no backstage set, or already hidden
      if (!getZonePlayers(here).length && !isZoneWatched(here)) {
        moveEntity(entity, home, broadcast, query);     // unobserved → vanish to backstage
        ai.patrolPath = []; ai.patrolTarget = null;
        break;
      }
      const studioZone = entity.work_zone_id || entity.studio_zone_id || getNpcStudioZone(entity.id);
      const sz = studioZone ? getZone(studioZone) : null;
      const target = sz?.flags?.world_exit_zone || (sz ? exitTargets(sz, 'out')[0] : null) || null;
      if (target && here !== target) {
        if (!ai.patrolPath.length || ai.patrolTarget !== target) {
          const path = findPath(here, target, entity);
          if (path && path.length >= 2) { ai.patrolPath = path.slice(1); ai.patrolTarget = target; }
        }
        const nextZone = ai.patrolPath.shift();
        if (nextZone) { const moved = moveEntity(entity, nextZone, broadcast, query); if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; } }
        break;
      }
      // At/near the exit but still watched — drift to a neighbour and try again next tick.
      const nbs = neighborZoneIds(getZone(here)).filter(z => getZone(z));
      if (nbs.length) moveEntity(entity, nbs[Math.floor(Math.random() * nbs.length)], broadcast, query);
      break;
    }

    default: {
      const fn = pluginActions.get(type);
      if (fn) {
        try { return await fn(entity, params, { broadcast, query, ai, zone, zoneId, node }); }
        catch (e) { console.error(`[ai:action:${type}] ${e.message}`); }
      }
      break;
    }
  }
}

// ── Default vendor/schedule behaviour graph ──────────────────────────────────

/**
 * Auto-generate a default VINE-compatible behaviour graph for any NPC that
 * respects a manual vendor_schedule (vendors and other employed NPCs alike).
 * The vendor-only steps (collect_safe/go_to_atm/deposit) no-op harmlessly for
 * non-selling jobs with no linked safe. Broadcast actors use
 * buildDefaultStudioGraph() instead — they follow the broadcast schedule, not
 * a manual one. Stored in npcs.behaviour_graph and editable in the VINE editor.
 */
export function buildDefaultVendorGraph() {
  return {
    _start: 'start',
    nodes: {
      start:          { type: 'start', next: 'check_work' },
      check_work:     { type: 'action', action_type: 'CHECK_VENDOR_WORK',
                        goToWork: 'go_to_work', haveLife: 'have_life',
                        endShift: 'collect_safe', offWork: 'off_home_check' },
      go_to_work:     { type: 'action', action_type: 'GO_TO_WORK', next: 'work_wait' },
      work_wait:      { type: 'wait', seconds: 60, next: 'player_check' },
      player_check:   { type: 'condition', condition_type: 'PLAYER_IN_ZONE',
                        ifTrue: 'work_say', ifFalse: 'check_work' },
      work_say:       { type: 'action', action_type: 'VENDOR_CHITCHAT', next: 'check_work' },
      have_life:      { type: 'action', action_type: 'HAVE_LIFE', next: 'check_work' },
      collect_safe:   { type: 'action', action_type: 'VENDOR_COLLECT_SAFE', next: 'go_to_atm' },
      go_to_atm:      { type: 'action', action_type: 'VENDOR_GO_TO_ATM', next: 'atm_emote' },
      atm_emote:      { type: 'action', action_type: 'EMOTE',
                        params: { message: 'steps up to the ATM terminal and makes a deposit.' },
                        next: 'atm_wait' },
      atm_wait:       { type: 'wait', seconds: 10, next: 'deposit' },
      deposit:        { type: 'action', action_type: 'VENDOR_DEPOSIT', next: 'post_shift' },
      post_shift:     { type: 'random', branches: [{ weight: 1 }, { weight: 5 }],
                        branch_0: 'have_life', branch_1: 'go_home_ps' },
      go_home_ps:     { type: 'action', action_type: 'GO_HOME', next: 'home_life_ps' },
      home_life_ps:   { type: 'action', action_type: 'AT_HOME_LIFE', next: 'check_work' },
      off_home_check: { type: 'condition', condition_type: 'AT_HOME',
                        ifTrue: 'home_idle', ifFalse: 'off_random' },
      home_idle:      { type: 'action', action_type: 'AT_HOME_LIFE', next: 'check_work' },
      off_random:     { type: 'random', branches: [{ weight: 1 }, { weight: 5 }],
                        branch_0: 'have_life', branch_1: 'go_home_off' },
      go_home_off:    { type: 'action', action_type: 'GO_HOME', next: 'check_work' },
    },
  };
}

/**
 * Default behaviour graph for studio NPCs (broadcast staff with no custom graph).
 * AT_WORK holds RUNNING while scheduled; when the shift ends it falls through to GO_HOME.
 */
export function buildDefaultStudioGraph() {
  return {
    _start: 'start',
    nodes: {
      start:      { type: 'start', next: 'have_life' },
      have_life:  { type: 'action', action_type: 'HAVE_LIFE',   next: 'go_to_work' },
      go_to_work: { type: 'action', action_type: 'GO_TO_WORK',  next: 'at_work' },
      at_work:    { type: 'action', action_type: 'AT_WORK',     next: 'go_home' },
      go_home:    { type: 'action', action_type: 'GO_HOME',     next: 'home_wait' },
      home_wait:  { type: 'wait', seconds: 60, next: 'start' },
    },
  };
}

/**
 * Default behaviour graph for unemployed NPCs.
 * Loops HAVE_LIFE indefinitely. When at home, AT_HOME_LIFE handles the sleep cycle.
 * Wandering destination is weighted toward flags.haunt_zone / flags.haunt_zones.
 */
export function buildDefaultUnemployedGraph() {
  return {
    _start: 'start',
    nodes: {
      start:      { type: 'start', next: 'have_life' },
      have_life:  { type: 'action', action_type: 'HAVE_LIFE', next: 'home_check' },
      home_check: { type: 'condition', condition_type: 'AT_HOME', ifTrue: 'home_idle', ifFalse: 'have_life' },
      home_idle:  { type: 'action', action_type: 'AT_HOME_LIFE', next: 'have_life' },
    },
  };
}

/**
 * Default combat behaviour graph for auto-aggressive enemies (behavior
 * 'aggressive' / 'territorial'). Target *acquisition* is deliberately left to the
 * engine substrate — the escalating-aggro + battlecry ramp in gameLoop still owns
 * "when the fight starts" (and keeps the telegraph). Once a target exists, the
 * graph owns the fight: attack, but break off and flee below 20% HP. This mirrors
 * the hardcoded fallback while adding the flee branch, and every part of it is now
 * editable per-enemy in the VINE editor.
 */
export function buildDefaultAggressiveEnemyGraph() {
  return {
    _start: 'start',
    nodes: {
      start:      { type: 'start', next: 'has_target' },
      has_target: { type: 'condition', condition_type: 'HAS_TARGET', ifTrue: 'low_hp', ifFalse: 'idle' },
      low_hp:     { type: 'condition', condition_type: 'HP_BELOW', params: { pct: 20 }, ifTrue: 'flee', ifFalse: 'attack' },
      flee:       { type: 'action', action_type: 'FLEE',   next: 'loop' },
      attack:     { type: 'action', action_type: 'ATTACK', next: 'loop' },
      idle:       { type: 'action', action_type: 'IDLE',   next: 'loop' },
      loop:       { type: 'loop', next: 'start' },
    },
  };
}

/**
 * Belt-and-suspenders: make sure an entity ticks through VINE rather than the
 * hardcoded fallback, by assigning a type-appropriate default graph when it has
 * none. Mirrors the auto-assign already done for NPCs at apiCreateNpc, extended to
 * cover enemies (which had no auto-assign) and to self-heal legacy graphless rows
 * at load. Returns true if a default was assigned.
 *
 * Intentionally conservative — leaves untouched:
 *   • entities that already carry a graph (authored or previously defaulted);
 *   • `_phantom` opt-outs (e.g. trip-plugin phantoms);
 *   • non-aggressive enemies (passive/defensive never auto-acquire — the benign
 *     fallback is correct for them);
 *   • plain untyped 'npc' extras / static set-pieces (only vendors, employed,
 *     unemployed and studio actors are meant to be autonomous).
 *
 * `kind` ('enemy' | 'npc') is inferred from instanceId when omitted, but callers
 * acting on template rows (pre-instance) should pass it explicitly.
 */
export function ensureBehaviourGraph(entity, kind) {
  if (!entity) return false;
  const g = entity.behaviour_graph;
  if (g && (g._start || Object.keys(g).length)) return false; // already has a graph
  if (entity.flags?._phantom) return false;                    // deliberately inert

  const isEnemyEntity = kind ? kind === 'enemy' : entity.instanceId != null;

  if (isEnemyEntity) {
    if (entity.behavior === 'aggressive' || entity.behavior === 'territorial') {
      entity.behaviour_graph = buildDefaultAggressiveEnemyGraph();
      return true;
    }
    return false;
  }

  const isActor = !!entity.studio_zone_id;
  const autonomous = isActor || entity.npc_type === 'unemployed'
    || entity.npc_type === 'vendor' || !!entity.work_zone_id;
  if (!autonomous) return false;
  entity.behaviour_graph = entity.npc_type === 'unemployed'
    ? buildDefaultUnemployedGraph()
    : isActor ? buildDefaultStudioGraph() : buildDefaultVendorGraph();
  return true;
}

// ── Main tick ────────────────────────────────────────────────────────────────

const MAX_STEPS = 50;

let _espShelterActive = false;
export function setEspShelter(active) { _espShelterActive = !!active; }

export async function tickEntityAI(entity, ctx) {
  // Normalize DB format (inline connections + flat data) to runtime format on first tick
  if (entity.behaviour_graph && !entity.behaviour_graph._normalized) {
    entity.behaviour_graph = normalizeGraph(entity.behaviour_graph);
  }
  const graph = entity.behaviour_graph;
  if (!graph || !graph._start) return;

  const ai = entity._ai;
  if (!ai) return;

  // Not placed in any zone — an unplaced entity has no room to act in. Ticking it
  // anyway makes zone-scoped broadcasts (SAY/EMOTE/home-life) fall through to a
  // null zone, which the server treats as a global send — so its lines leak to
  // every connected player. Skip it until it's given a zone.
  if (!entityZone(entity)) return;

  // A break-in alarm (burglary plugin) has taken this NPC over — it drives the
  // panic cop-call / flee sequence directly. Suspend the normal graph (and the
  // passive home-life below) until the plugin clears the flag.
  if (ai.alarm) return;

  // Don't tick while a player has this NPC's shop open.
  if (ai.shopPaused) return;

  // Passive home life — any NPC in their home zone does random activities when players are watching.
  // Skipped while homeSleeping (the NPC is visibly asleep; AT_HOME_LIFE owns that state).
  if (!isEnemy(entity) && !ai.homeSleeping && entity.home_zone && entityZone(entity) === entity.home_zone) {
    const now = Date.now();
    if ((now - (ai.lastHomeSay || 0)) > 30000) {
      const playersHere = getZonePlayers(entityZone(entity));
      if (playersHere.length && Math.random() < 0.3) {
        ai.lastHomeSay = now;
        const pool = (Array.isArray(entity.home_activities) && entity.home_activities.length)
          ? entity.home_activities : DEFAULT_HOME_ACTIVITIES;
        const act = pool[Math.floor(Math.random() * pool.length)];
        const { type: actType, message: actMsg } = formatChitchat(entity.name, act);
        ctx.broadcast(entityZone(entity), { type: actType, message: actMsg });
      } else if (playersHere.length) {
        ai.lastHomeSay = now;
      }
    }
  }

  // ESP: override all NPC behaviour — route everyone home until stand-down.
  if (_espShelterActive && !isEnemy(entity) && entity.home_zone) {
    const zoneId = entityZone(entity);
    if (zoneId !== entity.home_zone) {
      if (!ai.patrolPath.length || ai.patrolTarget !== entity.home_zone) {
        const path = findPath(zoneId, entity.home_zone, entity);
        if (path && path.length >= 2) { ai.patrolPath = path.slice(1); ai.patrolTarget = entity.home_zone; }
      }
      const next = ai.patrolPath.shift();
      if (next) {
        const moved = moveEntity(entity, next, ctx.broadcast, ctx.query);
        if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
      }
    }
    return;
  }

  // Studio actors NEVER linger in their workspace off-shift — enforced here, before
  // and independent of whatever behaviour graph the NPC carries, so there are no
  // exceptions: an active scheduled slot is the ONLY thing that keeps an actor in the
  // studio. Any actor sitting in (or anywhere inside) their studio while unscheduled is
  // walked out toward the exterior, one step per tick, and the graph is skipped until
  // they're clear of the building.
  if (!isEnemy(entity)) {
    const studioZone = entity.studio_zone_id || getNpcStudioZone(entity.id);
    if (studioZone && !isNpcScheduledNow(entity.id)) {
      const hereId = entityZone(entity);
      const cur = world.zones.get(hereId);
      const sz  = world.zones.get(studioZone);
      const insideStudio = hereId === studioZone
        || (cur && sz && sz.map_id && cur.map_id === sz.map_id && cur.flags?.is_interior);
      if (insideStudio && sz) {
        // Prefer the building's declared exterior seam, then an `out` exit, then home —
        // home_zone guarantees a reachable target so an actor is never trapped on set.
        const dest = sz.flags?.world_exit_zone || exitTargets(sz, 'out')[0] || entity.home_zone || null;
        if (dest && hereId !== dest) {
          if (!ai.patrolPath.length || ai.patrolTarget !== dest) {
            const path = findPath(hereId, dest, entity);
            if (path && path.length >= 2) { ai.patrolPath = path.slice(1); ai.patrolTarget = dest; }
          }
          const next = ai.patrolPath.shift();
          if (next) {
            const moved = moveEntity(entity, next, ctx.broadcast, ctx.query);
            if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
          }
          return; // evacuating — skip the graph this tick
        }
      }
    }
  }

  // Check if suspended in a WAIT — currentNode already points to the resume target
  if (ai.waitUntil && Date.now() < ai.waitUntil) return;
  ai.waitUntil = null;

  const nodes = graph.nodes;
  if (!nodes) return;
  const edges = graph.edges || [];

  // Resume from cursor if set, else restart from _start
  let nodeId = ai.currentNode || graph._start;
  ai.currentNode = null; // clear — will be re-set if execution suspends

  let steps = 0;

  while (nodeId && steps++ < MAX_STEPS) {
    const node = nodes[nodeId];
    if (!node) break;

    switch (node.type) {
      case 'start':
        nodeId = resolveEdge(edges, nodeId, 'next');
        break;

      case 'condition': {
        const result = evalCondition(node, entity);
        nodeId = resolveEdge(edges, nodeId, result ? 'ifTrue' : 'ifFalse');
        break;
      }

      case 'action': {
        const result = await execAction(node, entity, ctx);
        // RUNNING: stay at this node next tick. A string result (other than RUNNING) names
        // the outgoing port to follow (e.g. CHECK_WORK's 'goToWork'/'haveLife'). Anything
        // else (true/false/undefined from ordinary actions) falls back to the 'next' port.
        ai.currentNode = (result === 'RUNNING')
          ? nodeId
          : resolveEdge(edges, nodeId, typeof result === 'string' ? result : 'next');
        return;
      }

      case 'wait': {
        const seconds = node.data?.seconds ?? 1;
        ai.waitUntil = Date.now() + seconds * 1000;
        ai.currentNode = resolveEdge(edges, nodeId, 'next'); // resume here after wait
        return;
      }

      case 'loop': {
        // Explicit jump — follow 'next' edge or fall back to _start
        nodeId = resolveEdge(edges, nodeId, 'next') || graph._start;
        break;
      }

      case 'random': {
        const branches = node.data?.branches || [];
        if (!branches.length) { nodeId = null; break; }
        const totalWeight = branches.reduce((s, b) => s + (b.weight ?? 1), 0);
        let roll = Math.random() * totalWeight;
        let chosen = 0;
        for (let i = 0; i < branches.length; i++) {
          roll -= branches[i].weight ?? 1;
          if (roll <= 0) { chosen = i; break; }
        }
        nodeId = resolveEdge(edges, nodeId, `branch_${chosen}`);
        break;
      }

      default:
        nodeId = null;
    }
  }
  // Natural end or MAX_STEPS — currentNode stays null, next tick restarts from _start
}
