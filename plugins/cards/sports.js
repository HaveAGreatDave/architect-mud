// SPORTS CARDS — the Deadball and Cluster Puck season sets.
//
// A sports card is a different object from a Draft card and is kept apart from it: its own
// table (`sports_cards`), its own sleeves, its own machines and its own Binder pages. A Draft
// card is a description of somebody; a sports card is a man in his club's colours on the
// front and his season on the back, the way a ballplayer's card has always been.
//
// THE BACK IS FROZEN AT THE COUNTER. The stats on a card are the man's season at the moment
// the pack was BOUGHT, not when it was torn: `buySportsPack` rolls the sleeve's contents and
// writes every card's line onto the sleeve's own inventory row, and the tear only reveals
// them. So a pack kept sealed in a coat for a month opens onto the season as it stood when
// you paid, and two copies of the same man bought a week apart carry different numbers. That
// difference is the reason to keep both.
//
// Everything a card says is DERIVED from what the leagues already know, so nothing is
// authored per man and a new man in the pool gets a card for free:
//   • the club, number and position: each league's rosters (hockey's `rosterFor`, Deadball's
//     season squads, `clubRosters`). Before Deadball had squads its pool was reshuffled every
//     game, and a man's club was the one he turned out for most; that path is still here for a
//     league with no squads.
//   • the number: the same hash the rink and the Grandstand put on his back, so the card
//     and the broadcast never disagree about his sweater
//   • the season line: the sport's own fold (`sportsleague.getStandings`), the same numbers
//     the standings and the booth read
//   • the special editions: CAPTAINS (a club's bound NPC captain in the CPhL, else its centre;
//     in Deadball the man who has been with his club longest), GOALIES (every CPhL net-minder)
//     and RISING STARS (the CPhL's bound stars; Deadball's batting-race top three and its
//     strikeout leader). Deadball has no goalies, so it has no goalie edition.
//
// Cold path throughout: a pack is one action read (RAM), one standings read (cached) and one
// write. No tick.
import { escapeHtml as esc } from '../../server/engine/html.js';
import { actionSvg, poseOf, ACTION_LABEL } from './sports-action.js';

export const SPORTS = {
  baseball: {
    id: 'baseball', brand: 'DEADBALL', short: 'Deadball', set: 'Deadball Season Set',
    item: 'deadball_card_pack', screen: 'deadball', words: ['deadball', 'baseball', 'ball'],
    tagline: 'SEASON SET · THE GRANDSTAND',
  },
  hockey: {
    id: 'hockey', brand: 'CLUSTER PUCK', short: 'Cluster Puck', set: 'Cluster Puck Season Set',
    item: 'cphl_card_pack', screen: 'puck', words: ['puck', 'clusterpuck', 'hockey', 'cphl'],
    tagline: 'SEASON SET · THE GARDENS',
  },
};
export const SPORTS_PACK_PRICE = 150;
export const SPORTS_PACK_SIZE = 5;
// The last card in a sleeve is a special edition this often. The rest are base cards.
const SPECIAL_CHANCE = 0.4;
// Any card, base or special, is an ACTION SHOT this often: the man full length doing his job
// (sports-action.js) instead of posing. A base action shot reveals a rung up, at uncommon.
const ACTION_CHANCE = 0.25;

// An edition is a rank on the reveal's ladder, so a captain lands like a legendary does.
export const EDITIONS = {
  base:    { label: '',            rarity: 'common',    weight: 0 },
  star:    { label: 'Rising Star', rarity: 'rare',      weight: 50 },
  goalie:  { label: 'Goalie',      rarity: 'epic',      weight: 30 },
  captain: { label: 'Captain',     rarity: 'legendary', weight: 20 },
};
export const EDITION_ORDER = ['captain', 'goalie', 'star', 'base'];
// The rank a card reveals at: its edition's, except a base action shot, which is uncommon.
export const rarityOf = (card) => (card.edition === 'base' && card.art === 'action' ? 'uncommon' : (EDITIONS[card.edition] || EDITIONS.base).rarity);

