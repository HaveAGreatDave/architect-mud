// SPORTS CARDS — the machines, the tear and the Binder pages. The card itself (who is in
// the set, his editions, his frozen season, both faces) is sports.js; this file is where
// money, sleeves and rows change hands.
//
// A sports machine is an ordinary `flags.vends_packs` cabinet with `flags.card_league` set
// ('baseball' or 'hockey'). It shares the Draft machine's coils (machine.js) and its panel
// (client/game/js/panels/cardpack.js), which takes the brand, the verbs and the odds board
// from the payload, so one cabinet face serves all three sets.
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { world } from '../../server/engine/world.js';
import { getGameDateTime } from '../../server/engine/environment.js';
import { logRender } from '../../server/engine/minigame.js';
import { isPluggedIn } from '../appliances/index.js';
import { slotsFor, slotLeft, totalLeft, fullestSlot, takeFromSlot, normaliseSlot, SLOT_CODES } from './machine.js';
import { mulberry32 } from './builder.js';
import {
  SPORTS, SPORTS_PACK_PRICE, EDITIONS, EDITION_ORDER, rarityOf, leagueNow, rollSportsSleeve, renderSportsCard, dateLabel,
} from './sports.js';

const now = (sport) => leagueNow(sport, { dispatch: dispatchAction, npcs: [...world.npcs.values()], date: getGameDateTime().date });

// The club shields come from the broadcasts' own crest drawer, so a card's shield is the
// one on the score bug. Imported at call time (see the README on cross-system imports).
let _crest = null;
async function crestFn() {
  if (!_crest) _crest = (await import('../../client/game/js/panels/club-crest.js')).crestSvg;
  return _crest;
}
// The league's clubs, for drawing a face. RAM (the broadcast library), no round trip.
async function clubsOf(sport) {
  const lg = await dispatchAction({ type: 'broadcast.getSportsLeague', params: { sport } }).catch(() => null);
  return lg?.clubs || {};
}
export async function sportsFace(card, clubs) {
  const crestSvg = await crestFn();
  const club = clubs?.[card.team] || null;
  return renderSportsCard(card, {
    club,
    crest: club ? crestSvg(club, '100%', { title: card.team }) : '',
    miniCrest: club ? crestSvg(club, '100%') : '',
  });
}

// ── sleeves ────────────────────────────────────────────────────────────────────
export async function sportsPacksHeld(playerId, sport) {
  const { rows } = await query(
    'SELECT COALESCE(SUM(quantity),0) AS n FROM player_inventory WHERE player_id=$1 AND item_id=$2',
    [playerId, SPORTS[sport].item]);
  return Number(rows[0]?.n) || 0;
}

