import { query } from '../../models/db.js';
import { relieveBladder, relieveBowels } from '../bodily.js';
import { isMisActive } from '../mis.js';

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

// `use toilet` or `sit` — describes the toilet and provides contextual actions
async function cmdUseToilet(player) {
  const { rows } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND object_type='toilet' LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return null;

  const t = rows[0];
  const peeLink   = `<span class="action-link" data-action="pee" data-target="">pee</span>`;
  const poopLink  = `<span class="action-link" data-action="poop" data-target="">poop</span>`;
  const flushLink = `<span class="action-link" data-action="flush" data-target="">flush</span>`;

  let msg = `${t.name}\n${t.description}`;
  msg += `\n<span class="text-dim">Actions:</span> ${peeLink}  ${poopLink}  ${flushLink}`;

  if (isMisActive(player)) {
    msg += `\n<span class="text-dim">The stall offers a moment of total privacy.</span>`;
  }

  return { type:'output', message: msg };
}

// `use sink` or `wash` with no args — describes the sink and provides contextual actions
async function cmdUseSink(player) {
  const { rows } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND object_type='sink' LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return null;

  const s = rows[0];
  const washHandsLink = `<span class="action-link" data-action="wash" data-target="hands">wash hands</span>`;
  const washLink      = `<span class="action-link" data-action="wash" data-target="">wash</span>`;

  let msg = `${s.name}\n${s.description}`;
  msg += `\n<span class="text-dim">Actions:</span> ${washHandsLink}  ${washLink}`;

  if (isMisActive(player)) {
    msg += `\n<span class="text-dim">The running water is cold and good for cleaning up after intimate encounters.</span>`;
  }

  return { type:'output', message: msg };
}

// Pre-intercept handler for `use <toilet|sink>` — returns null to fall through to inventory use
export async function bodilyUseHandler(args, raw, player) {
  const target = args.filter(a => a !== 'on').join(' ').toLowerCase();

  // If target names a toilet
  if (!target || target.includes('toilet') || target.includes('sit')) {
    const result = await cmdUseToilet(player);
    if (result) return result;
  }

  // If target names a sink
  if (!target || target.includes('sink') || target.includes('faucet') || target.includes('tap')) {
    const result = await cmdUseSink(player);
    if (result) return result;
  }

  return null; // fall through to inventory use
}

export const handlers = {
  pee:      (args, raw, player, broadcast) => cmdPee(player, broadcast),
  urinate:  (args, raw, player, broadcast) => cmdPee(player, broadcast),
  piss:     (args, raw, player, broadcast) => cmdPee(player, broadcast),
  poop:     (args, raw, player, broadcast) => cmdPoop(player, broadcast),
  defecate: (args, raw, player, broadcast) => cmdPoop(player, broadcast),
  shit:     (args, raw, player, broadcast) => cmdPoop(player, broadcast),
  flush:    (args, raw, player)            => cmdFlush(args, player),
  sit:      (args, raw, player)            => cmdUseToilet(player).then(r => r || { type:'output', message:`There's nothing to sit on here.` }),
};