export function leagueOfWord(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return null;
  return Object.values(SPORTS).find(l => l.words.includes(w) || l.id === w)?.id || null;
}
export const sportsItemIds = () => Object.values(SPORTS).map(l => l.item);
export const leagueOfItem = (itemId) => Object.values(SPORTS).find(l => l.item === itemId)?.id || null;

// ── numbers ────────────────────────────────────────────────────────────────────
// The sweater numbers the broadcasts already draw, off the name. Deadball's is
// numberOf in client/game/js/panels/diamond/cast.js, the CPhL's numFor in
// client/game/js/panels/rink/director.js; both are FNV-1a, and they must stay these.
function fnvPoints(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function fnv(str) { let x = 0x811c9dc5 >>> 0; const s = String(str); for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619) >>> 0; return x >>> 0; }
export function sweaterNumber(sport, name) {
  return sport === 'hockey' ? 2 + (fnv(`num:${name}`) % 97) : 1 + (fnvPoints('no:' + name) % 99);
}

// ── the league, now ────────────────────────────────────────────────────────────
const HOCKEY_POS = ['LW', 'C', 'RW', 'D', 'D', 'G'];
const POS_ORDER = { P: 0, C: 1, '1B': 2, '2B': 3, '3B': 4, SS: 5, LF: 6, CF: 7, RF: 8, DH: 9, UT: 10, LW: 0, RW: 2, D: 3, G: 4, F: 5 };

const topKey = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
const addCounts = (a, b) => { const o = { ...(a || {}) }; for (const [k, v] of Object.entries(b || {})) o[k] = (o[k] || 0) + v; return o; };

