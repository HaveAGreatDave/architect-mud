// ── Game shows ───────────────────────────────────────────────────────────────
// A game show (playback_mode 'gameshow') is the live-ACTED procedural sibling of the
// talk show. Like it, it stores a ::lines library and assembles a fresh episode each
// in-game day, performed on stage by REAL npc_ cast (a host, optionally a sidekick who
// reads the prize copy). What makes it different is the AUDIENCE: any player standing
// in the studio when a round opens is a contestant, and their guess is televised to the
// whole city by the studio-floor camera relay. Nobody in the studio is not a failure
// mode — the contestants are then name-only strangers and the show plays out exactly as
// well. Participation is possible, never required.
//
// The quiz material is the world's own price list: `items.value`, read from the boot
// loaded item cache, so question generation costs ZERO queries and every item added to
// the game later becomes a new prize with no authoring.
//
// The episode is a pure function of (broadcastId, day bucket) — same seeded rng idiom as
// the talk show's persona pick and the sports league — so every TV in the city shows the
// same lots at the same instant, and a restart mid-day rebuilds the identical show.
//
// Spec: docs/bsm-format.md#game-shows-type-gameshow.

import { world, getZonePlayers } from '../../server/engine/world.js';
import { sendToZone, sendToPlayer, teachVerb } from '../../server/engine/messaging.js';
import { getEnvironmentState } from '../../server/engine/environment.js';
import { getItemCache } from '../../server/engine/items-cache.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { sportsPick, sportsShuffle, seedFromKey } from './rng.js';

// ── Tunables ────────────────────────────────────────────────────────────────
// Prize money is calibrated against the live quest economy (48 credit-rewarding
// quests: median 25, hardest 400) and a 20cr starting purse. A clean sweep of an
// episode pays ~370 — about the hardest job in the game — and the cooldown is what
// stops the studio being a credit faucet. If playtesting shows studio-camping,
// halve these before touching anything structural.
const ROUND_PRIZE = 40;
const SHOWCASE_PRIZE = 250;
const WIN_COOLDOWN_MS = 6 * 60 * 60 * 1000;   // real hours between paid wins
const COOLDOWN_FLAG = 'gameshow_win_cooldown';

// Prize-pool sanity bounds. The floor kills 1cr placeholder junk (a crushed can is
// not a question); the ceiling is headroom over today's dearest item (9,200) so one
// future absurd row can't hijack the show.
const PRIZE_MIN_VALUE = 5;
const PRIZE_MAX_VALUE = 12000;
// Value bands, so an episode isn't four consumables in a row.
const TIER_CHEAP_MAX = 50;
const TIER_MID_MAX = 500;
// The showcase is winnable inside a band rather than closest-without-going-over —
// a finale nobody can win reads badly, and "within twenty percent" says well on air.
const SHOWCASE_BAND = 0.20;
// Over-or-under is only a question when the two lots aren't neighbours. Below this
// ratio it's a coin flip, so the pair is rejected and another is drawn.
const OVERUNDER_MIN_RATIO = 1.35;

// ── Round state ─────────────────────────────────────────────────────────────
// Live rounds are in memory only and per channel. A round lasts about a minute; losing
// one to a restart costs nothing and is not worth a DB round trip. The only thing that
// is ever persisted is the win cooldown.
//
// rounds.get(channelId) = {
//   format, roundIndex, prizes:[{id,name,value}], price, correct, studioZoneId,
//   guesses: Map<playerId, { name, value, label }>,   // insertion-ordered: first in wins ties
//   npcGuesses: [{ name, value, label }],
//   resolved: bool, result: {…} | null
// }
const rounds = new Map();
// The most recent RESOLVED round per channel — what the reveal lines read their tokens
// from, kept separately so it survives the next round opening.
const lastResults = new Map();
// channelId → { bucket, pass } — which run-through of today's slot this channel is on.
// The episode fills its whole @airtime block, so when the graph's chain ends the walker
// wraps to _start and plays it AGAIN. Keying the deal on the day alone meant the second
// run-through had the same lots at the same prices: sit through one pass, sweep the next.
// The pass counter is bumped by the terminal gameshow_endpass node, so a fresh set of lots
// is dealt at exactly the moment the old episode finishes — never mid-show.
const passes = new Map();
// channelId → { bucket, paid } — credits this channel has actually handed out today, for
// the title card's money line. In memory like the rest of the runtime; a restart resets it
// to zero, which is the honest number for "paid out on this transmission".
const payouts = new Map();

