// Incidents — the thing a player walks into.
//
// An `incidents` row is a THING THAT CAN HAPPEN in a city block, never a thing
// that is happening. ⚠ Rule 6: persist the ledger, never the incidents. A live
// staging holds instance ids that do not survive a restart, and a persisted
// "checkpoint here" that outlives its teardown is a permanent checkpoint nobody
// authored. Correct post-restart state is: cell still hot, checkpoint gone, next
// tick re-stages it if it is still warranted.
//
// ⚠ Rule 1 lives here, in `eligible()`: nothing stages in a cell that has not
// carried a perceivable, attributable signal from THE SAME ORDER inside the
// window. That is the whole difference between consequence and spawn noise — the
// player who walked past the tag yesterday reads today's checkpoint as a reply.
//
// The stage vocabulary is a REGISTRY, not a switch. 1c registers the safe steps
// here; 1d registers the dangerous ones from stage.js. A step name nothing has
// registered is a build failure (regress sweeps every authored `do`), because an
// authored key that nothing reads is the failure mode that hid in `mutations`
// for months.
import { query } from '../../server/models/db.js';
import { emit } from '../../server/engine/events.js';
import { propagateSound } from '../../server/engine/sounds.js';
import { getBroadcast } from '../../server/engine/messaging.js';
import { dispatchAction } from '../../server/engine/actions.js';
import * as pool from '../gossip/pool.js';
import { tagFromWorld, removeTag } from '../graffiti/index.js';
import * as ledger from './ledger.js';
import * as signals from './signals.js';
import { allBlocks } from './blocks.js';
import { quarterOf } from './voice.js';

const RANK = { quiet: 0, watchful: 1, tense: 2, flashpoint: 3 };

// ⚠ Citywide, not per cell. Three simultaneous incidents over ten blocks is a
// city with something going on in it; ten is a city where the sim is the only
// thing happening, and the ambience it is sitting on top of stops being audible.
export const MAX_LIVE = 3;

/** id -> { instanceId, defId, key, writes, band, startedAt, endsAt, undo: [] } */
const live = new Map();
/** `${key}|${defId}` -> ms until this incident may return to this cell. */
const cooldowns = new Map();
/** Authored catalogue, read once. readTier 'boot' — see content-registry.js. */
let catalogue = [];
let seq = 0;

const nowMs = () => Date.now();
const rand = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');

// ── The catalogue ────────────────────────────────────────────────────────────

export async function loadCatalogue() {
  try {
    const r = await query('SELECT * FROM incidents WHERE enabled = 1');
    catalogue = (r.rows || []).map(row => ({
      id: row.id,
      name: row.name,
      writes: row.writes || 'heat',
      minBand: row.min_band || 'watchful',
      weight: Number(row.weight) || 10,
      durationMin: Number(row.duration_min) || 60,
      cooldownMin: Number(row.cooldown_min) || 240,
      stage: Array.isArray(row.stage) ? row.stage : [],
      flags: row.flags || {},
    }));
  } catch {
    // A bare test DB without the table is not a reason to fail a boot. No
    // catalogue means no incidents, which is exactly phase 1b's behaviour.
    catalogue = [];
  }
  return catalogue.length;
}

export function getCatalogue() { return catalogue; }
export function liveIncidents() { return [...live.values()]; }

// ── The stage-step registry ──────────────────────────────────────────────────
// Each step is { apply(ctx, step) -> undo|null }. `undo` is a function or null;
// teardown runs them in reverse. A step whose effect is a broadcast that already
// went out has no undo, and that is honest rather than lazy: a bulletin that
// aired, aired.
const STEPS = new Map();

export function registerStep(name, apply) {
  if (STEPS.has(name)) throw new Error(`unrest: stage step "${name}" registered twice`);
  STEPS.set(name, apply);
}

export function stepNames() { return [...STEPS.keys()]; }

// {place} is the only token, and it resolves to a part of town given by
// ORIENTATION. ⚠ Rule 3: never a name. An author who writes a district into a
// line is writing the thing the readout rule bans, one step removed.
function fill(text, ctx) {
  return String(text || '').replace(/\{place\}/g, quarterOf(ctx.key));
}