// Everything a card can say about the league at this moment. `dispatch` is the action
// dispatcher (injected so regress can hand in a fake league).
export async function leagueNow(sport, { dispatch, npcs = [], date = '' } = {}) {
  const [lg, st, season] = await Promise.all([
    dispatch({ type: 'broadcast.getSportsLeague', params: { sport } }).catch(() => null),
    dispatch({ type: 'sportsleague.getStandings', params: { sport } }).catch(() => null),
    dispatch({ type: 'sportsleague.getSeason', params: { sport } }).catch(() => null),
  ]);
  if (!lg || !Array.isArray(lg.players) || !lg.players.length) return null;
  const men = new Map();      // name -> { name, team, pos, num }
  const specials = [];        // [{ name, edition }]
  if (sport === 'hockey') {
    for (const team of lg.teams) {
      (lg.rosters?.[team] || []).forEach((name, k) => {
        if (!men.has(name)) men.set(name, { name, team, pos: HOCKEY_POS[k] || 'F', num: sweaterNumber(sport, name) });
      });
    }
    // The league men who live in the city carry their club role on the NPC (flags.cphl).
    const bound = {};
    for (const n of npcs) {
      const b = n?.flags?.cphl;
      if (!b || typeof b.player !== 'string' || typeof b.club !== 'string') continue;
      (bound[b.club] ||= {})[b.role] = [...(bound[b.club]?.[b.role] || []), b.player];
      if (!men.has(b.player)) men.set(b.player, { name: b.player, team: b.club, pos: 'F', num: sweaterNumber(sport, b.player) });
    }
    for (const team of lg.teams) {
      const roster = lg.rosters?.[team] || [];
      const captain = bound[team]?.captain?.[0] || roster[1];
      if (captain) specials.push({ name: captain, edition: 'captain' });
      if (roster[5]) specials.push({ name: roster[5], edition: 'goalie' });
      for (const s of bound[team]?.star || []) specials.push({ name: s, edition: 'star' });
    }
  } else if (lg.rosters) {
    // Deadball's season squads (clubRosters in broadcast/sports/baseball.js): a club's
    // captain is the man who has been with it longest, and the rising stars are the
    // batting race's top three and the strikeout leader.
    const captains = new Set();
    for (const team of lg.teams) {
      const squad = lg.rosters[team] || [];
      for (const e of squad) if (!men.has(e.name)) men.set(e.name, { name: e.name, team, pos: e.pos, num: sweaterNumber(sport, e.name), since: e.since });
      const cap = squad.reduce((best, e) => (!best || e.since < best.since ? e : best), null);
      if (cap) { captains.add(cap.name); specials.push({ name: cap.name, edition: 'captain' }); }
    }
    const rising = [...(st?.batters || []).slice(0, 3), ...(st?.strikeouts || []).slice(0, 1)].map(r => r.name);
    for (const name of new Set(rising)) if (men.has(name) && !captains.has(name)) specials.push({ name, edition: 'star' });
  } else {
    const bats = st?.ledger?.bats || new Map(), arms = st?.ledger?.arms || new Map();
    for (const name of lg.players) {
      const b = bats.get(name), a = arms.get(name);
      const clubs = addCounts(b?.clubs, a?.clubs);
      const pos = topKey(addCounts(b?.pos, a?.pos)) || (a && !b ? 'P' : null);
      men.set(name, { name, team: topKey(clubs) || b?.team || a?.team || null, pos: pos || '—', num: sweaterNumber(sport, name), g: (b?.g || 0) + (a?.g || 0) });
    }
    // A club's captain is the man who has turned out for it most.
    const captains = new Set();
    for (const team of lg.teams) {
      const best = [...men.values()].filter(m => m.team === team && m.g > 0)
        .sort((x, y) => y.g - x.g || x.name.localeCompare(y.name))[0];
      if (best) { captains.add(best.name); specials.push({ name: best.name, edition: 'captain' }); }
    }
    const rising = [...(st?.batters || []).slice(0, 3), ...(st?.strikeouts || []).slice(0, 1)].map(r => r.name);
    for (const name of new Set(rising)) if (men.has(name) && !captains.has(name)) specials.push({ name, edition: 'star' });
  }
  const set = [...men.values()].sort((a, b) =>
    (lg.teams.indexOf(a.team) + 1 || 99) - (lg.teams.indexOf(b.team) + 1 || 99)
    || (POS_ORDER[a.pos] ?? 9) - (POS_ORDER[b.pos] ?? 9) || a.name.localeCompare(b.name));
  set.forEach((m, i) => { m.serial = i + 1; });
  return {
    sport, teams: lg.teams, clubs: lg.clubs || {}, men, set, specials,
    seasonNo: season?.seasonNo || null, date, rows: Array.isArray(st?.rows) ? st.rows : [], extras: st || {},
  };
}

// ── the back: his season, frozen ───────────────────────────────────────────────
const avg3 = (n) => (n >= 1 ? n.toFixed(3) : n.toFixed(3).replace(/^0/, ''));
const WORDS = ['no', 'once', 'twice', 'three times', 'four times', 'five times', 'six times'];
const times = (n) => WORDS[n] || `${n} times`;

