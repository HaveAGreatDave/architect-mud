// Amusing world-aware news generator. Produces two kinds of story:
//
//   • LIVE  — event-sourced. Real things that happened (a death, a turf flip, a
//     DEADBALL champion crowned, a weather hero event) get spun through tabloid
//     templates. Grounded in real handles/zones/orgs, so it's specific and funny.
//     Kept in a small in-memory ring buffer (news is ephemeral — losing it on a
//     restart is fine, so no table).
//
//   • TABLOID — synthetic filler. When the world is quiet, Mad-Libs headlines are
//     built from real world nouns (zone/NPC/org/drug names pulled from the DB) so
//     even the fake stories name real places. Seeded off the in-game DATE, so
//     everyone sees the same "edition" today and it's stable across a restart.
//     Fabricated stories NEVER name a player — only NPCs/zones/orgs — so nobody
//     reads a made-up murder about themselves.
//
// Deliberately decoupled from the Tablet (no registry import): the broadcast
// plugin's TV news channel could consume getStories()/recordEvent() too, so this
// wants to graduate to a shared module rather than live behind one app.
import { query } from '../../server/models/db.js';
import { on } from '../../server/engine/events.js';
import { registerAction } from '../../server/engine/actions.js';
import { getGameDateTime } from '../../server/engine/environment.js';
import { getOrg, getZone } from '../../server/engine/world.js';

// ── Seeded RNG (date-stable "edition") ───────────────────────────────────────
// A tiny xmur3+mulberry32 pair so today's tabloid page is deterministic: same
// in-game date → same headlines for every player, and re-derivable after a
// restart. (Runtime Math.random would give per-request churn — not what a shared
// daily edition wants.)
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededRng(seedStr) { return mulberry32(xmur3(seedStr)()); }

// ── World noun banks (cached, DB-sourced with on-theme fallbacks) ────────────
let _banks = null;
let _banksAt = 0;
const BANK_TTL_MS = 10 * 60 * 1000; // refresh every 10 min — content rarely changes

const FALLBACK = {
  zone:   ['the Slagworks', 'Coldwater Bay', 'the Yards', 'Franchise Strip', 'the Undermarket', 'Redline'],
  person: ['a Franchise middle-manager', 'an off-duty Precinct 9 guard', 'a Breakers runner', 'a Glitch cultist', 'a nervous vendor'],
  org:    ['the Franchise', 'the Breakers', 'the Glitch', 'Halcyon Heights', 'Precinct 9'],
  drug:   ['Chrome', 'Slag', 'Bliss', 'Static', 'Ratshine'],
};

async function names(sql, fallback) {
  try {
    const { rows } = await query(sql);
    const list = rows.map(r => r.name).filter(Boolean);
    return list.length ? list : fallback;
  } catch { return fallback; }
}

async function loadBanks() {
  if (_banks && Date.now() - _banksAt < BANK_TTL_MS) return _banks;
  const [zone, person, org, drug] = await Promise.all([
    // District/street tiles only — outdoor zones + named streets (flags.artery),
    // never apartment units / hallways / utility rooms (flags.is_interior). A
    // name-guard mops up the few residual "Unit 101"s that lack the flag, so
    // headlines name a place ("the Slagworks") not a stairwell.
    names(`SELECT name FROM zones
             WHERE (COALESCE(flags->>'is_interior','') <> 'true' OR COALESCE(flags->>'artery','') = 'true')
               AND name !~* '^unit\\s'
             ORDER BY name LIMIT 300`, FALLBACK.zone),
    names(`SELECT name FROM npcs WHERE name IS NOT NULL LIMIT 200`, FALLBACK.person),
    names(`SELECT name FROM orgs WHERE name IS NOT NULL LIMIT 100`, FALLBACK.org),
    names(`SELECT name FROM drugs WHERE name IS NOT NULL LIMIT 100`, FALLBACK.drug),
  ]);
  // Static flavour banks — no DB, pure tone.
  const object = ['toaster', 'municipal drone', 'severed antenna', 'vending machine', 'prosthetic leg', 'shopping cart',
    'coolant barrel', 'ration brick', 'traffic bollard', 'defunct ATM', 'mannequin', 'space heater'];
  const profession = ['welder', 'data-broker', 'gutter-medic', 'ration clerk', 'drone wrangler', 'debt collector',
    'street preacher', 'scrap diver', 'noodle vendor', 'off-books electrician'];
  const verb = ['arguing with', 'proposing marriage to', 'attempting to eat', 'worshipping', 'selling counterfeit',
    'fistfighting', 'unionising', 'live-streaming', 'performing surgery on'];
  const outlet = ['The Coldwater Crier', 'Static Weekly', 'The Grid Gazette', 'Slag & Ash Report', 'The Daily Rust'];
  _banks = { zone, person, org, drug, object, profession, verb, outlet };
  _banksAt = Date.now();
  return _banks;
}