// The machine's odds board, in editions: base cards on the common bar, then each edition
// on the rank it reveals at. Drawn from the live set, like the Draft board.
function editionBoard(L) {
  const by = { common: L.set.length, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
  for (const s of L.specials) by[EDITIONS[s.edition].rarity] += 1;
  return by;
}

function panelBase(machine, sport, L, player, packs, day) {
  const lg = SPORTS[sport];
  return {
    machine: machine.name,
    brand: lg.brand,
    tagline: lg.tagline,
    league: sport,
    buyCmd: `buypack ${lg.screen}`,
    openCmd: `openpack ${lg.screen}`,
    price: SPORTS_PACK_PRICE,
    scrapValue: 0,
    credits: player.credits || 0,
    packs,
    slots: slotsFor(machine, day),
    pool: { total: L?.set.length || 0, byRank: L ? editionBoard(L) : {} },
    hint: `Five cards a sleeve, every one of them stamped with the man's season as it stands the second you pay. `
      + `About two sleeves in five end on a special edition: a captain, a ${sport === 'hockey' ? 'goalie, ' : ''}or a rising star.`,
  };
}

// `buypack` at a sports machine. Same shape as the Draft machine: bare opens the cabinet,
// `confirm [coil]` buys. The sleeve's five cards are rolled and their seasons frozen HERE,
// at the counter, and written onto the sleeve's own row (see sports.js).
export async function buySportsPack(machine, words, player, broadcast) {
  const sport = machine.flags.card_league;
  const lg = SPORTS[sport];
  if (!lg) return { type: 'error', message: `The ${machine.name} has nothing loaded.` };
  if (!isPluggedIn(machine)) return { type: 'error', message: `The ${machine.name}'s window is dark. The glass just shows you the room.` };
  const day = getGameDateTime().date;
  const confirming = words.some(w => /^(confirm|buy|yes|y)$/i.test(w));
  const asked = words.map(normaliseSlot).find(w => SLOT_CODES.includes(w)) || null;
  const L = await now(sport);
  const packs = await sportsPacksHeld(player.id, sport);

  if (!confirming && !asked) {
    const stocked = totalLeft(machine, day);
    return {
      type: 'cardmach_panel', ...panelBase(machine, sport, L, player, packs, day),
      message: !L
        ? `The ${machine.name} lights its window, and every coil reads OFF SEASON.`
        : stocked
          ? `The ${machine.name} lights its window: ${lg.set}, ${stocked} sleeve${stocked === 1 ? '' : 's'} on the coils.`
          : `The ${machine.name} lights its window, and every coil behind the glass is bare.`,
    };
  }
  if (!L) return { type: 'error', message: `The ${machine.name} reads OFF SEASON. There's no league to print.` };
  const slot = asked || fullestSlot(machine, day);
  if (!slot) return { type: 'error', message: `Every coil in the ${machine.name} is bare. Come back when it's been filled.` };
  if (asked && slotLeft(machine, day, asked) < 1) return { type: 'error', message: `Coil ${asked} is empty. Pick another.` };
  if ((player.credits || 0) < SPORTS_PACK_PRICE) return { type: 'error', message: `A sleeve is ₵${SPORTS_PACK_PRICE}. You have ₵${player.credits || 0}.` };
  const taken = takeFromSlot(machine, day, slot);
  if (!taken) return { type: 'error', message: `Coil ${slot} turns, catches, and gives you nothing. Try another.` };
  if (!(await adjustCredits(player, -SPORTS_PACK_PRICE, undefined, `cards:pack:${sport}`))) {
    return { type: 'error', message: `A sleeve is ₵${SPORTS_PACK_PRICE}. You have ₵${player.credits || 0}.` };
  }
  const cards = rollSportsSleeve(L, mulberry32(taken.seed));
  await query('INSERT INTO player_inventory (id, player_id, item_id, quantity, custom_data) VALUES ($1,$2,$3,1,$4)',
    [randomUUID(), player.id, lg.item, JSON.stringify({ league: sport, coil: taken.coil, machine: machine.name, cards })]);

  broadcast(player.current_zone, { type: 'zone_event', message: `The ${machine.name} grinds, and drops a ${lg.short} sleeve into its tray for ${player.handle}.` }, player.id);
  return {
    type: 'cardmach_vend',
    machine: machine.name,
    slot,
    credits: player.credits,
    packs: packs + 1,
    slots: slotsFor(machine, day),
    message: `Coil <b>${slot}</b> turns and a ${lg.short} sleeve drops into the tray. <b>₵${SPORTS_PACK_PRICE}</b> gone, <b>₵${player.credits}</b> left. `
      + `The backs are printed as of today. Tear it now or keep it sealed: `
      + `<span class="action-link cmd" data-action="cmd" data-cmd="openpack ${lg.screen}">openpack ${lg.screen}</span>.`,
  };
}

// The sports league whose sleeve `openpack` should take when the player named none: any
// league they hold a sleeve for. Null when they hold none.
export async function heldSportsLeague(playerId) {
  const { rows } = await query(
    `SELECT item_id FROM player_inventory WHERE player_id=$1 AND item_id = ANY($2) ORDER BY id LIMIT 1`,
    [playerId, Object.values(SPORTS).map(l => l.item)]);
  return rows.length ? Object.values(SPORTS).find(l => l.item === rows[0].item_id)?.id || null : null;
}

// Tearing a sports sleeve. The contents were decided and stamped at the counter; this
// only takes them out and puts them in the binder.
export async function openSportsPack(sport, player, broadcast) {
  const lg = SPORTS[sport];
  const { rows } = await query(
    `SELECT id, quantity, custom_data FROM player_inventory WHERE player_id=$1 AND item_id=$2 ORDER BY id LIMIT 1`,
    [player.id, lg.item]);
  if (!rows.length) return { type: 'error', message: `You have no ${lg.short} sleeves. They come out of a ${lg.short} card machine: ₵${SPORTS_PACK_PRICE} a go.` };
  const row = rows[0];
  if (Number(row.quantity) > 1) await query('UPDATE player_inventory SET quantity = quantity - 1 WHERE id=$1', [row.id]);
  else await query('DELETE FROM player_inventory WHERE id=$1', [row.id]);
  const d = row.custom_data || {};
  let cards = Array.isArray(d.cards) ? d.cards : [];
  // A sleeve with nothing stamped on it (given by staff, or from before the stamp) is
  // printed now, against the season as it stands.
  if (!cards.length) {
    const L = await now(sport);
    cards = L ? rollSportsSleeve(L) : [];
  }
  if (!cards.length) return { type: 'error', message: 'The sleeve is empty. Just foil.' };

  const before = await query(
    `SELECT subject, edition, COALESCE(card->>'art', 'portrait') AS art FROM sports_cards WHERE player_id=$1 AND league=$2 AND subject = ANY($3)`,
    [player.id, sport, cards.map(c => c.name)]);
  const had = new Set(before.rows.map(r => `${r.subject}|${r.edition}|${r.art}`));
  const vals = [], params = [];
  cards.forEach((c, i) => {
    params.push(player.id, sport, c.name, c.edition, JSON.stringify(c));
    vals.push(`($${i * 5 + 1},$${i * 5 + 2},$${i * 5 + 3},$${i * 5 + 4},$${i * 5 + 5})`);
  });
  const ins = await query(`INSERT INTO sports_cards (player_id, league, subject, edition, card) VALUES ${vals.join(',')} RETURNING id`, params);

  const clubs = await clubsOf(sport);
  const out = [];
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const ed = EDITIONS[c.edition] || EDITIONS.base;
    out.push({
      id: ins.rows[i]?.id, name: c.name,
      subject_type: `${ed.label ? ed.label + ' · ' : ''}${c.pos} · ${c.team || 'Unsigned'}`,
      rarity: rarityOf(c), hit: i === cards.length - 1, dupe: had.has(`${c.name}|${c.edition}|${c.art || 'portrait'}`),
      face: await sportsFace(c, clubs),
    });
  }
  // worst to best, so the hit lands last (the Draft reveal's rule)
  const rank = (r) => ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(r);
  out.sort((a, b) => rank(a.rarity) - rank(b.rarity));

  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} tears open a ${lg.short} sleeve.` }, player.id);
  const lines = out.map((c, i) => `<span class="card-pull card-pull-${c.rarity}" data-delay="${i}">`
    + `<span class="card-pull-name">${c.name}</span> <span class="text-dim">${c.subject_type}</span>`
    + (c.dupe ? ' <span class="card-dupe">GOT HIM</span>' : '') + '</span>');
  return logRender(player, {
    type: 'cardpack_open',
    cards: out,
    brand: lg.brand,
    sub: lg.set.toUpperCase(),
    league: sport,
    againCmd: `openpack ${lg.screen}`,
    shelfScreen: lg.screen,
    scrapValue: 0,
    scrapped: 0,
    coil: d.coil || null,
    machine: d.machine || null,
    hot: false,
    packs: await sportsPacksHeld(player.id, sport),
    message: `<span class="card-sleeve" data-count="${out.length}"><span class="card-tear">The ${lg.short} sleeve tears. <b>${out.length}</b> cards.`
      + (d.coil ? ` <span class="text-dim">Coil ${d.coil}${d.machine ? `, ${d.machine}` : ''}.</span>` : '')
      + `</span>${lines.join('')}</span>\n<span class="text-dim">They're in your Binder, on the ${lg.short} page.</span>`,
  });
}

