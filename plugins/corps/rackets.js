// plugins/corps/rackets.js — protection rackets, Phase 1 (NPC shops).
//
// A corp that CONTROLS a zone can lean on the shopkeepers in it. Each shop keeps
// a `fear` value; the corp skims a cut of every sale scaled by that fear.
//
// The one rule that shapes everything here: **fear decays, and nothing tops it
// up for you.** There is no collection tick, no reminder, no automatic renewal —
// income from a racket dies on a half-life unless a member physically walks back
// and leans on the shopkeeper again. That walk IS the mechanic. Territory income
// (runTerritoryTick) asks nothing of you once the zone is yours; this asks
// constantly, which is the whole reason it pays better.
//
// Two deliberate choices worth knowing before you tune anything:
//
//   1. **Fear is stored, never decayed by a write.** The row holds `fear` as of
//      `last_leaned_at`, and fearNow() computes the present value from elapsed
//      time — the player_npc_relations pattern (server/engine/relations.js:155).
//      No tick, restart-proof, and a corp that logged off for a month comes back
//      to exactly the decay it earned.
//
//   2. **The take comes out of the shop's till, not out of thin air.**
//      handleVenturePurchase (ventures.js) mints its cut into the treasury — fine
//      for a business you own and pay upkeep on, wrong for money you're taking at
//      knifepoint. The skim debits `npcs.vendor_credits`, so a racket is a
//      TRANSFER: an over-milked shop with an empty till pays nothing (greed caps
//      itself with no tuning knob), and every credit you skim is a credit a rival
//      can no longer crack out of that shop's safe (plugins/vendor-safe).
import { randomUUID } from 'crypto';
import { query, withTransaction } from '../../server/models/db.js';
import { emit } from '../../server/engine/events.js';
import {
  getZone, getZoneNpcs, getNpc, getOrg, getPlayerMembership, getZoneControl,
  getRacket, getAllRackets, getOrgRackets, reloadRacket, reloadOrg, syncNpc,
} from '../../server/engine/world.js';
import { PERM, hasPerm } from '../../server/engine/org-perms.js';
import { skillCheck, awardSkillUse } from '../../server/engine/skills.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
import { adjustRelation, getRelation } from '../../server/engine/relations.js';
import { holdVendorGrudge } from '../../server/engine/vendor-grudge.js';
import { zoneDanger } from '../../server/engine/danger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Half-life of fear, in real days. Deliberately FASTER than the 7-game-day rent
// clock (apartments.js RENT_PERIOD_DAYS): a racket must never settle into feeling
// like a bill you pay. At 10 days a full shakedown falls out of `terrified` in
// about two days and is worthless inside a month.
export const FEAR_HALFLIFE_DAYS = 10;
export const FEAR_CAP = 90;          // most frightened a shopkeeper ever gets
const LEAN_COOLDOWN_MS = 60000;      // per-player anti-spam on leaning

// Bands, not a curve (server/engine/condition.js) — a player has to be able to
// reason about what their book is worth without doing arithmetic.
export const RACKET_BANDS = [
  { min: 75, key: 'terrified', label: 'Terrified', rate: 0.20 },
  { min: 45, key: 'cowed',     label: 'Cowed',     rate: 0.12 },
  { min: 20, key: 'wary',      label: 'Wary',      rate: 0.06 },
  { min: 5,  key: 'slipping',  label: 'Slipping',  rate: 0.02 },
  { min: 0,  key: 'lapsed',    label: 'Lapsed',    rate: 0 },
];

const err = (message) => ({ type: 'error', message });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Present fear for a racket row. Sync, zero queries — safe on the buy hot path.
// Mirrors decayed() in relations.js, including the sub-day short circuit (drift
// under a day is noise and not worth the Math.pow).
export function fearNow(racket, now = Date.now()) {
  if (!racket) return 0;
  const fear = Number(racket.fear) || 0;
  if (fear <= 0) return 0;
  const last = Number(racket.last_leaned_at) * 1000 || now;
  const days = Math.max(0, (now - last) / DAY_MS);
  if (days < 1) return fear;
  return fear * Math.pow(0.5, days / FEAR_HALFLIFE_DAYS);
}

export function fearBand(fear) {
  return RACKET_BANDS.find(b => fear >= b.min) || RACKET_BANDS[RACKET_BANDS.length - 1];
}