// playerId → epoch ms of last PAID win. Populated lazily when a player guesses (the
// round window gives the read ~45s to land), so the on-air verdict can be decided
// synchronously at resolve time without the walker awaiting anything. Persisted to
// player_flags so a restart can't be used to reset the cooldown.
const lastWinAt = new Map();

// ── Prize pool ──────────────────────────────────────────────────────────────
// Fold the in-memory item catalog into a priceable pool. Deliberately NOT sourced from
// `furniture`: those rows are per-instance rather than catalog (the same flatscreen
// appears three times), half are unpriced, and the table is intentionally uncached.
export function gameshowPool(cache = getItemCache()) {
  const seen = new Set();
  const pool = [];
  for (const it of cache.values()) {
    const value = Number(it?.value);
    if (!Number.isFinite(value) || value < PRIZE_MIN_VALUE || value > PRIZE_MAX_VALUE) continue;
    // Street chemistry is both unguessable (median 8cr) and not what a network gives
    // away on daytime television.
    if (it.type === 'drug' || it.type === 'chemical') continue;
    if (!it.name || !String(it.description || '').trim()) continue;   // can't be presented on air
    const key = String(it.name).toLowerCase();
    if (seen.has(key)) continue;                                      // never show one prize twice
    seen.add(key);
    pool.push({ id: it.id, name: it.name, value, type: it.type || 'misc' });
  }
  // LOAD-BEARING: the item cache iterates in DB insertion order, which is not guaranteed
  // stable across restarts. Sorting by id before any seeded shuffle is what makes the
  // episode reproducible — without it, two servers (or the same server after a restart)
  // would disagree about tonight's lots.
  pool.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return pool;
}

function tierOf(item) {
  if (item.value <= TIER_CHEAP_MAX) return 'cheap';
  if (item.value <= TIER_MID_MAX) return 'mid';
  return 'dear';
}

// Split the pool into value bands, each independently shuffled by the episode rng.
// Rounds draw from the band that suits them, so the show has a shape: something small
// to warm up, something worth real money to finish on.
function gameshowTiers(pool, rand) {
  const t = { cheap: [], mid: [], dear: [] };
  for (const it of pool) t[tierOf(it)].push(it);
  return { cheap: sportsShuffle(t.cheap, rand), mid: sportsShuffle(t.mid, rand), dear: sportsShuffle(t.dear, rand) };
}

// Deal n lots from a tier, falling back through the other bands when a band is thin, so
// a sparse catalog still produces a full episode rather than a broken one.
function deal(tiers, tier, n) {
  const order = tier === 'dear' ? ['dear', 'mid', 'cheap'] : tier === 'mid' ? ['mid', 'cheap', 'dear'] : ['cheap', 'mid', 'dear'];
  const out = [];
  for (const t of order) {
    while (out.length < n && tiers[t].length) out.push(tiers[t].shift());
    if (out.length >= n) break;
  }
  return out;
}

// ── Airing + bucket ─────────────────────────────────────────────────────────
// Airs on in-game @airtime slots, reusing the sports 3-hour block clock. The caller
// passes the current slot-of-day (it reads the environment state, which lives in
// index.js). No @airtime ⇒ every slot.
export function gameshowAiring(script, slotOfDay) {
  const slots = script?.airSlots;
  if (!Array.isArray(slots) || !slots.length) return true;
  return slots.includes(slotOfDay);
}

// Episode bucket = the in-game calendar day, so a fresh set of lots rolls once a day and
// every viewer (and every restart within that day) sees the same episode.
export function gameshowDayBucket() {
  const env = getEnvironmentState();
  return (typeof env?.date === 'string' && env.date.length >= 10) ? env.date.slice(0, 10) : 'day0';
}

// ── Text helpers ────────────────────────────────────────────────────────────
// Assemble-time token fill. Unknown tokens are left VERBATIM rather than blanked — the
// outcome tokens ({winner} {verdict} {guesses} {contestant} {guess}) aren't knowable yet
// and must survive into the graph for _subTokens to resolve at airtime. This is the one
// place this differs from sportsFill, which blanks misses.
function fill(line, tok) {
  return String(line).replace(/\{(\w+)\}/g, (m, k) => (tok[k] !== undefined && tok[k] !== null ? String(tok[k]) : m));
}
function draw(pools, key, n, tok, rand) {
  const arr = Array.isArray(pools[key]) ? pools[key] : [];
  if (!arr.length) return [];
  return sportsShuffle(arr, rand).slice(0, n).map(l => fill(l, tok).trim()).filter(Boolean);
}
// Draw from a format-specific pool (`<base>.<format>`) and fall back to the generic one.
// Lets a file write a bespoke reveal for the three-lot round without having to supply a
// variant for every format.
function drawFmt(pools, base, format, n, tok, rand) {
  const specific = draw(pools, `${base}.${format}`, n, tok, rand);
  return specific.length ? specific : draw(pools, base, n, tok, rand);
}
const money = (n) => `${Number(n).toLocaleString('en-US')}`;

