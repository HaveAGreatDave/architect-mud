import { query } from '../../models/db.js';
import { relieveBladder, relieveBowels } from '../bodily.js';
import { isMisActive } from '../mis.js';
import { getZonePlayers } from '../world.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../sift.js';

async function hasFacilityNearby(zoneId) {
  const { rows } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND (object_type='toilet' OR jsonb_exists(flags,'toilet')) LIMIT 1`,
    [zoneId]
  );
  return rows.length > 0;
}

// Resolve an optional target from raw command args (e.g. "pee on alice" / "shit on bed")
async function resolveBodilyTarget(args, raw, player, verb) {
  // Expect "on <name>", "in <name>", or just no args
  const str = args.join(' ').replace(/^(?:on|in)\s+/i, '').trim();
  if (!str) return null;

  // Check for player target in zone using SIFT
  const others = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  const candidates = others.map(p => ({ ...p, name: p.handle }));
  const r = siftResolve(str, candidates);
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { verb });
    return { type: 'ambiguous', selection: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  if (r.type === 'match') return { type: 'player', target: r.candidate };

  // Check for sleeping body
  const { rows: sleepers } = await query(
    `SELECT * FROM players WHERE LOWER(handle) LIKE $1 AND current_zone=$2 AND offline_sleeping=TRUE LIMIT 1`,
    [`%${str.toLowerCase()}%`, player.current_zone]
  );
  if (sleepers.length) return { type: 'player', target: sleepers[0] };

  // Check for furniture with sit command (for shit) or just any furniture (for pee)
  const { rows: furniture } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND name ILIKE $2 LIMIT 1`,
    [player.current_zone, `%${str}%`]
  );
  if (furniture.length) return { type: 'furniture', target: furniture[0], name: furniture[0].name };

  return null;
}

async function cmdPee(args, player, broadcast) {
  // Check for "on <target>" — MIS required for on-player targeting
  const target = await resolveBodilyTarget(args, null, player, 'pee');
  if (target?.type === 'ambiguous') return { type:'output', message: target.selection };
  if (target?.type === 'player') {
    if (!isMisActive(player)) return { type:'error', message:`That requires MIS to be enabled.` };
    const result = await relieveBladder(player, false, broadcast, target);
    return { type: result.ok ? 'output' : 'error', message: result.message };
  }
  if (target?.type === 'furniture') {
    const f = target.target;
    if (f.object_type !== 'toilet') return { type:'error', message:`You can't do that in the ${f.name}.` };
    const result = await relieveBladder(player, true, broadcast);
    return { type: result.ok ? 'output' : 'error', message: result.message };
  }
  const hasFacility = await hasFacilityNearby(player.current_zone);
  const result = await relieveBladder(player, hasFacility, broadcast);
  return { type: result.ok ? 'output' : 'error', message: result.message };
}

async function cmdPoop(args, player, broadcast) {
  // Check for "on <target>" — MIS required for on-player targeting
  const target = await resolveBodilyTarget(args, null, player, 'poop');
  if (target?.type === 'ambiguous') return { type:'output', message: target.selection };
  if (target?.type === 'player') {
    if (!isMisActive(player)) return { type:'error', message:`That requires MIS to be enabled.` };
    // Target must be sleeping or lying down
    const tp = target.target;
    if (!tp.sleeping && !tp.offline_sleeping && tp.posture !== 'lying') {
      return { type:'error', message:`${tp.handle || 'They'} would have to be lying down for that.` };
    }
    const result = await relieveBowels(player, false, broadcast, target);
    return { type: result.ok ? 'output' : 'error', message: result.message };
  }
  if (target?.type === 'furniture') {
    const f = target.target;
    const isToilet = f.object_type === 'toilet' || f.flags?.toilet;
    const hasSit = f.flags?.interactions?.includes?.('sit') || isToilet;
    if (!hasSit) return { type:'error', message:`You can't do that on the ${f.name}.` };
    if (isToilet) {
      const result = await relieveBowels(player, true, broadcast);
      return { type: result.ok ? 'output' : 'error', message: result.message };
    }
    const result = await relieveBowels(player, false, broadcast, target);
    return { type: result.ok ? 'output' : 'error', message: result.message };
  }
  const hasFacility = await hasFacilityNearby(player.current_zone);
  const result = await relieveBowels(player, hasFacility, broadcast);
  return { type: result.ok ? 'output' : 'error', message: result.message };
}

async function cmdFlush(args, player) {
  const { rows } = await query(
    `SELECT id FROM furniture WHERE zone_id=$1 AND (object_type='toilet' OR jsonb_exists(flags,'toilet')) LIMIT 1`,
    [player.current_zone]
  );
  if (!rows.length) return { type:'error', message:`There's no toilet here to flush.` };
  return { type:'output', message:`You flush. The sound is deeply satisfying.` };
}

// `use toilet` or `sit` — describes the toilet and provides contextual actions
async function cmdUseToilet(player) {
  const { rows } = await query(
    `SELECT * FROM furniture WHERE zone_id=$1 AND (object_type='toilet' OR jsonb_exists(flags,'toilet')) LIMIT 1`,
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
    `SELECT * FROM furniture WHERE zone_id=$1 AND (object_type='sink' OR jsonb_exists(flags,'water_source')) LIMIT 1`,
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
  pee:      (args, raw, player, broadcast) => cmdPee(args, player, broadcast),
  urinate:  (args, raw, player, broadcast) => cmdPee(args, player, broadcast),
  piss:     (args, raw, player, broadcast) => cmdPee(args, player, broadcast),
  poop:     (args, raw, player, broadcast) => cmdPoop(args, player, broadcast),
  defecate: (args, raw, player, broadcast) => cmdPoop(args, player, broadcast),
  shit:     (args, raw, player, broadcast) => cmdPoop(args, player, broadcast),
  flush:    (args, raw, player)            => cmdFlush(args, player),
};
