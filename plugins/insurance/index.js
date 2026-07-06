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
const PILOT_ERROR_MULT = 0.5;        // flew it into the ground yourself → half the settlement
const FRAUD_WINDOW_SEC = 180;        // a total loss < 3 min after binding cover = denied (anti buy-then-crash)
const LIABILITY_LIMIT = 8000;        // most Halcyon pays toward third-party damage; the pilot eats the overflow

// Perils Halcyon covers in FULL: shot down, ground fire, weather, birds, engine fire —
// "acts of the world" you insure against. Everything else (crash/offfield/stall/fuel/
// hardlanding/abandoned/…) is ruled PILOT ERROR and pays reduced. Restricted-airspace or
// too-soon losses are EXCLUDED outright. Pure so the regress can assert the tiers.
const COVERED_REASONS = new Set(['shotdown', 'groundfire', 'weather', 'birdstrike', 'fire']);
export function classifyLoss({ reason, restricted, combat, impaired, ageSec }) {
  if (impaired) return { verdict: 'excluded_impaired', mult: 0 };   // flying under the influence voids cover
  if (restricted) return { verdict: 'excluded_nofly', mult: 0 };
  if (typeof ageSec === 'number' && ageSec < FRAUD_WINDOW_SEC) return { verdict: 'excluded_fraud', mult: 0 };
  if (combat || COVERED_REASONS.has(reason)) return { verdict: 'covered', mult: 1 };
  return { verdict: 'pilot_error', mult: PILOT_ERROR_MULT };
}

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

// Deduct a bill from a (possibly offline) pilot's credits, floored at zero. Returns paid.
async function chargePilot(pilotId, amount) {
  if (!pilotId || amount <= 0) return 0;
  const { rows } = await query('SELECT credits FROM players WHERE id=$1', [pilotId]);
  if (!rows.length) return 0;
  const paid = Math.min(rows[0].credits || 0, amount);
  await query('UPDATE players SET credits = GREATEST(0, credits - $1) WHERE id=$2', [amount, pilotId]);
  const p = getLivePlayer(pilotId);
  if (p) { p.credits = Math.max(0, (p.credits || 0) - amount); sendToPlayer(pilotId, { type: 'player_update', credits: p.credits }); }
  return paid;
}

// ── React to crashes: settle third-party LIABILITY, then the owner's HULL claim ──
on('flight.crashed', async ({ aircraftId, ownerId, pilotId, typeId, typeName, reason, rental, restricted, combat, impaired, liabilityBill = 0, casualties = 0 }) => {
  const now = nowSec();
  const craft = typeName || 'aircraft';
  // The craft's active hull policy (its liability rider covers third-party damage too).
  const pol = (!rental && aircraftId)
    ? (await query('SELECT * FROM insurance_policies WHERE aircraft_id=$1 AND expires_at > $2 LIMIT 1', [aircraftId, now])).rows[0]
    : null;

  // ── LIABILITY: someone pays for the ground damage, insured or not ─────────────
  if (liabilityBill > 0) {
    const who = casualties > 0 ? `${liabilityBill}c in third-party damage (incl. ${casualties} casualt${casualties > 1 ? 'ies' : 'y'})` : `${liabilityBill}c in third-party damage`;
    if (pol) {
      const covered = Math.min(liabilityBill, LIABILITY_LIMIT);
      const overflow = liabilityBill - covered;
      if (overflow > 0) await chargePilot(pilotId, overflow);
      if (pilotId && getLivePlayer(pilotId)) sendToPlayer(pilotId, { type: 'output', message: `<span class="msg-system">📄 <b>HALCYON ASSURANCE — LIABILITY:</b> we settled <b>${covered}c</b> of ${who} on your behalf${overflow > 0 ? `; the <b>${overflow}c</b> over your ${LIABILITY_LIMIT}c limit is yours` : ''}. <span class="text-dim">The lawsuit, and the wanted level, remain your own.</span></span>` });
    } else {
      const paid = await chargePilot(pilotId, liabilityBill);
      if (pilotId && getLivePlayer(pilotId)) sendToPlayer(pilotId, { type: 'output', message: `<span class="msg-system">⚖ <b>THIRD-PARTY LIABILITY:</b> uninsured, you are personally liable for <b>${liabilityBill}c</b> of ${who}. <b>${paid}c</b> has been garnished. <span class="text-dim">Halcyon would have covered most of it.</span></span>` });
    }
  }

  // ── HULL: the owner's airframe claim (only if it carried an active policy) ────
  if (rental || !ownerId || !aircraftId || !pol) return;

  // Assess fault → how much the loss pays (if anything).
  const { verdict, mult } = classifyLoss({ reason, restricted, combat, impaired, ageSec: now - (pol.created_at || 0) });
  const { deductible, payout: full } = settlement(pol.insured_value);
  const payout = Math.round(full * mult);
  await query('INSERT INTO insurance_claims (id, owner_id, aircraft_id, type_id, type_name, reason, payout, deductible, status, filed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [`clm_${randomUUID().slice(0, 10)}`, ownerId, aircraftId, typeId, craft, reason, payout, deductible, mult > 0 ? 'pending' : 'denied', now]);
  await query('DELETE FROM insurance_policies WHERE id=$1', [pol.id]);   // the policy is spent either way

  // Tell the owner the ruling straight away — the "why" for a reduced/denied claim.
  const p = getLivePlayer(ownerId);
  if (!p) return;
  const msg = {
    covered: `📄 <b>HALCYON ASSURANCE:</b> we're sorry for the loss of your ${craft}. Covered peril — a claim is open for <b>${payout}c</b> (we keep the ${deductible}c excess and the wreck). <span class="text-dim">Come in to the claims desk to settle.</span>`,
    pilot_error: `📄 <b>HALCYON ASSURANCE:</b> our assessors ruled <b>pilot error</b> on the ${craft}, so cover is reduced. A claim is open for <b>${payout}c</b> — half the standard settlement, less your excess. <span class="text-dim">Fly it, don't wear it. Settle at the claims desk.</span>`,
    excluded_nofly: `📄 <b>HALCYON ASSURANCE:</b> the ${craft} was lost in <b>restricted airspace</b> — an excluded, illegal flight. The claim is <b>denied</b> and the policy is void. <span class="text-dim">We did read the black box.</span>`,
    excluded_fraud: `📄 <b>HALCYON ASSURANCE:</b> a total loss this soon after binding cover is... convenient. The claim is <b>denied</b> pending an investigation that will outlast your patience. <span class="text-dim">Halcyon was not born yesterday.</span>`,
    excluded_impaired: `📄 <b>HALCYON ASSURANCE:</b> the tox panel came back — you were flying <b>impaired</b>. Operating an aircraft under the influence voids your cover outright. The claim is <b>denied</b> and the policy is void. <span class="text-dim">Fly sober, or fly uninsured.</span>`,
  }[verdict];
  sendToPlayer(ownerId, { type: 'output', message: `<span class="msg-system">${msg}</span>` });
});

export const commands = {
  insure: cmdInsure,
  claim: cmdClaim,
  policies: cmdPolicies,
  policy: cmdPolicies,
};

export const _test = { settlement, quotePremium, surchargeMult, classifyLoss, PAYOUT_FRAC, DEDUCTIBLE_FRAC, PILOT_ERROR_MULT };

console.log('[insurance] Plugin loaded.');
