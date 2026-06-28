import { query } from '../../models/db.js';
import { getZone, getMinimapData, addPlayerToZone, removePlayerFromZone, getDoorForExit, setDoorCache, getAllLivePlayers, getLivePlayer, getZoneEnemies } from '../world.js';
import { getZoneVisibility, getWindowsForZone, getEnvironmentState, getZoneTemperature } from '../environment.js';
import { describeZone, resolveNamedDestination } from './describe.js';
import { checkLockAuth, getLockTagPublic } from './doors.js';

const RAW_DIRECTIONS = ['north', 'south', 'east', 'west', 'up', 'down', 'in', 'out', 'exit'];

async function cmdLookThroughWindow(win, player) {
  if (!win.curtain_open && win.glass_state !== 'broken') {
    return { type:'examine', message:`The curtains are drawn. You can't see through ${win.name}.` };
  }
  const vis = getZoneVisibility(player.current_zone);
  if (vis.visibility < 0.1 && !win.zone_exterior) {
    return { type:'examine', message:`It's too dark on your side to make anything out through ${win.name}.` };
  }
  if (!win.zone_exterior) {
    const { getHUDPayload } = await import('../environment.js');
    const env = getHUDPayload();
    const weatherDesc = { clear:'clear skies', cloudy:'overcast skies', overcast:'heavy overcast', rain:'rain falling steadily', thunderstorm:'a thunderstorm raging overhead', storm:'a raging storm', snow:'snow coming down', blizzard:'a blinding blizzard', fog:'thick fog rolling in', haze:'a heavy haze in the air', ash:'ash falling from the sky' }[env.weatherType] || env.weatherType;
    return { type:'examine', message:`Through ${win.name} you see ${weatherDesc} outside. It is ${env.time}, ${env.season}.${win.glass_state === 'broken' ? ' Cold air drifts in through the broken glass.' : ''}` };
  }
  const otherZone = getZone(win.zone_exterior);
  if (!otherZone) return { type:'examine', message:`You peer through ${win.name} but can't make out what's on the other side.` };
  const otherVis = getZoneVisibility(win.zone_exterior);
  if (otherVis.category === 'pitch_dark') {
    return { type:'examine', message:`Through ${win.name} you can see ${otherZone.name}, but it's completely dark in there.` };
  }
  return { type:'examine', message:`Through ${win.name} you can see into <span style="color:var(--accent)">${otherZone.name}</span>:\n${otherZone.description}` };
}

function cmdLookSky(player) {
  let env;
  try { env = getEnvironmentState(); } catch { env = {}; }
  const vis = getZoneVisibility(player.current_zone);

  const zone = getZone(player.current_zone);
  const isIndoor = !!(zone?.flags?.is_interior || zone?.flags?.is_apartment);
  if (isIndoor) {
    const ceilingLines = [
      "You stare at the ceiling. It stares back. Neither of you blink.",
      "It's a ceiling. Flat. Featureless. Deeply unimpressive. You've seen better.",
      "You look up. Ceiling. No sky. This is what happens when you live indoors.",
      "The ceiling offers no weather information. It is simply there, being a ceiling.",
      "You crane your neck upward. Yep. That's a ceiling alright. Mystery solved.",
      "Sky unavailable in this location. Please proceed to an exit and try again.",
      "A ceiling. Possibly the same ceiling as before. You can't be sure.",
    ];
    return { type: 'examine', message: ceilingLines[Math.floor(Math.random() * ceilingLines.length)] };
  }

  if (vis.category === 'pitch_dark') return { type: 'examine', message: "It's too dark to see the sky." };
  const weatherLines = {
    clear: 'The sky is clear, a vast expanse stretching overhead.',
    cloudy: 'Clouds drift across the sky, patchy and slow.',
    overcast: 'A heavy overcast blankets everything above, flat and grey.',
    rain: 'Dark clouds hang low, rain falling steadily from them.',
    sleet: 'An ugly mix of sleet and rain falls from a leaden sky.',
    thunderstorm: 'Angry storm clouds roil overhead, lit from within by lightning.',
    storm: 'The sky is a churning mass of dark cloud. The storm is fierce.',
    snow: 'Pale grey clouds fill the sky, sending snow drifting down.',
    blizzard: 'A white-grey wall of blowing snow swallows the sky entirely.',
    fog: 'Thick fog diffuses what little light there is. The sky is invisible.',
    haze: 'A dirty haze sits over everything, muting the sky to a dull brown-grey.',
    ash: 'Ash falls from a rust-coloured sky. The air tastes of smoke.',
  };
  const base = weatherLines[env.weatherType] || 'You look up at the sky.';
  const timeNote = env.timePhase ? ` It is ${env.timePhase}.` : '';
  const tempNote = env.tempC !== undefined ? ` The temperature is ${Math.round(env.tempC)}°C.` : '';
  return { type: 'examine', message: base + timeNote + tempNote };
}

