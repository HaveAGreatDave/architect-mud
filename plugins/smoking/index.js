/**
 * Smoking plugin — the behavioural layer of lighting up.
 *
 * Everything that makes a cigarette *feel* like a cigarette but isn't a plain
 * stat buff lives here. The buff itself (Cool up, Stamina down) is pure content
 * on the drug row's phases.peak_mods; this plugin owns the three behaviours that
 * aren't expressible as a stat delta:
 *
 *   • appetite suppression — sets `player.appetiteSuppressedUntil` (ms); the
 *       engine's hunger-decay tick reads that field and simply stops decaying
 *       while it's in the future. Plugin owns the field, engine reacts — the
 *       posture pattern. Contract documented in docs/systems-survival.md.
 *   • hacking cough — a self-scheduled tick rolls a random cough for anyone who
 *       has smoked recently (high chance) or is still a smoker (chronic low
 *       chance), narrated to them and the room.
 *   • cool-reaction — on lighting up, everyone else in the zone is made to think,
 *       despite themselves, how cool the smoker looks.
 *
 * Nothing is hardcoded to "cigarettes": a drug row flagged `flags.smokeable`
 * drives all of it, so the drug editor stays the source of truth (mirrors how
 * the intoxication plugin keys off `flags.alcoholic`). The `smoke` verb is a
 * flavour alias for `use`/`inject`, delegating to the engine drug path.
 *
 * Smoking state is in-memory and cleared on death/logout, like the trip and
 * intoxication runtime fields.
 */
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { cmdUse } from '../../server/engine/commands/inventory.js';
import { getAllLivePlayers, getZonePlayers, getZoneNpcs } from '../../server/engine/world.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
import { burnCharge } from '../../server/engine/inventory.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';

// --- tunables ----------------------------------------------------------------
const DEFAULT_SUPPRESS_SECONDS = 900;   // 15 min of no hunger decay per cigarette

const COUGH_TICK_MS   = 8000;
const RECENT_SMOKE_MS  = 3 * 60 * 1000;   // "just smoked" window — cough is likely
const SMOKER_WINDOW_MS = 30 * 60 * 1000;  // still counts as a smoker — chronic cough
const RECENT_COUGH_CHANCE  = 0.30;        // per tick right after a smoke
const CHRONIC_COUGH_CHANCE = 0.05;        // per tick while a lingering smoker

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Second-person framing so every onlooker in the room "thinks to themselves".
const COOL_LINES = [
  '{who} takes a long, unhurried drag. You catch yourself thinking they look far cooler than they have any right to.',
  '{who} exhales a slow plume of smoke, and for a second you genuinely wish you looked that effortless.',
  'Smoke curls around {who} like they planned it. Annoyingly, it works. They look cool.',
  '{who} taps ash with a flick of the wrist, and some traitor part of your brain files it under "cool".',
];
const SELF_COUGH = [
  'You double over in a violent, hacking cough that leaves your eyes watering.',
  'A deep, tearing cough claws its way up your throat. Smoker\'s lungs.',
  'You hack and wheeze, thumping your chest until it passes.',
];
const ROOM_COUGH = [
  'doubles over in a violent, hacking cough.',
  'hacks and wheezes, thumping their chest.',
  'is seized by a deep, rattling cough.',
];

// --- smoke verb (flavour alias for use/inject) -------------------------------

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

async function smoke(args, raw, player, broadcast) {
  const targetStr = args.join(' ');
  if (!(await findDrug(targetStr, player))) {
    return { type: 'error', message: targetStr ? `You've got nothing like that to smoke.` : 'Smoke what?' };
  }
  return cmdUse(targetStr, player, broadcast);
}

// --- give a cigarette (bum one to a player/NPC) ------------------------------
//
// Recipient-first grammar layered over the engine give verb: `give <who> a
// cigarette` / `give <who> cigarette`. It takes ONE cigarette off the giver's
// pack (burnCharge — destroying the pack on the last one) and hands the recipient
// a single loose cigarette. Any other give (`give <item> to <who>`, non-cigarette
// items) returns undefined and falls straight through to the engine handler.
//
//   • NPCs always accept and thank on the spot.
//   • Players get a timed offer they can `accept` or `refuse`; the giver's pack is
//     only touched on accept. Offers expire after OFFER_TTL_MS.