// A plausible-looking wrong answer: a stranger's guess, deterministic from the episode
// rng, scattered around the true price and rounded the way a person rounds. Wide enough
// that the NPCs lose convincingly without looking scripted.
function npcGuessValue(price, rand) {
  const raw = price * (0.55 + rand() * 0.9);
  const step = price > 2000 ? 100 : price > 400 ? 25 : price > 60 ? 5 : 1;
  return Math.max(1, Math.round(raw / step) * step);
}

// ── Assembly ────────────────────────────────────────────────────────────────
// Build one episode into a VINE broadcast graph of npc_anchor + say nodes, with a
// gameshow_round / gameshow_reveal pair bracketing each round.
//
// The round-open and reveal nodes are INSTANTANEOUS side-effect nodes (like set_flag),
// not holds. The guess window is the host's own patter — the prompt and stall lines
// between them take real on-air seconds via nodeHoldMs — so there is never dead air
// waiting on a timer, and the window is exactly as long as the show sounds like it is.
//
// Prize names and prices are baked into the text at assemble time (they're already known
// and deterministic). Only the OUTCOME tokens — {guesses} {contestant} {guess} {winner}
// {verdict} — resolve at airtime, because only they depend on who was in the room.
export function assembleGameshowGraph(script, broadcastId, bucket, normalizeGraph, cache, pass = 0) {
  const pools = script.pools || {};
  // The pass is IN the seed, so each run-through of the block is a different episode —
  // otherwise the show's own replay hands out the answers. Pass 0 keeps the plain day key,
  // so the first airing of a given day is still the same show on every set.
  const rand = seedFromKey(pass ? `${broadcastId}:${bucket}:p${pass}` : `${broadcastId}:${bucket}`);
  const host = script.host || 'npc_host';
  const sidekick = script.sidekick || host;
  const contestantNames = (Array.isArray(script.contestants) ? script.contestants : []).filter(Boolean);
  const roundCount = Math.max(1, Math.min(4, Number(script.rounds) || 4));

  const pool = gameshowPool(cache);
  const tiers = gameshowTiers(pool, rand);

  const baseTok = {
    host: (world.npcs.get(host)?.name) || 'the host',
    sidekick: (world.npcs.get(sidekick)?.name) || 'the announcer',
  };

  const nodes = {};
  let n = 0, prevId = null, startId = null, curAnchor = null;
  const add = (data) => {
    const id = `gs_${n++}`;
    nodes[id] = { ...data };
    if (prevId) nodes[prevId].next = id;
    if (startId === null) startId = id;
    prevId = id;
    return id;
  };
  const anchor = (npcId) => { if (npcId !== curAnchor) { add({ type: 'npc_anchor', npc_id: npcId }); curAnchor = npcId; } };
  const line = (npcId, text) => { if (!text) return; anchor(npcId); add({ type: 'say', text, style: 'raw' }); };
  const lines = (npcId, arr) => arr.forEach(t => line(npcId, t));

  // Crowd beats — unattributed stage business, so they air as ambient (dim italic, no
  // speaker, not read aloud) over an empty anchor. Same idiom as the talk show.
  const audienceDeck = draw(pools, 'audience', 40, baseTok, rand);
  const applauseDeck = draw(pools, 'applause', 12, baseTok, rand);
  let rIdx = 0, aIdx = 0;
  const ambientBeat = (text, holdMs) => {
    if (!text) return;
    if (curAnchor !== '') { add({ type: 'npc_anchor', npc_id: '' }); curAnchor = ''; }
    add({ type: 'say', text, style: 'ambient', holdMs });
  };
  const react = () => { if (audienceDeck.length) ambientBeat(audienceDeck[rIdx++ % audienceDeck.length], 3500); };
  const applause = () => {
    if (applauseDeck.length) ambientBeat(applauseDeck[aIdx++ % applauseDeck.length], 4200);
    else react();
  };

  add({ type: 'start' });
  if (script.title) add({ type: 'title_card', graphic_id: script.title, theme: script.theme || null });
  else if (script.theme) add({ type: 'music', song: script.theme, text: '♪ The theme plays. ♪' });

  // Cold open — the announcer sets the show up, then brings the host out.
  lines(sidekick, draw(pools, 'open', 1 + Math.floor(rand() * 2), baseTok, rand));
  line(sidekick, fill(sportsPick(pools, rand, 'announce_host') || "Ladies and gentlemen — {host}!", baseTok));
  applause();
  // The invitation to play, with the verb taught the house way. This is the only place
  // `guess` is ever advertised, which is why it carries the shimmer. NOTE the token is
  // {verb}, not {guess} — {guess} is the runtime outcome token (what the winner said), and
  // using it here would make the invitation read back somebody's bid.
  const call = draw(pools, 'audience_call', 1, { ...baseTok, verb: teachVerb('guess') }, rand);
  if (call.length) lines(host, call);

  // ── Rounds ────────────────────────────────────────────────────────────────
  // Formats in fixed order so the episode has a shape: a fast binary warm-up, the
  // canonical pricing round, the hard one, then the money.
  const FORMATS = [
    { format: 'overunder', tier: 'mid', count: 2 },
    { format: 'price', tier: 'mid', count: 1 },
    { format: 'lot', tier: 'cheap', count: 3 },
    { format: 'showcase', tier: 'dear', count: 1 },
  ];

  for (let r = 0; r < roundCount; r++) {
    const spec = FORMATS[r];
    let prizes = deal(tiers, spec.tier, spec.count);
    if (prizes.length < spec.count) continue;   // catalog too thin for this format — skip the round

    // Over-or-under needs two lots that aren't near-neighbours, else the answer is a
    // coin flip. Keep dealing replacements for the second lot until the gap is real.
    if (spec.format === 'overunder') {
      let guard = 0;
      while (guard++ < 12 && Math.max(prizes[0].value, prizes[1].value) / Math.min(prizes[0].value, prizes[1].value) < OVERUNDER_MIN_RATIO) {
        const [next] = deal(tiers, spec.tier, 1);
        if (!next) break;
        prizes = [prizes[0], next];
      }
      if (Math.max(prizes[0].value, prizes[1].value) / Math.min(prizes[0].value, prizes[1].value) < OVERUNDER_MIN_RATIO) continue;
    }

    // Ordering three lots is only answerable if their prices are DISTINCT — two items at
    // the same value make the correct order ambiguous and the round unwinnable. Keep
    // swapping out duplicates until all three differ.
    if (spec.format === 'lot') {
      let guard = 0;
      while (guard++ < 20 && new Set(prizes.map(p => p.value)).size < prizes.length) {
        const dupAt = prizes.findIndex((p, i) => prizes.findIndex(q => q.value === p.value) !== i);
        const [next] = deal(tiers, spec.tier, 1);
        if (!next) break;
        prizes = prizes.map((p, i) => (i === dupAt ? next : p));
      }
      if (new Set(prizes.map(p => p.value)).size < prizes.length) continue;   // couldn't separate them
    }

    const isShowcase = spec.format === 'showcase';
    const price = prizes[0].value;
    // Lots read cheapest-first, for the ordering round's reveal.
    const ranked = prizes.map((p, i) => ({ slot: i + 1, ...p })).sort((a, b) => a.value - b.value);
    const tok = {
      ...baseTok,
      prize: prizes[0].name,
      prize2: prizes[1]?.name || '',
      prize3: prizes[2]?.name || '',
      price: money(price),
      price2: prizes[1] ? money(prizes[1].value) : '',
      price3: prizes[2] ? money(prizes[2].value) : '',
      // Every lot with its price, in the order they were shown — for a multi-item reveal.
      // The two-lot case (higher-or-lower) gets "against" rather than a comma: this token
      // is read out right after {guesses}, which is itself a comma list of names, and two
      // comma lists in a row parse as one run-on roster.
      prices: prizes.length === 2
        ? `${prizes[0].name} at ${money(prizes[0].value)} against ${prizes[1].name} at ${money(prizes[1].value)}`
        : prizes.map(p => `${p.name} at ${money(p.value)}`).join(', '),
      // The right answer, read out as prose.
      order: ranked.map(p => `${p.name} at ${money(p.value)}`).join(', then '),
      total: money(prizes.reduce((s, p) => s + p.value, 0)),
      purse: money(isShowcase ? SHOWCASE_PRIZE : ROUND_PRIZE),
    };

    // What the strangers said. Baked now so the reveal is deterministic and identical
    // on every set, whether or not a player ever turns up.
    const npcGuesses = contestantNames.slice(0, 3).map((name) => {
      if (spec.format === 'overunder') {
        const pick = rand() < 0.5 ? 'higher' : 'lower';
        return { name, value: pick, label: pick };
      }
      if (spec.format === 'lot') {
        const order = sportsShuffle([1, 2, 3], rand);
        return { name, value: order, label: order.join('-') };
      }
      const v = npcGuessValue(price, rand);
      return { name, value: v, label: money(v) };
    });

    const correct = spec.format === 'overunder'
      ? (prizes[1].value > prizes[0].value ? 'higher' : 'lower')
      : spec.format === 'lot'
        ? prizes.map((p, i) => ({ i: i + 1, v: p.value })).sort((a, b) => a.v - b.v).map(x => x.i)
        : null;

    // Round intro + the prize copy the announcer reads over the lot.
    lines(host, draw(pools, isShowcase ? 'showcase_intro' : `round_intro.${spec.format}`, 1, tok, rand));
    lines(sidekick, drawFmt(pools, 'prize_copy', spec.format, 1, tok, rand));

    // Open the round. Everything the contestants need to answer is in this node.
    add({
      type: 'gameshow_round',
      format: spec.format,
      roundIndex: r,
      prizes: prizes.map(p => ({ id: p.id, name: p.name, value: p.value })),
      price,
      correct,
      npcGuesses,
      purse: isShowcase ? SHOWCASE_PRIZE : ROUND_PRIZE,
      grantsItem: isShowcase,
    });

    // The guess window — the host asks, then fills. These lines ARE the clock.
    // The ask is format-specific: "what's it worth" makes no sense for an ordering round.
    lines(host, drawFmt(pools, 'prompt', spec.format, 1, tok, rand));
    lines(host, draw(pools, 'stall', 1 + Math.floor(rand() * 2), tok, rand));

    // Close the round and score it, then read the verdict out.
    add({ type: 'gameshow_reveal', format: spec.format, roundIndex: r });
    lines(host, isShowcase ? draw(pools, 'showcase_reveal', 1, tok, rand) : drawFmt(pools, 'reveal', spec.format, 1, tok, rand));
    // The price card. A multi-lot round shows every lot's price, or the card contradicts
    // the line that just aired. The ORDERING round lists them cheapest-first, because that
    // ordering is the answer; every other round lists them as they were shown, so the card
    // matches the order the host read them out in.
    const cardOrder = spec.format === 'lot' ? ranked : prizes;
    add({
      type: 'show_overlay',
      overlayType: 'text_card',
      text: prizes.length > 1
        ? `ACTUAL RETAIL PRICES\n\n${cardOrder.map(p => `${String(p.name).toUpperCase()} · ${money(p.value)}₵`).join('\n')}`
        : `${String(prizes[0].name).toUpperCase()}\n\nACTUAL RETAIL PRICE · ${money(price)}₵`,
      duration_s: 5,
    });
    curAnchor = null;   // the card broke the speaker chain; re-anchor before the next line
    lines(host, draw(pools, 'verdict_read', 1, tok, rand));
    react();

    // A commercial before the finale, so the money round gets its own act.
    if (r === roundCount - 2) {
      const ad = draw(pools, 'commercial', 1, tok, rand);
      if (ad.length) { add({ type: 'npc_anchor', npc_id: '' }); curAnchor = ''; ad.forEach(t => add({ type: 'say', text: t, style: 'narration' })); }
    }
  }

  // Sign-off — ONE line, so the show never says goodnight twice.
  applause();
  lines(host, draw(pools, 'signoff', 1, baseTok, rand));
  // The legal crawl runs out under the credits. One line, whole thing, every episode —
  // it's the same disclaimer every time by design.
  const crawl = draw(pools, 'ticker', 1, baseTok, rand);
  if (crawl.length) { curAnchor = null; add({ type: 'ticker', text: crawl[0] }); }
  // Terminal side-effect node: the episode is over, so bump the pass counter and let the
  // next tick deal a fresh one. Instantaneous, like the round nodes, and _seekGraph walks
  // past it without firing — a late tuner must not re-deal the show they just tuned into.
  add({ type: 'gameshow_endpass' });

  const graph = normalizeGraph({ _start: startId, nodes });
  // Deliberately keyed on the DAY, not the pass: tickBroadcastGraph resets the blackboard
  // (and seeks by slot-elapsed) whenever _broadcastId changes, and a seek at a pass boundary
  // would fast-forward the new episode to somewhere near its end. The walker is already at
  // a clean stop when the pass rolls, so it picks the new graph up at _start on its own.
  graph._broadcastId = `${broadcastId}:gameshow:${bucket}`;
  graph._requireHost = true;   // presence-gate: no cast on the floor ⇒ camera-idle → tech-diff
  return graph;
}