async function cmdLookGround(player) {
  const vis = getZoneVisibility(player.current_zone);
  if (vis.category === 'pitch_dark') return { type: 'examine', message: "It's too dark to make out the ground." };
  const zone = getZone(player.current_zone);
  const base = zone ? `You look at the ground around you in ${zone.name}.` : 'You look at the ground.';
  const { rows } = await query(
    `SELECT pi.id, i.name, i.rarity FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id = $1 AND pi.container_id IS NULL LIMIT 10`,
    [`_ground_${player.current_zone}`]
  );
  if (!rows.length) return { type: 'examine', message: `${base} Nothing of note lies here.` };
  const itemList = rows.map(r => r.name).join(', ');
  return { type: 'examine', message: `${base} On the ground: ${itemList}.` };
}

function cmdLookDistance(player) {
  const vis = getZoneVisibility(player.current_zone);
  if (vis.category === 'pitch_dark') return { type: 'examine', message: "It's too dark to make out anything in the distance." };
  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'examine', message: 'You see nothing in the distance.' };
  const exits = Object.entries(zone.exits || {});
  if (!exits.length) return { type: 'examine', message: 'No obvious exits lead away from here.' };
  const parts = exits.map(([dir, id]) => {
    const z = getZone(id);
    return z ? `to the ${dir}: ${z.name}` : `to the ${dir}: somewhere`;
  });
  return { type: 'examine', message: `Looking into the distance you can make out — ${parts.join('; ')}.` };
}

async function cmdLook(player, targetStr, broadcast) {
  if (targetStr === 'sky' || targetStr === 'up') return cmdLookSky(player);
  if (targetStr === 'ground' || targetStr === 'down') return cmdLookGround(player);
  if (targetStr === 'distance' || targetStr === 'out') return cmdLookDistance(player);
  if (!targetStr || targetStr === 'room' || targetStr === 'around') {
    const zone = getZone(player.current_zone);
    if (!zone) return { type:'error', message:'You are nowhere. This is a bug.' };
    return { type:'look', message: await describeZone(zone, player), zone: zone.id, minimap: getMinimapData(zone.id) };
  }
  const inMatch = targetStr.match(/^in\s+(.+)$/i);
  if (inMatch) {
    const { cmdLookInContainer } = await import('./inventory.js');
    return cmdLookInContainer(inMatch[1], player);
  }
  if (targetStr === 'me' || targetStr === 'self' || targetStr === 'myself') {
    return cmdExamineFallback(targetStr, player, broadcast);
  }
  const throughMatch = targetStr.match(/^(?:through\s+)?(.+)$/i);
  const windowTarget = throughMatch?.[1] || targetStr;
  const windows = getWindowsForZone(player.current_zone);
  const win = windows.find(w => w.name.toLowerCase().includes(windowTarget.toLowerCase()));
  if (win || /^(through|window|peer)/.test(targetStr)) {
    if (!win) return { type:'examine', message:`You don't see a window here.` };
    return cmdLookThroughWindow(win, player);
  }
  return cmdExamineFallback(targetStr, player, broadcast);
}

// Thin fallback so "look <thing>" works without a circular import with world.js
async function cmdExamineFallback(targetStr, player, broadcast) {
  const { handlers: worldH } = await import('./world.js');
  return worldH.examine([targetStr], `examine ${targetStr}`, player, broadcast || (() => {}));
}

async function cmdGo(argText, player, broadcast) {
  if (!argText) return { type: 'error', message: 'Go where? (north, south, east, west, up, down, in, out — or a building/room name)' };
  if (RAW_DIRECTIONS.includes(argText)) return cmdMove(argText, player, broadcast);
  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'error', message: 'Your zone is missing.' };
  const resolved = resolveNamedDestination(zone, argText);
  if (resolved.type === 'unique') return cmdMove(resolved.match.direction, player, broadcast);
  if (resolved.type === 'ambiguous') {
    const names = resolved.candidates.map(c => c.name).join(', ');
    return { type: 'error', message: `That could mean several things here: ${names}. Try being more specific.` };
  }
  return cmdMove(argText, player, broadcast);
}

