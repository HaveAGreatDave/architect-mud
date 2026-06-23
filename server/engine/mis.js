/**
 * Mature Interaction System (MIS) — horniness meter, erection state,
 * climax events, and shared helpers for MIS commands.
 *
 * Gated: server setting mis_enabled='true' AND player.mis_enabled=1.
 * Players opt in via the hidden debug code in client settings (MISON64).
 */
import { query } from '../models/db.js';
mis_enabled='false' 
let serverMisEnabled = true; // default open; DB overrides at load

export async function loadMisSettings() {
  const { rows } = await query(`SELECT value FROM server_settings WHERE key='mis_enabled'`);
  serverMisEnabled = rows.length ? rows[0].value === 'true' : true;
}

export function isMisServerEnabled() { return serverMisEnabled; }

export function isMisActive(player) {
  return serverMisEnabled && (player.mis_enabled === 1 || player.mis_enabled === true);
}

// Increase horniness and handle thresholds.
// Returns an array of messages to send privately to the player.
export async function addHorniness(player, amount, broadcast) {
  if (!isMisActive(player)) return [];
  const prev = player.horniness || 0;
  player.horniness = Math.min(120, prev + amount);
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

  // Climax at 100
  if (player.horniness >= 100) {
    const climaxMsgs = await triggerClimax(player, broadcast);
    messages.push(...climaxMsgs);
  }

  return messages;
}

export async function triggerClimax(player, broadcast) {
  player.horniness = 20;
  player.erect = 0;
  player.sanity = Math.min(player.sanity_max || 100, (player.sanity || 50) + 10);

  // Mark ejaculate state
  if (!player.appearance_data) player.appearance_data = {};
  if (player.biological_sex === 'male') {
    player.appearance_data.ejaculate_state = { locations: ['torso', 'hands'] };
  } else {
    player.appearance_data.ejaculate_state = { locations: ['legs'] };
  }

  await query(
    'UPDATE players SET horniness=$1, erect=$2, sanity=$3, appearance_data=$4 WHERE id=$5',
    [player.horniness, player.erect, player.sanity, JSON.stringify(player.appearance_data), player.id]
  );

  return pick(CLIMAX_MESSAGES);
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
export function erectionVisibilityNote(player, tightSlots) {
  if (!isMisActive(player)) return null;
  if (player.biological_sex !== 'male' || !player.erect) return null;
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

export const MIS_TUTORIAL = `<span style="color:var(--accent)">— MATURE INTERACTION SYSTEM ENABLED —</span>

You've unlocked biological realism mode. This system simulates the body honestly — not to titillate, but because bodies are part of survival. Think of it as the same candor the game applies to violence.

<span style="color:var(--text-dim)">COMMANDS:</span>
  touch &lt;target&gt; [body part]   — physical contact
  kiss &lt;target&gt;               — affection
  lick &lt;target&gt; [body part]   — oral contact
  fondle &lt;target&gt;             — breast contact
  stroke                        — solo stimulation
  masturbate                    — same as stroke
  suck &lt;target&gt;               — oral sex
  insert &lt;body part&gt; into &lt;target/location&gt; — penetration
  wash                          — clean yourself with water

Most acts restore sanity. Arousal builds over time and resets naturally.
Type <span style="color:var(--accent)">examine me</span> to see your current state.

<span style="color:var(--text-dim)">Type MIS OFF in the debug field to disable.</span>`;