// ─── The skim: a cut of every sale at a racketed shop ────────────────────────
// Wired in index.js via on('vendor.purchase', …). Fires on the buy hot path, so
// the common case (no racket on this shop) is a single Map lookup and a return —
// no query, no allocation. Same discipline as onHostileAct's early return.
export async function handleRacketPurchase({ npcId, price, zoneId }) {
  if (!npcId || !price) return;
  const r = getRacket(npcId);
  if (!r) return;

  const band = fearBand(fearNow(r));
  if (!band.rate) return;            // lapsed — the shop has stopped being afraid

  // A racket only pays while the corp still holds the street. Losing the zone in
  // the territory war silently stops the income; no tick has to notice.
  const zc = getZoneControl(zoneId || r.zone_id);
  if (!zc || zc.org_id !== r.org_id) return;

  const cut = Math.floor(price * band.rate);
  if (cut <= 0) return;

  // Transfer, not faucet. The guarded debit means a drained till simply pays
  // nothing rather than driving vendor_credits negative — and the treasury is
  // only credited with what the till actually gave up, so the two can never
  // disagree. One transaction; RETURNING keeps the live NPC in sync (the npcs
  // write funnel — see the same shape in vendor.js).
  const took = await withTransaction(async (q) => {
    const till = await q(
      'UPDATE npcs SET vendor_credits = vendor_credits - $1 WHERE id=$2 AND vendor_credits >= $1 RETURNING vendor_credits',
      [cut, npcId]);
    if (!till.rowCount) return null;
    await q('UPDATE orgs SET treasury = treasury + $1 WHERE id=$2', [cut, r.org_id]);
    return till.rows[0].vendor_credits;
  });
  if (took === null) return;         // till couldn't cover it — no skim this sale

  syncNpc(npcId, { vendor_credits: took });
  await reloadOrg(r.org_id);
}

// ─── Establishing a racket ───────────────────────────────────────────────────

// Shared target resolution for `shakedown` and `corp racket drop`: the vendor in
// this room the player named. Reuses the same isVendor test the room description
// uses (commands/describe.js) so what reads as a vendor and what can be leaned on
// can never drift.
const isVendor = (n) =>
  !n.flags?.trust_flag &&
  ((Array.isArray(n.vendor_inventory) && n.vendor_inventory.length > 0) ||
    n.flags?.personality === 'vendor');

function findShopkeeper(player, nameArg) {
  const pool = getZoneNpcs(player.current_zone).filter(isVendor);
  if (!pool.length) return { error: "There's no shopkeeper here to lean on." };
  if (!nameArg) {
    if (pool.length === 1) return { npc: pool[0] };
    return { error: `Lean on who — ${pool.map(n => n.name).join(', ')}?` };
  }
  const r = siftResolve(nameArg, pool);
  if (r.type === 'none') return { error: `There's no shopkeeper called "${esc(nameArg)}" here.` };
  if (r.type === 'ambiguous') return { error: `Who do you mean — ${r.candidates.map(c => c.name).join(', ')}?` };
  return { npc: r.candidate };
}

// Difficulty of frightening this particular shopkeeper. A shop that likes you is
// harder to shake down — warmth is read from memory (getRelation is sync by
// contract), so this costs nothing. Rough streets are easier: a vendor in a
// dangerous zone has fewer illusions about who protects them.
function leanDifficulty(player, npc, zone) {
  const warmth = getRelation(player, npc.id)?.warmth || 0;
  const danger = zoneDanger(zone);
  // 'medium', not 'moderate' — zoneDanger() answers safe/low/medium/high/lethal.
  // This branch read 'moderate' until 2026-08-03 and so never fired, which made
  // every non-safe zone lean identically.
  const dangerEase = danger === 'safe' ? 2 : (danger === 'medium' ? 1 : 0);
  return Math.max(3, 6 + Math.round(warmth / 25) - dangerEase);
}

const leanCooldown = new Map();      // playerId -> epoch ms