function buildBattleCryMessages(enemies, playerHandle) {
  // Group enemies by templateId, keeping one representative per type
  const byType = new Map();
  for (const e of enemies) {
    if (!byType.has(e.templateId)) byType.set(e.templateId, { enemy: e, count: 0 });
    byType.get(e.templateId).count++;
  }

  const lines = [];
  for (const { enemy, count } of byType.values()) {
    const cries = enemy.flags?.battle_cries;
    if (!Array.isArray(cries) || !cries.length) continue;
    const cry = cries[Math.floor(Math.random() * cries.length)];
    const plural = count > 1;
    const typeName = plural ? `${enemy.name}s` : enemy.name;

    // Replace $enemy and $player tokens, then fix possessives
    const forPlayer = cry
      .replace(/\$enemy/g, typeName)
      .replace(/\$player/g, 'you')
      .replace(/\b[Hh]is\b|\b[Hh]ers\b|\b[Ii]ts\b/g, m => plural ? (m[0] === m[0].toUpperCase() ? 'Their' : 'their') : m)
      .replace(/\b[Hh]er\b/g, m => plural ? (m[0] === m[0].toUpperCase() ? 'Their' : 'their') : m);
    const forBystander = cry
      .replace(/\$enemy/g, typeName)
      .replace(/\$player/g, playerHandle)
      .replace(/\b[Hh]is\b|\b[Hh]ers\b|\b[Ii]ts\b/g, m => plural ? (m[0] === m[0].toUpperCase() ? 'Their' : 'their') : m)
      .replace(/\b[Hh]er\b/g, m => plural ? (m[0] === m[0].toUpperCase() ? 'Their' : 'their') : m);

    lines.push({ forPlayer, forBystander });
  }
  return lines;
}

