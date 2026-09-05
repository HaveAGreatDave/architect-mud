/**
 * Tuning — bringing a machine that works up to the number on the tin.
 *
 * Condition is how beaten up a thing is. Calibration is how well it is TUNED,
 * and the two are deliberately independent: an augment at 100% condition and 62%
 * calibration is physically perfect and running badly, which is a state a player
 * can read and act on. Repair fixes the first. This fixes the second.
 *
 * WHY A SCORE AND NOT A WIN. Every other board in the game is an intrusion
 * fiction that reports a boolean, and a boolean would collapse calibration into a
 * coin flip. The synth/splice family already proved the 0-100 score wire, so this
 * uses it: `resolveForLogRung` returns both shapes and the client hands both to
 * the callback.
 *
 * THE CLIENT IS BOUNDED, NOT TRUSTED. The board's entire authority is ±15 points
 * around a server-side `electronics` check. Skipping it and reporting 100 buys
 * you the top of that band against a roll you still have to make — the same
 * shape as synthesis' ±2, for the same reason.
 *
 * TWO RULES THAT KEEP THE VERB ALIVE:
 *   - A tune NEVER lowers calibration. If a bad roll could make things worse
 *     nobody would ever risk one and the verb would be dead on arrival.
 *   - The board is upside, never a tax. The install bands already hand out
 *     working chrome, so a player who cannot or will not play it is never stuck.
 */
import { randomUUID } from 'crypto';
import { skillCheck, effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { textRender } from '../../server/engine/minigame.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { query } from '../../server/models/db.js';
import { world } from '../../server/engine/world.js';
import { catalog, findAugment, recordOf, persistRec, BOTCHED_CALIBRATION_CAP } from './state.js';

export const TUNING_SKILL = 'electronics';
const PENDING_TTL_MS = 180000;

// playerId -> { augmentId, nonce, difficulty, ts, kitRowId }
const pendingCalibration = new Map();

// The board's whole authority. Wide enough that playing well is worth doing,
// narrow enough that a client reporting a perfect score every time is buying a
// bonus rather than the outcome.
export const BOARD_SWING = 15;

/**
 * Calibration rigs. Better tools lower the difficulty rather than raising the
 * ceiling — a fine instrument makes the job easier, it does not make the machine
 * better than it is. The kit is CONSUMED.
 */
export const RIG_TAGS = ['calibration_rig'];

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/** `calibrate <name>` — open the board. */
export async function cmdCalibrate(args, raw, player) {
  const name = args.join(' ').trim();
  if (!name) return { type: 'error', message: 'Calibrate what? Try: calibrate <augment>' };

  const cache = await catalog();
  const aug = findAugment(cache, name);
  if (!aug) return { type: 'error', message: `No such augment: "${name}".` };
  const rec = recordOf(player, aug.id);
  if (!rec) return { type: 'error', message: `You don't have ${aug.name} installed.` };
  if (Number(rec.condition ?? 1) <= 0) {
    return { type: 'error', message: `${aug.name} is dead. There's nothing in there to tune yet — get it repaired first.` };
  }

  const ceiling = rec.install_quality === 'botched' ? BOTCHED_CALIBRATION_CAP : 100;
  if (rec.calibration >= ceiling) {
    return { type: 'error', message: rec.install_quality === 'botched'
      ? `${aug.name} is at ${rec.calibration}%, which is as far as a botched fitting will ever go.`
      : `${aug.name} is already running at spec.` };
  }

  // A rig in your hands, or a clinic bench under you. Either works; the bench is
  // better, which is a reason to walk somewhere rather than a reason to be stuck.
  const zone = world.zones.get(player.current_zone);
  const bench = !!zone?.flags?.augment_clinic;
  const kit = await resolveInventoryItem(player, { tag: RIG_TAGS });
  if (!bench && !kit) {
    return { type: 'error', message: 'You need a calibration rig in your hands, or a clinic bench to work at.' };
  }

  const difficulty = clamp(
    (Number(aug.install_difficulty) || 5) + (aug.slot === 'neural' ? 2 : 0) - (bench ? 2 : 0),
    1, 14
  );
  const nonce = randomUUID().slice(0, 8);
  pendingCalibration.set(player.id, {
    augmentId: aug.id, nonce, difficulty, ts: Date.now(), kitRowId: bench ? null : kit?.inv_id || null,
  });

  return await textRender(player, {
    type: 'aug_calibration',
    deviceName: aug.name,
    augmentId: aug.id,
    nonce,
    skill: await effectiveSkill(player, TUNING_SKILL),
    difficulty,
    resolveCmd: 'calibrateresolve',
  }, { skill: TUNING_SKILL });
}

/** `calibrateresolve <augmentId> <score> <nonce>` — the client reporting in. */
export async function cmdCalibrateResolve(args, raw, player) {
  const augmentId = args[0];
  const score = clamp(parseInt(args[1], 10) || 0, 0, 100);
  const nonce = args[2];

  const pending = pendingCalibration.get(player.id);
  pendingCalibration.delete(player.id);
  if (!pending || pending.augmentId !== augmentId || pending.nonce !== nonce
      || Date.now() - pending.ts > PENDING_TTL_MS) {
    return { type: 'noop' };
  }

  const cache = await catalog();
  const aug = cache[augmentId];
  const rec = recordOf(player, augmentId);
  if (!aug || !rec) return { type: 'noop' };

  // The kit is spent whatever happens. A tuning rig you get back on a bad run is
  // not a consumable, it is a button.
  if (pending.kitRowId) {
    await query('DELETE FROM player_inventory WHERE id=$1', [pending.kitRowId]);
  }

  const check = await skillCheck(player, TUNING_SKILL, pending.difficulty);
  const board = (score / 100 - 0.5) * 2 * BOARD_SWING;      // -15..+15
  const ceiling = rec.install_quality === 'botched' ? BOTCHED_CALIBRATION_CAP : 100;

  const target = clamp(Math.round(50 + check.margin * 5 + board), 0, ceiling);
  const before = rec.calibration;
  // Never worse. See the header.
  const after = Math.max(before, target);
  rec.calibration = after;
  await persistRec(player, augmentId);   // a deliberate act; written through, not queued

  if (check.success) await awardSkillUse(player.id, TUNING_SKILL, check.margin);

  const gain = after - before;
  const verdict = gain <= 0 ? 'no better'
    : gain < 5 ? 'a shade better'
    : gain < 15 ? 'better'
    : gain < 30 ? 'markedly better'
    : 'transformed';

  const capNote = after >= ceiling && ceiling < 100
    ? `\n<span style="opacity:.7">That's the ceiling a botched fitting left you.</span>`
    : after >= 100 ? `\n<span style="opacity:.7">Spec. It won't go higher — but it can be pushed past it.</span>` : '';

  return { type: 'output', message:
    `<span class="zone-name">${aug.name}</span> — calibration ${before}% → <b>${after}%</b> (${verdict}).${capNote}` };
}

export const _test = { pendingCalibration, BOARD_SWING, TUNING_SKILL };