// Everything both verbs check before a roll happens: membership, the permission
// bit, that the corp actually holds this street, and that a shopkeeper is here.
function gateShakedown(player, nameArg) {
  const m = getPlayerMembership(player.id);
  if (!m) return { error: "You're not in a corp." };
  if (!hasPerm(player, PERM.RACKET)) return { error: "You don't have permission to run rackets for your corp." };
  const zone = getZone(player.current_zone);
  const zc = getZoneControl(zone?.id);
  if (!zc || zc.org_id !== m.org_id) {
    return { error: "Your corp doesn't control this street. Take the zone first — nobody pays for protection you can't provide." };
  }
  const found = findShopkeeper(player, nameArg);
  if (found.error) return { error: found.error };
  return { m, zone, npc: found.npc };
}

// The consequences of leaning on somebody, win or lose. Both are cheap and both
// already exist: the shopkeeper's memory (coalesced, flushed on the minute tick)
// and the crime charge (surveillance listens and decides).
function chargeExtortion(player, npc, zone, warmthHit) {
  adjustRelation(player, npc.id, { warmth: -warmthHit, reason: 'extorted' });
  emit('extortion.witnessed', {
    player: { id: player.id, handle: player.handle, current_zone: player.current_zone },
    npcId: npc.id, zoneId: zone.id,
  });
}

// `corp racket [list|drop <shop>]` — the book, and walking away from a shop.
// Establishing and maintaining are NOT here: they're the `shakedown` verb.
export async function cmdRacket(player, args, broadcast, pushConsole) {
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'drop') return cmdDropRacket(player, args.slice(1).join(' '), pushConsole, broadcast);
  if (sub === '' || sub === 'list') return racketList(player);
  return err(`Unknown racket command "${esc(sub)}". Try "corp racket list", or "shakedown <shopkeeper>".`);
}

// `shakedown <shopkeeper>` — the whole system in one verb, and the only thing
// that ever raises fear. Deliberately ONE verb for both starting a racket and
// maintaining one: fictionally it's the same act (you lean on somebody), and
// making the player remember which state a shop is in would be bookkeeping, not
// menace. A bare top-level verb rather than a `corp` subcommand because it's the
// thing you do over and over; administration stays namespaced under `corp`.
export async function cmdShakedown(args, raw, player, broadcast, pushConsole) {
  return doShakedown(player, args.join(' '), broadcast, pushConsole);
}

async function doShakedown(player, nameArg, broadcast, pushConsole) {
  const g = gateShakedown(player, nameArg);
  if (g.error) return err(g.error);
  const { m, zone, npc } = g;

  const existing = getRacket(npc.id);
  if (existing && existing.org_id !== m.org_id) {
    const holder = getOrg(existing.org_id);
    return err(`${esc(npc.name)} already pays somebody — ${esc(holder?.name || 'another crew')}. They're not looking for a second set of friends.`);
  }

  const until = leanCooldown.get(player.id) || 0;
  if (Date.now() < until) {
    return err(`Give it a minute — leaning on people back to back just makes you look rattled. (${Math.ceil((until - Date.now()) / 1000)}s)`);
  }
  leanCooldown.set(player.id, Date.now() + LEAN_COOLDOWN_MS);

  const difficulty = leanDifficulty(player, npc, zone);
  const check = await skillCheck(player, 'intimidate', difficulty);
  const now = Math.floor(Date.now() / 1000);
  const org = getOrg(m.org_id);

  // Threatening somebody is a crime whether or not it works — the shopkeeper
  // heard it either way.
  chargeExtortion(player, npc, zone, check.success ? 12 : 6);
  broadcast?.(zone.id, { type: 'zone_event', message: `<span class="msg-system">${esc(player.handle)} has a quiet word with ${esc(npc.name)}, standing a little too close.</span>` }, player.id);

  if (!check.success) {
    // A failed lean is worse than not trying: they've now seen you fail. An
    // existing racket loses ground, and a shopkeeper you couldn't frighten
    // won't sell to you for a while either.
    await holdVendorGrudge(player, npc.id);
    if (existing) {
      const dropped = Math.max(0, fearNow(existing) - 15);
      await query('UPDATE org_rackets SET fear=$1, last_leaned_at=$2 WHERE id=$3', [dropped, now, existing.id]);
      await reloadRacket(npc.id);
      await pushConsole?.(m.org_id, broadcast);
      return { type: 'corp_racket', message: `${esc(npc.name)} holds your eye and doesn't blink. <span class="dim">(${check.effective} vs ${check.difficulty})</span> Whatever they were afraid of, it wasn't you — the arrangement is on thinner ice than it was.` };
    }
    return { type: 'corp_racket', message: `${esc(npc.name)} listens to the whole speech, then goes back to what they were doing. <span class="dim">(${check.effective} vs ${check.difficulty})</span> They won't be dealing with you for a while.` };
  }

  await awardSkillUse(player.id, 'intimidate', check.margin);

  // How frightened they end up. Margin matters, but the cap is the cap — you can
  // never scare somebody past FEAR_CAP, so a great roll buys you time, not a
  // permanently better rate.
  const gained = Math.min(FEAR_CAP, 55 + check.margin * 6);
  const before = existing ? fearNow(existing) : 0;
  const fear = Math.min(FEAR_CAP, Math.max(before, gained));
  const band = fearBand(fear);

  if (existing) {
    await query('UPDATE org_rackets SET fear=$1, last_leaned_at=$2 WHERE id=$3', [fear, now, existing.id]);
  } else {
    await query(
      `INSERT INTO org_rackets (id, org_id, npc_id, zone_id, fear, last_leaned_at, established_at)
         VALUES ($1,$2,$3,$4,$5,$6,$6)`,
      [randomUUID(), m.org_id, npc.id, zone.id, fear, now]);
  }
  await reloadRacket(npc.id);
  await pushConsole?.(m.org_id, broadcast);

  const cutPct = Math.round(band.rate * 100);
  if (existing) {
    return { type: 'corp_racket', message: `${esc(npc.name)} remembers the arrangement. <b>${band.label}</b> — <b>${esc(org.name)}</b> takes ${cutPct}% of the till again.` };
  }
  return { type: 'corp_racket', message: `${esc(npc.name)} stops arguing somewhere in the middle of the sentence. <b>${esc(npc.name)} is on the books.</b> <b>${band.label}</b> — ${cutPct}% of every sale to <b>${esc(org.name)}</b>. <span class="dim">It won't last. Come back before it doesn't.</span>` };
}

