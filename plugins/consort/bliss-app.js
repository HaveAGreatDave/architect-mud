// plugins/consort/bliss-app.js
//
// B.L.I.S.S. — Bonded Live-In Intimacy Subscription Service.
//
// The tablet app that places a consort in a space you hold, for a significant
// daily retainer. It is MIS-gated: the tile does not exist on the home screen
// unless the player has MIS on, which is the same rule the rest of this plugin's
// explicit content follows — nobody who hasn't opted in ever sees B.L.I.S.S.
// advertised at them.
//
// Screens:
//   listings   — the rotating catalogue. Six placements, seeded, rerollable on a
//                ten-minute cooldown. Rare slots are inseparable PAIRINGS.
//   detail     — one placement: every physical characteristic, how they describe
//                themselves, the rate, and what tenure would do to it.
//   arrangement— what you currently keep, what it costs today, tenure, release.
//
// The catalogue is not stored. It's regenerated from `<playerId>:<generation>`
// every time the screen is built, so the only state is a generation counter and
// the timestamp of the last reroll (two player_flags).
//
// The copy throughout is the Syndicate's, not the game's: brisk, procedural, and
// entirely untroubled by what it is actually selling.

import { registerTabletApp, normScreen } from '../tablet/registry.js';
import { isMisActive } from '../../server/engine/mis.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { generateRoster, rosterSections, listingCard, rerollState, effectiveRate, loyaltyTier, rerollCooldownMs } from './roster.js';
import { consortRowsOf, privateSpacesOf, placeListing, releaseConsort, consortRow, pairMembers, holdsPrivateSpace } from './hire.js';
import { PAIRINGS } from './archetypes.js';

const GEN_FLAG    = 'bliss_roster_gen';
const REROLL_FLAG = 'bliss_roster_rolled';

async function rosterFor(player) {
  const gen = Number(await getFlag('player', GEN_FLAG, player)) || 0;
  return { gen, listings: generateRoster(`${player.id}:${gen}`) };
}

async function findListing(player, listingId) {
  const { listings } = await rosterFor(player);
  return listings.find(l => l.id === listingId) || null;
}

// ── Screens ───────────────────────────────────────────────────────────────────
async function buildListings(player) {
  const { listings } = await rosterFor(player);
  const rolled = Number(await getFlag('player', REROLL_FLAG, player)) || 0;
  const held = await consortRowsOf(player.id);
  return {
    view: 'bliss_listings',
    strapline: 'Bonded Live-In Intimacy Subscription Service',
    smallprint: 'Placements are subject to availability, a daily retainer, and clause 9.',
    reroll: rerollState(rolled),
    cooldownMs: rerollCooldownMs(),
    heldCount: held.length,
    // The register is SECTIONED by sex, with matched pairs their own shelf. A
    // six-slot register is now built half and half (roster.js), so the sections
    // are always both worth opening — the old coin-per-slot could hand you five
    // women and a refresh you now have to wait a day for.
    sections: rosterSections(listings),
    listings: listings.map(l => {
      const card = listingCard(l);
      return {
        id: card.id,
        kind: card.kind,
        rate: card.rate,
        pairing: card.pairing,
        // The summary line the catalogue shows per placement.
        members: card.members.map(m => ({
          name: m.name,
          sex: m.sex,
          says: m.says,
          traits: m.temperament?.traits || [],
          headline: m.headline,
          summary: `${m.physical.find(r => r[0] === 'Height')?.[1] || ''}, ${m.physical.find(r => r[0] === 'Build')?.[1]?.split(' — ')[0] || ''}`,
        })),
      };
    }),
  };
}

async function buildDetail(player, listingId) {
  const listing = await findListing(player, listingId);
  if (!listing) return { view: 'bliss_listings', notice: 'That placement is no longer on the register.' };
  const card = listingCard(listing);
  const spaces = await privateSpacesOf(player);
  return {
    view: 'bliss_detail',
    listing: card,
    spaces,
    // No space, no placement — the Syndicate does not deliver to the street.
    blocked: spaces.length ? null : 'B.L.I.S.S. requires a private address on file. Acquire a residence or premises first.',
    firstCharge: card.rate,
  };
}

async function buildArrangement(player) {
  const rows = await consortRowsOf(player.id);
  // Collapse a pairing into one entry — it bills and releases as one unit.
  const seen = new Set();
  const entries = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    const group = r.pairing_id ? rows.filter(x => x.pairing_id === r.pairing_id) : [r];
    group.forEach(g => seen.add(g.id));
    const todayRate = group.reduce((s, g) => s + effectiveRate(g.daily_rate, g.days_kept), 0);
    const baseRate = group.reduce((s, g) => s + g.daily_rate, 0);
    entries.push({
      id: r.id,
      names: group.map(g => g.name),
      pairing: r.pairing_id ? (PAIRINGS[group.map(g => g.archetype).sort().join('_')]?.label || 'A matched pair') : null,
      daysKept: r.days_kept || 0,
      tier: loyaltyTier(r.days_kept || 0),
      baseRate,
      todayRate,
      saving: Math.max(0, baseRate - todayRate),
      missed: r.missed || 0,
      zone: r.home_zone,
      // A house placement is listed like any other — that's the whole point of
      // showing it — but it carries no retainer and cannot be released through
      // the app. The Syndicate did not place them and has no say in it.
      house: !!r.house,
    });
  }
  return {
    view: 'bliss_arrangement',
    entries,
    dailyTotal: entries.reduce((s, e) => s + e.todayRate, 0),
    empty: entries.length === 0,
  };
}