const OFFER_TTL_MS = 30000;
const pendingOffers = new Map();   // recipient playerId -> { fromId, fromHandle, timer }

const NPC_THANKS = [
  "Thanks — you're a lifesaver.",
  'Appreciated, friend.',
  "Been gasping for one of these.",
  'Cheers. I owe you.',
];

const parseTags = (t) => typeof t === 'string' ? (() => { try { return JSON.parse(t); } catch { return {}; } })() : (t || {});

// The trailing token must be "cigarette" for this to be a bum-a-smoke. Returns
// the recipient string, '' when none was named, or null to fall through to the
// engine give (a `... to ...` phrasing, or a non-cigarette item).
function parseCigGive(args) {
  const lower = args.map(a => a.toLowerCase());
  if (lower.includes('to')) return null;                 // engine grammar: give <item> to <who>
  let end = lower.length;
  if (end === 0 || lower[end - 1] !== 'cigarette') return null;
  end--;
  if (end > 0 && (lower[end - 1] === 'a' || lower[end - 1] === 'an')) end--;
  return args.slice(0, end).join(' ').trim();
}

// A held cigarette pack (or loose single) — the same item_id, tagged pack_size.
async function findPack(player) {
  const { rows } = await query(
    `SELECT pi.*, i.name, i.tags FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
      WHERE pi.player_id=$1 AND pi.container_id IS NULL AND pi.is_equipped=0
        AND i.name ILIKE '%cigarette%' AND jsonb_exists(i.tags, 'pack_size')
      ORDER BY pi.quantity DESC LIMIT 1`,
    [player.id]
  );
  return rows[0] || null;
}

async function giveCigarette(args, raw, player, broadcast) {
  const who = parseCigGive(args);
  if (who === null) return undefined;                    // not a cigarette bum → engine give
  if (!who) return { type: 'action', message: 'Give a cigarette to whom?' };

  const pack = await findPack(player);
  if (!pack) return { type: 'action', message: "You don't have a cigarette to give." };

  // Player in the room → timed offer they can accept/refuse.
  const players = getZonePlayers(player.current_zone).filter(p => p.id !== player.id).map(p => ({ ...p, name: p.handle }));
  const pr = siftResolve(who, players);
  if (pr.type === 'ambiguous') return { type: 'action', message: `Multiple people match "${who}" — be more specific.` };
  if (pr.type !== 'none') {
    const target = pr.candidate;
    const existing = pendingOffers.get(target.id);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      const o = pendingOffers.get(target.id);
      if (!o || o.fromId !== player.id) return;
      pendingOffers.delete(target.id);
      sendToPlayer(target.id, { type: 'output', message: `<span class="msg-system">The cigarette ${player.handle} offered goes unclaimed.</span>` });
      sendToPlayer(player.id, { type: 'output', message: `<span class="msg-system">${target.handle} never took the cigarette. You pocket it again.</span>` });
    }, OFFER_TTL_MS);
    pendingOffers.set(target.id, { fromId: player.id, fromHandle: player.handle, timer });
    sendToPlayer(target.id, { type: 'output', message: `<span class="msg-system">${player.handle} offers you a cigarette. Type <b>accept</b> or <b>refuse</b>.</span>` });
    return { type: 'action', message: `You hold out a cigarette to ${target.handle}.` };
  }

  // NPC → always accepts and thanks.
  const nr = siftResolve(who, getZoneNpcs(player.current_zone));
  if (nr.type === 'ambiguous') return { type: 'action', message: `Multiple people match "${who}" — be more specific.` };
  if (nr.type !== 'none') {
    const npc = nr.candidate;
    await burnCharge(pack, parseTags(pack.tags));
    sendToZone(player.current_zone, { type: 'zone_event', message: `${npc.name} takes a cigarette from ${player.handle} with a nod of thanks.` }, player.id);
    return { type: 'action', message: `You give ${npc.name} a cigarette. "${pick(NPC_THANKS)}"` };
  }

  return { type: 'action', message: `There's no "${who}" here to give a cigarette to.` };
}

