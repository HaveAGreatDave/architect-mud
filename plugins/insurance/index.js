// Halcyon Assurance — hull insurance for aircraft (later: property + other assets).
// The arcology owners' own underwriter, run out of the Halcyon tower. You buy a
// fixed-term per-aircraft policy at the underwriting desk; on a COVERED crash it
// files a claim you collect at the claims desk. The payout is deliberately PARTIAL
// (a fraction of the agreed value, minus a fat excess) and the insurer keeps the
// wreck — so a crash still hurts, and every claim you make surcharges your next
// premium. Softens the blow without ever making a plane disposable (anti-kamikaze).
//
// Gated to the desk (zone flag `insurance_desk`). Reacts to the flight plugin's
// `flight.crashed` event to file claims. Schema: insurance_policies + insurance_claims.

import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { getZone, getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';

// ── Tunables (all knobs — the "soften but don't erase" curve lives here) ──────
const PERIOD_SEC = 7 * 86400;        // a policy term
const PREMIUM_RATE = 0.15;           // premium = 15% of agreed value / term (before surcharge)
const PAYOUT_FRAC = 0.60;            // a covered total loss pays 60% of agreed value…
const DEDUCTIBLE_FRAC = 0.12;        // …minus a 12% excess → net ~48% back. You still rebuy at full.
const SURCHARGE_PER_CLAIM = 0.25;    // each prior paid claim adds 25% to future premiums…
const SURCHARGE_CAP = 1.5;           // …up to +150% (×2.5) — repeat crashers get priced out.

const nowSec = () => Math.floor(Date.now() / 1000);
const atDesk = (player) => !!getZone(player.current_zone)?.flags?.insurance_desk;
const notHere = { type: 'emote', message: 'Halcyon Assurance handles that. See the desk on the underwriting floor of the tower.' };

async function ownerPaidClaims(ownerId) {
  const { rows } = await query("SELECT COUNT(*)::int n FROM insurance_claims WHERE owner_id=$1 AND status='paid'", [ownerId]);
  return rows[0]?.n || 0;
}
function surchargeMult(paidClaims) { return 1 + Math.min(SURCHARGE_CAP, paidClaims * SURCHARGE_PER_CLAIM); }
function quotePremium(value, paidClaims) { return Math.max(1, Math.round(value * PREMIUM_RATE * surchargeMult(paidClaims))); }
function settlement(value) {
  const deductible = Math.round(value * DEDUCTIBLE_FRAC);
  return { deductible, payout: Math.max(0, Math.round(value * PAYOUT_FRAC) - deductible) };
}

// The player's owned, flyable (non-wreck, non-rental) aircraft + their live policy state.
async function ownedFleet(playerId) {
  const { rows } = await query(
    `SELECT a.id, a.name, t.name tname, t.price_buy,
            p.id policy_id, p.insured_value, p.expires_at
     FROM aircraft a JOIN aircraft_types t ON t.id=a.type_id
     LEFT JOIN insurance_policies p ON p.aircraft_id=a.id AND p.expires_at > $2
     WHERE a.owner_id=$1 AND a.is_wreck=0 AND a.rental=0
     ORDER BY t.price_buy`,
    [playerId, nowSec()]);
  return rows;
}

function pickCraft(fleet, want) {
  const w = (want || '').toLowerCase();
  return fleet.find(r => r.id === w || r.id.endsWith(w) || (r.name || '').toLowerCase().includes(w) || (r.tname || '').toLowerCase().includes(w));
}

// ── insure — quote / buy / renew a policy ─────────────────────────────────────
async function cmdInsure(args, raw, player) {
  if (!atDesk(player)) return notHere;
  const fleet = await ownedFleet(player.id);
  if (!fleet.length) return { type: 'output', message: '<span class="text-cyan">HALCYON ASSURANCE:</span> our records show no aircraft in your name to cover. Buy one first — we\'ll be delighted to insure it.' };
  const paid = await ownerPaidClaims(player.id);
  const want = (args[0] || '').toLowerCase();

  if (!want) {
    const daysLeft = (e) => Math.max(0, Math.ceil((e - nowSec()) / 86400));
    const lines = fleet.map(r => {
      const prem = quotePremium(r.price_buy, paid);
      const covered = r.policy_id ? `<span class="text-green">COVERED · ${daysLeft(r.expires_at)}d left</span>` : '<span class="text-dim">uninsured</span>';
      return `· <b>${r.tname}</b> "${r.name}" — ${covered} · premium <b>${prem}c</b>/${PERIOD_SEC / 86400}d · <span class="action-link" data-action="cmd" data-cmd="insure ${r.id}">${r.policy_id ? 'renew' : 'insure'}</span>`;
    });
    const surcharge = paid ? ` <span class="text-amber">(your ${paid} prior claim${paid > 1 ? 's' : ''} surcharge these premiums)</span>` : '';
    return { type: 'output', message: `<span class="text-cyan">HALCYON ASSURANCE — HULL COVER:</span>${surcharge}\n${lines.join('\n')}\n<span class="text-dim">A covered total loss pays ${Math.round(PAYOUT_FRAC * 100)}% of agreed value, less a ${Math.round(DEDUCTIBLE_FRAC * 100)}% excess; we retain the wreck. Fly carefully — we do read the black box.</span>` };
  }

  const craft = pickCraft(fleet, want);
  if (!craft) return { type: 'emote', message: `No aircraft of yours by "${want}". Type <b>insure</b> for the list.` };
  const value = craft.price_buy;
  const premium = quotePremium(value, paid);
  if ((player.credits || 0) < premium) return { type: 'emote', message: `The premium on the ${craft.tname} is ${premium}c — you're short. Halcyon does not do instalments.` };

  player.credits -= premium;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  const expires = nowSec() + PERIOD_SEC;
  if (craft.policy_id) {
    await query('UPDATE insurance_policies SET insured_value=$1, premium_paid=$2, expires_at=$3 WHERE id=$4', [value, premium, expires, craft.policy_id]);
  } else {
    await query('INSERT INTO insurance_policies (id, owner_id, aircraft_id, insured_value, premium_paid, expires_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [`pol_${randomUUID().slice(0, 10)}`, player.id, craft.id, value, premium, expires, nowSec()]);
  }
  const { deductible, payout } = settlement(value);
  return { type: 'output', message: `<span class="item-grant">Bound. The <b>${craft.tname}</b> "${craft.name}" is covered for ${PERIOD_SEC / 86400} days — <b>${premium}c</b>. Agreed value ${value}c; a covered write-off pays <b>${payout}c</b> after the ${deductible}c excess, and we keep the hull. <span class="text-dim">Renew before it lapses — a lapsed policy pays nothing.</span></span>`, player_update: { credits: player.credits } };
}

// ── claim — collect a filed claim ─────────────────────────────────────────────
async function cmdClaim(args, raw, player) {
  if (!atDesk(player)) return notHere;
  const { rows } = await query("SELECT * FROM insurance_claims WHERE owner_id=$1 AND status='pending' ORDER BY filed_at", [player.id]);
  if (!rows.length) return { type: 'output', message: '<span class="text-cyan">HALCYON ASSURANCE — CLAIMS:</span> you have no open claims. Try not to change that.' };

  const want = (args[0] || '').toLowerCase();
  if (!want && rows.length > 1) {
    const lines = rows.map(c => `· claim on a <b>${c.type_name}</b> — pays <b>${c.payout}c</b> (after ${c.deductible}c excess) · <span class="action-link" data-action="cmd" data-cmd="claim ${c.id}">collect</span>`);
    return { type: 'output', message: `<span class="text-cyan">HALCYON ASSURANCE — OPEN CLAIMS:</span>\n${lines.join('\n')}` };
  }
  const c = want ? rows.find(r => r.id === want || r.id.endsWith(want) || (r.type_name || '').toLowerCase().includes(want)) : rows[0];
  if (!c) return { type: 'emote', message: `No open claim matches "${want}". Type <b>claim</b> to list them.` };

  player.credits = (player.credits || 0) + c.payout;
  await query('UPDATE players SET credits=$1 WHERE id=$2', [player.credits, player.id]);
  await query("UPDATE insurance_claims SET status='paid', paid_at=$1 WHERE id=$2", [nowSec(), c.id]);
  // The insurer keeps the wreck: mark it written-off so the ex-owner can't also rebuild it.
  if (c.aircraft_id) await query("UPDATE aircraft SET custom_data = jsonb_set(COALESCE(custom_data,'{}'), '{stripped}', 'true') WHERE id=$1", [c.aircraft_id]);
  return { type: 'output', message: `<span class="item-grant">Settled. Halcyon pays out <b>${c.payout}c</b> on the ${c.type_name} — the ${c.deductible}c excess is yours to eat, and the wreck is ours now. <span class="text-dim">A pleasure doing business. Your next premium reflects today.</span></span>`, player_update: { credits: player.credits } };
}

// ── policies — what you currently carry ───────────────────────────────────────
async function cmdPolicies(args, raw, player) {
  const { rows } = await query(
    `SELECT p.insured_value, p.premium_paid, p.expires_at, t.name tname, a.name aname
     FROM insurance_policies p JOIN aircraft a ON a.id=p.aircraft_id JOIN aircraft_types t ON t.id=a.type_id
     WHERE p.owner_id=$1 AND p.expires_at > $2 ORDER BY p.expires_at`, [player.id, nowSec()]);
  if (!rows.length) return { type: 'output', message: '<span class="text-cyan">HALCYON ASSURANCE:</span> you carry no active cover.' };
  const lines = rows.map(r => `· <b>${r.tname}</b> "${r.aname}" — value ${r.insured_value}c · <b>${Math.max(0, Math.ceil((r.expires_at - nowSec()) / 86400))}d</b> left`);
  return { type: 'output', message: `<span class="text-cyan">YOUR HALCYON POLICIES:</span>\n${lines.join('\n')}` };
}

// ── React to crashes: file a claim if the downed craft was covered ─────────────
on('flight.crashed', async ({ aircraftId, ownerId, typeId, typeName, reason, rental }) => {
  if (rental || !ownerId || !aircraftId) return;   // rentals are the desk's problem, not a hull policy
  const { rows } = await query('SELECT * FROM insurance_policies WHERE aircraft_id=$1 AND expires_at > $2 LIMIT 1', [aircraftId, nowSec()]);
  const pol = rows[0];
  if (!pol) return;   // uninsured, or the policy had lapsed — no cover
  const { deductible, payout } = settlement(pol.insured_value);
  await query('INSERT INTO insurance_claims (id, owner_id, aircraft_id, type_id, type_name, reason, payout, deductible, filed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [`clm_${randomUUID().slice(0, 10)}`, ownerId, aircraftId, typeId, typeName || 'aircraft', reason, payout, deductible, nowSec()]);
  await query('DELETE FROM insurance_policies WHERE id=$1', [pol.id]);   // the policy is spent
  const p = getLivePlayer(ownerId);
  if (p) sendToPlayer(ownerId, { type: 'output', message: `<span class="msg-system">📄 <b>HALCYON ASSURANCE:</b> we're sorry for the loss of your ${typeName || 'aircraft'}. A claim is open — <b>${payout}c</b> waits at the tower (we keep the ${deductible}c excess and the wreck). <span class="text-dim">Bring yourself in to the claims desk to settle.</span></span>` });
});

export const commands = {
  insure: cmdInsure,
  claim: cmdClaim,
  policies: cmdPolicies,
  policy: cmdPolicies,
};

export const _test = { settlement, quotePremium, surchargeMult, PAYOUT_FRAC, DEDUCTIBLE_FRAC };

console.log('[insurance] Plugin loaded.');
