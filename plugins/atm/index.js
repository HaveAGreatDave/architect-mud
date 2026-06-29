import { query } from '../../server/models/db.js';
import { getZone } from '../../server/engine/world.js';
import { transferCredits } from '../../server/engine/economy.js';
import { skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { getPowerMap } from '../../server/engine/environment.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function buildAtmPanel(atm, player, powered) {
  return {
    type: 'atm_panel',
    atmId: atm.id,
    name: atm.name,
    network: {
      id: atm.network_id || null,
      name: atm.network_name || 'CENTRAL BANK',
      color: atm.color || '#00ff88',
      fee_rate: parseFloat(atm.fee_rate) || 0,
      withdrawal_limit: atm.withdrawal_limit ?? 5000,
    },
    cashStock: atm.cash_stock ?? 5000,
    cashMax: atm.cash_max ?? 5000,
    powered,
    isBroken: !!atm.is_broken,
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

  return buildAtmPanel(atm, player, isZonePowered(player.current_zone));
}

// Specialized action: use <atm-named-furniture>
async function doUseAtm(args, raw, player) {
  const nameHint = args.join(' ') || null;
  const atm = await findAtmInZone(player.current_zone, nameHint);
  if (!atm) return undefined; // fall through to next handler
  return buildAtmPanel(atm, player, isZonePowered(player.current_zone));
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
  if (!await transferCredits(player, amount, 'deposit')) return { type: 'error', message: `You only have ${player.credits || 0}c on you.` };

  const newStock = Math.min((atm.cash_max ?? 5000), (atm.cash_stock ?? 0) + amount);
  await query('UPDATE atm_units SET cash_stock=$1 WHERE id=$2', [newStock, atm.id]);

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

  // Debit bank, credit only rawAmount carried (fee evaporates into the network)
  player.bank_credits = banked - totalDebited;
  player.credits = (player.credits || 0) + rawAmount;
  await query('UPDATE players SET credits=$1, bank_credits=$2 WHERE id=$3', [player.credits, player.bank_credits, player.id]);

  const newStock = Math.max(0, cashAvail - rawAmount);
  await query('UPDATE atm_units SET cash_stock=$1 WHERE id=$2', [newStock, atm.id]);

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

async function cmdJack(args, raw, player) {
  return { type: 'error', message: "Terminal jacking is currently offline." };
  const atm = await findAtmInZone(player.current_zone);
  if (!atm) return { type: 'error', message: "Nothing worth jacking here." };
  if (atm.is_broken) return { type: 'error', message: 'This terminal is already dead.' };
  if (!isZonePowered(player.current_zone)) return { type: 'error', message: "The ATM is powered down — nothing to jack." };
  if (!atm.cash_stock || atm.cash_stock <= 0) return { type: 'error', message: "Cash reserves empty. Not worth the risk." };

  const lockedUntil = jackLockout.get(player.id) || 0;
  if (Date.now() < lockedUntil) {
    const secs = Math.ceil((lockedUntil - Date.now()) / 1000);
    return { type: 'error', message: `Terminal lockout active. ${secs}s remaining.` };
  }

  const difficulty = atm.hack_difficulty ?? 6;
  const result = await skillCheck(player, 'hacking', difficulty);

  if (result.success) {
    await awardSkillUse(player.id, 'hacking', result.margin);
    const stolen = atm.cash_stock;
    player.credits = (player.credits || 0) + stolen;
    await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
    await query('UPDATE atm_units SET cash_stock=0, is_broken=1 WHERE id=$1', [atm.id]);
    return {
      type: 'output',
      message: `You burn through the handshake and spoof the dispense signal. The ATM vomits ${stolen}c in chips before going dark.\n<span class="ip-gain">Terminal compromised.</span>`,
      player_update: { credits: player.credits },
    };
  }

  // Fail — set lockout and narrate severity by margin
  jackLockout.set(player.id, Date.now() + 5 * 60 * 1000);
  const badMargin = Math.abs(result.margin);
  if (badMargin >= 4) {
    return {
      type: 'error',
      message: `<span class="text-red">INTRUSION DETECTED.</span> Hard lockout. Security pulse traced the attempt. Your console ID is flagged. Lockout: 5 minutes.`,
    };
  }
  return {
    type: 'error',
    message: `Authentication rejected. Handshake dropped. Lockout: 5 minutes.`,
  };
}

// ── Cash replenishment tick ───────────────────────────────────────────────────

async function replenishTick() {
  const nowSec = Math.floor(Date.now() / 1000);
  const { rows } = await query(
    `SELECT id, cash_max, replenish_interval_hours, last_replenish
     FROM atm_units WHERE cash_stock < cash_max AND is_broken = 0`
  );
  for (const atm of rows) {
    const intervalSec = (atm.replenish_interval_hours || 6) * 3600;
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
        const { cash_stock, cash_max, replenish_interval_hours, hack_difficulty, network_id, is_broken } = body || {};
        const fields = [];
        const vals = [];
        let idx = 1;
        if (cash_stock != null)               { fields.push(`cash_stock=$${idx++}`);               vals.push(Math.max(0, parseInt(cash_stock, 10) || 0)); }
        if (cash_max != null)                 { fields.push(`cash_max=$${idx++}`);                 vals.push(Math.max(1, parseInt(cash_max, 10) || 5000)); }
        if (replenish_interval_hours != null) { fields.push(`replenish_interval_hours=$${idx++}`); vals.push(Math.max(1, parseInt(replenish_interval_hours, 10) || 6)); }
        if (hack_difficulty != null)          { fields.push(`hack_difficulty=$${idx++}`);          vals.push(Math.max(1, parseInt(hack_difficulty, 10) || 5)); }
        if (network_id !== undefined)         { fields.push(`network_id=$${idx++}`);               vals.push(network_id || null); }
        if (is_broken != null)                { fields.push(`is_broken=$${idx++}`);                vals.push(is_broken ? 1 : 0); }
        if (!fields.length) return { status: 400, body: { error: 'Nothing to update' } };
        vals.push(id);
        await query(`UPDATE atm_units SET ${fields.join(',')} WHERE id=$${idx}`, vals);
        return { status: 200, body: { ok: true } };
      }

      if (id && sub === 'repair' && method === 'POST') {
        await query('UPDATE atm_units SET is_broken=0 WHERE id=$1', [id]);
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
};

export const specializedActions = [
  { verb: 'use', requiredTag: 'atm', handler: doUseAtm },
];

console.log('[atm] Plugin loaded.');