// Return the day's assembled episode for a gameshow playlist item, rebuilt when the day
// bucket rolls. Cached on the item between ticks, exactly like the talk show's.
export function getGameshowGraph(item, normalizeGraph, channelId = null) {
  const script = item.gameshowScript;
  if (!script) return null;
  const bucket = gameshowDayBucket();
  const pass = gameshowPassIndex(channelId, bucket);
  const key = `${bucket}#${pass}`;
  if (item._gameshowGraph && item._gameshowBucket === key) return item._gameshowGraph;
  item._gameshowGraph = assembleGameshowGraph(script, item.broadcastId, bucket, normalizeGraph, undefined, pass);
  item._gameshowBucket = key;
  return item._gameshowGraph;
}

// Which run-through of today's block this channel is on. Rolls back to 0 when the day does.
export function gameshowPassIndex(channelId, bucket = gameshowDayBucket()) {
  if (!channelId) return 0;
  const cur = passes.get(channelId);
  if (!cur || cur.bucket !== bucket) { passes.set(channelId, { bucket, pass: 0 }); return 0; }
  return cur.pass;
}

// Fired by the terminal node of an episode: the next tick deals a brand-new one.
export function gameshowEndPass(channelId) {
  if (!channelId) return;
  const bucket = gameshowDayBucket();
  const cur = passes.get(channelId);
  passes.set(channelId, { bucket, pass: (cur && cur.bucket === bucket ? cur.pass : 0) + 1 });
}

