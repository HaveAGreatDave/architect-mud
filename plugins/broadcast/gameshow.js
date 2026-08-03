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
// WHAT the show asks about is a SUBJECT, picked by `@subject` in the .bsm and owned by
// gameshow-subjects.js — the material, the round plan, the parsing and the scoring. This
// module owns everything a game show has regardless of subject: the cast, the guess
// window, the purse, the cooldown, the studio relay. `retail` (what is this worth?) reads
// the world's own price list; `basin` (what do you know about this city?) reads the
// district registry and the orders. Both cost ZERO queries — that's the subject contract,
// because an episode is assembled on the broadcast tick for every set in the city.
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
import { getGameshowSubject, _subjectsTest } from './gameshow-subjects.js';

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

  // What this show asks about. An unknown or absent @subject is a retail show — that is
  // what every game show was before subjects existed, and The Last Lot must not notice.
  const subject = getGameshowSubject(script.subject);
  const dealer = subject.episode(rand, { cache, contestantNames });

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
  // The subject owns the plan: which formats, in what order, on what material. Retail's
  // is a fast binary warm-up, the canonical pricing round, the hard one, then the money;
  // a quiz's is four questions on a widening field. The loop below is the same either way.
  const plan = Array.isArray(subject.plan) ? subject.plan : [];

  for (let r = 0; r < roundCount; r++) {
    const spec = plan[r];
    if (!spec) continue;
    // Deal the round. A subject returns null when the world can't furnish this format
    // today — a thin catalog, a category with nothing left to ask. The episode simply
    // plays one round shorter, which is a normal outcome and not an error.
    const rd = dealer.round(spec);
    if (!rd) continue;

    const isShowcase = !!rd.isShowcase;
    const purse = isShowcase ? SHOWCASE_PRIZE : ROUND_PRIZE;
    // The PURSE is the engine's to set, never the subject's: prize money is calibrated
    // against the quest economy for every show at once, and a subject that could name
    // its own would be a subject that could mint credits.
    const tok = { ...baseTok, ...rd.tok, purse: money(purse) };

    // Round intro + the prize copy the announcer reads over the lot.
    lines(host, draw(pools, rd.keys?.intro || `round_intro.${spec.format}`, 1, tok, rand));
    lines(sidekick, drawFmt(pools, 'prize_copy', spec.format, 1, tok, rand));

    // Open the round. Everything the contestants need to answer is in this node.
    // `subject` rides along so the guess verb can parse and the reveal can score without
    // the runtime having to know which show it's looking at.
    add({
      type: 'gameshow_round',
      format: spec.format,
      subject: subject.id,
      roundIndex: r,
      ...rd.node,
      purse,
      grantsItem: !!rd.grantsItem,
    });

    // The guess window — the host asks, then fills. These lines ARE the clock.
    // The ask is format-specific: "what's it worth" makes no sense for an ordering round.
    lines(host, drawFmt(pools, 'prompt', spec.format, 1, tok, rand));
    lines(host, draw(pools, 'stall', 1 + Math.floor(rand() * 2), tok, rand));

    // Close the round and score it, then read the verdict out.
    add({ type: 'gameshow_reveal', format: spec.format, roundIndex: r });
    lines(host, isShowcase ? draw(pools, rd.keys?.reveal || 'showcase_reveal', 1, tok, rand) : drawFmt(pools, rd.keys?.reveal || 'reveal', spec.format, 1, tok, rand));
    // The answer card. The subject writes it, because only the subject knows what the
    // answer looks like — a retail round prints every lot's price (or the card contradicts
    // the line that just aired), a quiz round prints the lettered options and the right one.
    add({
      type: 'show_overlay',
      overlayType: 'text_card',
      text: rd.cardText,
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

// ── Round lifecycle ─────────────────────────────────────────────────────────
export function gameshowOpenRound(channelId, node, studioZoneId) {
  const d = node.data || node;
  rounds.set(channelId, {
    format: d.format || 'price',
    // A round dealt before subjects existed carries no subject; getGameshowSubject
    // resolves that to retail, which is what it was.
    subject: d.subject || 'retail',
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
  const winner = getGameshowSubject(round.subject).score(round.format, [...playerEntries, ...npcEntries], round);
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

    const subject = getGameshowSubject(round.subject);
    const parsed = subject.parse(round.format, args);
    if (!parsed) return subject.hint(round.format);

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

// Cleared on logout so a stale seat can't hold a guess for someone who has gone.
export function gameshowForgetPlayer(playerId) {
  for (const r of rounds.values()) r.guesses.delete(playerId);
}

// ── Back-compat surface ─────────────────────────────────────────────────────
// The pool, the four retail scorers and the guess parser moved into the retail subject
// when subjects were introduced. They are re-exported here because index.js and the
// regress suite import them from this module, and a subject boundary is not a reason to
// churn every call site. `parseGuess`/`scoreRound` keep their old signature by routing
// through the retail subject — which is what they always were.
export { gameshowPool, scorePrice, scoreOverUnder, scoreLot, scoreShowcase } from './gameshow-subjects.js';
export { getGameshowSubject, registerGameshowSubject, gameshowSubjectIds } from './gameshow-subjects.js';
export function parseGuess(format, args, subjectId = 'retail') {
  return getGameshowSubject(subjectId).parse(format, args);
}

// Test seam for regress.js — never used in production paths.
export const _gameshowTest = {
  rounds, lastResults, lastWinAt, passes, payouts,
  ROUND_PRIZE, SHOWCASE_PRIZE, WIN_COOLDOWN_MS,
  ..._subjectsTest,
};
