import { world, getLivePlayer, getDoorForExit, setDoorCache, getZone, getZonePlayers } from './world.js';
import { findPath, getZonesInRadius } from './pathfinding.js';
import { enemyAttackPlayer, enemyAttackNpc, enemyAttackEnemy } from './combat.js';
import { getEnvironmentState } from './environment.js';
import { emit } from './events.js';
import { dispatchAction } from './actions.js';
import { hasChannelViewers, isNpcScheduledNow, getNpcStudioZone } from './broadcast-bridge.js';
import { getShopperForNpc, closeShopSession } from './vendor-session.js';
import { getNpcChitchat } from './npc-personality.js';

// ── Vendor schedule helpers ──────────────────────────────────────────────────

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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

// Returns the ms timestamp to wake up before the next scheduled shift, or null.
function getNextShiftWakeMs(entity) {
  const schedule = entity.vendor_schedule;
  const now = Date.now();
  if (schedule && Object.keys(schedule).length) {
    for (let dayOffset = 0; dayOffset <= 6; dayOffset++) {
      const checkDate = new Date(now + dayOffset * 86400000);
      const dayKey = DAY_KEYS[checkDate.getDay()]; // 0=Sun…6=Sat maps to DAY_KEYS
      const blocks = schedule[dayKey] || [];
      for (const block of blocks) {
        const shiftStartMs = new Date(checkDate).setHours(block.from ?? 10, 0, 0, 0);
        const wakeMs = shiftStartMs - 60 * 60 * 1000; // 1 hour before shift
        if (wakeMs > now + 120000) return wakeMs;
      }
    }
  }
  // No vendor schedule — wake at 7am
  const tomorrow = new Date(now);
  if (new Date(now).getHours() >= 7) tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(7, 0, 0, 0);
  return tomorrow.getTime() > now + 120000 ? tomorrow.getTime() : null;
}

// Format a chitchat line the same way as enemy battlecries:
//   "quoted text"  → yellow say bubble    e.g. "You need something?"
//   unquoted text  → zone_event emote      e.g. drums fingers on the counter.
export function formatChitchat(name, line) {
  const t = line.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    return { type: 'output', message: `<span style="color:var(--yellow)">${name} says: ${t}</span>` };
  }
  return { type: 'zone_event', message: `${name} ${t}` };
}