// ── Scoring ─────────────────────────────────────────────────────────────────
// All four take entries in insertion order — [{ key, name, value, label }] — and return
// the winning entry or null. Ties go to whoever answered first, which rewards nerve.
// Pure and exported so the regress suite can drive them directly.

// Closest without going over. Over-bidding is elimination, not a penalty.
export function scorePrice(entries, price) {
  let best = null;
  for (const e of entries) {
    const v = Number(e.value);
    if (!Number.isFinite(v) || v > price) continue;
    if (!best || v > Number(best.value)) best = e;
  }
  return best;
}

// Binary. First correct answer takes it.
export function scoreOverUnder(entries, correct) {
  return entries.find(e => e.value === correct) || null;
}

// Order three lots cheapest→priciest. Score = adjacent pairs in the right order, so for
// three items a perfect 2 IS the exact order. Only a UNIQUE top scorer wins — a shared
// best means nobody got it, which happens often enough to be dramatic.
export function scoreLot(entries, correctOrder) {
  const rank = new Map(correctOrder.map((slot, i) => [slot, i]));
  const scored = entries.map(e => {
    const order = Array.isArray(e.value) ? e.value : [];
    let s = 0;
    for (let i = 0; i + 1 < order.length; i++) {
      const a = rank.get(order[i]), b = rank.get(order[i + 1]);
      if (a !== undefined && b !== undefined && a < b) s++;
    }
    return { e, s };
  });
  if (!scored.length) return null;
  const top = Math.max(...scored.map(x => x.s));
  const winners = scored.filter(x => x.s === top);
  return winners.length === 1 ? winners[0].e : null;
}

