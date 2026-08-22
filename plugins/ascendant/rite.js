/**
 * The Rite of Ascension — `ascend` at the Uplink.
 *
 * WHAT THIS IS NOT. It is not a cutscene, and it does not grant anything. The
 * entire mechanism was already shipping as ECONOMY, spread across three player
 * commands nobody had a reason to string together:
 *
 *   `augment install cortical backup`  (rep_gate inner_circle — the summit rung)
 *   `assurance`                        (buy the policy: restores_remaining)
 *   `backup`                           (commit the pattern: pattern_at)
 *
 * With all three standing, plugins/augments' `player.respawnZone` hook claims
 * your next death: you get up in the Vats instead of the Architect's free vat,
 * your chrome is NOT corrupted (corruption skips a claimed death), and the death
 * event carries `claimed: true` — which is what the quests plugin's `restore`
 * objective reads. So this file's whole job is to be the thing that kills you,
 * on purpose, in the right room, having checked that somebody is going to catch
 * you. Delete it and the Ascendant economy is unchanged.
 *
 * WHY THE CHECKS ARE HERE AND NOT IN THE QUEST. A quest objective can say "die a
 * claimed death"; it cannot say "and if nobody has your pattern, don't". Walking
 * into the Uplink uninsured has to be REFUSED rather than survived — the failure
 * mode is a player pressing the button on the strength of the ceremony and
 * simply dying, in the ordinary way, having been told for two quests that this
 * was survivable. That would be the game lying.
 *
 * ⚠ THE WANTED CHECK IS NOT DECORATION. `onRespawnZone` (plugins/augments/
 * backup.js) declines to claim the death of anybody at 1★ or more — the police
 * take that body. So a wanted player at the Uplink would die UNCLAIMED: no
 * restore, chrome corrupted, quest not advanced. Same refusal, stated here in
 * advance rather than discovered afterwards.
 */
import { handlePlayerDeath } from '../../server/engine/gameLoop.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getFlag } from '../../server/engine/flags.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { getZoneFurniture } from '../../server/engine/world.js';
import { query } from '../../server/models/db.js';

// Arm-then-run, copied deliberately from the Purifier (plugins/psionics/
// purifier.js): the first `ascend` prints the bill, a second inside the window
// does it. The two rituals are each other's undoing and it is right that they
// ask the same way.
const CONFIRM_MS = 30_000;
const pending = new Map(); // playerId -> armed at

const CORTICAL = 'aug_cortical_backup';

/** Everything that has to be true before the Vats will catch you. */
async function readiness(player) {
  const { rows: aug } = await query(
    'SELECT augment_id FROM player_augments WHERE player_id=$1 AND augment_id=$2',
    [player.id, CORTICAL],
  );
  const { rows: bk } = await query(
    'SELECT pattern_at, restores_remaining FROM player_backups WHERE player_id=$1',
    [player.id],
  );

  let wanted = parseFloat(await getFlag('player', 'wanted', player) || '0') || 0;
  try {
    const r = await dispatchAction({ type: 'WANTED_PEAK', actor: player });
    if (typeof r?.peak === 'number') wanted = Math.max(wanted, r.peak);
  } catch { /* surveillance not loaded — the flag stands */ }

  return {
    chrome: aug.length > 0,
    pattern: !!bk[0]?.pattern_at,
    policy: (Number(bk[0]?.restores_remaining) || 0) >= 1,
    clean: Math.floor(wanted) < 1,
  };
}

/**
 * The refusals. Each one names the missing thing and where to go and get it,
 * because this is the one system in the game where being coy would read as the
 * ceremony hiding a cost rather than the ceremony having one.
 */
