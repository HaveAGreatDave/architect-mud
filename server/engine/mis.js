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

// Returns true if `viewer` is attracted to the biological sex of `target`.
// sexuality values: 'Male', 'Female', 'Male and Female'
export function isAttractedTo(viewer, target) {
  if (!viewer || !target) return false;
  const sex = target.biological_sex; // 'male' or 'female'
  const sexuality = viewer.sexuality || 'Male';
  if (sexuality === 'Male and Female') return true;
  if (sex === 'male'   && sexuality === 'Male')   return true;
  if (sex === 'female' && sexuality === 'Female') return true;
  return false;
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
    // Penis always gets residue; add the target location too if on/in someone
    const ejacLoc = location ? ['penis', location] : ['torso', 'hands', 'penis'];
    player.appearance_data.ejaculate_state = { locations: ejacLoc };
  } else {
    // Female passive climax — fluid on legs, not depositable on others
    const ejacLoc = ['legs'];
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

// Breast + nipple visibility note for females.
// torsoLayerCount: number of equipped torso items
// outermostBulkiness: bulkiness value of outermost torso layer (0 if none)
// outermostLayerMax: allowed_layer_range.max of outermost item (1 = bra, 2+ = clothing)
// outermostName: display name of outermost torso item
export function breastVisibilityNote(player, torsoLayerCount, outermostBulkiness, outermostLayerMax, outermostName, tempC) {
  if (!isMisActive(player)) return null;
  if (player.biological_sex !== 'female') return null;

  const data = player.appearance_data || {};
  const size = data.breast_size || 'medium';
  const hard = (player.horniness || 0) >= 65 || (tempC !== undefined && tempC < 10);

  if (torsoLayerCount === 0) {
    // Naked chest — nipple state only (breasts described by describeGenitals)
    const NIPPLE_HARD = [
      `Her nipples are hard — fully committed to the bit.`,
      `Her nipples are erect, standing at attention like they got a memo.`,
      `Her nipples are stiff. They have strong opinions about this situation.`,
      `Her nipples are visibly hard. They're not subtle about it.`,
    ];
    const NIPPLE_SOFT = [
      `Her nipples are soft and relaxed, unbothered by everything.`,
      `Her nipples are at ease. No complaints. No agenda.`,
      `Her nipples are soft — at rest, diplomatically neutral.`,
    ];
    const pool = hard ? NIPPLE_HARD : NIPPLE_SOFT;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  if (torsoLayerCount === 1 && outermostLayerMax <= 1) {
    // Bra only — describe breast fullness
    const FILL = {
      flat:         `Her chest barely registers in the bra. The bra is doing charity work.`,
      small:        `Her breasts sit neatly in the bra — no complaints from either party.`,
      medium:       `Her breasts fill out the bra in a satisfying, uneventful way.`,
      large:        `Her breasts press against the bra with some conviction.`,
      'very large': `Her breasts are straining the bra's structural integrity. It's doing its best.`,
    };
    const fill = FILL[size] || FILL.medium;
    if (hard) {
      const NOTE = [`Her nipples press visibly against the fabric.`, `Hard nipples push through the thin material, undeniable.`];
      return `${fill} ${NOTE[Math.floor(Math.random() * NOTE.length)]}`;
    }
    return fill;
  }

  // Clothed: nipples show through 1 thin layer (bulkiness ≤ 2) or 2 very thin layers (≤ 1)
  const visible = (torsoLayerCount === 1 && outermostBulkiness <= 2) ||
                  (torsoLayerCount === 2 && outermostBulkiness <= 1);
  if (visible && hard) {
    const label = outermostName || 'fabric';
    const NOTE = [`Her nipples are visible through the ${label}.`, `Hard nipples press against the ${label}.`];
    return NOTE[Math.floor(Math.random() * NOTE.length)];
  }

  return null;
}

// Keep old name as alias for compatibility with any remaining call sites
export function nippleVisibilityNote(player, coveredTorso, tempC) {
  if (coveredTorso) return null;
  return breastVisibilityNote(player, 0, 0, 0, null, tempC);
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
export const FUCK_EVENT_PLAYER_MSGS = {
  mouth: [
    `You keep going, using {target}'s mouth.`,
    `You pump into {target}'s throat, setting a rhythm.`,
    `You grip {target}'s head and keep fucking their face.`,
    `{target} gags slightly as you keep going.`,
  ],
  pussy: [
    `You thrust into {target} harder.`,
    `You drive into {target}'s pussy, deep and insistent.`,
    `You pick up the pace, fucking {target} harder.`,
    `You and {target} keep going, completely absorbed.`,
  ],
  ass: [
    `You pump into {target}'s ass in a grinding rhythm.`,
    `You drive deep into {target} and keep going.`,
    `You set a harder pace, buried in {target}'s ass.`,
  ],
  default: [
    `You keep going, fucking {target} with increasing urgency.`,
    `You and {target} go at it steadily.`,
  ],
};

export const FUCK_EVENT_TARGET_MSGS = {
  mouth: [
    `{name} keeps going, using your mouth.`,
    `{name} pumps into your throat.`,
    `{name} grips your head and keeps going.`,
    `You gag slightly as {name} keeps going.`,
  ],
  pussy: [
    `{name} drives into your pussy harder.`,
    `{name} thrusts into you with building intensity.`,
    `{name} picks up the pace, fucking you harder.`,
  ],
  ass: [
    `{name} pumps into your ass in a grinding rhythm.`,
    `{name} drives deep and keeps going.`,
    `{name} sets a harder pace in your ass.`,
  ],
  default: [
    `{name} keeps fucking you with increasing urgency.`,
    `You and {name} keep going.`,
  ],
};

export const FUCK_EVENT_MSGS = {
  mouth: [
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
  ejaculate / cum [on &lt;target&gt;'s &lt;part&gt; / ground / &lt;furniture&gt;]  (requires 50%+ arousal; males only)

<span style="color:var(--text-dim)">WITH OTHERS:</span>
  touch / squeeze / fondle / lick &lt;target&gt;'s &lt;body part&gt;
  kiss &lt;target&gt;
  slap &lt;target&gt;'s &lt;body part&gt;
  suck &lt;target&gt;'s &lt;body part&gt;
  handjob / hj &lt;target&gt;
  blowjob / bj &lt;target&gt;
  eat out &lt;target&gt;'s [pussy / ass]
  fuck &lt;target&gt; [in mouth / pussy / ass]
  sex / screw / rail / bang / breed &lt;target&gt; [in ...]

<span style="color:var(--text-dim)">OTHER:</span>
  wash   — clean yourself with water

Most acts restore sanity. Arousal builds during events and peaks at climax.
Penetrative sex requires naked legs — clothed players grind instead.
Type <span style="color:var(--accent)">examine me</span> to see your current state.

<span style="color:var(--text-dim)">Type MIS OFF in the debug field to disable.</span>`;
