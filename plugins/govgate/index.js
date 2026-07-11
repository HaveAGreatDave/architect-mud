/**
 * govgate — the government-quarter security checkpoint at The Steps.
 *
 * North City's NW enclave (the govt/elite quarter) is sealed to two ways in: The
 * Steps (the front stair, `zone_civ_steps` → `zone_up_vellum`) and The Under
 * (`zone_gov_mezzanine` ↓, the covert tunnel). This plugin guards THE STEPS only —
 * the Under is deliberately left unwatched, the smuggler's way in.
 *
 * Entering the checkpoint zone (`flags.gov_checkpoint`) from OUTSIDE the enclave
 * (i.e. not from another `flags.gov_enclave` tile) runs two checks:
 *   1. WANTED — a hard turn-away. Any active wanted star and the guards bounce you;
 *      no felons in the government quarter. Clear your record (or take the Under).
 *   2. CONTRABAND — a scanner. Carrying raw drug material or any `contraband`-tagged
 *      item runs a Deception check (bagged goods count — the scanner sees through a
 *      coat). Pass → through; fail → a `contraband_possession` charge + the guards
 *      APPREHEND you (the shared arrest engine: submit/run → booking, palm-search) +
 *      a short guard-heat cooldown.
 *
 * Moving AROUND inside the quarter (enclave → checkpoint tile) never triggers it —
 * only crossing IN from the outside does. Content flags the tiles
 * (scripts/add-gov-checkpoint.js); the drop of hardcoded zone ids stays in content.
 *
 * DORMANT as of the legacy-world decommission (2026-07-11): the North City gov
 * quarter it guarded lived only on the old overworld, which is being retired. No
 * zone currently carries `gov_checkpoint`, so this gate registers but never fires.
 * The plugin is kept intact deliberately — re-flag a checkpoint tile
 * (`gov_checkpoint` + the enclave with `gov_enclave`) when North City is rebuilt in
 * the district and it wakes back up untouched. See
 * docs/proposals/north-city-under-rebuild.md.
 */
import { query } from '../../server/models/db.js';
import { skillCheck } from '../../server/engine/skills.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getFlag } from '../../server/engine/flags.js';

const SCAN_DIFF = 7;                          // government security is tighter than a wasteland border
const HEAT_MS = 45_000;                       // a flagged scan keeps the guards on you this long

const heat = new Map();                       // playerId → epoch ms the checkpoint stays hot

registerMoveGate(async ({ player, from, to }) => {
  if (!to?.flags?.gov_checkpoint) return;      // cheap: only the gate tile pays for the checks
  if (from?.flags?.gov_enclave) return;        // already inside the quarter — moving around, not entering

  // 1. Wanted → hard turn-away (no bluffing a rap sheet at a security desk).
  const stars = Number(await getFlag('player', 'wanted', player)) || 0;
  if (stars > 0) {
    return { block: true, message: `The checkpoint scanner reads your record and lights up red. "No entry — clear your warrants first." The guards wave you back down The Steps. <span class="text-dim">(You're wanted. Lose the heat, or find another way in.)</span>` };
  }

  // 2. Contraband scan — raw drug material or anything tagged contraband (bagged counts).
  const { rows } = await query(
    `SELECT 1 FROM player_inventory pi JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id=$1 AND (jsonb_exists(i.tags,'raw_drug') OR jsonb_exists(i.tags,'contraband')) LIMIT 1`,
    [player.id]).catch(() => ({ rows: [] }));
  if (!rows.length) return;                    // clean → walk through

  if (Date.now() < (heat.get(player.id) || 0))
    return { block: true, message: 'The checkpoint guards are still watching you from the last pass — hang back, or slip in another way.' };

  const chk = await skillCheck(player, 'deception', SCAN_DIFF);
  if (chk.success) {
    sendToPlayer(player.id, { type: 'output', message: `<span class="ambient">You keep your coat closed and your story straight. The scanner blinks green; the guard nods you up into the quarter.</span>` });
    return;                                    // pass (no XP award — a gate, not a training ground; avoids a farm)
  }

  // Caught. Charge the contraband, then the guards move to detain you — the same
  // arrest a street cop runs (submit/run → booking, with a shot to palm the goods).
  heat.set(player.id, Date.now() + HEAT_MS);
  await dispatchAction({ type: 'CHARGE_CRIME', actor: player, params: { key: 'contraband_possession' } });
  await dispatchAction({ type: 'APPREHEND', actor: player, params: { officer: 'The checkpoint guards' } });
  return { block: true, message: `The scanner shrills — <b>contraband</b>. The guards close on you at the top of The Steps — no bolting out of this one.` };
}, 'govgate:checkpoint');
