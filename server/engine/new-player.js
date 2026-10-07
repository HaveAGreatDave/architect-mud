// Making a character: the one INSERT both doors use (apiRegister for an account,
// `auth_guest` for a guest), the handle rules they share, and the purge that
// undoes it. Two copies of the INSERT would drift; reincarnatePlayer
// (commands/world.js) mirrors the same starting values for a reset.

import { randomUUID, randomBytes } from 'crypto';
import { query } from '../models/db.js';
import { world } from './world.js';
import { evictPlayerFlags, setFlagById } from './flags.js';
import { emit } from './events.js';
import { randomAppearance } from './appearance.js';
import { maxHpForEndurance } from './ip.js';
import { ensureTunables } from './tunables.js';
import { hashPassword } from './passwords.js';
import { RUNGS as DISPLAY_RUNGS, DISPLAY_MODE_FLAG } from './presentation.js';

// ⚠ A handle is shown to other players, and dialogue interpolates it into HTML
// (`${player.handle}`), so markup here would be stored XSS. Letters, digits,
// spaces and _ . ' - only.
export const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9 _.'-]{1,23}$/;
export const HANDLE_RULE = "Names are 2 to 24 characters: letters, numbers, spaces and _ . ' - (starting with a letter or number).";

// Words a command already reads as a target, or that would pass for staff.
const RESERVED = new Set([
  'me', 'self', 'myself', 'you', 'all', 'everyone', 'here', 'it', 'door', 'someone', 'nobody',
  'admin', 'staff', 'sysop', 'dev', 'mod', 'moderator', 'system', 'server',
  'guest', 'architect', 'the architect',
]);

// Sync checks: shape, reserved words and NPC names (world.npcs is in memory).
// Returns an error string, or null when the name may be used.
export function handleProblem(handle) {
  if (typeof handle !== 'string' || !HANDLE_RE.test(handle)) return HANDLE_RULE;
  const low = handle.trim().toLowerCase();
  if (RESERVED.has(low)) return `"${handle}" is reserved. Pick another name.`;
  for (const npc of world.npcs.values()) {
    if (npc?.name && npc.name.toLowerCase() === low) return `Somebody in the city already goes by ${npc.name}. Pick another name.`;
  }
  return null;
}

// The unique constraint is case-sensitive, and every lookup lowercases, so
// "Rook" and "rook" would both register and then shadow each other.
export async function handleTaken(handle, exceptId = null) {
  const { rows } = await query(
    'SELECT 1 FROM players WHERE LOWER(handle)=LOWER($1) AND id IS DISTINCT FROM $2 LIMIT 1',
    [handle.trim(), exceptId]
  );
  return rows.length > 0;
}

// Inserts a brand-new character in the prologue's first room and returns its id.
// Throws on a unique violation (23505) for the caller to answer.
export async function insertNewPlayer({ username, password, handle, email = null, role = 'player', displayRung = null }) {
  // Starting appearance is fully randomized (sex included) so the chargen
  // terminal opens on a random look the player then reshapes.
  const biologicalSex = Math.random() < 0.5 ? 'male' : 'female';
  const id = randomUUID();
  await ensureTunables();
  const app = randomAppearance(biologicalSex);
  // Stats start blank; hp/hp_max derive from endurance 0. No starting XP:
  // the chargen holosign hands out the free +1-to-all.
  const startHp = maxHpForEndurance(0);
  // A guest has no password, so it gets one nobody knows.
  const passwordHash = await hashPassword(password ?? randomBytes(32).toString('hex'));
  // New souls spawn into the prologue (zone_the_inbetween). anchor_zone keeps
  // its schema DEFAULT ('zone_start'), so a death after the prologue respawns at
  // the clone facility.
  await query(
    `INSERT INTO players
      (id,username,password_hash,handle,role,bonus_xp,hp,hp_max,stat_brawn,stat_reflexes,stat_endurance,stat_brains,stat_cool,stat_senses,
       biological_sex,hair_style,hair_length,hair_color,eye_color,height_cm,weight_kg,appearance_data,email,sexuality,current_zone)
     VALUES ($1,$2,$3,$4,$5,0,${startHp},${startHp},0,0,0,0,0,0,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Female','zone_the_inbetween')`,
    [id, username.toLowerCase(), passwordHash, handle.trim(), role,
     biologicalSex, app.hair_style, app.hair_length, app.hair_color, app.eye_color,
     app.height_cm, app.weight_kg, JSON.stringify(app.appearance_data), email ? email.toLowerCase().trim() : null]
  );
  // The auth screen's pre-login Display Mode choice has to be on the row before
  // the first login, because the prologue's cold open fires on it. Only a real
  // selection reaches us, so the never-chosen state survives.
  if (DISPLAY_RUNGS.includes(displayRung)) {
    await setFlagById(id, DISPLAY_MODE_FLAG, displayRung).catch(() => {});
  }
  return id;
}

// ── Purge ───────────────────────────────────────────────────────────────────
// Every per-player table keyed by player_id (the class-'player' rows of
// models/content-registry.js, plus runtime tables that carry a player). Only
// player_skills has a real FK, so a bare DELETE FROM players would either fail
// on it or orphan everything else.
const PURGE_PLAYER_ID_TABLES = [
  'player_inventory', 'player_skills', 'player_ideology_rep', 'player_corpses', 'player_deaths',
  'player_drug_state', 'player_mutations', 'player_augments', 'player_backups', 'player_flags',
  'player_macros', 'player_client_config', 'player_npc_relations', 'player_reads',
  'player_disciplines', 'player_purity', 'player_quests', 'player_achievements', 'player_outfits',
  'tape_rentals', 'bank_transactions', 'economy_ledger', 'org_members', 'yacht_invites',
  'password_reset_tokens', 'email_verification_tokens', 'card_holdings', 'player_sprays',
  'smuggle_orders', 'flight_contracts', 'jail_prisoners', 'script_waits',
];
const PURGE_OWNER_TABLES = ['insurance_policies', 'insurance_claims', 'cargo_drops', 'hangars'];

// Deletes offline characters outright. One statement per table for the whole
// batch, never per player. Online ids are skipped; returns how many rows went.
export async function purgePlayers(ids) {
  const offline = ids.filter(id => !world.players.has(id));
  if (!offline.length) return 0;
  // Owned property goes back to stock rather than vanishing with its owner.
  await query('UPDATE aircraft SET owner_id=NULL, hangar_id=NULL WHERE owner_id = ANY($1)', [offline]).catch(() => {});
  await query('UPDATE apartments SET owner_id=NULL, owner_handle=NULL, is_locked=0, purchased_at=NULL, date_rented=NULL WHERE owner_id = ANY($1)', [offline]).catch(() => {});
  for (const ap of world.apartments?.values?.() || []) {
    if (ap && offline.includes(ap.owner_id)) { ap.owner_id = null; ap.owner_handle = null; }
  }
  // Independent tables, so they go out together. A table this DB lacks is skipped.
  await Promise.all([
    ...PURGE_PLAYER_ID_TABLES.map(t => query(`DELETE FROM ${t} WHERE player_id = ANY($1)`, [offline]).catch(() => {})),
    ...PURGE_OWNER_TABLES.map(t => query(`DELETE FROM ${t} WHERE owner_id = ANY($1)`, [offline]).catch(() => {})),
  ]);
  for (const id of offline) evictPlayerFlags(id);
  // Plugins that mirror a wiped table in RAM (jail's roster) drop these players too.
  emit('player.wiped', { playerIds: offline });
  const { rowCount } = await query('DELETE FROM players WHERE id = ANY($1)', [offline]);
  return rowCount;
}
