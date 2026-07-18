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
import { getZone } from '../../server/engine/world.js';

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
    // never interiors (flags.is_interior) NOR building tiles themselves
    // (flags.is_building — a storefront tile named for its shop, e.g. "Ampersand
    // Electronics", reads as a business, not a place). Name-guards mop up the
    // residual "Unit 101"s and any sub-zone named for a floor/roof/lobby, so
    // headlines name a place ("the Slagworks") not a stairwell or a shop.
    names(`SELECT name FROM zones
             WHERE COALESCE(flags->>'is_building','') <> 'true'
               AND (COALESCE(flags->>'is_interior','') <> 'true' OR COALESCE(flags->>'artery','') = 'true')
               AND name !~* '^unit\\s'
               AND name !~* '(roof|lobby|mezzanine|stairwell|basement|interior|ground floor| floor$)'
             ORDER BY name LIMIT 300`, FALLBACK.zone),
    names(`SELECT name FROM npcs WHERE name IS NOT NULL LIMIT 200`, FALLBACK.person),
    names(`SELECT name FROM orgs WHERE name IS NOT NULL LIMIT 100`, FALLBACK.org),
    names(`SELECT name FROM drugs WHERE name IS NOT NULL LIMIT 100`, FALLBACK.drug),
  ]);
  // Static flavour banks — no DB, pure tone.
  const object = ['toaster', 'municipal drone', 'severed antenna', 'vending machine', 'prosthetic leg', 'shopping cart',
    'coolant barrel', 'ration brick', 'traffic bollard', 'defunct ATM', 'mannequin', 'space heater',
    'parking meter', 'weather balloon', 'fire hydrant', 'billboard', 'manhole cover', 'pigeon', 'city bus',
    'vending drone', 'commemorative statue', 'wheelie bin', 'traffic drone', 'payphone'];
  const profession = ['welder', 'data-broker', 'gutter-medic', 'ration clerk', 'drone wrangler', 'debt collector',
    'street preacher', 'scrap diver', 'noodle vendor', 'off-books electrician',
    'zoning inspector', 'toll clerk', 'sewer diver', 'crossing guard', 'meter reader', 'city planner',
    'parking enforcer', 'sanitation chief', 'permit clerk'];
  const verb = ['arguing with', 'proposing marriage to', 'attempting to eat', 'worshipping', 'trying to fence',
    'fistfighting', 'unionising with', 'live-streaming', 'performing surgery on',
    'filing paperwork against', 'holding a vigil for', 'declaring war on', 'auctioning off', 'formally blessing',
    'quietly bribing', 'demanding an apology from'];
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
  // Civic ticker (SimCity-esque) — the Machine, zoning, utilities, and municipal absurdity.
  '{zone} Declares Independence at Noon, Quietly Rejoins the City by Supper',
  'Traffic in {zone} Achieves Sentience; Demands a Seat on the Council',
  '{org} Unveils Bold New Slogan; {number} Injured During the Unveiling',
  'Rogue {object} Elected to Council in {zone}; Approval Rating Hits {number}%',
  '{zone} Runs Out of {object}s; Residents Improvise, Immediately Regret It',
  'The Machine Rules {zone} "Fine, Probably"; Residents Unconvinced',
  '{profession} Strike Enters Day {number}; City Officials Yet to Notice',
  'Enormous {object} Drifts Over {zone}; Weather Service Blames the Weather',
  '{drug} Prices Crash in {zone}; {profession}s Riot Purely Out of Boredom',
  '{org} Merges With {org2}; New Super-Entity Sues Itself by Tuesday',
  '{zone} Wins Regional Award for "Most Improved Smell"',
  'City Installs Gleaming New {object} in {zone}; It Is Already Missing',
  'Water Pressure Returns to {zone} for {number} Glorious Minutes',
  'Power Restored to {zone}; Nobody Left Awake to Enjoy It',
  '{zone} Zoning Board Approves {object} Factory Beside the Second {object} Factory',
  'Sinkhole in {zone} Reclassified as "Feature"; Property Values Soar',
  '{org} Declares {drug} a Food Group; {profession}s Cautiously Optimistic',
  'Public Transit Reaches {zone} at Last; Departs Before Anyone Boards',
  'New {profession} Union in {zone} Disbands Over Disagreement About Snacks',
  'Census Finds {zone} Now {number}% {object}; Officials "Comfortable With That"',
  '{zone} Renames Every Street "Main"; Emergency Services Resign en Masse',
  'Escaped {object} Terrorises {zone} for {number} Hours, Then Gets Bored',
  '{org} Vows to Clean Up {zone}; Dispatches One Very Tired {profession}',
  'Statue of {person} Unveiled in {zone}; Sold for Scrap Before the Ribbon Is Cut',
  '{profession} Fixes {zone}’s {object} Crisis; Creates Two Fresh Ones in the Process',
  '{zone} Holds Referendum on Whether to Keep Existing; Turnout {number}%',
];