registerStep('gossip', (ctx, step) => {
  const zone = ctx.zone;
  if (!zone) return null;
  const item = pool.addItem({
    category: 'world', templateKey: 'rumor', vars: { text: fill(step.text, ctx) },
    zoneId: zone, heat: step.heat ?? 0.85, reach: step.reach ?? 3,
    capGroup: 'unrest', coalesceKey: `unrest_inc|${ctx.key}|${ctx.defId}`,
  });
  signals.noteSignal(ctx.key, ctx.writes);
  return () => { pool.remove(item.id); };
});

registerStep('news', async (ctx, step) => {
  await dispatchAction({
    type: 'broadcast.newsWire',
    params: { category: 'unrest', text: fill(step.text, ctx), priority: step.priority },
  });
  return null;   // it aired. There is no unairing it.
});

registerStep('graffiti', async (ctx, step) => {
  const zone = ctx.zone;
  if (!zone) return null;
  await tagFromWorld(zone, fill(step.text, ctx), step.author || 'someone');
  signals.noteSignal(ctx.key, ctx.writes);
  // ⚠ Teardown removes it, but a process that dies mid-incident leaves it — and
  // that is fine, because a tag has its own lazy three-game-day expiry and an
  // orphan reads as exactly what it is: a wall nobody has scrubbed yet.
  return async () => { await removeTag(zone); };
});

registerStep('ambient', (ctx, step) => {
  const lines = (step.lines || [step.text]).filter(Boolean).map(l => fill(l, ctx));
  if (!lines.length) return null;
  signals.setAmbientOverride(ctx.key, lines, ctx.writes);
  return () => signals.clearAmbientOverride(ctx.key);
});

// ⚠ The proposal called this step "NPC mood". There is no seam in this codebase
// that reads a mood field off an NPC — inventing one would be an authored key
// nothing consumes, which is the exact failure the mutations rework was written
// to stop repeating. A noise in the street is the same beat through a seam that
// already exists, and 1d's warning uses the identical call.
registerStep('sound', (ctx, step) => {
  const zone = ctx.zone;
  const broadcast = getBroadcast();
  if (!zone || !broadcast) return null;
  propagateSound(zone, fill(step.text, ctx), step.loudness ?? 6, broadcast, true);
  signals.noteSignal(ctx.key, ctx.writes);
  return null;   // a sound is over the moment it has been heard
});

// ── The selector ─────────────────────────────────────────────────────────────

/**
 * May this incident stage in this cell right now?
 * Returns null when it may, or a short string saying why not — the dev panel
 * shows that string, because an operator who cannot see why nothing is staging
 * will conclude the sim is broken.
 */
export function eligible(def, key, now = nowMs()) {
  if (RANK[ledger.bandOf(key)] < RANK[def.minBand]) return 'band';
  // ⚠ RULE 1. Same order, inside the window. A cell whose mood belongs to the
  // authority cannot host an insurgency incident until heat has actually said
  // something there, which is what makes every staging attributable.
  if (!signals.hadSignal(key, def.writes, signals.SIGNAL_WINDOW_MS, now)) return 'signal';
  // ⚠ Occupancy is tested BEFORE the cooldown, and the order is the whole value
  // of the string. Staging sets the cooldown, so a cell that is currently hosting
  // this very incident would otherwise report "on cooldown" — true, and the least
  // useful of the two true answers to an operator looking at a running incident.
  for (const inc of live.values()) if (inc.key === key) return 'occupied';
  if ((cooldowns.get(`${key}|${def.id}`) || 0) > now) return 'cooldown';
  return null;
}

/** Every (definition, cell) pair that could stage this instant. */
export function candidates(now = nowMs()) {
  const out = [];
  for (const def of catalogue) {
    for (const key of allBlocks()) {
      if (!eligible(def, key, now)) out.push({ def, key });
    }
  }
  return out;
}

// ── Staging and teardown ─────────────────────────────────────────────────────

