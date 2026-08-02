import { query, withTransaction } from '../../server/models/db.js';
import { textRender } from '../../server/engine/minigame.js';
import { getZone, getZoneNpcs, updateFurniture, deleteFurniture } from '../../server/engine/world.js';
import { schedule } from '../../server/engine/scheduler.js';
import { transferCredits } from '../../server/engine/economy.js';
import { awardSkillUse, effectiveSkill } from '../../server/engine/skills.js';
import { getPowerMap } from '../../server/engine/environment.js';
import { emit } from '../../server/engine/events.js';
import { getReputation } from '../../server/engine/ideologies.js';
import { gameMsToReal } from '../../server/engine/gametime.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
// Jacking a terminal requires physically carrying a deck — no skill roll gates
// the attempt, just possession of the tool. Which deck now matters: see
// server/engine/hack-gear.js for the penalty/fragility contract.
import { hasHackDeck, hackDifficulty, damageHackDeck, breachMargin } from '../../server/engine/hack-gear.js';

// The banking ledger (bank_transactions). Written from every successful move in
// either direction, whichever path it came through (the ATM's own `deposit`/
// `withdraw` or Tablet's remote transfers), so the Bank app's Transaction
// History has one consistent source.
//
// This is no longer display-only: the 24-hour allowance below is a SUM over this
// table, so an ATM transaction that isn't logged here is one that never counted.
// `networkId` is what scopes the allowance — pass null for anything that should
// spend nobody's allowance (a teller counter, a remote tablet transfer).
export async function logBankTx(playerId, type, amount, balanceAfter, networkId = null) {
  await query(
    'INSERT INTO bank_transactions (player_id, type, amount, balance_after, network_id) VALUES ($1,$2,$3,$4,$5)',
    [playerId, type, amount, balanceAfter, networkId]
  );
}

async function findAtmById(id) {
  const { rows } = await query(`
    SELECT f.id, f.name, f.zone_id,
           a.network_id, a.cash_stock, a.cash_max, a.hack_difficulty, a.is_broken
    FROM furniture f LEFT JOIN atm_units a ON a.id = f.id
    WHERE f.id = $1`, [id]);
  return rows[0] || null;
}

async function findAtmInZone(zoneId, nameHint) {
  let sql = `
    SELECT f.id, f.name, f.zone_id,
           a.network_id, a.cash_stock, a.cash_max, a.replenish_interval_hours,
           a.last_replenish, a.hack_difficulty, a.is_broken,
           n.name AS network_name, n.color, n.fee_rate, n.withdrawal_limit,
           n.min_faction_rep, n.faction_id
    FROM furniture f
    LEFT JOIN atm_units a ON a.id = f.id
    LEFT JOIN atm_networks n ON n.id = a.network_id
    WHERE f.zone_id = $1 AND jsonb_exists(f.flags, 'atm')`;
  const params = [zoneId];
  if (nameHint) {
    sql += ` AND f.name ILIKE $2`;
    params.push(`%${nameHint}%`);
  }
  sql += ` LIMIT 1`;
  const { rows } = await query(sql, params);
  return rows[0] || null;
}

// ── The counter vs. the machine ──────────────────────────────────────────────
// A cash terminal is a hole in the wall with a drum of notes in it: it will move
// pocket money and nothing more. The network's `withdrawal_limit` is what it will
// move for you IN A ROLLING 24 HOURS, in BOTH directions at a physical ATM —
// deposits too, since the machine has to physically eat the notes. Anything
// bigger is a conversation with a human (or, in Citadel's case, TELLER UNIT 04),
// which is the whole point: big money has to walk into a bank and be looked at by
// something that can testify.
//
// It used to be a PER-TRANSACTION ceiling, which meant it wasn't a limit at all —
// you stood at the machine and ran the same maximum deposit until you'd moved
// everything you owned. A window is the only shape that actually bites.
//
// A teller is any live NPC flagged `bank_teller`. Being in the same ROOM as one is
// deliberately not enough — the Citadel hall holds both the teller and its own
// terminals, and a machine there is still just a machine. You have to address the
// teller: `withdraw 9000 from teller`. Only then does the cap lift.
//
// The one convenience: in a room with a teller and NO ATM furniture, a bare
// `deposit`/`withdraw` goes to the counter, because there is nothing else it could
// possibly mean.
export const DEFAULT_TXN_CAP = 2500;

function tellersInZone(zoneId) {
  return getZoneNpcs(zoneId).filter(n => n?.flags?.bank_teller);
}