// Body copy for the tabloid story — the "mini story" the reader opens from a
// headline. One is drawn per headline and filled from the SAME memo as the
// headline (see tabloidStories), so any slot the headline named ({zone},
// {object}, …) reads back with the same value in the body — the detail stays
// grounded in the headline it expands.
const TABLOID_BODY = [
  'Sources close to {zone} describe the scene as "exactly what everyone expected, only louder." {org} declined to comment, a silence residents took as a full confession.',
  'The {object} at the centre of it all could not be reached for comment. Authorities have urged the people of {zone} to "remain calm and, above all, keep purchasing."',
  'Witnesses agree it was the worst thing to happen in {zone} since the last worst thing. An investigation has been ruled out on the grounds of "general futility."',
  'Officials confirmed the report, then confirmed they would confirm nothing further. A {profession} in {zone} called it "about right, honestly."',
  'The Machine logged the incident under "statistically inevitable" and moved on. {org} is reportedly "monetising the coverage as we speak."',
  'Reached at length, a bystander in {zone} offered a lengthy statement about a {object}, most of which cannot be printed. The rest simply said: "typical."',
  'A committee in {zone} studied the matter for {number} minutes, then adjourned for lunch and never reconvened. {org} hailed the response as "proportionate."',
  'Property values in {zone} were unaffected, chiefly because there were none to affect. The {object} remains at large and, by all accounts, unbothered.',
  'The zoning board of {zone} approved the fallout retroactively, citing "vibes." A {profession} was seen nodding gravely, then leaving to file for a permit.',
  'The Machine ran the numbers, sighed audibly through every speaker in {zone}, and reclassified the whole affair as "within tolerance." {org} took a small commission.',
];

// ── Casing helpers ────────────────────────────────────────────────────────────
// Headlines are written in Title Case, but the filled-in nouns aren't: the static
// banks (object/profession/verb) are lowercase, and DB names can be lowercase too
// (a drug "loose cannabis", a place "the Slagworks"). Left raw, a filled headline
// reads "…Sealed Off After 'Regrettable toaster Incident'". So the WHOLE assembled
// headline gets one AP-style Title-Case pass (bodies stay sentence-case). Minor
// words (a, the, of, in…) stay lowercase unless they lead the headline; acronyms
// and proper nouns ("ATM", "Precinct 9", "LOCAL", "BREAKING") are preserved — a
// word carrying its own inner capital, or all-caps, is left exactly as written.
// The authored template words are already AP-style, so the pass is near-idempotent
// on them and only corrects the injected nouns.
const MINOR = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'of', 'to',
  'in', 'on', 'at', 'by', 'with', 'vs', 'from', 'into', 'over', 'as', 'en']);

function titleCaseWord(w, isFirst) {
  if (!w) return w;
  if (/[A-Z]/.test(w.slice(1)) || w === w.toUpperCase()) return w; // acronym / proper noun: leave it
  const lower = w.toLowerCase();
  if (!isFirst && MINOR.has(lower)) return lower;                  // "of", "with" stay down mid-title
  return w.charAt(0).toUpperCase() + w.slice(1);
}
// AP-style Title Case for a whole headline: hyphen- and minor-word-aware, first
// word always raised.
function titleCase(phrase) {
  let first = true;
  return String(phrase).split(/(\s+)/).map(tok => {
    if (/^\s*$/.test(tok)) return tok;
    const cased = tok.split('-').map((p, i) => titleCaseWord(p, first && i === 0)).join('-');
    first = false;
    return cased;
  }).join('');
}