// The finale: inside a band either side, first one in wins.
export function scoreShowcase(entries, price, band = SHOWCASE_BAND) {
  const lo = price * (1 - band), hi = price * (1 + band);
  return entries.find(e => {
    const v = Number(e.value);
    return Number.isFinite(v) && v >= lo && v <= hi;
  }) || null;
}

function scoreRound(round, entries) {
  switch (round.format) {
    case 'overunder': return scoreOverUnder(entries, round.correct);
    case 'lot':       return scoreLot(entries, round.correct);
    case 'showcase':  return scoreShowcase(entries, round.price);
    default:          return scorePrice(entries, round.price);
  }
}

// ── Round lifecycle ─────────────────────────────────────────────────────────
export function gameshowOpenRound(channelId, node, studioZoneId) {
  const d = node.data || node;
  rounds.set(channelId, {
    format: d.format || 'price',
    roundIndex: d.roundIndex ?? 0,
    prizes: Array.isArray(d.prizes) ? d.prizes : [],
    price: Number(d.price) || 0,
    correct: d.correct ?? null,
    npcGuesses: Array.isArray(d.npcGuesses) ? d.npcGuesses : [],
    purse: Number(d.purse) || ROUND_PRIZE,
    grantsItem: !!d.grantsItem,
    studioZoneId: studioZoneId || null,
    guesses: new Map(),
    resolved: false,
    result: null,
  });
}

export function getOpenRound(channelId) {
  const r = rounds.get(channelId);
  return r && !r.resolved ? r : null;
}

