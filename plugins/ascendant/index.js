/**
 * Ascendant Stronghold mechanics — the campus-side systems that aren't the augment
 * mechanic itself (that's plugins/augments). Right now: The Threshold move-gate.
 *
 * The Threshold: the far-western chrome campus flaunts itself, but its inner ring
 * turns the uncleared away. The public Gate face (flags.ascension_gate) is always
 * enterable — that's where you get scanned, rejected, or recruited. Every OTHER
 * campus tile (flags.ascendant_campus) is refused to the uncleared, from either the
 * Halcyon side or the Slagworks/Curtain side. Rejection is non-lethal; breaking into
 * a run at the line reads as forcing it and draws a turret warning (the lethal
 * turret fire is a later integration — see docs/proposals/ascendant-stronghold.md).
 *
 * Cleared = an ascendant_clearance flag (granted by the reveal quest chain), OR
 * Ascendant rep ≥ Known, OR you're already chromed (the machine welcomes its own).
 */
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { getFlag } from '../../server/engine/flags.js';
import { getPlayerIdeologyRep, REP_TIERS } from '../../server/engine/ideologies.js';
import { applyStrikeToPlayer } from '../../server/engine/combat.js';
import { handlePlayerDeath } from '../../server/engine/gameLoop.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { riteAction, _test as rite } from './rite.js';
import { _test as lapseTest } from './lapse.js';   // registers the ASC_LAPSE action

const ASCENDANTS = 'ideology_ascendants';
const TIER_RANK = Object.fromEntries(REP_TIERS.map((t, i) => [t.id, i]));
const CLEAR_TIER = TIER_RANK.known; // rep tier that counts as cleared

// Rushing the line the first time earns a warning; forcing it again inside this
// window means the turrets actually fire. Per-player rush state, in memory only.
const RUSH_WINDOW_MS = 12000;
const _rushState = new Map(); // playerId -> { count, at }
function registerRush(playerId) {
  const now = Date.now();
  const prev = _rushState.get(playerId);
  const count = (prev && now - prev.at < RUSH_WINDOW_MS) ? prev.count + 1 : 1;
  _rushState.set(playerId, { count, at: now });
  return count;
}

async function isCleared(player) {
  if (!player) return false;
  if (player.chromed) return true;                              // the chromed are always welcome
  if (await getFlag('player', 'ascendant_clearance', player)) return true;
  const reps = await getPlayerIdeologyRep(player.id).catch(() => []);
  const row = reps.find(r => r.id === ASCENDANTS);
  return (TIER_RANK[row?.tier || 'unknown'] ?? 0) >= CLEAR_TIER;
}

// The move-gate. Exported for the regression harness (mock ctx).
export async function thresholdGate({ player, from, to }) {
  if (!to?.flags?.ascendant_campus) return;      // only campus tiles pay the cost
  if (to.flags?.ascension_gate) return;          // the public Gate face is open to all
  if (from?.flags?.ascendant_campus) return;     // already inside — moving around freely
  if (await isCleared(player)) return;           // cleared → pass

  if (player?.running) {
    const rushes = registerRush(player.id);
    // First rush of a spree: a painted-target warning, no damage.
    if (rushes < 2) {
      return {
        block: true,
        message: `You break into a run at the line — and the turret housings pivot as one, laying targeting light across your chest. A warden's voice, unhurried: "Do not test the Threshold, baseline." You pull up short. <span class="text-dim">(Force it again and they fire. You need Ascendant clearance.)</span>`,
      };
    }
    // You forced it. The turrets fire — energy weapons, soak-reduced, escalating
    // with each further attempt. Enough of this and they cut you down.
    const burst = Math.min(3, rushes - 1); // 2nd rush = 1 burst, capped at 3
    let killed = false, totalDmg = 0, part = 'chest';
    for (let i = 0; i < burst && !killed; i++) {
      const hit = await applyStrikeToPlayer(player, { min: 10, max: 18, damageType: 'energy' });
      totalDmg += hit.damage; part = hit.partLabel; killed = hit.killed;
    }
    if (killed) {
      _rushState.delete(player.id);
      await handlePlayerDeath(player, null, { type: 'combat', label: 'Cut down forcing the Threshold' });
      return { block: true, message: `The Threshold opens fire. Chrome-cased cannon walk a line of fire up your body and you go down at the gate, exactly as promised.` };
    }
    sendToPlayer(player.id, { type: 'player_update', hp: player.hp });
    return {
      block: true,
      message: `<span class="turret-warning">⚠ The Threshold FIRES.</span> Energy cannon lash your ${part} (-${totalDmg} HP). The warden does not raise their voice: "Withdraw, or the next burst finishes it."`,
    };
  }
  return {
    block: true,
    message: `The Ascension Gate reads you head to foot and finds only meat. A warden turns you back without heat and without interest: "This is not for you. Withdraw." <span class="text-dim">(You need Ascendant clearance to pass.)</span>`,
  };
}
registerMoveGate(thresholdGate, 'ascendant:threshold');

// The Rite of Ascension — `ascend` at the Uplink. Campus-side ceremony over an
// economy plugins/augments already owns, which is why it lives here beside the
// Threshold rather than inside the augment mechanic itself.
//
// Exported for the LOADER to register rather than self-registered in rite.js:
// a plugin exporting none of {hooks, commands, routeHandler, specializedActions}
// is skipped by server/engine/plugins.js and never reaches getLoadedPlugins(),
// so until now this plugin worked entirely by import side effect and was
// invisible to the regress manifest sweep. See the note in rite.js.
export const specializedActions = [riteAction];

// Exposed for the regression harness.
export const _test = { thresholdGate, isCleared, rite, lapse: lapseTest };
