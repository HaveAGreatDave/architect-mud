import { world, getLivePlayer, getDoorForExit, setDoorCache } from './world.js';
import { findPath, getZonesInRadius } from './pathfinding.js';
import { enemyAttackPlayer } from './combat.js';
import { getEnvironmentState } from './environment.js';
import { emit } from './events.js';
import { hasChannelViewers } from './broadcast-bridge.js';

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
function moveEntity(entity, newZoneId, broadcast, query) {
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
  const arriveFrom = arriveDir === 'up' ? 'below' : arriveDir === 'down' ? 'above' : arriveDir ? `the ${arriveDir}` : null;
  const arriveMsg = arriveFrom ? `${entity.name} arrives from ${arriveFrom}.` : `${entity.name} arrives.`;

  if (isEnemy(entity)) {
    world.zones.get(oldZoneId)?.enemies.delete(entity.instanceId);
    entity.zoneId = newZoneId;
    world.zones.get(newZoneId)?.enemies.add(entity.instanceId);
    broadcast(newZoneId, { type: 'zone_event', message: arriveMsg, refresh: true });
    broadcast(oldZoneId, { type: 'zone_event', message: departMsg, refresh: true });
  } else {
    world.zones.get(oldZoneId)?.npcs.delete(entity.id);
    entity.zone_id = newZoneId;
    world.zones.get(newZoneId)?.npcs.add(entity.id);
    broadcast(newZoneId, { type: 'zone_event', message: arriveMsg, refresh: true });
    broadcast(oldZoneId, { type: 'zone_event', message: departMsg, refresh: true });
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
    const { type, next, ifTrue, ifFalse, _vine, ...fields } = node;

    if (next)    edges.push({ fromNode: id, fromPort: 'next',    toNode: next });
    if (ifTrue)  edges.push({ fromNode: id, fromPort: 'ifTrue',  toNode: ifTrue });
    if (ifFalse) edges.push({ fromNode: id, fromPort: 'ifFalse', toNode: ifFalse });

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

    case 'HOUR_RANGE': {
      const { hour } = getEnvironmentState();
      if (hour == null) return false;
      const from = params.from ?? 0, to = params.to ?? 23;
      return from <= to ? (hour >= from && hour <= to) : (hour >= from || hour <= to);
    }

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
          broadcast(null, { type: 'combat_incoming', message: result.message, damage: result.damage, hp: target.hp, hp_max: target.hp_max }, null, target.id);
          if (target.hp <= 0) {
            const { handlePlayerDeath } = await import('./gameLoop.js');
            await handlePlayerDeath(target, entity);
          } else {
            if (!target.combatTargetId) target.combatTargetId = entity.instanceId;
          }
        } else {
          broadcast(null, { type: 'combat_miss', message: result.message }, null, entity.targetId);
        }
      }).catch(() => {});
      break;
    }

    case 'ACQUIRE_TARGET': {
      if (!zone || zone.players.size === 0) break;
      const players = [...zone.players].map(id => getLivePlayer(id)).filter(Boolean);
      if (!players.length) break;
      if (params.prefer === 'lowest_hp') {
        players.sort((a, b) => a.hp - b.hp);
        entity.targetId = players[0].id;
      } else {
        entity.targetId = players[Math.floor(Math.random() * players.length)].id;
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

    case 'SAY': {
      if (!ai) break;
      const msg = params.message || '';
      if (!msg) break;
      const cooldown = (params.cooldown_s ?? 30) * 1000;
      if (params.once && ai.lastSay > 0) break;
      if (Date.now() - ai.lastSay < cooldown) break;
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
      if (!zone_id || arrive_by == null) break;

      // Already at work — let graph continue to work activity nodes
      if (zoneId === zone_id) break;

      const path = findPath(zoneId, zone_id);
      if (!path || path.length < 2) return 'RUNNING'; // unreachable — hold and retry

      const { minutes } = getEnvironmentState();
      const travelMinutes = path.length - 1;
      const arriveByMinutes = (arrive_by * 60) - depart_early_minutes;
      const departMinutes = (arriveByMinutes - travelMinutes + 1440) % 1440;
      const minutesUntilDept = (departMinutes - minutes + 1440) % 1440;

      // Not time to leave yet — hold here so work activities don't start early
      if (minutesUntilDept > travelMinutes + 5) return 'RUNNING';

      // Time to commute — step one zone toward destination
      if (!ai.patrolPath.length || ai.patrolTarget !== zone_id) {
        ai.patrolPath = path.slice(1);
        ai.patrolTarget = zone_id;
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

    case 'BROADCAST_SAY': {
      const { channel_id, text } = params;
      if (!text || !channel_id) break;
      emit('npc.broadcast_say', { entity, channel_id, text: `[${entity.name}] ${text}` });
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

    default:
      break;
  }
}

// ── Main tick ────────────────────────────────────────────────────────────────

const MAX_STEPS = 50;

export async function tickEntityAI(entity, ctx) {
  // Normalize DB format (inline connections + flat data) to runtime format on first tick
  if (entity.behaviour_graph && !entity.behaviour_graph._normalized) {
    entity.behaviour_graph = normalizeGraph(entity.behaviour_graph);
  }
  const graph = entity.behaviour_graph;
  if (!graph || !graph._start) return;

  const ai = entity._ai;
  if (!ai) return;

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
        // RUNNING: stay at this node next tick. Otherwise advance cursor.
        ai.currentNode = (result === 'RUNNING')
          ? nodeId
          : resolveEdge(edges, nodeId, 'next');
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
