// Steady Work plugin — tier-two employment over the quest/posture substrate.
//
// The grown-up sibling of the job board (plugins/jobboard): where a gig is a
// quick one-and-done errand, a SHIFT is employment — it takes real time, it
// competes with everything else you'd rather be doing, and it can be failed.
//
// Shape (this is the "spine + shift" first cut; couriers + the parcel/fence
// theft economy are the planned follow-up — see docs/proposals/steady-work.md):
//   - NO GATE (2026-07-21). This used to sit behind 500 lifetime XP, which was
//     backwards twice over: lifetime XP comes only from probabilistic per-use
//     skill rolls (quests award none — grantXp has no callers), so the whole
//     early quest chain moved you no closer to it; and it locked the SAFE,
//     indoor, repeatable earner behind proof you'd survived the dangerous ones.
//     A shift is now open to anyone who finds a venue. The on-ramp is discovery,
//     not permission — `work` with no venue underfoot lists every venue going.
//   - VENUE: a zone opts in with flags.work_venue = { role, wage, employer? } —
//     content-driven, exactly like scavenging_table_id / fishing_table_id.
//   - SHIFT: `clock in` at a venue sets posture 'working' and starts a per-player
//     shiftState on the live object (posture is the authoritative activity flag,
//     so moving/attacking force-stands and ends the shift for free — the same
//     contract fishing/scavenging rely on). A 1s tick drives timed EVENTS: each
//     is a prompt + a response verb + a stat check + a window. Nail it, botch it,
//     or ignore it (worst) — each nudges a hidden satisfaction meter. Drop below
//     the floor and the manager sends you home with cut pay. Exactly one RUSH is
//     seeded mid-shift (a burst of stacked events) as the guaranteed skill peak.
//   - PAY at clock-out: flat wage (prorated if you leave early) + a tip pool that
//     scales off ending satisfaction.
//
// No new tick machinery, no new engine seam — this composes the posture
// substrate, the stat rolls, and adjustCredits, the same way the other
// posture-tick activities do.

