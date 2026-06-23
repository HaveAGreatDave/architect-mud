import { query } from '../../models/db.js';
import { relieveBladder, relieveBowels } from '../bodily.js';

async function hasFacilityNearby(zoneId) {
  const { rows } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND object_type='toilet' LIMIT 1`,
    [zoneId]
  );
  return rows.length > 0;
}

async function cmdPee(player, broadcast) {
  const hasFacility = await hasFacilityNearby(player.current_zone);
  const result = await relieveBladder(player, hasFacility, broadcast);
  return { type: result.ok ? 'output' : 'error', message: result.message };
}

async function cmdPoop(player, broadcast) {
  const hasFacility = await hasFacilityNearby(player.current_zone);
  const result = await relieveBowels(player, hasFacility, broadcast);
  return { type: result.ok ? 'output' : 'error', message: result.message };
}

async function cmdFlush(args, player) {
  const { rows } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND object_type='toilet' LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return { type:'error', message:`There's no toilet here to flush.` };
  return { type:'output', message:`You flush. The sound is deeply satisfying.` };
}

export const handlers = {
  pee:      (args, raw, player, broadcast) => cmdPee(player, broadcast),
  urinate:  (args, raw, player, broadcast) => cmdPee(player, broadcast),
  piss:     (args, raw, player, broadcast) => cmdPee(player, broadcast),
  poop:     (args, raw, player, broadcast) => cmdPoop(player, broadcast),
  defecate: (args, raw, player, broadcast) => cmdPoop(player, broadcast),
  shit:     (args, raw, player, broadcast) => cmdPoop(player, broadcast),
  flush:    (args, raw, player, broadcast) => cmdFlush(args, player),
};
