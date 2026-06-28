import { getZone, getLivePlayer, getAllLivePlayers } from '../world.js';
import { describeZone } from './describe.js';
import { query } from '../../models/db.js';

const HAUNT_MESSAGES = [
  'An icy breath curls across your neck. There is nobody there.',
  'The shadows shift at the edge of your vision. Something ancient regards you with interest.',
  'A chill passes through your body from the inside out. The air tastes of static and old graves.',
  'The hairs on the back of your neck stand up. The feeling of being watched does not pass.',
  'Something invisible drifts through you. For one terrible moment you forget your own name.',
  'Your reflection blinks a half-second too late.',
  'The temperature drops three degrees. The warmth does not return.',
  'You hear your name spoken softly, just once, in a voice you don\'t recognise. Nobody is there.',
];

const GHOST_LIGHT_ON_MESSAGES = [
  'The lights come on by themselves. Nobody touched the switch.',
  'A light flickers to life. The switch did not move.',
  'The room brightens without warning. There is no one near the fixture.',
  'Something turns the light on. The switch clicks on its own.',
  'The bulb comes on. An invisible hand must have found the switch in the dark.',
  'Light fills the room, sudden and unexplained.',
];

const GHOST_LIGHT_OFF_MESSAGES = [
  'The lights go out. Nobody touched the switch.',
  'Darkness drops over the room without warning.',
  'Something kills the light. The switch clicked, but no hand was on it.',
  'The room goes dark. A cold stillness settles in after.',
  'The light dies. In the silence that follows, something feels closer.',
  'Without warning, the lights cut out.',
];

const GHOST_AMBIENT_MESSAGES = [
  'A presence moves through the room. You see nothing.',
  'Something stirs in the air, restless and unseen.',
  'The hairs on your arms stand up for no reason you can explain.',
  'A faint disturbance ripples through the space around you.',
  'The shadows seem to shift, as if something passed through them.',
  'An inexplicable chill settles over the area.',
  'You feel briefly, intensely observed. The feeling passes.',
  'The air pressure changes for just a moment, then returns to normal.',
  'Something brushes past you. There is nothing there.',
  'A low, sourceless sound — less heard than felt — moves through the room.',
  'The light flickers almost imperceptibly.',
  'The silence thickens for a moment before easing.',
  'You sense a presence just beyond the edge of perception.',
  'An old instinct fires: run. Then it subsides. Nothing is there.',
  'The atmosphere shifts, as if the room is holding its breath.',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomGhostAmbient(originalMsg) {
  if (originalMsg) {
    const m = String(originalMsg);
    if (/flickers on|comes on|lit up/i.test(m)) return pick(GHOST_LIGHT_ON_MESSAGES);
    if (/goes dark|turns off|cut out/i.test(m))  return pick(GHOST_LIGHT_OFF_MESSAGES);
  }
  return pick(GHOST_AMBIENT_MESSAGES);
}

// Wraps the real broadcast so any zone-visible action by a ghost reaches
// other players only as an anonymous eerie disturbance — no name, no details.
export function makeGhostBroadcast(realBroadcast, ghostPlayerId) {
  return function ghostBroadcast(zoneId, msg, excludePlayerId, targetPlayerId) {
    // Targeted messages (whispers etc.) — suppress entirely for ghosts.
    if (targetPlayerId && targetPlayerId !== ghostPlayerId) return;
    // Zone-wide action by the ghost: replace content with eerie feeling.
    if (zoneId && excludePlayerId === ghostPlayerId) {
      const ghostMsg = { type: 'zone_event', message: randomGhostAmbient(msg.message) };
      if (msg.refresh) ghostMsg.refresh = true;
      realBroadcast(zoneId, ghostMsg, ghostPlayerId);
      return;
    }
    // Anything else (e.g. broadcast TO the ghost themselves) passes through.
    realBroadcast(zoneId, msg, excludePlayerId, targetPlayerId);
  };
}

export async function cmdGhostLook(session) {
  const zone = getZone(session.ghostZoneId);
  if (!zone) return { type: 'ghost_error', message: 'Zone not found.' };
  const player = getLivePlayer(session.playerId) || { id: session.playerId, handle: session.handle, current_zone: session.ghostZoneId };
  const message = await describeZone(zone, player);
  return { type: 'ghost_look', message, zone: zone.id, zoneName: zone.name };
}

export async function cmdGhostMove(direction, session) {
  const zone = getZone(session.ghostZoneId);
  if (!zone) return { type: 'ghost_error', message: 'Zone not found.' };
  const targetId = zone.exits?.[direction];
  if (!targetId) {
    const cardinal = ['north', 'south', 'east', 'west'].includes(direction);
    return { type: 'ghost_error', message: cardinal ? `No exit to the ${direction}.` : `No exit ${direction}.` };
  }
  const targetZone = getZone(targetId);
  if (!targetZone) return { type: 'ghost_error', message: 'That exit leads nowhere.' };
  session.ghostZoneId = targetId;
  const player = getLivePlayer(session.playerId) || { id: session.playerId, handle: session.handle, current_zone: targetId };
  const message = await describeZone(targetZone, player);
  return { type: 'ghost_look', message, zone: targetId, zoneName: targetZone.name };
}

export async function cmdGhostHaunt(targetHandle, session, broadcast) {
  const target = getAllLivePlayers().find(p => p.handle.toLowerCase() === targetHandle.toLowerCase());
  if (!target) return { type: 'ghost_error', message: `${targetHandle} is not online.` };
  const hauntMsg = HAUNT_MESSAGES[Math.floor(Math.random() * HAUNT_MESSAGES.length)];
  broadcast(null, { type: 'ambient', message: `<span style="color:#9f7aea;font-style:italic">${hauntMsg}</span>` }, null, target.id);
  await query('UPDATE players SET sanity = GREATEST(0, sanity - 10) WHERE id=$1', [target.id]);
  if (target.sanity !== undefined) target.sanity = Math.max(0, target.sanity - 10);
  return { type: 'ghost_haunt_result', message: `Phantom sent to ${target.handle}.` };
}