import { getTunable } from '../../server/engine/tunables.js';
import { schedule } from '../../server/engine/scheduler.js';
import { getZone, world, getAllLivePlayers, getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { setPosture, forceStand } from '../../server/engine/posture.js';
import { adjustCredits } from '../../server/engine/economy.js';
import { on } from '../../server/engine/events.js';
import { setFlag } from '../../server/engine/flags.js';
import { courierVerb, deliver, crack, registerCourierAction, _courierTest } from './courier.js';

// ── Tunables (defaults; adjustable via the tunables table without a redeploy) ──
const T = {
  shiftSecs:  () => getTunable('work_shift_secs', 420),     // 7-minute shift
  tickSecs:   () => getTunable('work_shift_tick_secs', 20), // min gap between event rolls
  eventChance:() => getTunable('work_event_chance', 0.55),  // per-window fire chance
};

const EVENT_WINDOW_MS = 13000; // response window on a normal event
const RUSH_WINDOW_MS   = 9000;  // tighter window during the rush
const SAT_START  = 70;
const SAT_FLOOR  = 25;   // below this the manager cuts the shift short
const SAT_NAILED = 9;
const SAT_BOTCH  = -11;
const SAT_IGNORE = -16;  // letting a window expire is the worst outcome
const DEFAULT_WAGE = 65;
const TIP_MAX = 85;      // tip pool at max satisfaction

// ── The diner event pool (WORK_TEMPLATES, kind:'shift') ───────────────────────
// Event copy is content authoring, not design — it lives here in the build. A
// venue can reweight/replace this later via flags.work_venue.events. Each event:
//   { id, verb, stat, difficulty, prompt, nailed, botched }
// `stat` is a player stat key ('reflexes'|'cool'|'brawn') or 'brawn|cool' (best of).
const DINER_EVENTS = [
  { id: 'order_up', verb: 'serve', stat: 'reflexes', difficulty: 5,
    prompt: 'Table four\'s order is dying on the pass. <b>serve</b> it before it goes cold.',
    nailed: 'You sweep the plates off the pass and land them hot. The table nods; the tip jar notices.',
    botched: 'The plates sit under the lamp a beat too long. Lukewarm noodles, a flat look, no thanks.' },
  { id: 'the_check', verb: 'bill', stat: 'cool', difficulty: 5,
    prompt: 'Table two is waving for their tab. <b>bill</b> them before they cool on you.',
    nailed: 'You total it in your head, run the card, wish them a night. Smooth. They round up.',
    botched: 'You fumble the reader, the total\'s wrong twice. They pay, but the tip line stays a hard zero.' },
  { id: 'fryer', verb: 'douse', stat: 'reflexes', difficulty: 6,
    prompt: '<span class="text-red">The fryer\'s smoking — grease is about to catch.</span> <b>douse</b> it, now.',
    nailed: 'You kill the element and smother it before it goes up. Gus grunts, which is high praise.',
    botched: 'You get to it late. A gout of flame, a stink of burnt oil, half the counter wreathed in smoke.' },
  { id: 'regular', verb: 'soothe', stat: 'cool', difficulty: 4,
    prompt: 'Old Hensley wants his usual and somebody to hear his stories. <b>soothe</b> him.',
    nailed: 'You let him talk, top his coffee, laugh at the one about the dog. He leaves happy and heavy-tipping.',
    botched: 'You cut him off. He deflates, drinks up, and takes his lonely credits somewhere kinder.' },
  { id: 'drunk', verb: 'bounce', stat: 'brawn|cool', difficulty: 6,
    prompt: 'A drunk at the counter is getting loud and handsy. <b>bounce</b> him — muscle or mouth.',
    nailed: 'You walk him to the door without a scene. The room exhales; the mood holds.',
    botched: 'It turns into a shoving match. A stool goes over, two tables clear out. Gus is not thrilled.' },
];

// A second venue shape: a bar/nightclub floor. Reuses the same five response
// verbs (no new global verbs) but leans Brawn/Cool — the rowdy, keep-the-room-
// smooth work the diner's Reflexes checks don't cover. Selected per venue by
// flags.work_venue.pool = 'bar'.
const BAR_EVENTS = [
  { id: 'round', verb: 'serve', stat: 'reflexes', difficulty: 6,
    prompt: 'A booth just ordered a full round and the rail\'s three deep. <b>serve</b> it before they wander off to the next bar.',
    nailed: 'You build the round in one fluid sweep, slide it down the bar, and never miss a face. The tab grows; the crowd stays.',
    botched: 'You lose track of who ordered what. Two drinks come back, one walks out the door unpaid.' },
  { id: 'tab', verb: 'bill', stat: 'cool', difficulty: 6,
    prompt: 'A suit at the end wants to close a fat tab and he\'s already arguing the total. <b>bill</b> him cool.',
    nailed: 'You walk him through it line by line, smile fixed, and he signs with a flourish and a fat tip to prove he wasn\'t cheap.',
    botched: 'He disputes every line, you blink first, and the tip evaporates along with your patience.' },
  { id: 'spill', verb: 'douse', stat: 'reflexes', difficulty: 6,
    prompt: 'Someone knocked a candle into a napkin pile on the VIP rail. <b>douse</b> it before the bottle service goes up.',
    nailed: 'You smother it with a bar towel in one motion, barely breaking stride. Nobody in VIP even looks up.',
    botched: 'It catches. A flare, a shriek, a very expensive bottle of nothing — and security glaring at you.' },
  { id: 'vip', verb: 'soothe', stat: 'cool', difficulty: 5,
    prompt: 'A regular high-roller feels ignored and is loudly threatening to take his money to Voltage\'s rival. <b>soothe</b> him.',
    nailed: 'You comp him a top-shelf pour, remember his usual, and laugh at his terrible joke. He settles in for the night.',
    botched: 'You say the wrong name. He deflates, closes out, and takes his whole entourage with him.' },
  { id: 'brawl', verb: 'bounce', stat: 'brawn|cool', difficulty: 7,
    prompt: 'Two drunks are squaring up over a spilled drink and the crowd\'s starting to circle. <b>bounce</b> it — muscle or mouth.',
    nailed: 'You get between them, big and calm, and talk it down to a handshake before a fist flies. The floor barely notices.',
    botched: 'It goes off. Glass, a table, a scream — and the whole floor\'s energy curdles for the rest of the night.' },
];

// Named event pools a venue can select via flags.work_venue.pool.
const POOLS = { diner: DINER_EVENTS, bar: BAR_EVENTS };

// Every verb any pool uses — so off-shift no-op wrappers cover them all. Kept as
// a union so adding a pool never silently drops a verb from the set.
const VERBS = new Set([...DINER_EVENTS, ...BAR_EVENTS].map(e => e.verb));

// ── Dice / checks ─────────────────────────────────────────────────────────────
function roll2d8() { return Math.floor(Math.random() * 8) + 1 + Math.floor(Math.random() * 8) + 1; }

function statValue(player, stat) {
  if (stat === 'brawn|cool') return Math.max(statValue(player, 'brawn'), statValue(player, 'cool'));
  const v = player[`stat_${stat}`];
  return Number.isFinite(v) ? v : 3;
}

// 2d8-2d8 swing vs a difficulty, same feel as engine skill checks — close
// matchups are coin-flippy, and the XP-gated audience (raised Reflexes/Cool)
// wins more of them, which is the whole point of the rush.
function statCheck(player, stat, difficulty) {
  return (statValue(player, stat) - difficulty) + (roll2d8() - roll2d8()) >= 0;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function tipFor(sat) { return Math.round(TIP_MAX * Math.max(0, sat - 40) / 60); }

function out(pid, message) { sendToPlayer(pid, { type: 'output', message }); }

// ── Venue lookup (content-driven) ─────────────────────────────────────────────
function venueOf(zone) {
  const v = zone?.flags?.work_venue;
  return v && typeof v === 'object' ? v : null;
}

// Every zone in the world currently posting shift work (in-memory scan — the live
// world Maps, never a query; this is exactly the read-tier the hot-path rule wants).
function allVenues() {
  const list = [];
  for (const zone of world.zones.values()) {
    const v = venueOf(zone);
    if (v) list.push({ zone, venue: v });
  }
  return list;
}

// ── Shift lifecycle ───────────────────────────────────────────────────────────
function eventPool(venue) {
  if (Array.isArray(venue.events) && venue.events.length) return venue.events;
  return POOLS[venue.pool] || DINER_EVENTS;
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function enqueueEvent(st) { st.queue.push({ ...pick(eventPool(st.venue)), rush: false }); }
function enqueueRush(st) {
  const pool = eventPool(st.venue);
  for (let i = 0; i < 3; i++) st.queue.push({ ...pick(pool), rush: true });
  st.rushDone = true;
}

// Pop the next queued event and arm its window.
function fireNext(player, st) {
  const ev = st.queue.shift();
  if (!ev) return;
  st.pending = { ...ev, expiresAt: Date.now() + (ev.rush ? RUSH_WINDOW_MS : EVENT_WINDOW_MS) };
  const banner = ev.rush ? '<span class="text-yellow">RUSH — </span>' : '';
  out(player.id, `<span class="msg-system">${banner}${ev.prompt}</span>`);
}

// A window expired with no response — the worst outcome.
function ignoreEvent(player, st) {
  const ev = st.pending;
  st.pending = null;
  st.satisfaction = clamp(st.satisfaction + SAT_IGNORE, 0, 100);
  out(player.id, `<span class="text-red">You never got to it. ${ev.verb === 'douse' ? 'The fire has its way for a moment before it dies down.' : 'The moment passes, and not in your favour.'}</span>`);
  if (st.queue.length) fireNext(player, st);
  else if (st.satisfaction < SAT_FLOOR) endShift(player, 'sent_home');
}

// Manager's flat wage for this venue.
function wageOf(st) { return Number(st.venue.wage) || DEFAULT_WAGE; }

function endShift(player, reason) {
  const st = player.shiftState;
  if (!st) return;
  player.shiftState = null; // clear first so the posture.changed handler no-ops
  if (getPosture(player) === 'working') forceStand(player, 'work.end');

  const worked = clamp((Date.now() - st.startedAt) / (T.shiftSecs() * 1000), 0, 1);
  const sat = Math.round(st.satisfaction);
  const wage = wageOf(st);
  let pay, tips = 0, headline;

  if (reason === 'completed') {
    pay = wage; tips = tipFor(sat);
    headline = 'Shift over. Gus racks the spatula and thumbs your pay across the counter.';
  } else if (reason === 'sent_home') {
    pay = Math.round(wage * worked * 0.5); tips = 0;
    headline = '<span class="text-red">"Go home."</span> Gus doesn\'t look up. "You\'re costing me more than you\'re making. Half for the hours, no tips. Try again when you\'ve got the legs for it."';
  } else { // clocked_out, or walked off (moved/interrupted)
    pay = Math.round(wage * worked * 0.85); tips = tipFor(sat);
    headline = reason === 'clocked_out'
      ? 'You untie the apron and clock out. Gus counts out the hours you worked.'
      : 'You walk off mid-shift. Gus watches you go and docks you for the trouble.';
  }
  const total = pay + tips;
  if (total > 0) adjustCredits(player, total, undefined, 'work:shift');

  const parts = [`<span class="msg-system">${headline}</span>`];
  parts.push(`<span class="msg-system">Wage ${pay}₵${tips ? ` + tips ${tips}₵` : ''} = <b>${total}₵</b>. (Table satisfaction ${sat}%.)</span>`);
  out(player.id, parts.join('\n'));
  sendToZone(st.zoneId, { type: 'zone_event', message: `${player.handle} clocks out.` }, player.id);

  // You have now held a job. Content gates on this — Marta withholds her "so what
  // are you going to be?" until it's set, because the question means nothing asked
  // of someone who has never worked a day. Only the two endings you chose count:
  // being thrown off the floor or wandering away mid-shift aren't holding a job.
  if (reason === 'completed' || reason === 'clocked_out') {
    setFlag('player', 'work_shift_done', 'true', player).catch(() => {});
  }
}

function getPosture(player) { return player.posture || 'standing'; }

// ── The tick — one loop for every clocked-in player (mirrors fishing) ──────────
let ticking = false;
async function workTick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const player of getAllLivePlayers()) {
      const st = player.shiftState;
      if (getPosture(player) !== 'working') {
        if (st) { const cur = getLivePlayer(player.id); if (cur) cur.shiftState = null; }
        continue;
      }
      if (!st) continue;
      // Safety: if the player somehow left the venue zone while 'working', end it.
      if (player.current_zone !== st.zoneId) { endShift(player, 'walked'); continue; }
      if (now >= st.endsAt) { endShift(player, 'completed'); continue; }

      if (st.pending) {
        if (now >= st.pending.expiresAt) ignoreEvent(player, st);
        continue;
      }
      if (st.queue.length) { fireNext(player, st); continue; }
      if (now - st.lastRoll < T.tickSecs() * 1000) continue;
      st.lastRoll = now;
      if (!st.rushDone && now >= st.rushAt) { enqueueRush(st); fireNext(player, st); }
      else if (Math.random() < T.eventChance()) { enqueueEvent(st); fireNext(player, st); }
    }
  } finally {
    ticking = false;
  }
}
schedule('1s', () => workTick().catch(e => console.error('[work] tick error:', e.message)));