function pickChitchatLine(entity) {
  // NPC's own chitchat override, else the archetype default (getNpcChitchat).
  // Enemies have no personality archetype, so this falls through to their own
  // chitchat array or null.
  const lines = getNpcChitchat(entity) || (Array.isArray(entity.chitchat) ? entity.chitchat : []);
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

const OPPOSITE_DIR = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up', in:'out', out:'in' };

// Returns true if the move succeeded, false if blocked by a locked door.
export function moveEntity(entity, newZoneId, broadcast, query) {
  const oldZoneId = entityZone(entity);
  if (oldZoneId === newZoneId) return true;

  const departDir = exitDirection(oldZoneId, newZoneId);

  // ── Door handling ────────────────────────────────────────────────────────────
  let doorWasClosed = false;
  if (departDir) {
    const door = getDoorForExit(oldZoneId, departDir)
              || getDoorForExit(newZoneId, OPPOSITE_DIR[departDir])
              || null;

    if (door && door.hp > 0) {
      if (door.lock_state === 'locked') return false; // blocked — entity can't pass

      if (!door.is_open) {
        doorWasClosed = true;
        door.is_open = 1;
        setDoorCache(door.id, door);
        if (query) query('UPDATE doors SET is_open=1 WHERE id=$1', [door.id]).catch(() => {});
        broadcast(oldZoneId, { type: 'zone_event', message: `${entity.name} opens the door.` });
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

  if (isEnemy(entity)) {
    world.zones.get(oldZoneId)?.enemies.delete(entity.instanceId);
    entity.zoneId = newZoneId;
    world.zones.get(newZoneId)?.enemies.add(entity.instanceId);
    broadcast(newZoneId, { type: 'zone_event', message: arriveMsg, refresh: true });
    broadcast(oldZoneId, { type: 'zone_event', message: departMsg, refresh: true });
  } else {
    // If a player has this NPC's shop open, close it before the NPC leaves.
    const shopperId = getShopperForNpc(entity.id);
    if (shopperId) {
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
    const homeDoor = getDoorForExit(newZoneId, OPPOSITE_DIR[departDir])
                  || getDoorForExit(oldZoneId, departDir)
                  || null;
    if (homeDoor && homeDoor.tags && Object.keys(homeDoor.tags).some(k => k.startsWith('lock:'))) {
      homeDoor.is_open = 0;
      homeDoor.lock_state = 'locked';
      setDoorCache(homeDoor.id, homeDoor);
      if (query) query("UPDATE doors SET is_open=0, lock_state='locked' WHERE id=$1", [homeDoor.id]).catch(() => {});
      broadcast(newZoneId, { type: 'zone_event', message: `The lock clicks as ${entity.name} secures the door.` });
    }
  }

  // Close the door behind them
  if (doorWasClosed) {
    const door = getDoorForExit(oldZoneId, departDir)
              || getDoorForExit(newZoneId, OPPOSITE_DIR[departDir]);
    if (door) {
      door.is_open = 0;
      setDoorCache(door.id, door);
      if (query) query('UPDATE doors SET is_open=0 WHERE id=$1', [door.id]).catch(() => {});
      broadcast(newZoneId, { type: 'zone_event', message: 'The door closes behind them.' });
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
  const exits = world.zones.get(fromZoneId)?.exits || {};
  return Object.keys(exits).find(dir => exits[dir] === toZoneId) || null;
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
      const target = getLivePlayer(entity.targetId);
      if (!target) return false;
      return target.faction === params.faction;
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

    case 'CHANNEL_HAS_VIEWERS':
      return hasChannelViewers(params.channel_id);

    // True if the NPC is in an active daily schedule slot right now
    case 'IS_BROADCAST_SCHEDULED':
      return isNpcScheduledNow(entity.id);

    // True if the NPC is already in their assigned studio zone
    case 'AT_WORK_ZONE': {
      const studioZone = entity.studio_zone_id || getNpcStudioZone(entity.id);
      return studioZone ? zoneId === studioZone : false;
    }

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

    default:
      return false;
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
        if (isEnemy(entity) === false && query) {
          query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [target, entity.id]).catch(() => {});
        }
        break;
      }

      // Walk mode: BFS path, step one zone per tick
      if (!ai.patrolPath.length || ai.patrolTarget !== target) {
        const path = findPath(zoneId, target);
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
        if (!isEnemy(entity) && query) {
          query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [entityZone(entity), entity.id]).catch(() => {});
        }
        return 'RUNNING'; // still en route — stay at PATROL node next tick
      }
      break;
    }

    case 'FLEE': {
      if (!ai) break;
      const targetPlayer = getLivePlayer(entity.targetId);
      const targetZoneId = targetPlayer?.current_zone;
      const exits = Object.values(zone?.exits || {});
      if (!exits.length) break;

      // Move to any adjacent zone that doesn't contain the target
      const safeExits = exits.filter(z => z !== targetZoneId);
      const dest = safeExits.length
        ? safeExits[Math.floor(Math.random() * safeExits.length)]
        : exits[Math.floor(Math.random() * exits.length)];

      const moved = moveEntity(entity, dest, broadcast, query);
      if (!moved) break; // locked door — stay put
      if (!isEnemy(entity) && query) {
        query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [entityZone(entity), entity.id]).catch(() => {});
      }
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
      const exits = Object.values(curZone?.exits || {});
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
      if (!isEnemy(entity) && query) {
        query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [dest, entity.id]).catch(() => {});
      }
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
        const path = findPath(zoneId, workZone);
        if (!path || path.length < 2) return 'RUNNING'; // unreachable — hold and retry
        const { minutes } = getEnvironmentState();
        const travelMinutes = path.length - 1;
        const arriveByMinutes = (arrive_by * 60) - depart_early_minutes;
        const departMinutes = (arriveByMinutes - travelMinutes + 1440) % 1440;
        const minutesUntilDept = (departMinutes - minutes + 1440) % 1440;
        // Not time to leave yet — hold here so work activities don't start early
        if (minutesUntilDept > travelMinutes + 5) return 'RUNNING';
      }

      // Time to commute — step one zone toward destination
      if (!ai.patrolPath.length || ai.patrolTarget !== workZone) {
        const path = findPath(zoneId, workZone);
        if (!path || path.length < 2) return 'RUNNING';
        ai.patrolPath = path.slice(1);
        ai.patrolTarget = workZone;
        ai.patrolMode = 'walk';
      }
      const nextZone = ai.patrolPath[0];
      if (!nextZone) return 'RUNNING';
      ai.patrolPath.shift();
      const moved = moveEntity(entity, nextZone, broadcast, query);
      if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
      else if (!isEnemy(entity) && query) {
        query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [entityZone(entity), entity.id]).catch(() => {});
      }
      return 'RUNNING';
    }

    // CHECK_WORK: branch to goToWork or haveLife based on the NPC's current schedule.
    case 'CHECK_WORK': {
      const studioZone = entity.studio_zone_id || getNpcStudioZone(entity.id);
      if (!studioZone) return 'haveLife';
      return isNpcScheduledNow(entity.id) ? 'goToWork' : 'haveLife';
    }

    case 'BROADCAST_SAY': {
      const { channel_id, text } = params;
      if (!text || !channel_id) break;
      emit('npc.broadcast_say', { entity, channel_id, text: `[${entity.name}] ${text}` });
      break;
    }

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
        const path = findPath(zoneId, home);
        if (!path || path.length < 2) return 'RUNNING';
        ai.patrolPath = path.slice(1);
        ai.patrolTarget = home;
      }

      const nextZone = ai.patrolPath.shift();
      if (!nextZone) return 'RUNNING';
      const moved = moveEntity(entity, nextZone, broadcast, query);
      if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
      else if (!isEnemy(entity) && query) {
        query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [entityZone(entity), entity.id]).catch(() => {});
      }
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
      broadcast(zoneId, {
        type: 'output',
        message: `<span style="color:var(--yellow)">${entity.name} ${msg}</span>`,
      });
      break;
    }

    // HAVE_LIFE: do a life activity — skipped when NPC is scheduled to work
    case 'HAVE_LIFE': {
      if (!ai) break;
      if (isNpcScheduledNow(entity.id)) {
        ai._lifeActivity = null; // clear so next off-schedule period re-rolls
        break;
      }
      // Small per-tick chance to emote or say a chitchat line, independent of movement.
      if (Date.now() - ai.lastSay > 20000 && Math.random() < 0.05) {
        ai.lastSay = Date.now();
        const line = pickChitchatLine(entity);
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
            const HIGH_DANGER = new Set(['high', 'very_high', 'extreme']);
            for (const [sid, sz] of world.zones) {
              if (sz.map_id !== 'map_world') continue;
              if (sz.flags?.is_interior || sz.flags?.is_apartment) continue;
              if (safeOnly ? !sz.is_safe_zone : HIGH_DANGER.has(sz.danger_rating)) continue;
              safe.push(sid);
            }
            ai.patrolTarget = safe.length ? safe[Math.floor(Math.random() * safe.length)] : entity.home_zone;
          }
        }
        hlife_dest = ai.patrolTarget;
      }
      if (!hlife_dest || zoneId === hlife_dest) { ai._lifeActivity = null; break; }
      if (!ai.patrolPath.length || ai.patrolTarget !== hlife_dest) {
        const path = findPath(zoneId, hlife_dest);
        if (!path || path.length < 2) { ai._lifeActivity = null; break; }
        ai.patrolPath = path.slice(1);
        ai.patrolTarget = hlife_dest;
      }
      const hlife_next = ai.patrolPath.shift();
      if (hlife_next) {
        const moved = moveEntity(entity, hlife_next, broadcast, query);
        if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; ai._lifeActivity = null; }
        else if (!isEnemy(entity) && query) {
          query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [entityZone(entity), entity.id]).catch(() => {});
        }
      }
      break; // does NOT return RUNNING — graph continues to GO_TO_WORK each tick
    }

    // AT_WORK: hold at studio while scheduled; fall through when shift ends so graph routes to GO_HOME.
    case 'AT_WORK': {
      if (isNpcScheduledNow(entity.id)) return 'RUNNING';
      // Shift ended — fall through to 'next' so the graph can route to GO_HOME
      break;
    }

    // ── Vendor-specific actions ──────────────────────────────────────────────

    // CHECK_VENDOR_WORK: 4-way branch for vendor NPC daily routine.
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
        broadcast(zoneId, { type: 'zone_event', message: `${entity.name} stirs and wakes up.` });
        break;
      }

      // Activities are handled by the passive home-life ticker in tickEntityAI.
      // This node only manages the sleep cycle so the graph can loop back to check_work.

      // ~15% chance to fall asleep per tick
      if (Math.random() < 0.15) {
        const wakeMs = getNextShiftWakeMs(entity);
        if (wakeMs !== null && wakeMs > now + 120000) {
          // Find something to sleep on in the zone
          let sleepOn = 'the floor';
          try {
            const BED_WORDS = /\b(bed|cot|couch|mattress|sofa|futon|bunk|hammock)\b/i;
            const { rows: furnRows } = await query(
              `SELECT name FROM furniture WHERE zone_id=$1 LIMIT 20`, [zoneId]
            );
            const bedFurn = furnRows.find(f => BED_WORDS.test(f.name));
            if (bedFurn) sleepOn = `the ${bedFurn.name.toLowerCase()}`;
          } catch (_) {}
          ai.homeSleeping = true;
          ai.waitUntil = wakeMs;
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
            const path = findPath(zoneId, z);
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
        const path = findPath(zoneId, atmZone);
        if (!path || path.length < 2) return 'RUNNING';
        ai.patrolPath = path.slice(1);
        ai.patrolTarget = atmZone;
      }

      const nextZone = ai.patrolPath.shift();
      if (!nextZone) return 'RUNNING';
      const moved = moveEntity(entity, nextZone, broadcast, query);
      if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
      else if (query) {
        query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [entityZone(entity), entity.id]).catch(() => {});
      }
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
        const path = findPath(zoneId, studioZone);
        if (!path || path.length < 2) return 'RUNNING';
        ai.patrolPath = path.slice(1);
        ai.patrolTarget = studioZone;
      }

      const nextZone = ai.patrolPath.shift();
      if (!nextZone) return 'RUNNING';
      const moved = moveEntity(entity, nextZone, broadcast, query);
      if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
      else if (!isEnemy(entity) && query) {
        query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [entityZone(entity), entity.id]).catch(() => {});
      }
      return 'RUNNING';
    }

    default:
      break;
  }
}

// ── Default vendor behaviour graph ───────────────────────────────────────────

/**
 * Auto-generate a default VINE-compatible behaviour graph for vendor NPCs.
 * Stored in npcs.behaviour_graph and editable in the VINE editor.
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
        const path = findPath(zoneId, entity.home_zone);
        if (path && path.length >= 2) { ai.patrolPath = path.slice(1); ai.patrolTarget = entity.home_zone; }
      }
      const next = ai.patrolPath.shift();
      if (next) {
        const moved = moveEntity(entity, next, ctx.broadcast, ctx.query);
        if (!moved) { ai.patrolPath = []; ai.patrolTarget = null; }
        else if (ctx.query) ctx.query('UPDATE npcs SET zone_id=$1 WHERE id=$2', [entityZone(entity), entity.id]).catch(() => {});
      }
    }
    return;
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