async function cmdMove(direction, player, broadcast) {
  if (!direction) return { type:'error', message:'Go where? (north, south, east, west, up, down)' };
  const zone = getZone(player.current_zone);
  if (!zone) return { type:'error', message:'Your zone is missing.' };
  let targetId = zone.exits[direction];
  if (!targetId && (direction === 'in' || direction === 'out' || direction === 'exit')) {
    const exitEntries = Object.entries(zone.exits || {});
    if (exitEntries.length === 1) {
      direction = exitEntries[0][0];
      targetId = exitEntries[0][1];
    }
  }
  if (!targetId) {
    const cardinal = ['north', 'south', 'east', 'west'].includes(direction);
    return { type:'error', message: cardinal ? `No exit to the ${direction}.` : `No exit ${direction}.` };
  }
  const targetZone = getZone(targetId);
  if (!targetZone) return { type:'error', message:'That exit leads nowhere yet.' };

  const OPPOSITE = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up', in:'out', out:'in' };
  let doorWasClosed = false;
  let doorWasLocked = false;
  // Door may be on either side: in this zone going out, or in the target zone going back
  let door = getDoorForExit(zone.id, direction) || getDoorForExit(targetId, OPPOSITE[direction]) || null;
  if (door && door.hp > 0) {
    if (door.lock_state === 'locked') {
      const lockTag = getLockTagPublic(door);
      const canPass = lockTag && await checkLockAuth(lockTag, door, player);
      if (!canPass) return { type:'error', message:`The door to the ${direction} is locked.` };
      doorWasLocked = true;
    }
    if (!door.is_open) {
      doorWasClosed = true;
      door.is_open = 1;
      setDoorCache(door.id, door);
      await query('UPDATE doors SET is_open=1 WHERE id=$1', [door.id]);
    }
  }

  const oldZoneId = player.current_zone;
  const followers = getAllLivePlayers().filter(p => p.following === player.id && p.current_zone === oldZoneId);

  removePlayerFromZone(player.id, player.current_zone);
  addPlayerToZone(player.id, targetId);
  player.current_zone = targetId;
  player.combatTargetId = null;
  player.sitting = false;
  if (player.pvpTargetId) {
    const opponent = getLivePlayer(player.pvpTargetId);
    if (opponent) {
      opponent.pvpTargetId = null;
      broadcast(null, { type: 'output', message: `${player.handle} flees the fight. Combat ends.` }, null, opponent.id);
    }
    player.pvpTargetId = null;
  }
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [targetId, player.id]);

  const arrivalDir = OPPOSITE[direction] || null;

  const hadDoor = !!(door && door.hp > 0);
  const lockTag = hadDoor ? getLockTagPublic(door) : null;

  const departMsg = doorWasLocked
    ? `The lock disengages. ${player.handle} opens the door and heads ${direction}.`
    : doorWasClosed
      ? `${player.handle} opens the door and heads ${direction}.`
      : `${player.handle} heads ${direction}.`;
  const arriveMsg = (doorWasLocked || doorWasClosed)
    ? (arrivalDir ? `${player.handle} comes through the door from the ${arrivalDir}.` : `${player.handle} comes through the door.`)
    : (arrivalDir ? `${player.handle} arrives from the ${arrivalDir}.` : `${player.handle} arrives.`);
  broadcast(zone.id, { type:'zone_event', message: departMsg, refresh: true }, player.id);
  broadcast(targetId, { type:'zone_event', message: arriveMsg, refresh: true }, player.id);

  // Close (and re-lock if locked) the door behind the player
  if (hadDoor && doorWasClosed) {
    door.is_open = 0;
    if (doorWasLocked) {
      door.lock_state = 'locked';
      setDoorCache(door.id, door);
      await query('UPDATE doors SET is_open=0,lock_state=\'locked\' WHERE id=$1', [door.id]);
      broadcast(zone.id, { type:'zone_event', message:'The door swings closed and locks.' }, player.id);
      broadcast(targetId, { type:'zone_event', message:'The door swings closed and locks.' }, player.id);
    } else {
      setDoorCache(door.id, door);
      await query('UPDATE doors SET is_open=0 WHERE id=$1', [door.id]);
      broadcast(zone.id, { type:'zone_event', message:'The door swings closed.' }, player.id);
      broadcast(targetId, { type:'zone_event', message:'The door swings closed.' }, player.id);
    }
  }

  let radGain = 0;
  if (targetZone.radiation_level > 0) {
    radGain = Math.floor(targetZone.radiation_level * 0.1);
    if (radGain > 0) {
      player.radiation = Math.min(100, (player.radiation||0) + radGain);
      await query('UPDATE players SET radiation=$1 WHERE id=$2', [player.radiation, player.id]);
    }
  }
  const zoneDesc = await describeZone(targetZone, player);

  const destName = targetZone.name;
  let narration;
  if (doorWasLocked) {
    const unlockMsg = lockTag?.messages?.unlock ?? 'The lock disengages.';
    const closeMsg = doorWasClosed ? ' It swings closed and locks behind you.' : '';
    narration = `→ ${unlockMsg} You open the door ${direction} into ${destName}.${closeMsg}`;
  } else if (doorWasClosed) {
    narration = `→ You open the door ${direction} into ${destName}. It swings closed behind you.`;
  } else {
    narration = `→ You head ${direction} to ${destName}.`;
  }

  // Battle cries: one per enemy type in the destination zone
  const arrivedEnemies = getZoneEnemies(targetId);
  if (arrivedEnemies.length) {
    const cryLines = buildBattleCryMessages(arrivedEnemies, player.handle);
    for (const { forPlayer, forBystander } of cryLines) {
      broadcast(null, { type: 'zone_event', message: `<span class="battle-cry">${forPlayer}</span>` }, null, player.id);
      broadcast(targetId, { type: 'zone_event', message: `<span class="battle-cry">${forBystander}</span>` }, player.id);
    }
  }

  for (const follower of followers) {
    const followerResult = await cmdMove(direction, follower, broadcast);
    if (followerResult) broadcast(null, followerResult, null, follower.id);
  }

  return { type:'move', message:zoneDesc, narration, zone:targetId, direction, radiation_gain:radGain, minimap: getMinimapData(targetId), tempC: getZoneTemperature(targetId) };
}

function cmdFollow(args, player, broadcast) {
  if (!args.length) {
    if (!player.following) return { type: 'output', message: 'You are not following anyone.' };
    player.following = null;
    return { type: 'output', message: 'You stop following.' };
  }
  const targetHandle = args.join(' ').toLowerCase();
  const target = getAllLivePlayers().find(p => p.handle.toLowerCase() === targetHandle && p.id !== player.id);
  if (!target) return { type: 'error', message: `No player named "${args.join(' ')}" is online.` };
  player.following = target.id;
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} starts following ${target.handle}.` }, player.id);
  return { type: 'output', message: `You are now following ${target.handle}. Type "follow" with no arguments to stop.` };
}

function cmdUnfollow(player, broadcast) {
  if (!player.following) return { type: 'output', message: 'You are not following anyone.' };
  player.following = null;
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} stops following.` }, player.id);
  return { type: 'output', message: 'You stop following.' };
}

const MAP_DIR_OFFSET = { north:[0,-1], south:[0,1], east:[1,0], west:[-1,0] };

