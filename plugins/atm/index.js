import { query, withTransaction } from '../../server/models/db.js';
import { getZone } from '../../server/engine/world.js';
import { transferCredits } from '../../server/engine/economy.js';
import { awardSkillUse, effectiveSkill } from '../../server/engine/skills.js';
import { getPowerMap } from '../../server/engine/environment.js';
import { emit } from '../../server/engine/events.js';
import { gameMsToReal } from '../../server/engine/gametime.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Jacking a terminal requires physically carrying this item — no skill roll
// gates the attempt anymore, just possession of the tool.
// Any item tagged `hack_device` (see tagCatalog.js) is a valid deck — the gate
// is the capability tag, not a specific item id.
async function hasHackDevice(playerId) {
  const { rows } = await query(
    `SELECT 1 FROM player_inventory pi JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id=$1 AND pi.container_id IS NULL AND jsonb_exists(i.tags,'hack_device') LIMIT 1`,
    [playerId]
  );
  return rows.length > 0;
}

// A failed breach fries the deck a little — five failures and it's slag.
// Marked `unique` on the item so multiple decks don't share one condition.
const HACK_DEVICE_DAMAGE_PER_FAIL = 0.2;
async function damageHackDevice(playerId) {
  const { rows } = await query(
    `SELECT pi.id, pi.condition FROM player_inventory pi JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id=$1 AND pi.container_id IS NULL AND jsonb_exists(i.tags,'hack_device') LIMIT 1`,
    [playerId]
  );
  const dev = rows[0];
  if (!dev) return '';
  const newCond = Math.max(0, (dev.condition ?? 1) - HACK_DEVICE_DAMAGE_PER_FAIL);
  if (newCond <= 0) {
    await query('DELETE FROM player_inventory WHERE id=$1', [dev.id]);
    return ' Your hack deck fries, sparks, and crumbles to slag in your hands.';
  }
  await query('UPDATE player_inventory SET condition=$1 WHERE id=$2', [newCond, dev.id]);
  return ` Your hack deck takes damage (${Math.round(newCond * 100)}% integrity).`;
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

function isZonePowered(zoneId) {
  const map = getPowerMap();
  const z = map.find(e => e.zoneId === zoneId);
  // Zones not in the power map (no generator assigned) are treated as powered.
  return !z || z.status === 'powered' || z.status === 'overloaded';
}

async function checkFactionAccess(player, atm) {
  if (!atm.faction_id || atm.min_faction_rep == null || atm.min_faction_rep <= -200) return true;
  const { rows } = await query(
    'SELECT reputation FROM player_faction_rep WHERE player_id=$1 AND faction_id=$2',
    [player.id, atm.faction_id]
  );
  return (rows[0]?.reputation ?? 0) >= atm.min_faction_rep;
}

async function buildAtmPanel(atm, player, powered) {
  return {
    type: 'atm_panel',
    atmId: atm.id,
    name: atm.name,
    network: {
      id: atm.network_id || null,
      name: atm.network_name || 'UNLINKED',
      color: atm.color || '#00ff88',
      fee_rate: parseFloat(atm.fee_rate) || 0,
      withdrawal_limit: atm.withdrawal_limit ?? 5000,
    },
    cashStock: atm.cash_stock ?? 5000,
    cashMax: atm.cash_max ?? 5000,
    powered,
    isBroken: !!atm.is_broken,
    hackDifficulty: atm.hack_difficulty ?? 6,
    hackingSkill: await effectiveSkill(player, 'hacking'),
    hasHackDevice: await hasHackDevice(player.id),
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

  // Legacy zone-flag fallback (no ATM furniture)
  if (!atm) {
    if (!zone?.flags?.has_atm) return { type: 'error', message: "There's no ATM here." };
    const amount = amountStr === 'all' ? (player.credits || 0) : parseInt(amountStr, 10);
    if (!amount || amount <= 0) return { type: 'error', message: 'Deposit how much? Try "deposit 50" or "deposit all".' };
    if (!await transferCredits(player, amount, 'deposit')) return { type: 'error', message: `You only have ${player.credits || 0}c on you.` };
    return { type: 'deposit', message: `You deposit ${amount}c. Carried: ${player.credits}c · Banked: ${player.bank_credits}c`, player_update: { credits: player.credits, bank_credits: player.bank_credits } };
  }

  if (atm.is_broken) return { type: 'error', message: 'The ATM is damaged. Try another terminal.' };
  if (!isZonePowered(player.current_zone)) return { type: 'error', message: 'The ATM screen is dark — no power.' };
  if (!await checkFactionAccess(player, atm)) return { type: 'error', message: `${atm.network_name || 'This network'} requires higher standing to access.` };

  const amount = amountStr === 'all' ? (player.credits || 0) : parseInt(amountStr, 10);
  if (!amount || amount <= 0) return { type: 'error', message: 'Deposit how much? Try "deposit 50" or "deposit all".' };

  // Move the credits and fill the machine as one atomic unit.
  const newStock = Math.min((atm.cash_max ?? 5000), (atm.cash_stock ?? 0) + amount);
  const moved = await withTransaction(async (q) => {
    if (!await transferCredits(player, amount, 'deposit', q)) return false;
    await q('UPDATE atm_units SET cash_stock=$1 WHERE id=$2', [newStock, atm.id]);
    return true;
  });
  if (!moved) return { type: 'error', message: `You only have ${player.credits || 0}c on you.` };

  return {
    type: 'deposit',
    message: `You deposit ${amount}c. Carried: ${player.credits}c · Banked: ${player.bank_credits}c`,
    player_update: { credits: player.credits, bank_credits: player.bank_credits },
    atm_cash_stock: newStock,
  };
}

async function cmdWithdraw(args, raw, player) {
  const amountStr = args[0];
  const zone = getZone(player.current_zone);
  const atm = await findAtmInZone(player.current_zone);

  // Legacy zone-flag fallback
  if (!atm) {
    if (!zone?.flags?.has_atm) return { type: 'error', message: "There's no ATM here." };
    const amount = amountStr === 'all' ? (player.bank_credits || 0) : parseInt(amountStr, 10);
    if (!amount || amount <= 0) return { type: 'error', message: 'Withdraw how much? Try "withdraw 50" or "withdraw all".' };
    if (!await transferCredits(player, amount, 'withdraw')) return { type: 'error', message: `You only have ${player.bank_credits || 0}c banked.` };
    return { type: 'withdraw', message: `You withdraw ${amount}c. Carried: ${player.credits}c · Banked: ${player.bank_credits}c`, player_update: { credits: player.credits, bank_credits: player.bank_credits } };
  }

  if (atm.is_broken) return { type: 'error', message: 'The ATM is damaged. Try another terminal.' };
  if (!isZonePowered(player.current_zone)) return { type: 'error', message: 'The ATM screen is dark — no power.' };
  if (!await checkFactionAccess(player, atm)) return { type: 'error', message: `${atm.network_name || 'This network'} requires higher standing to access.` };

  const limit = atm.withdrawal_limit ?? 5000;
  const cashAvail = atm.cash_stock ?? 0;
  const banked = player.bank_credits || 0;
  const feeRate = parseFloat(atm.fee_rate) || 0;

  let rawAmount;
  if (amountStr === 'all') {
    // Max that fits within limit, cash stock, and what they can afford after fee
    const maxByCash = Math.min(cashAvail, limit);
    // fee is on top: banked >= rawAmount + ceil(rawAmount * feeRate)
    // rawAmount <= banked / (1 + feeRate)
    const maxByFunds = feeRate > 0 ? Math.floor(banked / (1 + feeRate)) : banked;
    rawAmount = Math.min(maxByCash, maxByFunds);
  } else {
    rawAmount = parseInt(amountStr, 10);
  }

  if (!rawAmount || rawAmount <= 0) return { type: 'error', message: 'Withdraw how much? Try "withdraw 50" or "withdraw all".' };
  if (rawAmount > limit) return { type: 'error', message: `This ATM has a ${limit}c per-transaction limit.` };
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

  const feeMsg = fee > 0 ? ` (−${fee}c ${atm.network_name || 'network'} fee)` : '';
  return {
    type: 'withdraw',
    message: `You withdraw ${rawAmount}c${feeMsg}. Carried: ${player.credits}c · Banked: ${player.bank_credits}c`,
    player_update: { credits: player.credits, bank_credits: player.bank_credits },
    atm_cash_stock: newStock,
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
  if (!(await hasHackDevice(player.id))) return { type: 'error', message: "You need a hacking device to breach this terminal." };

  const lockedUntil = jackLockout.get(player.id) || 0;
  if (Date.now() < lockedUntil) {
    const secs = Math.ceil((lockedUntil - Date.now()) / 1000);
    return { type: 'error', message: `Terminal lockout active. ${secs}s remaining.` };
  }

  // The moment you jack in, the breach is underway — the crime chance starts
  // here, not on success. Surveillance rolls a time-ramping camera catch over
  // the length of the jacked-in session (see plugins/surveillance activeCrimes).
  emit('atm.jacked', { player, zoneId: atm.zone_id });

  return {
    type: 'circuit_hack',
    deviceId: atm.id,
    deviceName: atm.name,
    skill: await effectiveSkill(player, 'hacking'),
    difficulty: atm.hack_difficulty ?? 6,
    resolveCmd: 'jackresolve',
  };
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
  if (!(await hasHackDevice(player.id))) return { type: 'error', message: 'You need a hacking device to breach this terminal.' };

  // The jacked-in session is over (win or lose) — stop the ongoing-crime roll
  // that started at `jack`.
  emit('atm.jackResolved', { player });

  if (!win) {
    jackLockout.set(player.id, Date.now() + 5 * 60 * 1000);
    const deviceMsg = await damageHackDevice(player.id);

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

  await awardSkillUse(player.id, 'hacking', 2);
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
  for (const atm of rows) {
    // Authored in game-hours — convert to the real seconds to actually wait via
    // the game-speed knob so refills track the sped-up day.
    const intervalSec = gameMsToReal((atm.replenish_interval_hours || 6) * 3600 * 1000) / 1000;
    if (nowSec - (atm.last_replenish || 0) >= intervalSec) {
      await query(
        'UPDATE atm_units SET cash_stock=cash_max, last_replenish=$1 WHERE id=$2',
        [nowSec, atm.id]
      );
    }
  }
}

setInterval(() => replenishTick().catch(e => console.error('[atm] replenish error:', e.message)), 5 * 60 * 1000);

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
          await query('UPDATE furniture SET name=$1 WHERE id=$2', [name.trim() || 'ATM Terminal', id]);
        }
        return { status: 200, body: { ok: true } };
      }

      if (id && !sub && method === 'DELETE') {
        await query('DELETE FROM atm_units WHERE id=$1', [id]);
        await query('DELETE FROM furniture WHERE id=$1', [id]);
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