// Walk away from a shop deliberately (stops the crime exposure; the shopkeeper
// keeps the grudge). Officers only, same bit as establishing one.
async function cmdDropRacket(player, nameArg, pushConsole, broadcast) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  if (!hasPerm(player, PERM.RACKET)) return err("You don't have permission to run rackets for your corp.");
  const found = findShopkeeper(player, nameArg);
  if (found.error) return err(found.error);
  const r = getRacket(found.npc.id);
  if (!r || r.org_id !== m.org_id) return err(`${esc(found.npc.name)} isn't on your books.`);
  await query('DELETE FROM org_rackets WHERE id=$1', [r.id]);
  await reloadRacket(found.npc.id);
  await pushConsole?.(m.org_id, broadcast);
  return { type: 'corp_racket', message: `You let ${esc(found.npc.name)} off the hook. They don't thank you.` };
}

function racketList(player) {
  const m = getPlayerMembership(player.id);
  if (!m) return err("You're not in a corp.");
  const rows = racketConsoleBlock(m.org_id);
  if (!rows.length) return { type: 'corp_racket', message: 'Your corp has nobody on the books. Take a street, then lean on the shops in it.' };
  const lines = rows.map(r =>
    `  <b>${esc(r.shop)}</b> — ${esc(r.zone)} · <b>${r.band}</b> (${r.cut}% of the till)` +
    (r.lapsed ? ' <span class="dim">— lapsed, go remind them</span>' : ''));
  return { type: 'corp_racket', message: `<b>On the books:</b>\n${lines.join('\n')}` };
}

// ─── Console payload (consumed by buildConsolePayload in index.js) ───────────
// This is where the decay becomes visible: a book sliding from Terrified to Wary
// is the only nudge the game ever gives you to go walk the beat.
export function racketConsoleBlock(orgId) {
  const now = Date.now();
  return getOrgRackets(orgId).map(r => {
    const fear = fearNow(r, now);
    const band = fearBand(fear);
    return {
      shop: getNpc(r.npc_id)?.name || r.npc_id,
      zone: getZone(r.zone_id)?.name || r.zone_id,
      band: band.label,
      bandKey: band.key,
      fear: Math.round(fear),
      cut: Math.round(band.rate * 100),
      lapsed: !band.rate,
    };
  });
}

export const racketCount = (orgId) => getOrgRackets(orgId).length;
export { getAllRackets };