export function seasonLineOf(L, man) {
  const x = L.extras || {};
  if (L.sport === 'hockey') {
    const toll = x.toll?.[man.name] || { hurt: 0, died: 0 };
    const vat = (x.career?.[man.name]?.died || 0) + (toll.died || 0);
    const notes = [];
    if (toll.hurt) notes.push(`Carried off ${times(toll.hurt)} this season.`);
    if (toll.died) notes.push(`Died ${times(toll.died)} this season.`);
    if (vat > (toll.died || 0)) notes.push(`${vat} trips to the vat, all told.`);
    if (man.pos === 'G') {
      const g = x.goalies?.[man.name] || { gp: 0, w: 0, sa: 0, ga: 0 };
      return { stats: [['GP', g.gp], ['W', g.w], ['SA', g.sa], ['GA', g.ga], ['SV%', g.sa ? avg3((g.sa - g.ga) / g.sa) : '—']], notes };
    }
    const s = x.players?.[man.name] || { gp: 0, g: 0, a: 0, sog: 0 };
    return { stats: [['GP', s.gp], ['G', s.g], ['A', s.a], ['PTS', s.g + s.a], ['SOG', s.sog]], notes };
  }
  const led = x.ledger || {};
  if (man.pos === 'P') {
    const a = led.arms?.get?.(man.name) || { g: 0, w: 0, l: 0, outs: 0, er: 0, k: 0 };
    return { stats: [['G', a.g || 0], ['W', a.w], ['L', a.l], ['IP', `${Math.floor(a.outs / 3)}.${a.outs % 3}`], ['K', a.k], ['ERA', a.outs ? ((a.er * 27) / a.outs).toFixed(2) : '—']], notes: [] };
  }
  const b = led.bats?.get?.(man.name) || { g: 0, ab: 0, hits: 0, hr: 0, rbi: 0, sb: 0 };
  return { stats: [['G', b.g || 0], ['AB', b.ab], ['H', b.hits], ['HR', b.hr], ['RBI', b.rbi], ['SB', b.sb], ['AVG', b.ab ? avg3(b.hits / b.ab) : '—']], notes: [] };
}

function clubRecord(L, team) {
  const r = L.rows.find(x => x.team === team);
  if (!r) return '';
  return L.sport === 'hockey'
    ? `${r.wins}-${r.losses}-${r.otl || 0}, ${r.points || 0} pts`
    : `${r.wins}-${r.losses}`;
}

// One card, as it is written onto the sleeve and later into the binder.
export function snapshotCard(L, man, edition = 'base', art = 'portrait') {
  const { stats, notes } = seasonLineOf(L, man);
  const card = {
    league: L.sport, name: man.name, team: man.team, pos: man.pos, num: man.num,
    edition, art, season: L.seasonNo, asOf: L.date, stats, notes,
    record: man.team ? clubRecord(L, man.team) : '',
    serial: man.serial, setSize: L.set.length,
  };
  if (art === 'action') card.pose = poseOf(card);
  return card;
}

// ── the sleeve ─────────────────────────────────────────────────────────────────
// Four base cards, then the hit: a special edition about two sleeves in five, otherwise a
// fifth base card. No man twice in one sleeve. `rand` is the coil's seeded stream.
export function rollSportsSleeve(L, rand = Math.random) {
  const pool = [...L.set];
  const out = [];
  const takeBase = () => {
    if (!pool.length) return null;
    const i = Math.floor(rand() * pool.length);
    return pool.splice(i, 1)[0];
  };
  const art = () => (rand() < ACTION_CHANCE ? 'action' : 'portrait');
  for (let k = 0; k < SPORTS_PACK_SIZE - 1; k++) { const m = takeBase(); if (m) out.push(snapshotCard(L, m, 'base', art())); }
  const specials = L.specials.filter(s => L.men.has(s.name));
  let hit = null;
  if (specials.length && rand() < SPECIAL_CHANCE) {
    const total = specials.reduce((n, s) => n + EDITIONS[s.edition].weight, 0);
    let r = rand() * total;
    for (const s of specials) { r -= EDITIONS[s.edition].weight; if (r <= 0) { hit = s; break; } }
    hit ||= specials[specials.length - 1];
  }
  if (hit) out.push(snapshotCard(L, L.men.get(hit.name), hit.edition, art()));
  else { const m = takeBase(); if (m) out.push(snapshotCard(L, m, 'base', art())); }
  return out;
}

// ── the front: a photograph ────────────────────────────────────────────────────
// No photographs exist, so the card draws one: head and shoulders in his club's kit, his
// number on his chest, a cap or a helmet, and a face built off his name so he looks the
// same on every copy. A goalie is in his mask.
const SKIN = ['#f1d3bd', '#e4b998', '#d29f7c', '#b97f58', '#9a6443', '#7a4a2f', '#5c3824'];
const HAIR = ['#1b1512', '#3a2a1e', '#6b4a2b', '#a87a46', '#c9b07a', '#8a8580', '#5a1f12'];