function refusal(r) {
  if (!r.chrome) {
    return 'The terminal reads you, finds no pattern-grade hardware in your skull, and declines.\n'
      + '<span class="text-dim">There is nothing here to copy. The Cortical Backup is fitted at the clinic, and it is not cheap, and that is the point of it.</span>';
  }
  if (!r.policy) {
    return 'The terminal reads the hardware, finds the account behind it empty, and declines.\n'
      + '<span class="text-dim">A backup with no policy behind it is a photograph. Buy the assurance first (`assurance`), or the Vats have no instruction to print you.</span>';
  }
  if (!r.pattern) {
    return 'The terminal finds hardware and a paid policy, and no scan on file, and declines.\n'
      + '<span class="text-dim">Nothing of you has been committed yet. Go to the Vats Registry and `backup` — what you commit there is exactly who gets up afterwards.</span>';
  }
  if (!r.clean) {
    return 'The terminal reads you, hesitates in a way machines are not supposed to, and declines.\n'
      + '<span class="text-dim">There is a warrant against this body. The police take a wanted corpse before Halcyon does, and Halcyon will not contest it — they will simply not collect. Settle it, then come back.</span>';
  }
  return null;
}

function warning() {
  return [
    '<span class="hdr">THE UPLINK</span>',
    '<span class="ambient">You put both hands on the terminal. It is colder than the room, and the room is cold.</span>',
    '',
    '<span class="dmg-taken">This will kill you.</span>',
    '<span class="text-dim">Not metaphorically, and not gently. The pattern held in the Vats is the one you committed, not the one standing here — anything you have become since your last scan is not in it.</span>',
    '',
    '<span class="ambient">Somewhere behind you, Orrin is not saying anything.</span>',
    '',
    '<span class="text-dim">`ascend` again within thirty seconds to go through with it.</span>',
  ].join('<br>');
}

/**
 * Exported as a DESCRIPTOR rather than self-registered at import time.
 *
 * Both work — the module body runs either way, which is how this plugin's move
 * gate has always registered itself — but a plugin exporting none of {hooks,
 * commands, routeHandler, specializedActions} is SKIPPED by the loader
 * (server/engine/plugins.js) and never reaches `getLoadedPlugins()`. It still
 * functions, by side effect, while being invisible to the regress manifest
 * sweep. Handing the loader the descriptor puts the plugin back on the books.
 */
export const riteAction = {
  verb: 'ascend',
  requiredFlag: 'asc_rite',
  handler: async (args, raw, player, broadcast) => {
      // SELF-GATE. `requiredFlag` drives discoverability (examine hints, the
      // smart bar) — it does NOT stop the verb being typed anywhere in the
      // Basin, because `fireSpecializedAction` fires every registered handler
      // and expects each one to resolve its own target. Returning `undefined`
      // falls through to whatever else claims the verb, which for `ascend` is
      // nothing, so the player gets the ordinary unknown-command answer.
      const terminal = getZoneFurniture(player.current_zone).find(f => f.flags?.asc_rite);
      if (!terminal) return undefined;

      const r = await readiness(player);
      const no = refusal(r);
      if (no) {
        pending.delete(player.id);
        return { type: 'error', message: no };
      }

      const armed = pending.get(player.id);
      if (!armed || Date.now() - armed > CONFIRM_MS) {
        pending.set(player.id, Date.now());
        return { type: 'output', message: warning() };
      }
      pending.delete(player.id);

      if (broadcast && player.current_zone) {
        broadcast(player.current_zone, {
          type: 'zone_event', refresh: true,
          message: `${player.handle} puts both hands on the Uplink terminal, and the hum stops.`,
        }, player.id);
      }

      sendToPlayer(player.id, { type: 'output', message: [
        '<span class="ambient">The white fire comes through the glass to meet you, which it has not done before.</span>',
        '<span class="dmg-taken">It is very quick, and it is not painless, and you are aware of both.</span>',
      ].join('<br>') });

      // The ordinary death path, deliberately. Everything that makes this the
      // RITE rather than a suicide happens downstream of here, in code this file
      // does not touch: the respawn hook claims it, the Vats print you, the
      // corruption pass stands down, and `player.death` carries `claimed: true`
      // for the quest to read. Writing a bespoke death here would skip all four.
      await handlePlayerDeath(player, null, { type: 'rite', label: 'the Rite of Ascension' });

      return { type: 'output', message: '' };
  },
};

export const _test = { readiness, refusal, warning, CONFIRM_MS, pending };