async function acceptOffer(args, raw, player, broadcast) {
  const offer = pendingOffers.get(player.id);
  if (!offer) return undefined;                          // nothing pending → fall through
  clearTimeout(offer.timer);
  pendingOffers.delete(player.id);

  const giver = getAllLivePlayers().find(p => p.id === offer.fromId);
  if (!giver) return { type: 'action', message: 'Whoever offered you that cigarette is gone.' };
  const pack = await findPack(giver);
  if (!pack) return { type: 'action', message: `${offer.fromHandle} doesn't have a cigarette anymore.` };

  await burnCharge(pack, parseTags(pack.tags));
  // Hand the recipient a single loose cigarette — a 1-charge instance of the same
  // item. `loose` marks it as a lone smoke (not a pack) for the end-of-use line.
  await query(
    `INSERT INTO player_inventory (id, player_id, item_id, quantity, is_equipped, custom_data)
     VALUES ($1,$2,$3,1,0,$4::jsonb)`,
    [randomUUID(), player.id, pack.item_id, JSON.stringify({ charges: 1, name: 'cigarette', loose: true })]
  );
  sendToPlayer(giver.id, { type: 'output', message: `<span class="msg-system">${player.handle} takes the cigarette you offered.</span>` });
  return { type: 'action', message: `You take the cigarette from ${offer.fromHandle}.` };
}

async function refuseOffer(args, raw, player, broadcast) {
  const offer = pendingOffers.get(player.id);
  if (!offer) return undefined;                          // nothing pending → fall through
  clearTimeout(offer.timer);
  pendingOffers.delete(player.id);
  const giver = getAllLivePlayers().find(p => p.id === offer.fromId);
  if (giver) sendToPlayer(giver.id, { type: 'output', message: `<span class="msg-system">${player.handle} waves off the cigarette you offered.</span>` });
  return { type: 'action', message: `You decline ${offer.fromHandle}'s cigarette.` };
}

export const specializedActions = [
  { verb: 'smoke', requiredTag: 'drug', handler: smoke },
  { verb: 'give', handler: giveCigarette },
  { verb: 'accept', handler: acceptOffer },
  { verb: 'refuse', handler: refuseOffer },
];

// --- on light-up: appetite suppression + cool-reaction -----------------------

on('player.drugUsed', ({ player, drug }) => {
  if (!player || !drug?.flags?.smokeable) return;
  const secs = Number(drug.flags.appetite_suppress_seconds) || DEFAULT_SUPPRESS_SECONDS;
  player.appetiteSuppressedUntil = Date.now() + secs * 1000;
  player._lastSmokeAt = Date.now();
  sendToZone(
    player.current_zone,
    { type: 'zone_event', message: pick(COOL_LINES).replace('{who}', player.handle) },
    player.id
  );
});

// --- cough lifecycle ---------------------------------------------------------

function cough(player) {
  sendToPlayer(player.id, { type: 'output', message: pick(SELF_COUGH) });
  sendToZone(
    player.current_zone,
    { type: 'zone_event', message: `${player.handle} ${pick(ROOM_COUGH)}` },
    player.id
  );
}

function clearSmoking(player) {
  if (!player) return;
  player._lastSmokeAt = 0;
  player.appetiteSuppressedUntil = 0;
  // Drop any cigarette offer this player is part of (as recipient or giver).
  const own = pendingOffers.get(player.id);
  if (own) { clearTimeout(own.timer); pendingOffers.delete(player.id); }
  for (const [rid, o] of pendingOffers) {
    if (o.fromId === player.id) { clearTimeout(o.timer); pendingOffers.delete(rid); }
  }
}

on('player.death',  ({ player }) => clearSmoking(player));
on('player.logout', ({ id })     => clearSmoking(getAllLivePlayers().find(x => x.id === id)));

// --- tick: random hacking cough ----------------------------------------------

let ticking = false;
function coughTick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const player of getAllLivePlayers()) {
      const since = now - (player._lastSmokeAt || 0);
      if (!player._lastSmokeAt || since >= SMOKER_WINDOW_MS) continue;
      const chance = since < RECENT_SMOKE_MS ? RECENT_COUGH_CHANCE : CHRONIC_COUGH_CHANCE;
      if (Math.random() < chance) cough(player);
    }
  } finally {
    ticking = false;
  }
}

setInterval(() => { try { coughTick(); } catch (e) { console.error('[smoking] tick error:', e.message); } }, COUGH_TICK_MS);

// Exposed for the regression suite.
export const _test = { coughChance: (since) => since < RECENT_SMOKE_MS ? RECENT_COUGH_CHANCE : (since < SMOKER_WINDOW_MS ? CHRONIC_COUGH_CHANCE : 0), DEFAULT_SUPPRESS_SECONDS };
