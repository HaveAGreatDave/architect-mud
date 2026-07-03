/**
 * Smoking plugin — the behavioural layer of lighting up.
 *
 * Everything that makes a cigarette *feel* like a cigarette but isn't a plain
 * stat buff lives here. The buff itself (Cool up, Stamina down) is pure content
 * on the drug row's phases.peak_mods; this plugin owns the three behaviours that
 * aren't expressible as a stat delta:
 *
 *   • appetite suppression — sets `player.appetiteSuppressedUntil` (ms); the
 *       engine's hunger-decay tick reads that field and simply stops decaying
 *       while it's in the future. Plugin owns the field, engine reacts — the
 *       posture pattern. Contract documented in docs/systems-survival.md.
 *   • hacking cough — a self-scheduled tick rolls a random cough for anyone who
 *       has smoked recently (high chance) or is still a smoker (chronic low
 *       chance), narrated to them and the room.
 *   • cool-reaction — on lighting up, everyone else in the zone is made to think,
 *       despite themselves, how cool the smoker looks.
 *
 * Nothing is hardcoded to "cigarettes": a drug row flagged `flags.smokeable`
 * drives all of it, so the drug editor stays the source of truth (mirrors how
 * the intoxication plugin keys off `flags.alcoholic`). The `smoke` verb is a
 * flavour alias for `use`/`inject`, delegating to the engine drug path.
 *
 * Smoking state is in-memory and cleared on death/logout, like the trip and
 * intoxication runtime fields.
 */
import { query } from '../../server/models/db.js';
import { cmdUse } from '../../server/engine/commands/inventory.js';
import { getAllLivePlayers } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';

// --- tunables ----------------------------------------------------------------
const DEFAULT_SUPPRESS_SECONDS = 900;   // 15 min of no hunger decay per cigarette

const COUGH_TICK_MS   = 8000;
const RECENT_SMOKE_MS  = 3 * 60 * 1000;   // "just smoked" window — cough is likely
const SMOKER_WINDOW_MS = 30 * 60 * 1000;  // still counts as a smoker — chronic cough
const RECENT_COUGH_CHANCE  = 0.30;        // per tick right after a smoke
const CHRONIC_COUGH_CHANCE = 0.05;        // per tick while a lingering smoker

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Second-person framing so every onlooker in the room "thinks to themselves".
const COOL_LINES = [
  '{who} takes a long, unhurried drag. You catch yourself thinking they look far cooler than they have any right to.',
  '{who} exhales a slow plume of smoke, and for a second you genuinely wish you looked that effortless.',
  'Smoke curls around {who} like they planned it. Annoyingly, it works. They look cool.',
  '{who} taps ash with a flick of the wrist, and some traitor part of your brain files it under "cool".',
];
const SELF_COUGH = [
  'You double over in a violent, hacking cough that leaves your eyes watering.',
  'A deep, tearing cough claws its way up your throat. Smoker\'s lungs.',
  'You hack and wheeze, thumping your chest until it passes.',
];
const ROOM_COUGH = [
  'doubles over in a violent, hacking cough.',
  'hacks and wheezes, thumping their chest.',
  'is seized by a deep, rattling cough.',
];

// --- smoke verb (flavour alias for use/inject) -------------------------------

async function findDrug(targetStr, player) {
  if (!targetStr) return false;
  const { rows } = await query(
    `SELECT pi.id FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     JOIN drugs d ON d.item_id = i.id
     WHERE pi.player_id=$1 AND (i.name ILIKE $2 OR pi.custom_data->>'name' ILIKE $2) LIMIT 1`,
    [player.id, `%${targetStr}%`]
  );
  return rows.length > 0;
}

async function smoke(args, raw, player, broadcast) {
  const targetStr = args.join(' ');
  if (!(await findDrug(targetStr, player))) {
    return { type: 'error', message: targetStr ? `You've got nothing like that to smoke.` : 'Smoke what?' };
  }
  return cmdUse(targetStr, player, broadcast);
}

export const specializedActions = [
  { verb: 'smoke', requiredTag: 'drug', handler: smoke },
];

// --- on light-up: appetite suppression + cool-reaction -----------------------

on('player.drugUsed', ({ player, drug }) => {
  if (!player || !drug?.flags?.smokeable) return;
  const secs = Number(drug.flags.appetite_suppress_seconds) || DEFAULT_SUPPRESS_SECONDS;
  player.appetiteSuppressedUntil = Date.now() + secs * 1000;
  player._lastSmokeAt = Date.now();
  sendToZone(
    player.current_zone,
    { type: 'zone_event', message: pick(COOL_LINES).replace('{who}', player.handle) },
    player.id
  );
});

// --- cough lifecycle ---------------------------------------------------------

function cough(player) {
  sendToPlayer(player.id, { type: 'output', message: pick(SELF_COUGH) });
  sendToZone(
    player.current_zone,
    { type: 'zone_event', message: `${player.handle} ${pick(ROOM_COUGH)}` },
    player.id
  );
}

function clearSmoking(player) {
  if (!player) return;
  player._lastSmokeAt = 0;
  player.appetiteSuppressedUntil = 0;
}

on('player.death',  ({ player }) => clearSmoking(player));
on('player.logout', ({ id })     => clearSmoking(getAllLivePlayers().find(x => x.id === id)));

// --- tick: random hacking cough ----------------------------------------------

let ticking = false;
function coughTick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const player of getAllLivePlayers()) {
      const since = now - (player._lastSmokeAt || 0);
      if (!player._lastSmokeAt || since >= SMOKER_WINDOW_MS) continue;
      const chance = since < RECENT_SMOKE_MS ? RECENT_COUGH_CHANCE : CHRONIC_COUGH_CHANCE;
      if (Math.random() < chance) cough(player);
    }
  } finally {
    ticking = false;
  }
}

setInterval(() => { try { coughTick(); } catch (e) { console.error('[smoking] tick error:', e.message); } }, COUGH_TICK_MS);

// Exposed for the regression suite.
export const _test = { coughChance: (since) => since < RECENT_SMOKE_MS ? RECENT_COUGH_CHANCE : (since < SMOKER_WINDOW_MS ? CHRONIC_COUGH_CHANCE : 0), DEFAULT_SUPPRESS_SECONDS };