// Score the open round and queue any payout. IDEMPOTENT — it is reachable from the
// reveal node and (in principle) from a re-entrant tick, and must never pay twice.
export function gameshowResolveRound(channelId) {
  const round = rounds.get(channelId);
  if (!round || round.resolved) return round?.result || null;
  round.resolved = true;

  // Room authority: you have to still be in the studio to win. Wandering off mid-round
  // forfeits the guess — that's correct behaviour, not a case to engineer around.
  const present = new Set((round.studioZoneId ? getZonePlayers(round.studioZoneId) : []).map(p => p.id));
  const playerEntries = [];
  for (const [pid, g] of round.guesses) {
    if (!present.has(pid)) continue;
    playerEntries.push({ key: `player:${pid}`, playerId: pid, name: g.name, value: g.value, label: g.label });
  }
  const walkedOff = round.guesses.size - playerEntries.length;
  const npcEntries = round.npcGuesses.map((g, i) => ({ key: `npc:${i}`, name: g.name, value: g.value, label: g.label }));

  // Players first so a player takes a tie against a stranger.
  const winner = scoreRound(round, [...playerEntries, ...npcEntries]);
  const all = [...playerEntries, ...npcEntries];

  const result = {
    format: round.format,
    price: round.price,
    prizes: round.prizes,
    winner: winner || null,
    guesses: all,
    walkedOff,
    noPayout: false,
    paid: 0,
  };

  // Decide the on-air verdict synchronously — the reveal line airs on the very next
  // node, so it cannot wait on a DB read. The cooldown map is populated when the player
  // guesses (see cmdGuess), which gives it the whole round window to load.
  if (winner?.playerId) {
    const last = lastWinAt.get(winner.playerId) || 0;
    if (Date.now() - last < WIN_COOLDOWN_MS) {
      result.noPayout = true;
    } else {
      result.paid = round.purse;
      lastWinAt.set(winner.playerId, Date.now());
      const bucket = gameshowDayBucket();
      const tally = payouts.get(channelId);
      payouts.set(channelId, { bucket, paid: (tally && tally.bucket === bucket ? tally.paid : 0) + round.purse });
      _payWinner(winner.playerId, round.purse, round.grantsItem ? round.prizes[0] : null)
        .catch(e => console.error('[gameshow] payout failed:', e.message));
    }
  }

  round.result = result;
  lastResults.set(channelId, result);
  return result;
}

async function _payWinner(playerId, amount, prizeItem) {
  // Offline-safe idiom (sportsbet's): the guarded UPDATE is authoritative, so a win
  // still pays even if the player has since left the studio or the game.
  const stub = { id: playerId, credits: 0 };
  await adjustCredits(stub, amount, undefined, 'gameshow:prize');
  await setFlag('player', COOLDOWN_FLAG, String(Date.now()), { id: playerId });

  let itemLine = '';
  if (prizeItem?.id) {
    // Canonical action, never a direct inventory write — you win the actual lot.
    await dispatchAction({
      type: 'GRANT_ITEM',
      actor: { id: playerId },
      params: { item_id: prizeItem.id, quantity: 1, once: false },
      context: {},
    }).catch(e => console.error('[gameshow] prize grant failed:', e.message));
    itemLine = ` The ${prizeItem.name} is yours.`;
  }
  sendToPlayer(playerId, {
    type: 'output',
    message: `<span style="color:var(--green)">You won ${money(amount)}₵ on television.${itemLine}</span>`,
  });
}

// ── Airtime tokens ──────────────────────────────────────────────────────────
// Merged into _scriptedTokens, so a reveal line resolves against the round that just
// closed. Everything returns a STRING even with no round in play: the late-tune seeker
// walks past the round nodes without firing them, so a viewer tuning in mid-episode
// lands on a reveal line with nothing behind it — and must not see `undefined` on air.
export function gameshowTokens(channelId) {
  // The money the show is playing for, and what it has actually handed over today. These
  // three are knowable with no round in play — the title card reads them before a single
  // lot has been shown — so they sit outside the no-result early return. They are purses,
  // never prices: nothing here leaks an answer.
  const tally = payouts.get(channelId);
  const money_tok = {
    purse_round: money(ROUND_PRIZE),
    purse_showcase: money(SHOWCASE_PRIZE),
    paid_today: money(tally && tally.bucket === gameshowDayBucket() ? tally.paid : 0),
  };
  const res = lastResults.get(channelId);
  if (!res) {
    return { ...money_tok, guesses: 'the studio', contestant: 'our contestant', guess: 'a number', winner: 'nobody', verdict: '' };
  }
  const guesses = res.guesses.length
    ? res.guesses.map(g => `${g.name} ${g.label}`).join(', ')
    : 'nobody at all';
  const first = res.guesses[0] || null;
  const w = res.winner;
  const verdict = !w
    ? "Nobody. Not one of you."
    : res.noPayout
      ? `${w.name} takes it — though the network says one purse a day, friend.`
      : `${w.name} takes it.`;
  return {
    ...money_tok,
    guesses,
    contestant: (w?.name) || first?.name || 'our contestant',
    guess: (w?.label) || first?.label || 'a number',
    winner: w?.name || 'nobody',
    verdict,
  };
}

