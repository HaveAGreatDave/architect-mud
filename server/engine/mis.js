/**
 * Mature Interaction System (MIS) — horniness meter, erection state,
 * climax events, and shared helpers for MIS commands.
 *
 * Gated: server setting mis_enabled='true' AND player.mis_enabled=1.
 * Players opt in via the hidden debug code in client settings (MISON64).
 */
import { query } from '../models/db.js';
let serverMisEnabled = false// default open; DB overrides at load

export async function loadMisSettings() {
  const { rows } = await query(`SELECT value FROM server_settings WHERE key='mis_enabled'`);
  serverMisEnabled = rows.length ? rows[0].value === 'true' : true;
}

export function isMisServerEnabled() { return serverMisEnabled; }

export function isMisActive(player) {
  return player.mis_enabled === 1 || player.mis_enabled === true;
}

// Ongoing event intervals (masturbation, fucking) keyed by player ID
const MIS_EVENTS = new Map();

export function startMisEvent(playerId, intervalFn, intervalMs = 8000) {
  stopMisEvent(playerId);
  const id = setInterval(intervalFn, intervalMs);
  MIS_EVENTS.set(playerId, id);
}

export function stopMisEvent(playerId) {
  const id = MIS_EVENTS.get(playerId);
  if (id !== undefined) {
    clearInterval(id);
    MIS_EVENTS.delete(playerId);
  }
}

export function hasMisEvent(playerId) {
  return MIS_EVENTS.has(playerId);
}

// Increase horniness and handle thresholds.
// Returns an array of messages to send privately to the player.
export async function addHorniness(player, amount, broadcast) {
  if (!isMisActive(player)) return [];
  const prev = player.horniness || 0;
  player.horniness = Math.min(120, prev + amount);
  player.horniness_last_increased = Date.now(); // track for decay delay
  await query('UPDATE players SET horniness=$1 WHERE id=$2', [player.horniness, player.id]);

  const messages = [];

  // First-cross threshold at 50
  if (prev < 50 && player.horniness >= 50) {
    messages.push(...pick(HORNY_MESSAGES));
  }

  // Update erection for males
  if (player.biological_sex === 'male') {
    const wasErect = player.erect === 1;
    const nowErect = player.horniness >= 40;
    if (nowErect !== wasErect) {
      player.erect = nowErect ? 1 : 0;
      await query('UPDATE players SET erect=$1 WHERE id=$2', [player.erect, player.id]);
    }
  }

  // Climax at 100 — only triggered here for passive accumulation; active events handle their own
  if (player.horniness >= 100 && !hasMisEvent(player.id)) {
    const climaxMsgs = await triggerClimax(player, broadcast);
    messages.push(...climaxMsgs);
  }

  return messages;
}

export async function triggerClimax(player, broadcast, location = null) {
  player.horniness = 0;
  player.erect = 0;
  player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + 10);
  player.horniness_last_increased = null;

  if (!player.appearance_data) player.appearance_data = {};
  if (player.biological_sex === 'male') {
    const ejacLoc = location ? [location] : ['torso', 'hands'];
    player.appearance_data.ejaculate_state = { locations: ejacLoc };
  } else {
    const ejacLoc = location ? [location] : ['legs'];
    player.appearance_data.ejaculate_state = { locations: ejacLoc };
  }

  await query(
    'UPDATE players SET horniness=$1, erect=$2, sanity=$3, appearance_data=$4 WHERE id=$5',
    [player.horniness, player.erect, player.sanity, JSON.stringify(player.appearance_data), player.id]
  );

  return pick(CLIMAX_MESSAGES);
}

// Climax directly onto the ground (masturbation events)
export async function triggerGroundClimax(player) {
  player.horniness = 0;
  player.erect = 0;
  player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + 10);
  player.horniness_last_increased = null;

  await query(
    'UPDATE players SET horniness=$1, erect=$2, sanity=$3 WHERE id=$4',
    [player.horniness, player.erect, player.sanity, player.id]
  );

  return pick(GROUND_CLIMAX_MESSAGES);
}

function pick(arr) { return Array.isArray(arr[0]) ? arr[Math.floor(Math.random() * arr.length)] : [arr[Math.floor(Math.random() * arr.length)]]; }

// Wash ejaculate off a player
export async function washEjaculate(player) {
  if (!player.appearance_data?.ejaculate_state) return false;
  player.appearance_data.ejaculate_state = null;
  await query('UPDATE players SET appearance_data=$1 WHERE id=$2', [JSON.stringify(player.appearance_data), player.id]);
  return true;
}

// Describe erection visibility through clothing (called by describePlayerAppearance)
// layerCount: number of items equipped to legs slot
// tightSlots: Set of slots covered by low-bulkiness items
export function erectionVisibilityNote(player, tightSlots, layerCount) {
  if (!isMisActive(player)) return null;
  if (player.biological_sex !== 'male' || !player.erect) return null;
  // Visible only through ≤3 layers and only if no bulky outer layer
  if (layerCount > 3) return null;
  if (tightSlots.has('legs')) {
    return `The outline of an erection is visible through ${player.handle || 'their'} clothing.`;
  }
  return null;
}

// Nipple visibility note for females
export function nippleVisibilityNote(player, coveredTorso, tempC) {
  if (!isMisActive(player)) return null;
  if (player.biological_sex !== 'female') return null;
  if (coveredTorso) return null;
  if ((player.horniness || 0) >= 65 || (tempC !== undefined && tempC < 10)) {
    return `Her nipples are visibly hard.`;
  }
  return null;
}