function kitOf(sport, club) {
  const k = club?.kit?.home || {};
  const col = club?.colours || ['#555b66', '#22252b', '#e9e6df'];
  if (sport === 'hockey') {
    return { jersey: k.jersey || col[0], trim: k.trim || col[1], number: k.number || col[2] || '#fff',
      edge: k.numberEdge || col[1], head: k.helmet || col[1], bill: null };
  }
  const n = Array.isArray(k.number) ? k.number : [k.number || col[1], col[0]];
  return { jersey: k.base || col[2] || '#eee', trim: k.trim || col[0], number: n[0] || col[1], edge: n[1] || col[0],
    head: k.cap || col[1], bill: k.bill || k.cap || col[1], wordmark: k.wordmark || '' };
}

export function portraitSvg(card, club) {
  const h = fnv(`face:${card.name}`);
  const pick = (arr, salt) => arr[(fnv(`${salt}:${card.name}`) >>> 0) % arr.length];
  const skin = pick(SKIN, 'skin'), hair = pick(HAIR, 'hair');
  const kit = kitOf(card.league, club);
  const hockey = card.league === 'hockey';
  const goalie = hockey && card.pos === 'G';
  const wide = 13 + (h % 5);                       // the jaw
  const beard = (h >> 4) % 4 === 0, stache = (h >> 6) % 5 === 0;
  const scar = hockey && (h >> 8) % 3 === 0;
  const mouth = ['M45 72 Q50 74 55 72', 'M45 73 L55 72', 'M45 72 Q50 70 56 73', 'M44 73 Q50 75 55 71'][(h >> 10) % 4];
  const gap = hockey && (h >> 12) % 3 === 0;
  const bg = hockey
    // under the rink lights: a pale crowd, the glass, the boards in his club's trim
    ? `<rect width="100" height="120" fill="#5d6d7c"/><rect width="100" height="46" fill="#7e8fa0"/>
       <circle cx="20" cy="14" r="10" fill="#fff" opacity=".22"/><circle cx="80" cy="10" r="13" fill="#fff" opacity=".18"/>
       <rect y="70" width="100" height="50" fill="#dbe9f2" opacity=".55"/><rect y="84" width="100" height="6" fill="${esc(kit.trim)}" opacity=".85"/>`
    : `<rect width="100" height="120" fill="#7fb1d8"/><rect y="0" width="100" height="40" fill="#a9cbe6"/>
       <path d="M0 64 L100 58 L100 86 L0 86 Z" fill="#3f4a3a" opacity=".55"/><rect y="86" width="100" height="34" fill="#4c8a3a"/>`;
  const num = esc(String(card.num));
  const body = `<path d="M6 120 C8 96 26 86 50 86 C74 86 92 96 94 120 Z" fill="${esc(kit.jersey)}"/>
    <path d="M40 87 L50 98 L60 87" fill="none" stroke="${esc(kit.trim)}" stroke-width="3.2"/>
    <path d="M14 104 C18 100 22 98 26 97 M86 104 C82 100 78 98 74 97" stroke="${esc(kit.trim)}" stroke-width="3" fill="none"/>
    <text x="50" y="116" text-anchor="middle" font-family="Impact,Haettenschweiler,'Arial Narrow Bold',sans-serif" font-size="17" fill="${esc(kit.number)}" stroke="${esc(kit.edge)}" stroke-width=".8">${num}</text>`;
  const neck = `<rect x="43" y="76" width="14" height="13" rx="3" fill="${esc(skin)}"/>`;
  const head = `<ellipse cx="34.5" cy="60" rx="2.6" ry="4" fill="${esc(skin)}"/><ellipse cx="65.5" cy="60" rx="2.6" ry="4" fill="${esc(skin)}"/>
    <path d="M${50 - wide} 54 Q${50 - wide} ${78 + (h % 3)} 50 ${80 + (h % 3)} Q${50 + wide} ${78 + (h % 3)} ${50 + wide} 54 Q${50 + wide} 38 50 38 Q${50 - wide} 38 ${50 - wide} 54 Z" fill="${esc(skin)}"/>`;
  const face = `<path d="M41 55 L47 54 M53 54 L59 55" stroke="${esc(hair)}" stroke-width="1.6"/>
    <ellipse cx="44" cy="59" rx="1.6" ry="1.2" fill="#1a1412"/><ellipse cx="56" cy="59" rx="1.6" ry="1.2" fill="#1a1412"/>
    <path d="M50 60 L48.5 67 L51 67.5" stroke="#000" stroke-opacity=".35" stroke-width="1" fill="none"/>
    <path d="${mouth}" stroke="#4a2420" stroke-width="1.4" fill="none"/>
    ${gap ? '<rect x="49" y="71.6" width="2" height="1.6" fill="#1a1412"/>' : ''}
    ${beard ? `<path d="M${51 - wide} 64 Q${50 - wide + 2} 82 50 83 Q${50 + wide - 2} 82 ${49 + wide} 64 Q50 78 ${51 - wide} 64 Z" fill="${esc(hair)}" opacity=".85"/>` : ''}
    ${stache && !beard ? `<path d="M44 70 Q50 67 56 70 Q50 69 44 70 Z" fill="${esc(hair)}"/>` : ''}
    ${scar ? '<path d="M58 50 L62 60" stroke="#8c3a32" stroke-width="1"/>' : ''}`;
  let hat;
  if (goalie) {
    // the mask: a shell over the face, the club's trim across it, a cage at the front
    hat = `<path d="M33 54 Q33 34 50 33 Q67 34 67 54 Q67 74 50 83 Q33 74 33 54 Z" fill="${esc(kit.head)}"/>
      <path d="M36 46 Q50 40 64 46" stroke="${esc(kit.jersey)}" stroke-width="3" fill="none"/>
      <path d="M40 54 L60 54 L58 78 Q50 81 42 78 Z" fill="#0b0b0d" opacity=".75"/>
      <path d="M40 60 L60 60 M41 66 L59 66 M42 72 L58 72 M45 54 L46 79 M50 54 L50 81 M55 54 L54 79" stroke="#c9ccd2" stroke-width="1"/>`;
  } else if (hockey) {
    hat = `<path d="M${49 - wide} 56 Q${48 - wide} 34 50 33 Q${52 + wide} 34 ${51 + wide} 56 L${50 + wide} 50 Q50 44 ${50 - wide} 50 Z" fill="${esc(kit.head)}"/>
      <path d="M${49 - wide} 50 L${51 + wide} 50" stroke="#000" stroke-opacity=".35" stroke-width="1.2"/>
      ${(h >> 14) % 2 ? `<path d="M${51 - wide} 51 L${49 + wide} 51 L${48 + wide} 57 L${52 - wide} 57 Z" fill="#cfe8ff" opacity=".28"/>` : ''}
      <path d="M${50 - wide} 56 Q${50 - wide + 2} 70 46 76 M${50 + wide} 56 Q${50 + wide - 2} 70 54 76" stroke="#222" stroke-width="1" fill="none"/>`;
  } else {
    hat = `<path d="M${49 - wide} 50 Q${48 - wide} 33 50 32 Q${52 + wide} 33 ${51 + wide} 50 Z" fill="${esc(kit.head)}"/>
      <path d="M${51 - wide} 50 Q50 46 ${49 + wide} 50 Q${56 + wide} 52 ${60 + wide} 54 Q50 56 ${50 - wide} 52 Z" fill="${esc(kit.bill)}"/>
      <path d="M${50 - wide} 50 Q50 47 ${50 + wide} 50" stroke="#000" stroke-opacity=".3" stroke-width="1" fill="none"/>
      <circle cx="50" cy="32.6" r="1.3" fill="${esc(kit.trim)}"/>
      <path d="M${51 - wide} 52 Q${49 - wide} 56 ${50 - wide} 58" stroke="${esc(hair)}" stroke-width="2" fill="none"/>`;
  }
  return `<svg class="spc-portrait" viewBox="0 0 100 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${bg}${body}${neck}${head}${goalie ? '' : face}${hat}</svg>`;
}

