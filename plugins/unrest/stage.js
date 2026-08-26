// The dangerous half of the stage vocabulary — phase 1d.
//
// Everything here can hurt a player, and every one of them is built out of a
// seam that already existed. Nothing in this file implements combat, a lockdown
// or a gate: `spawnEnemySync` makes the mob, the checkpoint plugin's own move
// gate reads the config, and the ESP is dispatched into `plugins/emergency` BY
// NAME so neither plugin imports the other.
//
// ⚠ Rule 5, and it is the difference between a system and an ambush: danger must
// be AUDIBLE FROM THE TILE YOU ARE STANDING ON. `propagateSound` already reaches
// neighbours, so the warning costs about four lines and turns "killed by a sim I
// cannot see" into "I heard that and walked in anyway". The warning is inside the
// hostile step rather than a separate authored line, which makes it true by
// construction — an author cannot forget it, because there is nowhere to forget
// it from.
import { query } from '../../server/models/db.js';
import { world, spawnEnemySync, removeEnemyInstance } from '../../server/engine/world.js';
import { propagateSound } from '../../server/engine/sounds.js';
import { getBroadcast } from '../../server/engine/messaging.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { registerStep } from './incidents.js';
import { blockInfo, neighboursOf } from './blocks.js';
import * as signals from './signals.js';

// Loud enough to carry off the block. `propagateSound` falls off by hops, so this
// is the number that decides whether the neighbours get a chance to not come.
const WARNING_LOUDNESS = 9;

/** cell key -> ms of the last hostile warning. Read by regress, and by nothing else. */
const warnings = new Map();

export function warnedAt(key) { return warnings.get(key) ?? null; }

/**
 * Say it before you do it. Fires in the incident's own cell and again from each
 * neighbouring cell's anchor, so the warning reaches the streets somebody could
 * be walking in rather than only the tile the trouble lands on.
 */
export function warnNeighbours(key, text) {
  const broadcast = getBroadcast();
  const here = signals.anchorZone(key);
  if (!broadcast || !here) return false;
  propagateSound(here, text, WARNING_LOUDNESS, broadcast, false);
  for (const near of neighboursOf(key)) {
    const zone = signals.anchorZone(near);
    if (zone) propagateSound(zone, text, WARNING_LOUDNESS - 3, broadcast, false);
  }
  warnings.set(key, Date.now());
  return true;
}

// ── hostile ──────────────────────────────────────────────────────────────────
// { do: 'hostile', enemy: 'enemy_id', count: 2, warn: '...' }

const DEFAULT_WARNING = 'Somewhere close, several people start moving at once, and none of them are talking.';

registerStep('hostile', async (ctx, step) => {
  // ⚠ THE WARNING GOES FIRST, ALWAYS, and before a single template is loaded.
  // Putting it after the spawn would still read fine in the log and would mean a
  // player who was standing one street over heard about it afterwards.
  warnNeighbours(ctx.key, step.warn || DEFAULT_WARNING);

  let template = null;
  try {
    const r = await query('SELECT * FROM enemies WHERE id = $1 LIMIT 1', [step.enemy]);
    template = r.rows?.[0] || null;
  } catch { template = null; }
  if (!template) {
    console.warn(`[unrest] hostile step names a missing enemy: ${step.enemy}`);
    return null;
  }

  // Spread them over the cell's own streets rather than stacking them on one
  // tile — a block that has gone bad is bad to walk through, not bad to stand on.
  const info = blockInfo(ctx.key);
  const streets = (info?.zones || []).filter(id => {
    const z = world.zones.get(id);
    return z && !z.flags?.is_interior && !z.flags?.is_apartment;
  });
  if (!streets.length) return null;

  const ids = [];
  const count = Math.max(1, Math.min(6, Number(step.count) || 1));
  for (let i = 0; i < count; i++) {
    const zoneId = streets[i % streets.length];
    const instance = spawnEnemySync(template, zoneId);
    instance.flags = { ...(instance.flags || {}), unrest_incident: ctx.defId };
    if (step.graph) instance.behaviour_graph = step.graph;
    ids.push(instance.instanceId);
  }
  signals.noteSignal(ctx.key, ctx.writes);

  // ⚠ EVERY instance comes back down. A leaked mob is a permanent hostile nobody
  // authored standing on a street that has been quiet for a week — the same class
  // of mistake as a persisted checkpoint, and harder to notice.
  return () => { for (const id of ids) removeEnemyInstance(id); };
});

// ── checkpoint ───────────────────────────────────────────────────────────────
// { do: 'checkpoint', guards: 'the marshals', checks: ['wanted'], wantedMode: 'bluff' }

registerStep('checkpoint', (ctx, step) => {
  const info = blockInfo(ctx.key);
  // ⚠ Never over an AUTHORED gate. The South Gate's config is content and a
  // temporary incident must not be the thing that decides what it does, even for
  // ninety minutes with a restore afterwards.
  const zoneId = (info?.zones || []).find(id => {
    const z = world.zones.get(id);
    return z && !z.flags?.is_interior && !z.flags?.is_apartment && !z.flags?.checkpoint_cfg;
  });
  const zone = zoneId ? world.zones.get(zoneId) : null;
  if (!zone) return null;

  // ⚠ RAM ONLY. `world.zones` is never written back, so this is restart-safe by
  // construction — which is rule 6 holding without anybody having to remember it.
  // A checkpoint_cfg that reached the `zones` table would be a permanent gate
  // nobody authored, and it would survive every teardown there is.
  zone.flags = zone.flags || {};
  zone.flags.checkpoint_cfg = {
    guards: step.guards || 'the marshals',
    checks: Array.isArray(step.checks) && step.checks.length ? step.checks : ['wanted'],
    wantedMode: step.wantedMode || 'bluff',
  };
  warnNeighbours(ctx.key, step.warn
    || 'Vehicles are stopping at the top of the street, and people are getting out of them.');
  signals.noteSignal(ctx.key, ctx.writes);

  return () => { delete zone.flags.checkpoint_cfg; };
});

// ── esp ──────────────────────────────────────────────────────────────────────
// { do: 'esp', message: '...' }

// ⚠ THE ESP IS A SINGLETON in plugins/emergency — one module-level `espActive`
// beside one `espZones` set. Two concurrent incidents cannot each own a lockdown:
// the second activate() silently joins the first and the first deactivate() ends
// both. So exactly one incident may hold it, and the holder is tracked here.
let espHolder = null;

export function espHeldBy() { return espHolder; }

registerStep('esp', async (ctx, step) => {
  if (espHolder) return null;         // somebody else already has it
  const token = `${ctx.key}|${ctx.defId}|${Date.now()}`;
  espHolder = token;
  const r = await dispatchAction({ type: 'ESP_ACTIVATE', params: { message: step.message || null } });
  if (!r || r.type === 'error') { espHolder = null; return null; }
  signals.noteSignal(ctx.key, ctx.writes);
  return async () => {
    if (espHolder !== token) return;   // not ours any more; leave it alone
    espHolder = null;
    await dispatchAction({ type: 'ESP_DEACTIVATE' });
  };
});

/** Test seam. */
export function _reset() {
  warnings.clear();
  espHolder = null;
}

export const _test = { warnings, WARNING_LOUDNESS, DEFAULT_WARNING };