// Strip a trailing `[from|to|with|at] <name>` off a deposit/withdraw and resolve it
// against the tellers standing in the room. This is a complex-arg command (the
// amount rides along with the target), so per docs/commands.md it uses SIFT scoring
// but errors on ambiguity rather than opening the disambiguation UI — replaying it
// with only a candidate name would drop the amount.
//
// Returns { teller, named, error }:
//   named=false → the player addressed nobody
//   error       → they named someone who isn't a teller here (or an ambiguous one)
function resolveTeller(args, zoneId) {
  const rest = args.slice(1).filter(Boolean);
  const words = ['from', 'to', 'with', 'at'].includes((rest[0] || '').toLowerCase())
    ? rest.slice(1) : rest;
  const q = words.join(' ').trim();
  if (!q) return { teller: null, named: false, error: null };

  const tellers = tellersInZone(zoneId);
  const nobody = { teller: null, named: true, error: `There's nobody here called "${q}" to bank with.` };
  if (!tellers.length) return nobody;

  // "teller" is the generic — accept it when exactly one is standing here.
  if (/^(the )?teller$/i.test(q) && tellers.length === 1) return { teller: tellers[0], named: true, error: null };

  const r = siftResolve(q, tellers);
  if (r.type === 'ambiguous') return { teller: null, named: true, error: 'More than one teller matches — be more specific.' };
  if (r.type !== 'match' || !r.candidate) return nobody;
  return { teller: r.candidate, named: true, error: null };
}

// The size of the allowance: null (uncapped) when a teller is being addressed,
// else the machine's network limit. The number is unchanged — what changed is
// that it now covers a 24-hour window rather than a single transaction.
export function txnCap(atm, teller) {
  if (teller) return null;
  return atm?.withdrawal_limit ?? DEFAULT_TXN_CAP;
}

// ── The 24-hour allowance ────────────────────────────────────────────────────
// Rolling, not a daily reset: the window is always "the last 24 hours from right
// now", summed at check time off bank_transactions. No counter to store, nothing
// to reset on a tick, no drift if the server restarts, and no midnight at which
// everyone's limit refills at once.
//
// Scoped PER NETWORK — hitting Citadel's ceiling leaves a rival's terminals open,
// which is what finally gives atm_units.network_id a job. An unlinked terminal
// keys off its own furniture id so it can't be used as a limitless side door.
//
// The two directions are SEPARATE buckets: banking a day's earnings must not stop
// you drawing walking-around money back out.
export const ALLOWANCE_WINDOW_SEC = 24 * 60 * 60;

// The allowance key for a terminal. Never call this for a teller — the counter
// has no allowance and logs network_id null.
export function networkKey(atm) {
  return atm?.network_id || `atm:${atm?.id}`;
}

// What's left of the allowance right now, plus when the oldest transaction still
// inside the window ages out — which is the moment some of it comes back, and the
// only honest thing to tell a player who has hit the ceiling.
// Returns { cap, spent, remaining, resetsInSec }.
export async function allowanceFor(playerId, atm, type) {
  const cap = txnCap(atm, null);
  if (cap == null) return { cap: null, spent: 0, remaining: Infinity, resetsInSec: 0 };
  const netKey = networkKey(atm);
  const cutoff = Math.floor(Date.now() / 1000) - ALLOWANCE_WINDOW_SEC;
  const { rows } = await query(
    `SELECT COALESCE(SUM(amount), 0)::int AS spent, MIN(created_at) AS oldest
       FROM bank_transactions
      WHERE player_id = $1 AND network_id = $2 AND type = $3 AND created_at > $4`,
    [playerId, netKey, type, cutoff]
  );
  const spent = rows[0]?.spent || 0;
  const oldest = rows[0]?.oldest != null ? Number(rows[0].oldest) : null;
  return {
    cap,
    spent,
    remaining: Math.max(0, cap - spent),
    resetsInSec: oldest == null ? 0 : Math.max(0, oldest + ALLOWANCE_WINDOW_SEC - Math.floor(Date.now() / 1000)),
  };
}

// "3h 20m" / "18m" — the wait until the window gives something back.
export function fmtWindowWait(sec) {
  if (sec <= 0) return 'shortly';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}

// The refusal a machine gives when you ask it for more than it will still move
// today. Names the way out, so the player learns the cap is a door and not a dead
// end — a teller if one is standing there, otherwise the clock. Says what's left
// rather than only what the ceiling is, because after the first transaction those
// are different numbers and only one of them is actionable.
export function overCapMessage(kind, amount, allowance, atm, teller) {
  const verb = kind === 'deposit' ? 'accept' : 'dispense';
  const net = atm?.network_name || 'This terminal';
  const out = teller
    ? `Try "${kind} ${amount} from ${String(teller.name || 'teller').split(' ')[0].toLowerCase()}".`
    : `Walk it into a bank and speak to a teller, or come back in ${fmtWindowWait(allowance.resetsInSec)}.`;
  const spent = allowance.spent > 0
    ? ` You've already moved ${allowance.spent}c through it in the last 24 hours, leaving ${allowance.remaining}c.`
    : '';
  return `${net} won't ${verb} more than ${allowance.cap}c in any 24 hours — you asked for ${amount}c.${spent} ${out}`;
}

function isZonePowered(zoneId) {
  const map = getPowerMap();
  const z = map.find(e => e.zoneId === zoneId);
  // Zones not in the power map (no generator assigned) are treated as powered.
  return !z || z.status === 'powered' || z.status === 'overloaded';
}