// ── the Binder pages ───────────────────────────────────────────────────────────
// Unlike the Draft page, a league page names its gaps. The Draft page hides who is in an
// empty slot because the pool holds minted players; a league's roster is on the air every
// night, and a checklist with the names on it is what a season set has always come with.
export async function sportsBinderScreen(player, sport) {
  const lg = SPORTS[sport];
  const [L, { rows }] = await Promise.all([
    now(sport),
    query('SELECT id, subject, edition, card, pulled_at FROM sports_cards WHERE player_id=$1 AND league=$2 ORDER BY id DESC', [player.id, sport]),
  ]);
  const held = new Map();   // `${name}|${edition}` -> { id, n, card }, any art
  const action = new Map(); // `${name}|${edition}` -> the newest action shot's id
  for (const r of rows) {
    const k = `${r.subject}|${r.edition}`;
    const h = held.get(k);
    if (h) h.n += 1; else held.set(k, { id: r.id, n: 1, card: r.card });
    if (r.card?.art === 'action' && !action.has(k)) action.set(k, r.id);
  }
  const clubs = L?.clubs || {};
  const crestSvg = await crestFn();
  const teams = L?.teams || [];
  const byTeam = new Map(teams.map(t => [t, []]));
  for (const m of L?.set || []) {
    const h = held.get(`${m.name}|base`);
    if (!byTeam.has(m.team)) byTeam.set(m.team, []);
    byTeam.get(m.team).push({ name: m.name, num: m.num, pos: m.pos, id: h?.id || null, n: h?.n || 0, actionId: action.get(`${m.name}|base`) || null });
  }
  const specials = (L?.specials || []).map(s => {
    const m = L.men.get(s.name);
    const h = held.get(`${s.name}|${s.edition}`);
    return { name: s.name, edition: s.edition, label: EDITIONS[s.edition].label, rarity: EDITIONS[s.edition].rarity,
      team: m?.team || '', num: m?.num, pos: m?.pos, id: h?.id || null, n: h?.n || 0, actionId: action.get(`${s.name}|${s.edition}`) || null };
  }).sort((a, b) => EDITION_ORDER.indexOf(a.edition) - EDITION_ORDER.indexOf(b.edition) || teams.indexOf(a.team) - teams.indexOf(b.team));
  // Specials pulled for a man who no longer holds the edition (a new captain, a cooled bat)
  // stay in the binder: the card is a record of when he did.
  for (const [k, h] of held) {
    const [name, edition] = k.split('|');
    if (edition === 'base' || specials.some(s => s.name === name && s.edition === edition)) continue;
    specials.push({ name, edition, label: EDITIONS[edition]?.label || edition, rarity: EDITIONS[edition]?.rarity || 'rare',
      team: h.card?.team || '', num: h.card?.num, pos: h.card?.pos, id: h.id, n: h.n, retired: true });
  }
  const baseTotal = L?.set.length || 0;
  const baseOwned = (L?.set || []).filter(m => held.has(`${m.name}|base`)).length;
  const actionOwned = (L?.set || []).filter(m => action.has(`${m.name}|base`)).length;
  return {
    view: 'binder_sports',
    breadcrumb: [lg.short],
    league: sport,
    leagueName: lg.short,
    setName: lg.set,
    seasonNo: L?.seasonNo || null,
    pulls: rows.length,
    baseOwned, baseTotal, actionOwned,
    pct: baseTotal ? Math.round((baseOwned / baseTotal) * 100) : 0,
    clubs: [...byTeam].filter(([, men]) => men.length).map(([team, men]) => ({
      team: team || 'Unsigned',
      crest: clubs[team] ? crestSvg(clubs[team], 28) : '',
      colour: clubs[team]?.colours?.[0] || '#667',
      men,
    })),
    specials: specials.map(s => ({ ...s, colour: clubs[s.team]?.colours?.[0] || '#667' })),
  };
}