// ── Event response (the shift verbs) ──────────────────────────────────────────
// serve / bill / douse / soothe / bounce all route here. They only mean anything
// while you're clocked in with a matching event live; otherwise a gentle nudge.
function resolveEvent(player, verb) {
  const st = player.shiftState;
  if (getPosture(player) !== 'working' || !st) {
    return { type: 'emote', message: 'You\'re not on a shift right now.' };
  }
  if (!st.pending) return { type: 'emote', message: 'Nothing needs that right this second. Stay sharp.' };
  if (st.pending.verb !== verb) {
    return { type: 'emote', message: `That\'s not what the floor needs — read the room and ${st.pending.verb} it.` };
  }
  const ev = st.pending;
  st.pending = null;
  const nailed = statCheck(player, ev.stat, ev.difficulty);
  st.satisfaction = clamp(st.satisfaction + (nailed ? SAT_NAILED : SAT_BOTCH), 0, 100);
  const line = nailed
    ? `<span class="item-grant">${ev.nailed}</span>`
    : `<span class="text-red">${ev.botched}</span>`;

  // Rush chain: keep the pressure on by firing the next queued event immediately.
  if (st.queue.length) { out(player.id, line); fireNext(player, st); return { type: 'noop' }; }
  // Otherwise a botch can drop us under the floor → sent home.
  if (st.satisfaction < SAT_FLOOR) { out(player.id, line); endShift(player, 'sent_home'); return { type: 'noop' }; }
  return { type: 'output', message: line };
}