async function checkFactionAccess(player, atm) {
  if (!atm.faction_id || atm.min_faction_rep == null || atm.min_faction_rep <= -200) return true;
  // getReputation, not a raw SELECT — standing decays toward its resting point,
  // and a gate reading the stored checkpoint would lock you out over a grudge
  // the rest of the game has already let go of.
  return (await getReputation(player.id, atm.faction_id)) >= atm.min_faction_rep;
}

async function buildAtmPanel(atm, player, powered) {
  // Two independent buckets, so two reads — the screen has to show both before
  // the player commits to a direction. Independent, so they go together.
  const [dep, wd] = await Promise.all([
    allowanceFor(player.id, atm, 'deposit'),
    allowanceFor(player.id, atm, 'withdraw'),
  ]);
  return {
    type: 'atm_panel',
    atmId: atm.id,
    name: atm.name,
    network: {
      id: atm.network_id || null,
      name: atm.network_name || 'UNLINKED',
      color: atm.color || '#00ff88',
      fee_rate: parseFloat(atm.fee_rate) || 0,
      withdrawal_limit: atm.withdrawal_limit ?? DEFAULT_TXN_CAP,
    },
    // The 24h allowance at this machine. A machine is ALWAYS capped — the bypass
    // is addressing a teller, not standing near one, so a terminal in the bank
    // hall is still just a terminal.
    txnCap: txnCap(atm, null),
    // What's actually left in each direction, which is what the MAX button clamps
    // to — it must never propose an amount the machine will refuse. `resetsIn` is
    // seconds until the window gives some back, 0 when nothing has been spent.
    allowance: {
      deposit:  { remaining: dep.remaining, spent: dep.spent, resetsIn: dep.resetsInSec },
      withdraw: { remaining: wd.remaining,  spent: wd.spent,  resetsIn: wd.resetsInSec },
    },
    cashStock: atm.cash_stock ?? 5000,
    cashMax: atm.cash_max ?? 5000,
    powered,
    isBroken: !!atm.is_broken,
    // Shown on the terminal readout, so it must be the number the minigame will
    // actually run — deck penalty included.
    hackDifficulty: await hackDifficulty(player.id, atm.hack_difficulty),
    hackingSkill: await effectiveSkill(player, 'hacking'),
    hasHackDevice: await hasHackDeck(player.id),
    maintenanceUnlocked: hasMaintenanceAccess(atm.id, player.id),
    player: { credits: player.credits || 0, bank_credits: player.bank_credits || 0 },
  };
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdAtm(args, raw, player) {
  const zone = getZone(player.current_zone);
  const nameHint = args.join(' ') || null;
  const atm = await findAtmInZone(player.current_zone, nameHint);

  if (!atm) {
    // Legacy zone-flag fallback
    if (zone?.flags?.has_atm) {
      return {
        type: 'output',
        message: `[ATM TERMINAL]\nCarried: ${player.credits || 0}c  Banked: ${player.bank_credits || 0}c\n\nUse: deposit <amount> · withdraw <amount>`,
      };
    }
    return { type: 'error', message: "There's no ATM here." };
  }

  return await buildAtmPanel(atm, player, isZonePowered(player.current_zone));
}

// Specialized action: use <atm-named-furniture>
async function doUseAtm(args, raw, player) {
  const nameHint = args.join(' ') || null;
  const atm = await findAtmInZone(player.current_zone, nameHint);
  if (!atm) return undefined; // fall through to next handler
  return await buildAtmPanel(atm, player, isZonePowered(player.current_zone));
}

async function cmdDeposit(args, raw, player) {
  const amountStr = args[0];
  const zone = getZone(player.current_zone);
  const atm = await findAtmInZone(player.current_zone);
  const addressed = resolveTeller(args, player.current_zone);
  if (addressed.error) return { type: 'error', message: addressed.error };
  // A bare command in a machineless room still falls to the counter — nothing else it could mean.
  const teller = addressed.teller || (!atm ? tellersInZone(player.current_zone)[0] || null : null);

  // The counter path: a teller you addressed, or a room with no machine in it. Bypasses
  // the terminal entirely — no power gate, no cash drum, no network fee, no cap.
  if (teller || !atm) {
    if (!teller && !zone?.flags?.has_atm) return { type: 'error', message: "There's no ATM here." };
    const amount = amountStr === 'all' ? (player.credits || 0) : parseInt(amountStr, 10);
    if (!amount || amount <= 0) return { type: 'error', message: 'Deposit how much? Try "deposit 50" or "deposit all".' };
    if (!await transferCredits(player, amount, 'deposit')) return { type: 'error', message: `You only have ${player.credits || 0}c on you.` };
    await logBankTx(player.id, 'deposit', amount, player.bank_credits);
    const at = teller ? ` ${teller.name} counts it twice and does not comment on where it came from.` : '';
    return { type: 'deposit', message: `You deposit ${amount}c.${at} Carried: ${player.credits}c · Banked: ${player.bank_credits}c`, player_update: { credits: player.credits, bank_credits: player.bank_credits } };
  }

  if (atm.is_broken) return { type: 'error', message: 'The ATM is damaged. Try another terminal.' };
  if (!isZonePowered(player.current_zone)) return { type: 'error', message: 'The ATM screen is dark — no power.' };
  if (!await checkFactionAccess(player, atm)) return { type: 'error', message: `${atm.network_name || 'This network'} requires higher standing to access.` };

  // What this network will still take from you inside the rolling 24h window
  // (lifted at a teller's counter). `all` clamps down to what's left and says so;
  // an explicit over-allowance amount is refused outright rather than quietly
  // shaved, so nobody moves less money than they meant to.
  const allowance = await allowanceFor(player.id, atm, 'deposit');
  let amount = amountStr === 'all' ? (player.credits || 0) : parseInt(amountStr, 10);
  if (!amount || amount <= 0) return { type: 'error', message: 'Deposit how much? Try "deposit 50" or "deposit all".' };
  // Exhausted allowance is its own refusal — clamping `all` to zero would
  // otherwise fall through as a nonsense "deposit 0c".
  if (allowance.cap != null && allowance.remaining <= 0) {
    return { type: 'error', message: `${atm.network_name || 'This terminal'} has taken its ${allowance.cap}c from you for today. The slot won't open again for ${fmtWindowWait(allowance.resetsInSec)} — a teller has no such limit.` };
  }
  let capNote = '';
  if (allowance.cap != null && amount > allowance.remaining) {
    if (amountStr !== 'all') return { type: 'error', message: overCapMessage('deposit', amount, allowance, atm, tellersInZone(player.current_zone)[0]) };
    amount = allowance.remaining;
    capNote = ` The slot takes ${amount}c and stops — that's the rest of what it'll swallow today.`;
  }

  // Move the credits and fill the machine as one atomic unit.
  const newStock = Math.min((atm.cash_max ?? 5000), (atm.cash_stock ?? 0) + amount);
  const moved = await withTransaction(async (q) => {
    if (!await transferCredits(player, amount, 'deposit', q)) return false;
    await q('UPDATE atm_units SET cash_stock=$1 WHERE id=$2', [newStock, atm.id]);
    return true;
  });
  if (!moved) return { type: 'error', message: `You only have ${player.credits || 0}c on you.` };
  // Must carry the network key — an unlogged move is a move that never counted
  // against the allowance.
  await logBankTx(player.id, 'deposit', amount, player.bank_credits, networkKey(atm));

  return {
    type: 'deposit',
    message: `You deposit ${amount}c.${capNote} Carried: ${player.credits}c · Banked: ${player.bank_credits}c`,
    player_update: { credits: player.credits, bank_credits: player.bank_credits },
    atm_cash_stock: newStock,
    atm_allowance: { deposit: Math.max(0, allowance.remaining - amount) },
  };
}

async function cmdWithdraw(args, raw, player) {
  const amountStr = args[0];
  const zone = getZone(player.current_zone);
  const atm = await findAtmInZone(player.current_zone);
  const addressed = resolveTeller(args, player.current_zone);
  if (addressed.error) return { type: 'error', message: addressed.error };
  const teller = addressed.teller || (!atm ? tellersInZone(player.current_zone)[0] || null : null);

  // The counter path: a teller you addressed, or a room with no machine in it. Bypasses
  // the terminal entirely — no power gate, no cash drum, no network fee, no cap.
  if (teller || !atm) {
    if (!teller && !zone?.flags?.has_atm) return { type: 'error', message: "There's no ATM here." };
    const amount = amountStr === 'all' ? (player.bank_credits || 0) : parseInt(amountStr, 10);
    if (!amount || amount <= 0) return { type: 'error', message: 'Withdraw how much? Try "withdraw 50" or "withdraw all".' };
    if (!await transferCredits(player, amount, 'withdraw')) return { type: 'error', message: `You only have ${player.bank_credits || 0}c banked.` };
    const at = teller ? ` ${teller.name} counts it out in banded notes, unhurried, and slides them under the glass.` : '';
    return { type: 'withdraw', message: `You withdraw ${amount}c.${at} Carried: ${player.credits}c · Banked: ${player.bank_credits}c`, player_update: { credits: player.credits, bank_credits: player.bank_credits } };
  }

  if (atm.is_broken) return { type: 'error', message: 'The ATM is damaged. Try another terminal.' };
  if (!isZonePowered(player.current_zone)) return { type: 'error', message: 'The ATM screen is dark — no power.' };
  if (!await checkFactionAccess(player, atm)) return { type: 'error', message: `${atm.network_name || 'This network'} requires higher standing to access.` };

  // A network dispenses at most its `withdrawal_limit` to you in any rolling 24
  // hours — the drum only holds so many notes and a face that keeps coming back
  // gets remembered. Bigger sums go to a teller (see txnCap), where the ceiling
  // lifts. Inside the allowance you're still bounded by the machine's cash stock
  // and what you have banked.
  //
  // The allowance is spent by the amount DISPENSED, not the amount debited: the
  // network's own fee should not eat into what it will hand you.
  const cashAvail = atm.cash_stock ?? 0;
  const banked = player.bank_credits || 0;
  const feeRate = parseFloat(atm.fee_rate) || 0;
  const allowance = await allowanceFor(player.id, atm, 'withdraw');

  if (allowance.cap != null && allowance.remaining <= 0) {
    return { type: 'error', message: `${atm.network_name || 'This terminal'} has dispensed its ${allowance.cap}c to you for today. The drum stays shut for another ${fmtWindowWait(allowance.resetsInSec)} — a teller has no such limit.` };
  }

  let rawAmount;
  let capNote = '';
  if (amountStr === 'all') {
    // Max the cash stock can dispense and the balance can cover after the fee.
    // fee is on top: banked >= rawAmount + ceil(rawAmount * feeRate) ⇒ rawAmount <= banked/(1+feeRate)
    const maxByFunds = feeRate > 0 ? Math.floor(banked / (1 + feeRate)) : banked;
    rawAmount = Math.min(cashAvail, maxByFunds);
    if (allowance.cap != null && rawAmount > allowance.remaining) {
      rawAmount = allowance.remaining;
      capNote = ` The drum stops at ${rawAmount}c — that's the rest of this network's day.`;
    }
  } else {
    rawAmount = parseInt(amountStr, 10);
  }

  if (!rawAmount || rawAmount <= 0) return { type: 'error', message: 'Withdraw how much? Try "withdraw 50" or "withdraw all".' };
  if (allowance.cap != null && rawAmount > allowance.remaining) return { type: 'error', message: overCapMessage('withdraw', rawAmount, allowance, atm, tellersInZone(player.current_zone)[0]) };
  if (rawAmount > cashAvail) return { type: 'error', message: `ATM is low on cash. Max available: ${cashAvail}c.` };

  const fee = feeRate > 0 ? Math.ceil(rawAmount * feeRate) : 0;
  const totalDebited = rawAmount + fee;

  if (banked < totalDebited) {
    const feeNote = fee > 0 ? ` (${fee}c network fee)` : '';
    return { type: 'error', message: `Need ${totalDebited}c${feeNote} but you only have ${banked}c banked.` };
  }

  // Debit bank (raw + fee), credit only rawAmount carried (the fee evaporates
  // into the network), and draw down the machine's cash — one atomic unit. The
  // guarded UPDATE also blocks a concurrent second withdrawal from overdrawing.
  const newStock = Math.max(0, cashAvail - rawAmount);
  const dispensed = await withTransaction(async (q) => {
    const res = await q(
      'UPDATE players SET bank_credits = bank_credits - $1, credits = credits + $2 WHERE id = $3 AND bank_credits >= $1 RETURNING credits, bank_credits',
      [totalDebited, rawAmount, player.id]);
    if (res.rowCount === 0) return false;
    player.credits      = res.rows[0].credits;
    player.bank_credits = res.rows[0].bank_credits;
    await q('UPDATE atm_units SET cash_stock=$1 WHERE id=$2', [newStock, atm.id]);
    return true;
  });
  if (!dispensed) return { type: 'error', message: `Need ${totalDebited}c but you only have ${player.bank_credits || 0}c banked.` };
  // Withdrawals were historically unlogged — the ledger was deposits-only. They
  // must be logged now or the withdrawal allowance can never be spent.
  await logBankTx(player.id, 'withdraw', rawAmount, player.bank_credits, networkKey(atm));

  const feeMsg = fee > 0 ? ` (−${fee}c ${atm.network_name || 'network'} fee)` : '';
  return {
    type: 'withdraw',
    message: `You withdraw ${rawAmount}c${feeMsg}.${capNote} Carried: ${player.credits}c · Banked: ${player.bank_credits}c`,
    player_update: { credits: player.credits, bank_credits: player.bank_credits },
    atm_cash_stock: newStock,
    atm_allowance: { withdraw: Math.max(0, allowance.remaining - rawAmount) },
  };
}

// Per-player lockout after a failed hack (in-memory, resets on server restart)
const jackLockout = new Map();

// A successful jack drops the hacker into MAINTENANCE mode on that specific
// terminal instead of paying out immediately — the ATM panel then shows an
// "EJECT ALL CREDITS" option. In-memory, keyed by atm id -> Set of player ids.
const atmMaintenanceAccess = new Map();

function hasMaintenanceAccess(atmId, playerId) {
  return !!atmMaintenanceAccess.get(atmId)?.has(playerId);
}

function grantMaintenanceAccess(atmId, playerId) {
  if (!atmMaintenanceAccess.has(atmId)) atmMaintenanceAccess.set(atmId, new Set());
  atmMaintenanceAccess.get(atmId).add(playerId);
}

function revokeMaintenanceAccess(atmId, playerId) {
  atmMaintenanceAccess.get(atmId)?.delete(playerId);
}

// jack — arms a breach attempt. No skill roll gates this: the Circuit Breach
// minigame itself (client-side) is what decides success, reported back via
// `jackresolve`. The only server-side gate is physically carrying a hacking
// device (see HACK_DEVICE_ITEM_ID).
async function cmdJack(args, raw, player) {
  const atm = await findAtmInZone(player.current_zone);
  if (!atm) return { type: 'error', message: "Nothing worth jacking here." };
  if (atm.is_broken) return { type: 'error', message: 'This terminal is already dead.' };
  if (!isZonePowered(player.current_zone)) return { type: 'error', message: "The ATM is powered down — nothing to jack." };
  if (!atm.cash_stock || atm.cash_stock <= 0) return { type: 'error', message: "Cash reserves empty. Not worth the risk." };
  if (!(await hasHackDeck(player.id))) return { type: 'error', message: "You need a hacking device to breach this terminal." };

  const lockedUntil = jackLockout.get(player.id) || 0;
  if (Date.now() < lockedUntil) {
    const secs = Math.ceil((lockedUntil - Date.now()) / 1000);
    return { type: 'error', message: `Terminal lockout active. ${secs}s remaining.` };
  }

  // The moment you jack in, the breach is underway — the crime chance starts
  // here, not on success. Surveillance rolls a time-ramping camera catch over
  // the length of the jacked-in session (see plugins/surveillance activeCrimes).
  emit('atm.jacked', { player, zoneId: atm.zone_id });

  // textRender stamps the payload for a player on a text Display Mode rung — the
  // same board, drawn in characters. One line, no protocol change: the game runs
  // client-side and reports through `jackresolve` either way.
  return textRender(player, {
    type: 'circuit_hack',
    deviceId: atm.id,
    deviceName: atm.name,
    skill: await effectiveSkill(player, 'hacking'),
    difficulty: await hackDifficulty(player.id, atm.hack_difficulty),
    resolveCmd: 'jackresolve',
  });
}

// A failed breach kicks a shock back up the cable — random 6-14 damage.
const JACK_SHOCK_MIN = 6, JACK_SHOCK_RANGE = 9;

// jackresolve <atmId> <1|0> — silent; the Circuit Breach overlay fires this
// with the minigame's own outcome. That outcome is authoritative: winning it
// is the only gate on MAINTENANCE access beyond carrying the device.
async function cmdJackResolve(args, raw, player, broadcast) {
  const atmId = args[0];
  const win = args[1] === '1';
  if (!atmId) return { type: 'noop' };
  const atm = await findAtmById(atmId);
  if (!atm || atm.zone_id !== player.current_zone) return { type: 'noop' };
  if (atm.is_broken) return { type: 'error', message: 'This terminal is already dead.' };
  if (!isZonePowered(player.current_zone)) return { type: 'error', message: 'The ATM is powered down.' };
  if (!(await hasHackDeck(player.id))) return { type: 'error', message: 'You need a hacking device to breach this terminal.' };

  // The jacked-in session is over (win or lose) — stop the ongoing-crime roll
  // that started at `jack`.
  emit('atm.jackResolved', { player });

  if (!win) {
    jackLockout.set(player.id, Date.now() + 5 * 60 * 1000);
    const deviceMsg = await damageHackDeck(player.id);

    const shockDmg = JACK_SHOCK_MIN + Math.floor(Math.random() * JACK_SHOCK_RANGE);
    const hp = Math.max(0, (player.hp || 0) - shockDmg);
    player.hp = hp;
    query('UPDATE players SET hp=$1 WHERE id=$2', [hp, player.id]).catch(() => {});

    if (hp <= 0) {
      broadcast(null, {
        type: 'output',
        message: `<span class="text-red">INTRUSION DETECTED.</span> The feedback surge stops your heart before the countermeasures even finish tracing you.${deviceMsg}`,
        player_update: { hp },
      }, null, player.id);
      const { handlePlayerDeath } = await import('../../server/engine/gameLoop.js');
      await handlePlayerDeath(player, null, { type: 'security', label: 'Electrocuted hacking an ATM' });
      return { type: 'noop' };
    }

    return {
      type: 'error',
      message: `<span class="text-red">INTRUSION DETECTED.</span> Feedback surges up the line — you take ${shockDmg} damage.${deviceMsg} Security pulse traced the attempt. Lockout: 5 minutes.`,
      player_update: { hp },
    };
  }

  await awardSkillUse(player.id, 'hacking', await breachMargin(player, atm.hack_difficulty));
  grantMaintenanceAccess(atm.id, player.id);
  // The hacking crime is no longer charged on success — it's now rolled over the
  // whole jacked-in session that began at `jack` (see the atm.jacked handler in
  // plugins/surveillance). Draining still charges atm_robbery separately.
  return {
    type: 'jack',
    message: `You burn through the handshake and drop into the diagnostic shell.\n<span class="ip-gain">MAINTENANCE mode unlocked.</span> Reopen the terminal to eject the cash reserve.`,
    atm_maintenance: true,
  };
}

async function cmdDrain(args, raw, player) {
  const atm = await findAtmInZone(player.current_zone);
  if (!atm) return { type: 'error', message: "Nothing worth draining here." };
  if (atm.is_broken) return { type: 'error', message: 'This terminal is already dead.' };
  if (!isZonePowered(player.current_zone)) return { type: 'error', message: "The ATM is powered down." };
  if (!hasMaintenanceAccess(atm.id, player.id)) return { type: 'error', message: 'MAINTENANCE access required. Jack the terminal first.' };
  if (!atm.cash_stock || atm.cash_stock <= 0) return { type: 'error', message: 'Cash reserves empty. Nothing to eject.' };

  const stolen = atm.cash_stock;
  // Pay out the cash and brick the machine together, so a retry can't hand
  // over credits twice (or drain an already-emptied terminal).
  await withTransaction(async (q) => {
    const res = await q('UPDATE players SET credits = credits + $1 WHERE id = $2 RETURNING credits', [stolen, player.id]);
    player.credits = res.rows[0].credits;
    await q('UPDATE atm_units SET cash_stock=0, is_broken=1 WHERE id=$1', [atm.id]);
  });
  revokeMaintenanceAccess(atm.id, player.id);
  emit('atm.drained', { player, zoneId: atm.zone_id });

  return {
    type: 'drain',
    message: `MAINTENANCE OVERRIDE: dispense hopper forced open. ${stolen}c in chips clatter into your bag before the terminal seizes and goes dark.`,
    player_update: { credits: player.credits },
    atm_cash_stock: 0,
    atm_maintenance: false,
  };
}

// Admin-only: preview the Circuit Breach overlay at an arbitrary difficulty/
// skill without needing to find or reconfigure a real ATM. Reuses the same
// `circuit_hack` client message the `hijack` command sends (see
// plugins/surveillance/index.js), just with a fake device id so resolving it
// is a harmless no-op server-side.
const ADMIN_ROLES = new Set(['admin', 'dev', 'builder', 'designer']);
function cmdHackPreview(args, raw, player) {
  if (!ADMIN_ROLES.has(player.role)) return { type: 'error', message: 'Admin only.' };
  const difficulty = Math.max(1, parseInt(args[0], 10) || 6);
  const skill = Math.max(1, parseInt(args[1], 10) || 4);
  return { type: 'circuit_hack', deviceId: 'preview', deviceName: 'PREVIEW TERMINAL', skill, difficulty };
}

// ── Cash replenishment tick ───────────────────────────────────────────────────

async function replenishTick() {
  const nowSec = Math.floor(Date.now() / 1000);
  const { rows } = await query(
    `SELECT id, cash_max, replenish_interval_hours, last_replenish
     FROM atm_units WHERE cash_stock < cash_max AND is_broken = 0`
  );
  // Which units are actually due. The interval is authored in GAME hours and
  // converted through the game-speed knob, so the decision stays in JS — but the
  // write does not have to. Every due unit gets the IDENTICAL update
  // (`cash_stock=cash_max`, same timestamp), so this is one statement, not one
  // round trip per drained cash machine every 5 minutes.
  const due = rows.filter(atm => {
    const intervalSec = gameMsToReal((atm.replenish_interval_hours || 6) * 3600 * 1000) / 1000;
    return nowSec - (atm.last_replenish || 0) >= intervalSec;
  });
  if (!due.length) return;
  await query(
    'UPDATE atm_units SET cash_stock=cash_max, last_replenish=$1 WHERE id = ANY($2)',
    [nowSec, due.map(a => a.id)]
  );
}

schedule('5m', () => replenishTick().catch(e => console.error('[atm] replenish error:', e.message)));

// ── Dev-panel route handler ───────────────────────────────────────────────────

function devOk(auth) {
  return auth && ['dev', 'admin', 'builder', 'designer'].includes(auth.role);
}

export const routeHandler = async (path, method, body, auth) => {
  if (!path.startsWith('/atm')) return null;
  if (method !== 'GET' && !devOk(auth)) return { status: 403, body: { error: 'Dev access required' } };

  const parts = path.split('/').filter(Boolean); // ['atm', resource, id?, sub?]
  const resource = parts[1];
  const id = parts[2];
  const sub = parts[3];

  try {
    // ── Units ────────────────────────────────────────────────────────────────
    if (resource === 'units') {
      if (!id && method === 'GET') {
        const { rows } = await query(`
          SELECT f.id, f.name AS atm_name, f.zone_id,
                 z.name AS zone_name,
                 a.network_id, a.cash_stock, a.cash_max, a.replenish_interval_hours,
                 a.last_replenish, a.hack_difficulty, a.is_broken,
                 n.name AS network_name, n.color AS network_color
          FROM furniture f
          JOIN atm_units a ON a.id = f.id
          LEFT JOIN atm_networks n ON n.id = a.network_id
          LEFT JOIN zones z ON z.id = f.zone_id
          WHERE jsonb_exists(f.flags, 'atm')
          ORDER BY z.name, f.name
        `);
        const powerMap = getPowerMap();
        const result = rows.map(r => ({
          ...r,
          power_status: powerMap.find(p => p.zoneId === r.zone_id)?.status ?? 'powered',
        }));
        return { status: 200, body: result };
      }

      if (id && !sub && method === 'PUT') {
        // Update ATM unit config
        const { cash_stock, cash_max, replenish_interval_hours, hack_difficulty, network_id, is_broken, name } = body || {};
        const fields = [];
        const vals = [];
        let idx = 1;
        if (cash_stock != null)               { fields.push(`cash_stock=$${idx++}`);               vals.push(Math.max(0, parseInt(cash_stock, 10) || 0)); }
        if (cash_max != null)                 { fields.push(`cash_max=$${idx++}`);                 vals.push(Math.max(1, parseInt(cash_max, 10) || 5000)); }
        if (replenish_interval_hours != null) { fields.push(`replenish_interval_hours=$${idx++}`); vals.push(Math.max(1, parseInt(replenish_interval_hours, 10) || 6)); }
        if (hack_difficulty != null)          { fields.push(`hack_difficulty=$${idx++}`);          vals.push(Math.max(1, parseInt(hack_difficulty, 10) || 5)); }
        if (network_id !== undefined)         { fields.push(`network_id=$${idx++}`);               vals.push(network_id || null); }
        if (is_broken != null)                { fields.push(`is_broken=$${idx++}`);                vals.push(is_broken ? 1 : 0); }
        if (!fields.length && name == null) return { status: 400, body: { error: 'Nothing to update' } };
        if (fields.length) {
          vals.push(id);
          await query(`UPDATE atm_units SET ${fields.join(',')} WHERE id=$${idx}`, vals);
        }
        if (name != null) {
          await updateFurniture(id, { name: name.trim() || 'ATM Terminal' });
        }
        return { status: 200, body: { ok: true } };
      }

      if (id && !sub && method === 'DELETE') {
        await query('DELETE FROM atm_units WHERE id=$1', [id]);
        await deleteFurniture(id);
        return { status: 200, body: { ok: true } };
      }

      if (id && sub === 'repair' && method === 'POST') {
        await query('UPDATE atm_units SET is_broken=0 WHERE id=$1', [id]);
        atmMaintenanceAccess.delete(id);
        return { status: 200, body: { ok: true } };
      }

      if (id && sub === 'replenish' && method === 'POST') {
        const nowSec = Math.floor(Date.now() / 1000);
        await query('UPDATE atm_units SET cash_stock=cash_max, last_replenish=$1 WHERE id=$2', [nowSec, id]);
        return { status: 200, body: { ok: true } };
      }
    }

    // ── Replenish all ────────────────────────────────────────────────────────
    if (resource === 'replenish-all' && method === 'POST') {
      const nowSec = Math.floor(Date.now() / 1000);
      const { rowCount } = await query(
        'UPDATE atm_units SET cash_stock=cash_max, last_replenish=$1 WHERE is_broken=0',
        [nowSec]
      );
      return { status: 200, body: { ok: true, count: rowCount } };
    }

    // ── Networks ─────────────────────────────────────────────────────────────
    if (resource === 'networks') {
      if (!id && method === 'GET') {
        const { rows } = await query('SELECT * FROM atm_networks ORDER BY name');
        return { status: 200, body: rows };
      }

      if (!id && method === 'POST') {
        const nid = body.id || `net_${Date.now()}`;
        await query(
          `INSERT INTO atm_networks (id, name, color, fee_rate, withdrawal_limit, min_faction_rep, faction_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [nid, body.name || 'Unnamed Network', body.color || '#00ff88',
           parseFloat(body.fee_rate) || 0, parseInt(body.withdrawal_limit, 10) || 500,
           parseInt(body.min_faction_rep, 10) || -200, body.faction_id || null]
        );
        return { status: 201, body: { id: nid } };
      }

      if (id && !sub && method === 'PUT') {
        await query(
          `UPDATE atm_networks SET name=$1, color=$2, fee_rate=$3, withdrawal_limit=$4,
           min_faction_rep=$5, faction_id=$6 WHERE id=$7`,
          [body.name || 'Unnamed Network', body.color || '#00ff88',
           parseFloat(body.fee_rate) || 0, parseInt(body.withdrawal_limit, 10) || 500,
           parseInt(body.min_faction_rep, 10) || -200, body.faction_id || null, id]
        );
        return { status: 200, body: { ok: true } };
      }

      if (id && !sub && method === 'DELETE') {
        // Unlink ATMs first, then delete
        await query('UPDATE atm_units SET network_id=NULL WHERE network_id=$1', [id]);
        await query('DELETE FROM atm_networks WHERE id=$1', [id]);
        return { status: 200, body: { ok: true } };
      }

      // Inject funds: fill all ATMs on this network to their cash_max
      if (id && sub === 'inject' && method === 'POST') {
        const nowSec = Math.floor(Date.now() / 1000);
        const { rowCount } = await query(
          'UPDATE atm_units SET cash_stock=cash_max, last_replenish=$1 WHERE network_id=$2 AND is_broken=0',
          [nowSec, id]
        );
        return { status: 200, body: { ok: true, count: rowCount } };
      }
    }

  } catch (err) {
    return { status: 400, body: { error: err.message } };
  }

  return null;
};

// ── Plugin exports ────────────────────────────────────────────────────────────

export const commands = {
  atm: cmdAtm,
  deposit: cmdDeposit,
  withdraw: cmdWithdraw,
  jack: cmdJack,
  jackresolve: cmdJackResolve,
  drain: cmdDrain,
  '.hackpreview': cmdHackPreview,
};

export const specializedActions = [
  { verb: 'use', requiredTag: 'atm', handler: doUseAtm },
];

console.log('[atm] Plugin loaded.');
