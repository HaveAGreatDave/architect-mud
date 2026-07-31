/**
 * Script trigger registry — the seam that binds event-bus events to authored
 * VINE script graphs (docs/proposals/engine-plugin-boundary.md, registry class).
 *
 * Before this existed, a Script asset could only ever run from a dialogue node's
 * EXECUTE_SCRIPT — one trigger surface for the whole game. A trigger row binds
 * any past-tense event on the bus (zone.entered, item.equipped, player.death,
 * flag.set, weather.event, …) to a script id, so "when X happens, run this
 * graph" becomes authored content instead of a code change.
 *
 * ENGINE vs CONTENT: this module knows nothing about any particular event or
 * script. It is the channel; every binding lives in the `script_triggers` table
 * and every effect lives in a `scripts` graph.
 *
 * HOT PATH CONTRACT: zone.entered fires on every move, so the dispatcher's miss
 * case must be free — one Map.get returning undefined. Nothing is awaited, and
 * no DB is touched, until a trigger actually matches the event name. The
 * sync filters (zone, chance, cooldown) run before the async ones (conditions,
 * once-guard) for the same reason. Triggers themselves are boot-cached; the DB
 * is read once at boot and again only on an explicit reload.
 *
 * WIRING: one dispatcher is subscribed per distinct event name, at most once for
 * the life of the process (events.js has no unsubscribe-by-name). A dispatcher
 * always reads the live TRIGGERS map, so a reload that drops every trigger for
 * an event leaves a subscription that no-ops — correct, and cheap.
 */
import { query } from '../models/db.js';
import { on } from './events.js';
import { runScriptById } from './graph.js';
import { evalConditions, getFlag, setFlag } from './flags.js';
import { getBroadcast } from './messaging.js';

// eventName -> [trigger row, ...]
let TRIGGERS = new Map();
// eventName -> true, for every event we've already subscribed a dispatcher to
const WIRED = new Set();
// `${triggerId}:${actorId}` -> epoch ms of the last run (cooldown_seconds gate)
const LAST_RUN = new Map();

/** Player-flag key used by a once=1 trigger to guarantee one fire per player. */
const onceFlag = (id) => `script_trigger_${id}`;

/**
 * Load every enabled trigger into memory and make sure each of their events has
 * a dispatcher subscribed. Safe to call repeatedly (dev-panel reload).
 */
export async function loadScriptTriggers() {
  let rows = [];
  try {
    ({ rows } = await query('SELECT * FROM script_triggers WHERE enabled = 1'));
  } catch (e) {
    // Table not yet applied to this DB — the rest of the engine must still boot.
    console.warn(`[scriptTriggers] not loaded: ${e.message}`);
    TRIGGERS = new Map();
    return TRIGGERS;
  }
  const next = new Map();
  for (const t of rows) {
    if (!t.event || !t.script_id) continue;
    if (!next.has(t.event)) next.set(t.event, []);
    next.get(t.event).push(t);
  }
  TRIGGERS = next;
  for (const eventName of next.keys()) wire(eventName);
  return TRIGGERS;
}

function wire(eventName) {
  if (WIRED.has(eventName)) return;
  WIRED.add(eventName);
  on(eventName, (payload) => dispatch(eventName, payload));
}

/** Normalize the actor across payload shapes ({actor} vs {player}). */
function actorOf(payload) {
  return payload?.actor || payload?.player || null;
}

/**
 * Normalize the zone across payload shapes. `zone` is a zone id on
 * zone.entered but a zone object elsewhere; zoneId is used by several plugins.
 * Falls back to wherever the actor is standing.
 */
function zoneIdOf(payload, actor) {
  const z = payload?.zone ?? payload?.zoneId ?? null;
  if (typeof z === 'string') return z;
  if (z && typeof z === 'object') return z.id ?? null;
  return actor?.current_zone ?? null;
}

// Fire-and-forget: an event subscriber's return value is ignored and its
// rejection is swallowed by the bus, so errors are logged here instead.
function dispatch(eventName, payload) {
  const list = TRIGGERS.get(eventName);
  if (!list?.length) return;
  const actor = actorOf(payload);
  const zoneId = zoneIdOf(payload, actor);
  const now = Date.now();

  for (const t of list) {
    // ── sync filters first (see hot-path contract) ──
    if (t.zone_id && t.zone_id !== zoneId) continue;
    if (t.chance != null && t.chance < 1 && Math.random() > t.chance) continue;
    const cd = Number(t.cooldown_seconds) || 0;
    if (cd > 0) {
      const key = `${t.id}:${actor?.id || 'world'}`;
      const last = LAST_RUN.get(key) || 0;
      if (now - last < cd * 1000) continue;
      LAST_RUN.set(key, now);
    }
    // ── async filters + the run itself ──
    runTrigger(t, actor, payload).catch((e) =>
      console.error(`[scriptTriggers:${t.id}] ${e.message}`),
    );
  }
}

async function runTrigger(t, actor, payload) {
  const conditions = Array.isArray(t.conditions) ? t.conditions : [];
  if (conditions.length && !(await evalConditions(conditions, actor))) return;

  if (t.once) {
    if (!actor) return; // a per-player once-guard needs a player
    if (await getFlag('player', onceFlag(t.id), actor)) return;
    await setFlag('player', onceFlag(t.id), 'true', actor);
  }

  await runScriptById(t.script_id, {
    actor,
    broadcast: payload?.broadcast || getBroadcast(),
    // The graph's ${tokens} resolve from here — one authored script, one row per
    // instance. `zone` is always available so a graph can key state to the room
    // it fired in without the author restating it, and `event` exposes the raw
    // payload for dotted lookups (${event.delta}, ${event.item.name}).
    //
    // The payload is referenced, NOT copied: this runs on zone.entered, and only
    // scalar leaves ever resolve, so handing over the live object costs nothing
    // and leaks nothing. A trigger's own params win a name collision — authored
    // intent beats whatever the emitter happened to call its field.
    params: { event: payload, ...(t.params || {}), zone: zoneIdOf(payload, actor) ?? '' },
    trigger: t.id,
    event: t.event,
    depth: 0,
  });
}

/** Introspection — used by the regress sweep and the dev panel. */
export function getScriptTriggers() {
  return [...TRIGGERS.values()].flat();
}
export function getTriggeredEvents() {
  return [...TRIGGERS.keys()];
}