// ── Commands ──────────────────────────────────────────────────────────────────
// `work` / `shift` / `shifts` — the discovery + status surface.
function cmdWork(args, raw, player) {
  if (!player) return { type: 'error', message: 'No character.' };
  if (getPosture(player) === 'working' && player.shiftState) {
    const st = player.shiftState;
    const left = Math.max(0, Math.round((st.endsAt - Date.now()) / 1000));
    return { type: 'output', message: `<span class="msg-system">You\'re on shift — ${st.venue.role || 'working'} (${Math.round(st.satisfaction)}% satisfaction, ${left}s left). Respond to what the floor throws at you, or \`clock out\` to leave.</span>` };
  }

  const here = venueOf(getZone(player.current_zone));
  if (here) {
    return { type: 'output', message:
      `<span class="msg-system">${here.name || 'This place'} is hiring a ${here.role || 'hand'}.</span>\n` +
      `<span class="text-dim">Wage about ${here.wage || DEFAULT_WAGE}₵ a shift, tips on top for good work. Type \`clock in\` to start. It takes real time and you can be sent home — don\'t start one you can\'t finish.</span>` };
  }
  const venues = allVenues();
  if (!venues.length) return { type: 'output', message: '<span class="text-dim">No steady work posted anywhere right now.</span>' };
  const lines = ['<span class="msg-system">Steady work is going at:</span>'];
  for (const { zone, venue } of venues) lines.push(`  <span class="text-dim">${venue.name || zone.name} — ${venue.role || 'hand'}, ~${venue.wage || DEFAULT_WAGE}₵/shift (${zone.name})</span>`);
  lines.push('<span class="text-dim">Get to one of these and type</span> <span class="msg-system">clock in</span>.');
  lines.push('<span class="text-dim">Or take a delivery run — type</span> <span class="msg-system">courier</span>.');
  return { type: 'output', message: lines.join('\n') };
}

