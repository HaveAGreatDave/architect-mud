/**
 * Drugs plugin — registers USE and INJECT as tag-gated specialized actions
 * (drug → Use/Inject). Both resolve a carried drug (an item with a row in the
 * drugs table) and delegate the effect to the engine's cmdUse, which applies
 * the drug and consumes it. `use` returns undefined when nothing drug-like
 * matches, so the built-in use path (cosmetic machines, consumables) still runs.
 *
 * Also owns HABITS — the read-out of your own pharmacology. Tolerance, dependency
 * and the withdrawal arc are all modelled server-side but were previously invisible:
 * a player could only infer them from stats moving for no stated reason. This verb
 * formats engine.getDrugStatus(); it deliberately computes nothing itself, so the
 * numbers can never disagree with the laws that produced them.
 */
import { query } from '../../server/models/db.js';
import { cmdUse } from '../../server/engine/commands/inventory.js';
import { getDrugStatus } from '../../server/engine/drugs.js';

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

// The route is the verb: injecting collapses the come-up and hits harder than
// swallowing the same dose. useDrug owns that law and quietly falls back to the
// neutral route for a drug that isn't flagged injectable, so `inject` on a pill
// still works — it just doesn't get the needle's speed.
const useVia = (route) => async (args, raw, player, broadcast) => {
  const targetStr = args.join(' ');
  if (!(await findDrug(targetStr, player))) return undefined;
  return cmdUse(targetStr, player, broadcast, route);
};

export const specializedActions = [
  { verb: 'use', requiredTag: 'drug', handler: useVia('use') },
  { verb: 'inject', requiredTag: 'drug', handler: useVia('inject') },
];

// --- habits: what you're carrying, and what's carrying you --------------------

const sys = (s) => `<span class="msg-system">${s}</span>`;
const dim = (s) => `<span class="text-dim">${s}</span>`;

// Coarse, human durations — nobody wants "11,437 seconds ago".
function ago(sec) {
  if (sec < 60) return 'just now';
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ago`;
}
function soon(sec) {
  if (sec < 60) return 'any minute';
  const m = Math.floor(sec / 60);
  return m < 60 ? `about ${m}m` : `about ${Math.floor(m / 60)}h`;
}
// The severity arc, described rather than numbered — the curve is the engine's.
function bite(sev) {
  if (sev >= 0.9) return 'This is the worst of it.';
  if (sev >= 0.6) return 'It has both hands on you now.';
  if (sev >= 0.35) return 'It is settling in properly.';
  return 'The itch has started.';
}

async function habits(args, raw, player) {
  const rows = await getDrugStatus(player);
  if (!rows.length) {
    return { type: 'output', message: sys("Nothing has its hooks in you. That is worth more than you think.") };
  }

  const lines = [sys('<b>What you are carrying, and what is carrying you.</b>')];
  for (const d of rows) {
    // Pad the plain text BEFORE wrapping it in markup — the client renders these
    // in a monospace log, so the columns only line up if the padding is on the
    // visible characters and not counting tag bytes.
    const name = d.name.length > 16 ? d.name.slice(0, 15) + '…' : d.name.padEnd(16);
    const tol = `tolerance ${String(Math.round(d.tolerance * 100)).padStart(3)}%`;
    const hooked = d.addicted ? '<span class="addiction-warning">HOOKED</span>' : dim('  —   ');
    lines.push(`  <b>${name}</b> ${hooked}  ${dim(tol)}  ${dim('last dose ' + ago(d.sinceLastUse))}`);

    if (d.withdrawalSeverity > 0) {
      const held = d.substituted ? ' Something close enough is holding it off.' : '';
      lines.push(`      <span class="withdrawal-warning">${bite(d.withdrawalSeverity)}${held}</span>`);
    } else if (d.withdrawalIn > 0) {
      lines.push(dim(`      Quiet — ${soon(d.withdrawalIn)} before it starts asking.`));
    }
    if (d.dosesInSystem > 0) {
      // The ceiling is the whole point of the relapse law: it moves with tolerance,
      // so seeing it shrink while you are clean is the warning the system owes you.
      const close = d.dosesInSystem >= d.odCeiling - 1;
      const note = `      ${d.dosesInSystem} still in you — ${d.odCeiling} would be too many.`;
      lines.push(close ? `<span class="overdose-warning">${note}</span>` : dim(note));
    }
  }
  return { type: 'output', message: lines.join('\n') };
}

export const commands = { habits };

// Pure formatters, exposed for the regress suite only (the `_test` convention).
export const _test = { ago, soon, bite };