// ── The `guess` verb ────────────────────────────────────────────────────────
// One verb answers all four formats. It exists rather than parsing raw `say` because
// the studio relay can't tell an answer from audience chatter — but the OUTCOME is still
// "you said a number out loud on television": the handler echoes the guess into the
// studio, and the existing relay puts that echo on air to every set in the city.
//
// `channelsForStudio` is supplied by index.js (it owns channelRuntime) and returns
// [{ channelId, studioZoneId }] for the zone the player is standing in.
export function makeGuessCommand(channelsForStudio) {
  return async function cmdGuess(args, raw, player) {
    const here = channelsForStudio(player.current_zone) || [];
    let channelId = null, round = null;
    for (const c of here) {
      const r = getOpenRound(c.channelId);
      if (r) { channelId = c.channelId; round = r; break; }
    }
    if (!round) {
      return here.length
        ? "The floor isn't taking answers right now. Wait for the host to ask."
        : "There's nothing to guess at in here.";
    }
    if (round.guesses.has(player.id)) return "You've locked your answer in.";

    const parsed = parseGuess(round.format, args);
    if (!parsed) return guessHint(round.format);

    round.guesses.set(player.id, { name: player.handle || player.name || 'someone', ...parsed });

    // Warm the cooldown so resolve can decide the verdict without awaiting anything.
    if (!lastWinAt.has(player.id)) {
      getFlag('player', COOLDOWN_FLAG, player)
        .then(v => { const t = Number(v); if (Number.isFinite(t) && t > 0) lastWinAt.set(player.id, t); })
        .catch(() => {});
    }

    // Say it out loud. This is the line the whole city hears: sendToZone → zone.broadcast
    // → the studio relay → every TV, deck and tablet tuned to the channel.
    const who = player.handle || player.name || 'Someone';
    sendToZone(player.current_zone, {
      type: 'output',
      message: `<span style="color:var(--yellow)">${who} says, "${parsed.spoken}"</span>`,
    });
    return null;   // the room echo IS the feedback; a second private line would double it
  };
}

// Per-format parsing. Returns { value, label, spoken } or null.
export function parseGuess(format, args) {
  const text = String(Array.isArray(args) ? args.join(' ') : (args || '')).trim();
  if (!text) return null;

  if (format === 'overunder') {
    const w = text.toLowerCase().replace(/[^a-z]/g, '');
    if (['higher', 'high', 'over', 'up', 'h'].includes(w)) return { value: 'higher', label: 'higher', spoken: 'Higher.' };
    if (['lower', 'low', 'under', 'down', 'l'].includes(w)) return { value: 'lower', label: 'lower', spoken: 'Lower.' };
    return null;
  }

  if (format === 'lot') {
    const nums = text.match(/[1-3]/g);
    if (!nums || nums.length !== 3) return null;
    const order = nums.map(Number);
    if (new Set(order).size !== 3) return null;
    return { value: order, label: order.join('-'), spoken: `${order.join(', then ')}.` };
  }

  // price / showcase — a plain number, commas and a leading ₵ tolerated.
  const m = text.replace(/[,₵]/g, '').match(/\d+/);
  if (!m) return null;
  const v = Number(m[0]);
  if (!Number.isFinite(v) || v <= 0) return null;
  return { value: v, label: money(v), spoken: `${money(v)} credits.` };
}

function guessHint(format) {
  if (format === 'overunder') return 'Say `guess higher` or `guess lower`.';
  if (format === 'lot') return 'Order all three — `guess 2 1 3` — cheapest first.';
  return 'Name a price in credits — `guess 400`.';
}

// Cleared on logout so a stale seat can't hold a guess for someone who has gone.
export function gameshowForgetPlayer(playerId) {
  for (const r of rounds.values()) r.guesses.delete(playerId);
}

// Test seam for regress.js — never used in production paths.
export const _gameshowTest = {
  rounds, lastResults, lastWinAt, passes, payouts,
  npcGuessValue, tierOf, deal, gameshowTiers,
  ROUND_PRIZE, SHOWCASE_PRIZE, WIN_COOLDOWN_MS, SHOWCASE_BAND, OVERUNDER_MIN_RATIO,
  PRIZE_MIN_VALUE, PRIZE_MAX_VALUE,
};