export async function stage(def, key, now = nowMs()) {
  const zone = signals.anchorZone(key);
  const ctx = { key, zone, defId: def.id, writes: def.writes, band: ledger.bandOf(key) };
  const undo = [];
  for (const step of def.stage) {
    const apply = STEPS.get(step.do);
    // An unregistered step is skipped rather than thrown: half an incident is
    // worse than none, but a boot that dies on one bad content row is worse than
    // both. Regress is what actually stops the row existing.
    if (!apply) { console.warn(`[unrest] unknown stage step "${step.do}" in ${def.id}`); continue; }
    try {
      const back = await apply(ctx, step);
      if (typeof back === 'function') undo.push(back);
    } catch (e) {
      console.error(`[unrest] stage step "${step.do}" failed in ${def.id}: ${e.message}`);
    }
  }

  const instanceId = `inc_${now}_${rand()}_${seq++}`;
  const inc = {
    instanceId, defId: def.id, name: def.name, key, zone,
    writes: def.writes, band: ctx.band, startedAt: now,
    endsAt: now + def.durationMin * 60000, undo,
  };
  live.set(instanceId, inc);
  cooldowns.set(`${key}|${def.id}`, now + def.cooldownMin * 60000);

  // ⚠ `world_events` is the AUDIT LOG, not the ledger. Exactly one row per
  // staging — it is how an operator reconstructs a night after the fact, and it
  // is the only durable trace an incident leaves.
  await query(
    `INSERT INTO world_events (id, event_type, description, zone_id, data)
     VALUES ($1, $2, $3, $4, $5)`,
    [`we_${instanceId}`, 'unrest.incident', `${def.name} staged in ${quarterOf(key)}`, zone,
     JSON.stringify({ cell: key, incident: def.id, writes: def.writes, band: ctx.band })]
  ).catch(() => {});

  // Named `zone` because script-triggers normalises payload.zone ?? payload.zoneId;
  // an authored trigger row filtering on zone_id matches nothing otherwise.
  emit('unrest.incident.staged', {
    zone, cell: key, incident: def.id, instanceId, writes: def.writes, band: ctx.band,
  });
  return inc;
}

export async function teardown(instanceId) {
  const inc = live.get(instanceId);
  if (!inc) return false;
  live.delete(instanceId);
  // Reverse order: the last thing put up is the first thing taken down, so a
  // step that layered over another restores what was underneath it.
  for (const back of [...inc.undo].reverse()) {
    try { await back(); } catch (e) { console.error(`[unrest] teardown failed: ${e.message}`); }
  }
  emit('unrest.incident.ended', { zone: inc.zone, cell: inc.key, incident: inc.defId, instanceId });
  return true;
}

/** Take down anything whose time is up. Cheap; safe to call often. */
export async function reap(now = nowMs()) {
  let n = 0;
  for (const inc of [...live.values()]) {
    if (inc.endsAt <= now) { await teardown(inc.instanceId); n++; }
  }
  return n;
}

/**
 * One selection pass. Reaps first, then stages AT MOST ONE incident — a tick
 * that could stage three would empty the cap in one pass and make the city lurch
 * rather than turn.
 */
export async function tick(now = nowMs()) {
  await reap(now);
  if (live.size >= MAX_LIVE) return null;
  const pairs = candidates(now);
  if (!pairs.length) return null;
  const total = pairs.reduce((s, p) => s + Math.max(1, p.def.weight), 0);
  let roll = Math.random() * total;
  for (const p of pairs) {
    roll -= Math.max(1, p.def.weight);
    if (roll <= 0) return stage(p.def, p.key, now);
  }
  return stage(pairs[pairs.length - 1].def, pairs[pairs.length - 1].key, now);
}

/** Test seam — drop every live staging and every cooldown, running teardowns. */
export async function _reset() {
  for (const id of [...live.keys()]) await teardown(id);
  cooldowns.clear();
  seq = 0;
}

export const _test = { live, cooldowns, STEPS, RANK, setCatalogue: (c) => { catalogue = c; } };