// ── the faces ──────────────────────────────────────────────────────────────────
// Both sides go out as one block, and the client flips it (client/game/js/panels/sportcard.js).
// `crest` is the club's shield, already drawn (club-crest.js's crestSvg, one source with the
// broadcasts); the caller passes it so this file stays free of client imports.
export function renderSportsCard(card, { club = null, crest = '', miniCrest = '' } = {}) {
  const L = SPORTS[card.league] || SPORTS.baseball;
  const ed = EDITIONS[card.edition] || EDITIONS.base;
  const col = club?.colours || ['#555b66', '#22252b', '#e9e6df'];
  const team = card.team || 'Unsigned';
  const statHead = card.stats.map(([k]) => `<th>${esc(k)}</th>`).join('');
  const statRow = card.stats.map(([, v]) => `<td>${esc(String(v))}</td>`).join('');
  const ribbon = ed.label ? `<div class="spc-ribbon spc-r-${esc(card.edition)}">${esc(ed.label.toUpperCase())}</div>` : '';
  const season = card.season ? `Season ${card.season}` : 'Preseason';
  return `<div class="spc spc-${esc(card.league)} spc-ed-${esc(card.edition)}${card.art === 'action' ? ' spc-art-action' : ''}" style="--k1:${esc(col[0])};--k2:${esc(col[1] || col[0])};--k3:${esc(col[2] || '#eee')}">
  <div class="spc-side spc-front">
    <div class="spc-photo">${card.art === 'action' ? actionSvg(card, club) : portraitSvg(card, club)}</div>
    ${card.art === 'action' ? `<div class="spc-act">IN ACTION</div>` : ''}
    <div class="spc-num">${esc(String(card.num))}</div>
    <div class="spc-crest">${crest}</div>
    ${ribbon}
    <div class="spc-plate">
      <div class="spc-name">${esc(card.name)}</div>
      <div class="spc-pos"><b>${esc(card.pos)}</b> · ${esc(team)}</div>
    </div>
    <div class="spc-brand">${esc(L.brand)} · ${esc(season.toUpperCase())}</div>
  </div>
  <div class="spc-side spc-back">
    <div class="spc-bhead">
      <div class="spc-bnum">${esc(String(card.num))}</div>
      <div class="spc-bwho"><div class="spc-bname">${esc(card.name)}</div><div class="spc-bpos">${esc(card.pos)} · ${esc(team)}</div></div>
      <div class="spc-bcrest">${miniCrest}</div>
    </div>
    <div class="spc-asof">${esc(season)}${card.asOf ? ` · as of ${esc(dateLabel(card.asOf))}` : ''}</div>
    <table class="spc-stats"><thead><tr>${statHead}</tr></thead><tbody><tr>${statRow}</tr></tbody></table>
    ${card.record ? `<div class="spc-rec">${esc(team)}: ${esc(card.record)}</div>` : ''}
    ${(card.notes || []).map(n => `<div class="spc-note">${esc(n)}</div>`).join('')}
    ${ed.label ? `<div class="spc-edline">${esc(ed.label)} edition</div>` : ''}
    ${card.art === 'action' ? `<div class="spc-edline spc-actline">Action shot: ${esc(ACTION_LABEL[card.pose] || 'in play')}</div>` : ''}
    <div class="spc-foot"><span>${esc(L.set)}</span><span>№ ${String(card.serial || 0).padStart(2, '0')}/${card.setSize || 0}</span></div>
  </div>
  <button type="button" class="spc-flip" data-spc-flip title="Turn the card over">⟲ TURN OVER</button>
</div>`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dateLabel(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''} ${m[1]}` : String(d || '');
}

export const _test = { fnv, fnvPoints, kitOf, clubRecord, SPECIAL_CHANCE };