// ── Synthetic (tabloid) templates ────────────────────────────────────────────
// {slot} tokens are filled from the banks above with the seeded picker.
const TABLOID = [
  '{person} Spotted {verb} a {object} in {zone}; Witnesses "Deeply Unsettled"',
  'LOCAL {profession} Marries Own {object} — {object} Files for Divorce Within the Hour',
  '{org} Denies All Knowledge of the {number} Missing {object}s',
  'BREAKING: {zone} Sealed Off After "Regrettable {object} Incident"',
  'Study Finds {drug} Now Cheaper Than Water in {zone}; Officials "Thrilled"',
  '{profession} Claims {drug} Cured Their {object}; Doctors Disagree Violently',
  'Poll: {number}% of {zone} Residents Would Trade a Kidney for a Working {object}',
  '{org} and {org2} Feud Escalates to Passive-Aggressive Graffiti',
  '{person} Elected Mayor of {zone} in Election Nobody Remembers Holding',
  'The {object} Shortage Reaches {zone}; Black-Market {profession}s Rejoice',
  'Weather Prophet in {zone} Predicts "More Weather"; Crowd Disperses',
  '{person} Sues {org} Over a {object}, a Grudge, and "The Principle of It"',
  'City Renames {zone} to "{zone}, But Worse" Citing Honesty',
  '{profession} Sets Personal Record: {number} {object}s Stolen Before Noon',
];

// Fill {slot} tokens. Repeated tokens resolve to the SAME value within one
// headline (so "Marries Own {object} — {object} Files for Divorce" names one
// object) — that's why templates use a numbered variant ({org2}, {zone2}) when
// they deliberately want two DIFFERENT picks. A per-render memo keyed on the
// exact token gives both behaviours for free.
function fill(tpl, pick, rng) {
  const memo = new Map();          // token → value (same token = same value)
  const used = new Map();          // bank → Set of values already used this headline
  const bankOf = (token) => token.replace(/\d+$/, ''); // {org2} → org
  const distinctPick = (bank) => {
    const seen = used.get(bank) || new Set();
    let val = pick(bank);
    for (let i = 0; i < 6 && seen.has(val); i++) val = pick(bank); // dodge a same-bank collision (feuds etc.)
    seen.add(val); used.set(bank, seen);
    return val;
  };
  return tpl.replace(/\{(\w+)\}/g, (_, token) => {
    if (memo.has(token)) return memo.get(token);
    const val = token === 'number' ? String(3 + Math.floor(rng() * 96)) : distinctPick(bankOf(token));
    memo.set(token, val);
    return val;
  });
}

async function tabloidStories(count) {
  const banks = await loadBanks();
  const { date } = getGameDateTime();
  const rng = seededRng(`news:${date || 'day0'}`);
  const pick = (bank) => {
    const arr = banks[bank] || [];
    return arr.length ? arr[Math.floor(rng() * arr.length)] : '???';
  };
  const outlet = () => banks.outlet[Math.floor(rng() * banks.outlet.length)];

  // Draw `count` distinct templates in the seeded order.
  const order = [...TABLOID.keys()].sort(() => rng() - 0.5);
  const out = [];
  for (const idx of order) {
    if (out.length >= count) break;
    out.push({ headline: fill(TABLOID[idx], pick, rng), byline: outlet(), tag: 'tabloid' });
  }
  return out;
}