// `clock in` / `clock out`
function cmdClock(args, raw, player, broadcast) {
  if (!player) return { type: 'error', message: 'No character.' };
  const sub = String((args && args[0]) || '').toLowerCase();

  if (sub === 'out') {
    if (getPosture(player) !== 'working' || !player.shiftState) return { type: 'emote', message: 'You\'re not clocked in anywhere.' };
    endShift(player, 'clocked_out');
    return { type: 'noop' };
  }
  if (sub !== 'in') return { type: 'emote', message: 'Type `clock in` to start a shift, or `clock out` to end one.' };

  if (getPosture(player) === 'working' && player.shiftState) return { type: 'emote', message: 'You\'re already on the clock.' };
  if (player.combatTargetId || player.pvpTargetId || player.npcCombatTargetId) return { type: 'emote', message: 'You\'re a little busy for a shift right now.' };
  if (getPosture(player) !== 'standing') return { type: 'emote', message: 'You need to be on your feet to clock in.' };

  const zone = getZone(player.current_zone);
  const venue = venueOf(zone);
  if (!venue) return { type: 'emote', message: 'There\'s no work to clock into here.' };

  const now = Date.now();
  const shiftMs = T.shiftSecs() * 1000;
  setPosture(player, 'working');
  player.shiftState = {
    zoneId: player.current_zone, venue,
    startedAt: now, endsAt: now + shiftMs,
    satisfaction: SAT_START, pending: null, queue: [],
    lastRoll: now, rushDone: false,
    rushAt: now + shiftMs * (0.45 + Math.random() * 0.1), // one rush, mid-shift
  };
  (broadcast || sendToZone)(player.current_zone, { type: 'zone_event', message: `${player.handle} ties on an apron and clocks in behind the counter.` }, player.id);
  return { type: 'output', message:
    `<span class="msg-system">You clock in as ${venue.role || 'a hand'}. ${Math.round(T.shiftSecs() / 60)} minutes on the floor.</span>\n` +
    `<span class="text-dim">Handle what comes at you — <b>serve</b>, <b>bill</b>, <b>douse</b>, <b>soothe</b>, <b>bounce</b> — before the moment passes. Keep the tables happy and the tips follow. Let it slide and you get cut.</span>` };
}

// The five event-response verbs — thin wrappers over resolveEvent.
function makeVerb(v) { return (args, raw, player) => resolveEvent(player, v); }

export const commands = {
  work: cmdWork,
  shift: cmdWork,
  shifts: cmdWork,
  clock: cmdClock,
  serve: makeVerb('serve'),
  bill: makeVerb('bill'),
  douse: makeVerb('douse'),
  soothe: makeVerb('soothe'),
  bounce: makeVerb('bounce'),
  // Courier archetype (plugins/work/courier.js).
  courier: courierVerb,
  runs: courierVerb,
  deliver: (args, raw, player) => deliver(player),
  crack: (args, raw, player) => crack(player),
};

// The fence's hot-run offer (OFFER_COURIER_HOT), fired from dialogue.
registerCourierAction();

// ── Interruptions end the shift (posture is authoritative) ────────────────────
// Any forced stand out of 'working' — a move, an attack, being attacked — pays
// you out for the hours worked and drops the shift. endShift clears shiftState
// BEFORE it force-stands, so its own forceStand re-entry through here no-ops.
on('posture.changed', ({ player, from, to }) => {
  if (from === 'working' && to !== 'working' && player.shiftState) endShift(player, 'walked');
});

on('player.stop', ({ player, stopped }) => {
  if (getPosture(player) === 'working' && player.shiftState) {
    endShift(player, 'clocked_out');
    stopped.push('working');
  }
});

// Pure helpers exposed for the regression suite (never used in production).
export const _test = { statCheck, statValue, tipFor, DINER_EVENTS, VERBS, resolveEvent, endShift, venueOf, allVenues, courier: _courierTest };

console.log('[work] Plugin loaded.');