async function cmdMap(player) {
  const { getAllZones } = await import('../world.js');
  const current = getZone(player.current_zone);
  if (!current) return { type:'map', tiles: [] };

  // Placed zone: show all rooms on the same map/floor using grid coords.
  if (current.map_id && current.grid_x != null && current.grid_y != null) {
    const currentZ = current.grid_z ?? 0;
    const onMap = getAllZones().filter(z =>
      z.map_id === current.map_id &&
      (z.grid_z ?? 0) === currentZ &&
      z.grid_x != null && z.grid_y != null);
    const placed = new Set(onMap.map(z => z.id));
    const tiles = onMap.map(z => {
      const links = {};
      for (const [dir, target] of Object.entries(z.exits || {})) {
        if (placed.has(target)) links[dir] = target;
      }
      return {
        id: z.id, x: z.grid_x, y: z.grid_y, name: z.name,
        danger: z.danger_rating || null, marker: z.marker || null,
        color: z.color || null, bg_color: z.bg_color || null,
        exits: links, isCurrent: z.id === player.current_zone,
      };
    });
    return { type:'map', tiles };
  }

  // Unplaced zone: BFS outward up to 8 hops using cardinal exits to compute a virtual grid.
  const coords = new Map([[player.current_zone, [0, 0]]]);
  const dist = new Map([[player.current_zone, 0]]);
  const queue = [player.current_zone];
  while (queue.length) {
    const id = queue.shift();
    if (dist.get(id) >= 8) continue;
    const zone = getZone(id);
    if (!zone) continue;
    const [cx, cy] = coords.get(id);
    for (const [dir, targetId] of Object.entries(zone.exits || {})) {
      if (coords.has(targetId)) continue;
      const off = MAP_DIR_OFFSET[dir];
      if (!off) continue;
      coords.set(targetId, [cx + off[0], cy + off[1]]);
      dist.set(targetId, dist.get(id) + 1);
      queue.push(targetId);
    }
  }
  const visited = new Set(coords.keys());
  const tiles = [];
  for (const [id, [x, y]] of coords) {
    const zone = getZone(id);
    if (!zone) continue;
    const links = {};
    for (const [dir, target] of Object.entries(zone.exits || {})) {
      if (visited.has(target) && MAP_DIR_OFFSET[dir]) links[dir] = target;
    }
    tiles.push({
      id, x, y, name: zone.name,
      danger: zone.danger_rating || null, marker: zone.marker || null,
      color: zone.color || null, bg_color: zone.bg_color || null,
      exits: links, isCurrent: id === player.current_zone,
    });
  }
  return { type:'map', tiles };
}

export const handlers = {
  look:  (args, raw, player, broadcast) => cmdLook(player, args.length ? args.join(' ') : undefined, broadcast),
  l:     (args, raw, player, broadcast) => cmdLook(player, args.length ? args.join(' ') : undefined, broadcast),
  go:    (args, raw, player, broadcast) => cmdGo(args.join(' '), player, broadcast),
  move:  (args, raw, player, broadcast) => cmdGo(args.join(' '), player, broadcast),
  enter: (args, raw, player, broadcast) => cmdGo(args.join(' '), player, broadcast),
  north: (args, raw, player, broadcast) => cmdMove('north', player, broadcast),
  n:     (args, raw, player, broadcast) => cmdMove('north', player, broadcast),
  south: (args, raw, player, broadcast) => cmdMove('south', player, broadcast),
  s:     (args, raw, player, broadcast) => cmdMove('south', player, broadcast),
  east:  (args, raw, player, broadcast) => cmdMove('east', player, broadcast),
  e:     (args, raw, player, broadcast) => cmdMove('east', player, broadcast),
  west:  (args, raw, player, broadcast) => cmdMove('west', player, broadcast),
  w:     (args, raw, player, broadcast) => cmdMove('west', player, broadcast),
  up:    (args, raw, player, broadcast) => cmdMove('up', player, broadcast),
  u:     (args, raw, player, broadcast) => cmdMove('up', player, broadcast),
  down:  (args, raw, player, broadcast) => cmdMove('down', player, broadcast),
  d:     (args, raw, player, broadcast) => cmdMove('down', player, broadcast),
  in:    (args, raw, player, broadcast) => cmdMove('in', player, broadcast),
  out:   (args, raw, player, broadcast) => cmdMove('out', player, broadcast),
  exit:  (args, raw, player, broadcast) => cmdMove('exit', player, broadcast),
  map:      (args, raw, player) => cmdMap(player),
  follow:   (args, raw, player, broadcast) => cmdFollow(args, player, broadcast),
  unfollow: (args, raw, player, broadcast) => cmdUnfollow(player, broadcast),
};