// ── Live (event-sourced) stories ──────────────────────────────────────────────
const RING = [];
const RING_MAX = 24;

const normHeadline = (h) => String(h || '').trim().toLowerCase();

function record(headline) {
  if (!headline) return;
  // Drop any existing copy first, so a repeated event (another death, another
  // weather front) refreshes to the top of the feed instead of stacking a
  // duplicate — the ring never holds the same headline twice.
  const k = normHeadline(headline);
  for (let i = RING.length - 1; i >= 0; i--) {
    if (normHeadline(RING[i].headline) === k) RING.splice(i, 1);
  }
  RING.unshift({ headline, tag: 'live', ts: Date.now() });
  if (RING.length > RING_MAX) RING.length = RING_MAX;
}

// Resolve an org id (e.g. 'faction_franchise') to its display name, or prettify.
function orgName(id) {
  if (!id) return 'persons unknown';
  const o = getOrg(id);
  if (o?.name) return o.name;
  return String(id).replace(/^faction_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function zoneName(id) {
  const z = id ? getZone(id) : null;
  return z?.name || (id ? String(id).replace(/_/g, ' ') : 'an undisclosed location');
}
function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

on('player.death', ({ player }) => {
  if (!player?.handle) return;
  const z = zoneName(player.current_zone);
  record(pickOne([
    `${player.handle} Found Dead in ${z}; Machine Rules It "Statistically Inevitable"`,
    `Coroner in ${z} Lists ${player.handle}'s Cause of Death as "Skill Issue"`,
    `${z} Mourns ${player.handle} for Approximately ${2 + Math.floor(Math.random() * 8)} Seconds`,
  ]));
});

on('drugwar.flip', ({ zoneId, fromOrg, toOrg }) => {
  const z = zoneName(zoneId);
  record(pickOne([
    `${orgName(toOrg)} Seize ${z} From ${orgName(fromOrg)} in Broad Daylight`,
    `Turf War Update: ${z} Now Flies ${orgName(toOrg)} Colours; ${orgName(fromOrg)} "Fine, Actually"`,
  ]));
});

on('sports.champion', ({ champion, runnerUp, champScore, runScore }) => {
  if (!champion) return;
  record(`DEADBALL: ${champion} Crush ${runnerUp} ${champScore}-${runScore} to Take the Crown`);
});

on('sports.worldseries', ({ teams }) => {
  if (!Array.isArray(teams) || teams.length < 2) return;
  record(`DEADBALL WORLD SERIES SET: ${teams[0]} vs ${teams[1]} — City Grinds to a Halt`);
});

on('weather.event', ({ type, phase }) => {
  if (!type || phase === 'passing') return;
  const t = String(type).replace(/_/g, ' ');
  record(pickOne([
    `${t} Bearing Down on the City; Authorities Recommend "Praying, Mostly"`,
    `Meteorologists Confirm the ${t} Is "Someone Else's Problem Now"`,
  ]));
});

// ── Public seam ───────────────────────────────────────────────────────────────
// Up to `total` stories: the freshest live ones first, padded with today's
// tabloid edition. Returns [{ headline, byline?, tag }].
export async function getStories(total = 6) {
  const seen = new Set();
  const out = [];
  // Freshest live stories first (capped so tabloid still fills the page), each
  // added only once.
  for (const s of RING) {
    if (out.length >= Math.min(4, total)) break;
    const k = normHeadline(s.headline);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ headline: s.headline, tag: 'live' });
  }
  // Pad with today's tabloid edition, skipping any headline already shown (a live
  // story can coincide with a filler one). Over-draw all templates so removing a
  // collision never leaves the page short of `total`.
  if (out.length < total) {
    const filler = await tabloidStories(TABLOID.length);
    for (const s of filler) {
      if (out.length >= total) break;
      const k = normHeadline(s.headline);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

// Read seam for the engine (motd.js) and any other consumer: the same live-first,
// tabloid-padded feed, exposed through the Action registry so nothing outside the
// tablet plugin has to import this file directly.
registerAction({
  type: 'news.getStories',
  handler: async ({ params }) => ({ type: 'news', stories: await getStories(params?.total || 6) }),
});

export const _test = { tabloidStories, record, getStories, RING };