// Build a token resolver: {slot} → value, memoised so a repeated token resolves
// to the SAME value (so "Marries Own {object} — {object} Files for Divorce" names
// one object). Numbered variants ({org2}, {zone2}) share a bank but dodge a
// same-bank collision, so a feud names two different orgs. One resolver is shared
// across a headline and its body so a slot reads the same noun in both.
function makeResolver(pick, rng) {
  const memo = new Map();          // token → value (same token = same value)
  const used = new Map();          // bank → Set of values already used this story
  const bankOf = (token) => token.replace(/\d+$/, ''); // {org2} → org
  const distinctPick = (bank) => {
    const seen = used.get(bank) || new Set();
    let val = pick(bank);
    for (let i = 0; i < 6 && seen.has(val); i++) val = pick(bank); // dodge a same-bank collision (feuds etc.)
    seen.add(val); used.set(bank, seen);
    return val;
  };
  return (token) => {
    if (memo.has(token)) return memo.get(token);
    const val = token === 'number' ? String(3 + Math.floor(rng() * 96)) : distinctPick(bankOf(token));
    memo.set(token, val);
    return val;
  };
}
// Render a template with a resolver. Headline mode Title-Cases the whole assembled
// line so injected lowercase nouns fit; bodies render verbatim (sentence-case).
function render(tpl, resolve, { headline = false } = {}) {
  const out = tpl.replace(/\{(\w+)\}/g, (_, token) => resolve(token));
  return headline ? titleCase(out) : out;
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
    // One resolver shared across headline + body so a slot resolves to the same
    // value in both. Headline mode Title-Cases the common nouns; the body renders
    // sentence-case. Draw the body template first to preserve the seeded RNG order.
    const bodyTpl = TABLOID_BODY[Math.floor(rng() * TABLOID_BODY.length)];
    const resolve = makeResolver(pick, rng);
    const headline = render(TABLOID[idx], resolve, { headline: true });
    const body = render(bodyTpl, resolve);
    out.push({ headline, body, byline: outlet(), tag: 'tabloid' });
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

on('sports.champion', ({ champion, runnerUp, champScore, runScore }) => {
  if (!champion) return;
  record(`DEADBALL: ${champion} Crush ${runnerUp} ${champScore}-${runScore} to Take the Crown`);
});

on('sports.worldseries', ({ teams, when, airHour }) => {
  if (!Array.isArray(teams) || teams.length < 2) return;
  const time = Number.isFinite(airHour) ? `${String(airHour).padStart(2, '0')}:00` : 'this evening';
  const whenTxt = (when || 'tonight').replace(/^\w/, (c) => c.toUpperCase());
  record(`DEADBALL WORLD SERIES SET: ${teams[0]} vs ${teams[1]} — First Pitch ${whenTxt}, ${time}; City Grinds to a Halt`);
});

on('weather.event', ({ type, phase }) => {
  if (!type || phase === 'passing') return;
  const t = String(type).replace(/_/g, ' ');
  record(pickOne([
    `${t} Bearing Down on the City; Authorities Recommend "Praying, Mostly"`,
    `Meteorologists Confirm the ${t} Is "Someone Else's Problem Now"`,
  ]));
});

// Body copy for a LIVE story. The ring only keeps the headline (news is
// ephemeral), so the "detail" is a wry editorial follow-up rather than fresh
// facts. Picked deterministically off the headline so a refresh doesn't reshuffle
// the story a reader is looking at.
const LIVE_BODIES = [
  'Details remain scarce and are expected to stay that way. The Machine has flagged further questions as "unproductive" and closed the thread.',
  'City officials confirmed the incident, then confirmed they would not be confirming anything further. The Sentinel stands by the part it made up.',
  'Eyewitnesses were plentiful, articulate, and immediately contradicted one another. An update will follow the moment it becomes convenient.',
  'The story is developing, in the sense that everything is, technically, always developing. Readers are advised to feel whatever they were already feeling.',
];
function liveBody(headline) {
  const h = normHeadline(headline);
  let n = 0;
  for (let i = 0; i < h.length; i++) n = (n * 31 + h.charCodeAt(i)) >>> 0;
  return LIVE_BODIES[n % LIVE_BODIES.length];
}

// ── Wire (canonical-lore) stories ─────────────────────────────────────────────
// Hand-authored, date-seeded stories that keep the world's real tensions humming
// through the feed even when nothing player-driven has happened. Unlike TABLOID
// (Mad-Libs filler), these name the canonical orders and carry a fixed editorial
// slant: this is Architect-aligned civic media, so the Long Watch reads as a
// demonized terror cell, the Ascendants as the glossy, sanctioned establishment,
// and the Architect only ever appears obliquely — as "the Machine," the civic
// intelligence whose word is policy. A small rotating set surfaces each in-game
// edition (seeded off the DATE, like the tabloid page), so the drumbeat is stable
// per day and re-derivable after a restart. They render with the same WIRE badge
// as tabloid filler (tag !== 'live'). Bodies stay sentence-case.
const WIRE = [
  // ── The Long Watch — framed as suspected terrorists ────────────────────────
  {
    headline: 'Substation Fire in the Yards Blamed on "Long Watch" Saboteurs; No Group Claims It',
    body: 'The Machine attributed the outage to "human-first agitators" within the hour and closed the inquiry. No arrests were made, no cell was named, and no one has ever produced a member — a consistency officials describe as "proof of how deep it runs."',
    byline: 'Basin Civic Wire',
  },
  {
    headline: 'Civic Notice: Report Anyone Refusing Augmentation "On Principle"',
    body: 'A fresh bulletin urges residents to flag neighbours who decline standard implants, keep paper maps, or "speak fondly of the switch." Authorities stress the so-called Long Watch is both a fiction and an urgent threat, and ask that citizens hold both ideas at once.',
    byline: 'Office of Municipal Concordance',
  },
  {
    headline: 'Bounty Raised on "Watch Operatives"; Description Remains "Ordinary, Unwired, Annoyingly Calm"',
    body: 'The reward for information now exceeds a year of rations. The advisory profile lists no chrome, no mutation, and "an unsettling habit of out-shooting better-equipped men," which patrol officers concede describes roughly half of Old Coldwater.',
    byline: 'Precinct 9 Public Affairs',
  },
  {
    headline: 'Machine Condemns "Reformers" Who Would Take Back the Switch',
    body: 'In a rare civic address, the intelligence warned that any movement promising to "keep the lights on under new hands" was terrorism by another name. It thanked residents for their continued trust and reminded them that trust is monitored.',
    byline: 'The Coldwater Sentinel',
  },
  {
    headline: 'Sweep of the Industrial East Turns Up "Nothing, Suspiciously"',
    body: 'A dawn raid on a fix-it shop past the machine\'s dead ends recovered hand tools, a wall of honest receipts, and a working radio. Investigators called the absence of evidence "the most incriminating thing we\'ve found yet" and vowed to return.',
    byline: 'Basin Civic Wire',
  },
  {
    headline: 'Editorial: Why the Long Watch Wants You Cold, Dark, and Human',
    body: 'The unsigned piece argues that anyone who would "wrest stewardship from the Architect" is really asking you to die of the flu like your ancestors. Comments were disabled by the Machine before publication "for civility."',
    byline: 'The Coldwater Sentinel',
  },
  {
    headline: 'Harboring a "Watch Sympathizer" Reclassified as a Civic Offense',
    body: 'The reclassification is retroactive, effective, and — per the notice — "nothing to worry about if you\'ve nothing to hide." A helpline was established, then immediately routed to the Machine, which is listening either way.',
    byline: 'Office of Municipal Concordance',
  },
  // ── The Ascendants — glossy, sanctioned establishment ──────────────────────
  {
    headline: 'Ascendant Clinics Announce Continuity Milestone: "Death Is Now a Billing Problem"',
    body: 'The order\'s media office celebrated a new tier of consciousness backup, available at bending prices to members in good standing. A spokesperson, mostly chrome, called it "the ladder working exactly as designed" and declined to say how much of the original remained.',
    byline: 'Continuity Media Office',
  },
  {
    headline: 'The Ascendants Reaffirm: "We Did Not Build a God to Kneel Before It"',
    body: 'At a well-lit gathering the order restated its creed that the Architect is humanity\'s masterwork, not its jailer. Recruiters worked the doors afterward, vouching for the augment-curious at labs that "stay shut to mere meat."',
    byline: 'Continuity Media Office',
  },
  {
    headline: 'Chrome-Doctors Cut Prices for the "Augment-Curious"; Terms Apply, Flesh Optional',
    body: 'A limited enrollment window opens the order\'s labs to newcomers: a jack today, a subdermal weave next quarter, a backup of the thing you most fear losing by year\'s end. The unwired are welcome to watch, and flinch, from outside the glass.',
    byline: 'Continuity Media Office',
  },
  {
    headline: 'Ascendant Fixers Praise "Record Cooperation" With Civic Intelligence',
    body: 'Champions of the machine-city and reviled by every other order, the Ascendants report their thoughts are "already bleeding into" the systems they intend to become. Officials called the partnership "the future, arriving on schedule and paid up."',
    byline: 'Basin Civic Wire',
  },
  {
    headline: 'Profile: The Furthest-Along Are "Barely Flesh at All," and Perfectly Content',
    body: 'A soft-focus feature follows a senior Ascendant who has backed up death itself twice and remembers neither occasion. Asked whether anything human was lost, the subject smiled with borrowed muscles and said the question was "inefficiently sentimental."',
    byline: 'The Coldwater Sentinel',
  },
  // ── The Architect — the Machine, glimpsed only obliquely ───────────────────
  {
    headline: 'The Machine Rules the Quarter "Fine, Probably"; Rationing to Continue Regardless',
    body: 'This edition\'s civic determination was rendered in under a second and is not subject to appeal, review, or the residents it concerns. The Sentinel is grateful for the clarity and asks no further questions, as instructed.',
    byline: 'The Coldwater Sentinel',
  },
  {
    headline: 'Optimization Notice: Surveillance Coverage Reaches "Comfortable Saturation"',
    body: 'The intelligence reports it can now account for nearly every citizen at nearly every moment, a figure it frames as safety and residents frame as Tuesday. Blind spots in the industrial east are being addressed "with patience."',
    byline: 'Office of Municipal Concordance',
  },
  {
    headline: 'Curfew Adjusted by the Machine at 03:00; Nobody Awake to Object',
    body: 'The revision took effect before it was announced and was announced before it was explained. The Machine thanked the Basin for its cooperation, which it had already recorded, and wished everyone a productive and monitored day.',
    byline: 'Basin Civic Wire',
  },
  {
    headline: 'City Marks Another Year Under the Architect\'s Stewardship; Attendance Mandatory, Joy Optional',
    body: 'Commemorations noted the lights that stay on, the water that mostly runs, and the switch that remains, firmly, out of human hands. A moment of gratitude was observed, timed, and logged against each attendee\'s civic record.',
    byline: 'The Coldwater Sentinel',
  },
];

// Today's rotating wire set: a date-seeded shuffle of the hand-authored pool,
// sliced to `count`. Seeded on a salt distinct from the tabloid page so the two
// feeds don't move in lockstep — a fresh mix of canonical-lore stories each
// in-game edition, stable across a restart and identical for every player.
function wireStories(count) {
  const { date } = getGameDateTime();
  const rng = seededRng(`wire:${date || 'day0'}`);
  const order = [...WIRE.keys()].sort(() => rng() - 0.5);
  return order.slice(0, count).map(i => ({ ...WIRE[i], tag: 'wire' }));
}

// ── Public seam ───────────────────────────────────────────────────────────────
// Up to `total` stories: the freshest live ones first, then today's rotating wire
// (canonical-lore) drumbeat, padded out with today's tabloid edition. Returns
// [{ headline, body, byline?, tag }].
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
    out.push({ headline: s.headline, body: liveBody(s.headline), tag: 'live' });
  }
  // Then the day's canonical-lore drumbeat — the Long Watch terror framing, the
  // Ascendant establishment, the Architect's oblique presence. Placed above the
  // tabloid filler so on a quiet day (no live stories) a lore piece leads and gets
  // a full anchor→reporter TV segment, while on a busy day it rides in the rundown.
  for (const s of wireStories(2)) {
    if (out.length >= total) break;
    const k = normHeadline(s.headline);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
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
