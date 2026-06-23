import { query } from '../../models/db.js';
import { getZone, getMinimapData, addPlayerToZone, removePlayerFromZone } from '../world.js';
import { getZoneVisibility, getWindowsForZone } from '../environment.js';
import { describeZone, resolveNamedDestination } from './describe.js';

const RAW_DIRECTIONS = ['north', 'south', 'east', 'west', 'up', 'down', 'in', 'out'];

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

async function cmdLook(player, targetStr) {
  if (!targetStr || targetStr === 'room' || targetStr === 'around') {
    const zone = getZone(player.current_zone);
    if (!zone) return { type:'error', message:'You are nowhere. This is a bug.' };
    return { type:'look', message: await describeZone(zone, player), minimap: getMinimapData(zone.id) };
  }
  const inMatch = targetStr.match(/^in\s+(.+)$/i);
  if (inMatch) {
    const { cmdLookInContainer } = await import('./inventory.js');
    return cmdLookInContainer(inMatch[1], player);
  }
  if (targetStr === 'me' || targetStr === 'self' || targetStr === 'myself') {
    let msg = `${player.handle}\n${player.origin_fragment || 'A survivor. Still standing, somehow.'}`;
    if (player.visibly_mutated) msg += `\n<span class="mutation-tag">Whatever's changed about you, it shows.</span>`;
    return { type:'examine', message: msg };
  }
  const throughMatch = targetStr.match(/^(?:through\s+)?(.+)$/i);
  const windowTarget = throughMatch?.[1] || targetStr;
  const windows = getWindowsForZone(player.current_zone);
  const win = windows.find(w => w.name.toLowerCase().includes(windowTarget.toLowerCase()));
  if (win || /^(through|window|peer)/.test(targetStr)) {
    if (!win) return { type:'examine', message:`You don't see a window here.` };
    return cmdLookThroughWindow(win, player);
  }
  return cmdExamineFallback(targetStr, player);
}

// Thin fallback so "look <thing>" works without a circular import with world.js
async function cmdExamineFallback(targetStr, player) {
  const { handlers: worldH } = await import('./world.js');
  return worldH.examine([targetStr], `examine ${targetStr}`, player, () => {});
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

async function cmdMove(direction, player, broadcast) {
  if (!direction) return { type:'error', message:'Go where? (north, south, east, west, up, down)' };
  const zone = getZone(player.current_zone);
  if (!zone) return { type:'error', message:'Your zone is missing.' };
  const targetId = zone.exits[direction];
  if (!targetId) return { type:'error', message:`No exit to the ${direction}.` };
  const targetZone = getZone(targetId);
  if (!targetZone) return { type:'error', message:'That exit leads nowhere yet.' };

  removePlayerFromZone(player.id, player.current_zone);
  addPlayerToZone(player.id, targetId);
  player.current_zone = targetId;
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [targetId, player.id]);

  const OPPOSITE = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up', in:'out', out:'in' };
  const arrivalDir = OPPOSITE[direction] || null;

  broadcast(zone.id, { type:'zone_event', message:`${player.handle} heads ${direction}.` }, player.id);
  broadcast(targetId, { type:'zone_event', message: arrivalDir
    ? `${player.handle} arrives from the ${arrivalDir}.`
    : `${player.handle} arrives.` }, player.id);

  let radGain = 0;
  if (targetZone.radiation_level > 0) {
    radGain = Math.floor(targetZone.radiation_level * 0.1);
    if (radGain > 0) {
      player.radiation = Math.min(100, (player.radiation||0) + radGain);
      await query('UPDATE players SET radiation=$1 WHERE id=$2', [player.radiation, player.id]);
    }
  }
  return { type:'move', message:await describeZone(targetZone, player), zone:targetId, radiation_gain:radGain, minimap: getMinimapData(targetId) };
}

async function cmdMap(player) {
  const { getAllZones } = await import('../world.js');
  const current = getZone(player.current_zone);
  if (!current || !current.map_id || current.grid_x == null || current.grid_y == null) {
    return { type:'map', tiles: [] };
  }
  const onMap = getAllZones().filter(z =>
    z.map_id === current.map_id &&
    z.grid_z === current.grid_z &&
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

export const handlers = {
  look:  (args, raw, player, broadcast) => cmdLook(player, args.length ? args.join(' ') : undefined),
  l:     (args, raw, player, broadcast) => cmdLook(player, args.length ? args.join(' ') : undefined),
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
  map:   (args, raw, player) => cmdMap(player),
};