const HORNY_MESSAGES = [
  ['Something stirs in you. A familiar warmth, building quietly.'],
  ['Your thoughts drift somewhere warmer. You push them aside — mostly.'],
  ['A low heat settles in your body, patient and insistent.'],
  ['You become aware of your body in a way you weren\'t a moment ago.'],
];

const CLIMAX_MESSAGES = [
  ['A wave of release moves through you, sudden and overwhelming. The tension breaks. (+10 Sanity)'],
  ['Your body shudders. For a moment, nothing else exists. Then the world comes back. (+10 Sanity)'],
  ['The pressure crests and lets go all at once. You exhale. (+10 Sanity)'],
];

const GROUND_CLIMAX_MESSAGES = [
  ['You come hard, spilling onto the ground at your feet. The tension leaves your body all at once. (+10 Sanity)'],
  ['Your body shudders through it and you finish on the floor. You stand still for a moment, catching your breath. (+10 Sanity)'],
  ['You let go, making a mess of the ground below you. Your legs feel weak. (+10 Sanity)'],
];

// Message pools for ongoing masturbation events (zone-visible)
export const MASTURBATE_EVENT_MALE = [
  `{name} strokes themselves slowly, lost in it.`,
  `{name} jerks off against the wall, breath catching.`,
  `{name} works their cock with increasing urgency.`,
  `{name} masturbates openly, completely absorbed.`,
  `{name} pumps their fist in long, deliberate strokes.`,
  `{name} edges themselves, fingers tight, pace building.`,
];

export const MASTURBATE_EVENT_FEMALE = [
  `{name} touches themselves slowly, eyes half-closed.`,
  `{name} fingers themselves against the wall, quietly.`,
  `{name} rubs between their legs with increasing focus.`,
  `{name} masturbates openly, breath coming in short pulls.`,
  `{name} works their fingers faster, thighs pressing together.`,
  `{name} pleasures themselves with slow, deliberate circles.`,
];

// Ongoing fucking event messages by location
export const FUCK_EVENT_MSGS = {
  mouth: [
    `{name} and {target} continue — {name} using {target}'s mouth.`,
    `{name} pumps into {target}'s throat, setting a rhythm.`,
    `{name} grips {target}'s head, fucking their face steadily.`,
    `{target} gags slightly as {name} keeps going.`,
  ],
  pussy: [
    `{name} thrusts into {target} with building intensity.`,
    `{name} and {target} fuck in a steady, urgent rhythm.`,
    `{name} drives into {target}'s pussy, deep and insistent.`,
    `{target} grips {name}'s back as {name} keeps thrusting.`,
    `{name} picks up the pace, fucking {target} harder.`,
  ],
  ass: [
    `{name} pumps into {target}'s ass in a grinding rhythm.`,
    `{name} and {target} continue — {name} buried in {target}'s ass.`,
    `{name} drives deep into {target} and keeps going.`,
    `{target} grunts as {name} sets a harder pace.`,
  ],
  default: [
    `{name} and {target} continue having sex.`,
    `{name} and {target} are going at it steadily.`,
    `{name} fucks {target} with increasing urgency.`,
    `{name} and {target} keep going, lost in each other.`,
  ],
};

// Zone-visible ejaculation broadcast messages
export const EJACULATE_ZONE_MSGS = {
  ground: [
    `{name} finishes with a groan, coming onto the ground.`,
    `{name} shudders and spills across the floor.`,
    `{name} comes hard, making a mess at their feet.`,
  ],
  on_player: [
    `{name} finishes on {target}, leaving them marked.`,
    `{name} comes across {target}'s {part}.`,
    `{name} shudders and empties onto {target}.`,
  ],
  into_player: [
    `{name} buries deep and finishes inside {target}.`,
    `{name} comes hard inside {target}'s {part}.`,
    `{name} shudders through a climax, buried in {target}.`,
  ],
  furniture: [
    `{name} finishes against the {target}, leaving it marked.`,
    `{name} comes onto the {target}.`,
  ],
};

export const MIS_TUTORIAL = `<span style="color:var(--accent)">— MATURE INTERACTION SYSTEM ENABLED —</span>

You've unlocked biological realism mode. This system simulates the body honestly — not to titillate, but because bodies are part of survival. Think of it as the same candor the game applies to violence.

<span style="color:var(--text-dim)">SOLO:</span>
  stroke / masturbate / jerkoff / rubself / fingerself
  jerk off on &lt;target&gt;
  ejaculate / cum [on &lt;target&gt;/ground/&lt;furniture&gt;]

<span style="color:var(--text-dim)">WITH OTHERS:</span>
  touch &lt;target&gt; [body part]
  squeeze &lt;target&gt; [body part]
  kiss / lick / fondle &lt;target&gt;
  slap &lt;target&gt;'s &lt;body part&gt;
  suck &lt;target&gt;
  handjob / hj &lt;target&gt;
  blowjob / bj &lt;target&gt;
  fuck &lt;target&gt; [in mouth / pussy / ass]
  sex / screw / rail / bang / breed &lt;target&gt; [in ...]
  insert &lt;body part&gt; into &lt;target&gt;

<span style="color:var(--text-dim)">OTHER:</span>
  wash   — clean yourself with water

Most acts restore sanity. Arousal builds during events and peaks at climax.
Type <span style="color:var(--accent)">examine me</span> to see your current state.

<span style="color:var(--text-dim)">Type MIS OFF in the debug field to disable.</span>`;
