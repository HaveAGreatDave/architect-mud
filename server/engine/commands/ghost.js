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
  broadcast(null, { type: 'system', message: `<span style="color:#9f7aea;font-style:italic">${hauntMsg}</span>` }, null, target.id);
  await query('UPDATE players SET sanity = GREATEST(0, sanity - 10) WHERE id=$1', [target.id]);
  if (target.sanity !== undefined) target.sanity = Math.max(0, target.sanity - 10);
  return { type: 'ghost_haunt_result', message: `Phantom sent to ${target.handle}.` };
}