// One pulled card at size, with every other copy of him in the same edition listed under
// it, newest first, so the seasons can be compared.
export async function sportsCardScreen(player, id) {
  const { rows } = await query('SELECT id, league, subject, edition, card, pulled_at FROM sports_cards WHERE id=$1 AND player_id=$2', [Number(id), player.id]);
  if (!rows.length) return null;
  const r = rows[0];
  const lg = SPORTS[r.league] || SPORTS.baseball;
  const [{ rows: copies }, clubs] = await Promise.all([
    query('SELECT id, card FROM sports_cards WHERE player_id=$1 AND league=$2 AND subject=$3 AND edition=$4 ORDER BY id DESC',
      [player.id, r.league, r.subject, r.edition]),
    clubsOf(r.league),
  ]);
  const ed = EDITIONS[r.edition] || EDITIONS.base;
  return {
    view: 'binder_sports_card',
    breadcrumb: [lg.short, r.subject],
    league: r.league,
    screen: lg.screen,
    card: {
      id: r.id, name: r.subject, edition: r.edition, editionLabel: ed.label, rarity: rarityOf(r.card),
      face: await sportsFace(r.card, clubs),
    },
    copies: copies.map(c => ({
      id: c.id, current: c.id === r.id,
      label: `${c.card?.season ? `Season ${c.card.season}` : 'Preseason'}${c.card?.asOf ? `, ${dateLabel(c.card.asOf)}` : ''}`,
      line: (c.card?.stats || []).slice(0, 4).map(([k, v]) => `${v} ${k}`).join(' · '),
    })),
  };
}

export const sportsTabs = () => [
  { id: 'binder', label: 'Draft' },
  ...Object.values(SPORTS).map(l => ({ id: l.screen, label: l.short })),
];
export const leagueOfScreen = (screen) => Object.values(SPORTS).find(l => l.screen === screen)?.id || null;
export const screenOfLeague = (league) => SPORTS[league]?.screen || 'binder';