// ── Actions ───────────────────────────────────────────────────────────────────
async function handleAction(player, actionId, params) {
  if (actionId === 'open') return buildDetail(player, params);

  if (actionId === 'reroll') {
    const rolled = Number(await getFlag('player', REROLL_FLAG, player)) || 0;
    const state = rerollState(rolled);
    if (!state.ready) {
      return { ...(await buildListings(player)), notice: `The register refreshes in ${state.remainingLabel}.` };
    }
    const gen = (Number(await getFlag('player', GEN_FLAG, player)) || 0) + 1;
    await setFlag('player', GEN_FLAG, gen, player);
    await setFlag('player', REROLL_FLAG, Date.now(), player);
    return { ...(await buildListings(player)), notice: 'Register refreshed. New placements available.' };
  }

  if (actionId === 'place') {
    const [listingId, zoneId] = String(params || '').split('|');
    const listing = await findListing(player, listingId);
    if (!listing) return { ...(await buildListings(player)), notice: 'That placement is no longer on the register.' };
    if (!(await holdsPrivateSpace(player, zoneId))) {
      return { ...(await buildDetail(player, listingId)), notice: 'That address is not one you hold.' };
    }
    // First day up front — the retainer is prepaid, then billed nightly.
    const cost = listing.rate;
    const paid = await chargeUpFront(player, cost);
    if (!paid) {
      return { ...(await buildDetail(player, listingId)), notice: `Declined. The first day's retainer is ${cost}c and your accounts do not cover it.` };
    }
    const created = await placeListing(player, listing, zoneId);
    const names = created.map(c => c.name).join(' and ');
    // Burn the listing so it can't be ordered twice out of the same catalogue.
    const gen = (Number(await getFlag('player', GEN_FLAG, player)) || 0) + 1;
    await setFlag('player', GEN_FLAG, gen, player);
    return { ...(await buildArrangement(player)), notice: `${names} placed. First day's retainer of ${cost}c drawn.` };
  }

  if (actionId === 'release') {
    const row = await consortRow(String(params || ''));
    if (!row || row.owner_id !== player.id) {
      // A house placement has no `player_consorts` row, so it lands here. Say what
      // is actually true rather than "no such placement" — it is very much on the
      // account, the Syndicate simply has no authority over it.
      const arr = await buildArrangement(player);
      const house = (arr.entries || []).find(e => e.id === String(params || '') && e.house);
      return { ...arr, notice: house
        ? `${house.names.join(' and ')} are not a Syndicate placement. B.L.I.S.S. cannot collect what it did not place.`
        : 'No such placement on your account.' };
    }
    const members = await pairMembers(row);
    await releaseConsort(row, 'released');
    const names = members.map(m => m.name).join(' and ');
    return {
      ...(await buildArrangement(player)),
      notice: members.length > 1
        ? `${names} released. A matched pair goes together; the Syndicate does not sever one.`
        : `${names} released. The retainer ends tonight.`,
    };
  }

  if (actionId === 'arrangement') return buildArrangement(player);
  return buildListings(player);
}

// Bank first, then pocket — the same order the nightly retainer draws in.
async function chargeUpFront(player, amount) {
  const { query } = await import('../../server/models/db.js');
  const res = await query(
    `UPDATE players
        SET bank_credits = bank_credits - LEAST(bank_credits, $1),
            credits      = credits - GREATEST(0, $1 - LEAST(bank_credits, $1))
      WHERE id = $2 AND bank_credits + credits >= $1
      RETURNING credits, bank_credits`, [amount, player.id]);
  if (!res.rowCount) return false;
  player.credits = res.rows[0].credits;
  player.bank_credits = res.rows[0].bank_credits;
  return true;
}

async function buildScreen(player, screenId) {
  const screen = normScreen(screenId);
  if (screen === 'arrangement' || screen === 'your arrangement') return buildArrangement(player);
  return buildListings(player);
}

registerTabletApp({
  id: 'bliss',
  name: 'BLISS',
  icon: '♡',
  category: 'General',
  // MIS-gated: no tile, no listing, no mention of it for anyone who hasn't opted in.
  visible(player) { return isMisActive(player); },
  buildScreen,
  handleAction,
});

export const _test = { buildListings, buildDetail, buildArrangement, handleAction, rosterFor };
