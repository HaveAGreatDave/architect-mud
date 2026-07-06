// bartender — brings bartender-personality NPCs to life behind the bar.
//
// The archetype already hands Lowry a pool of *canned* work chitchat; the engine
// fires it sparsely from the AT_WORK behaviour node. This plugin is the reactive
// layer on top: a ~30s tick that reads the LIVE room the bartender is standing in
// and reacts in character instead of at random —
//
//   • a first-week player walks in  → he clocks them, welcomes them by handle,
//     and drips real survival tips one at a time over the night
//   • a poker hand is running        → rail commentary that reads the actual pot
//   • the TV is on                   → he comments on what's actually airing
//   • Orion Dex is on the floor      → a rare, curated coworker back-and-forth
//     between the two of them (the bartender and the Embassy's house card dealer)
//   • otherwise                      → bar business: pouring, wiping, the patter
//
// It also registers three dialogue actions (BARTENDER_ADVICE / _TV / _POKER) so the
// same live reads answer when a player `talk`s to him and picks the matching option.
//
// Why the coworker banter lives HERE and not in the shared npc-banter engine: that
// engine excludes any NPC that's on-shift (isEligible → !vendor_was_working), and
// Lowry works the Embassy 24/7 — so it would never pair him with anyone. This tick
// is the one place that fires *while* he's behind the bar, which is exactly when the
// two of them are both on the floor. The pairing is hard-wired to Orion Dex.
//
// Scope: any NPC with flags.personality === 'bartender' who is on-shift at their
// bar with at least one player watching. Today that's Lowry at the Embassy; any
// future bartender inherits it for free. All state is in-memory (resets on
// restart) — a bartender's memory of who's new doesn't warrant a persisted Flag.

import { schedule } from '../../server/engine/scheduler.js';
import { world, getZonePlayers } from '../../server/engine/world.js';
import { isNpcAtWork, formatChitchat } from '../../server/engine/ai-behaviour.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { registerAction } from '../../server/engine/actions.js';
import { activeTables } from '../gametable/game-table.js';
import { getZoneNowPlaying } from '../broadcast/index.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
const NEW_PLAYER_MS     = 7 * 24 * 60 * 60 * 1000; // "first week or so"
const WELCOME_REPEAT_MS = 12 * 60 * 60 * 1000;     // re-greet a returning newcomer after this
const AMBIENT_GAP_MS    = 45_000;                  // min gap between ambient lines (not welcomes)
const WELCOME_MIN_GAP_MS = 8_000;                  // tiny anti-double-talk gap before a welcome
const SPEAK_CHANCE      = 0.65;                     // an eligible tick where he just works quietly

const ORION_ID          = 'npc_orion_dex';         // his coworker — the house card dealer
const COWORKER_GAP_MS   = 5 * 60 * 1000;           // keep the two-hander a rare treat, not a loop
const COWORKER_CHANCE   = 0.4;                      // ...and only sometimes when it's eligible
const COWORKER_TURN_MS  = [4500, 8000];            // random delay between turns of the exchange

// ── In-memory memory ──────────────────────────────────────────────────────────
const lastSpoke   = new Map(); // npcId    -> ms of his last line (any kind)
const welcomedAt  = new Map(); // playerId -> ms he last welcomed them
const tipsGiven   = new Map(); // playerId -> Set(tip index)
const coworkerAt  = new Map(); // npcId    -> ms the last coworker scene began
const sceneZones  = new Set(); // zoneIds with a coworker scene currently running

// ── Content ───────────────────────────────────────────────────────────────────
// Fully-quoted lines render as a yellow "Lowry says:" bubble; unquoted lines
// render as an emote ("Lowry wipes down the counter."). {name} → the guest's handle.

const WELCOMES = [
  `"Well. Fresh meat in a clean jacket. Welcome to the Embassy, {name} — Lowry's the name. You've got the look of someone who booted up about ten minutes ago."`,
  `"New face, and a green one. First week, unless I've lost my eye — and I haven't. Sit down, {name}. Let me point you at a few things before the basin does it the hard way."`,
  `"Valued guest, freshly minted. Welcome to the Embassy Lounge, {name}. Stick near the bar a while — I've kept more newcomers breathing than any clinic in this city."`,
];

// Ordered roughly by how soon a newcomer needs it. Every verb here is real.
const TIPS = [
  `"Word of advice, {name}: hunger and thirst kill more newcomers than bullets do. Keep something in your gut. The Swill's four credits and it counts as both."`,
  `"You die out here and whatever's in your pockets is anyone's, {name}. Whatever's in the bank is still yours. There's an ATM on the wall — 'deposit' before you go looking for trouble, not after."`,
  `"Cameras on every corner, and the law here doesn't do warnings, {name}. Build up enough heat and you'll wake in Precinct 9 with your gear in an evidence locker. Type 'wanted' if you want to know how deep you're in."`,
  `"Broke, {name}? Everyone starts broke. 'scavenge' the trash and the wastes for salvage, or check the job board — 'gigs' — for honest-ish work. Nobody out here got fed standing still."`,
  `"Bleeding's not a personality, {name}. Sit down, 'rest', let the body knit before you go swinging at things again. Dead men tip poorly."`,
  `"Check the 'map' before you wander, {name}. Some corners of this basin — the Redline, the deep wastes — will cook you or eat you before you've read the room. Green's for grass, not for you."`,
  `"Don't pick fights bare, {name}. 'look' at a thing before you 'attack' it, and 'equip' something between your skin and their edge. Armor's the difference between a scar and a corpse."`,
  `"Nobody here was born good at anything, {name}. You get better by doing — 'skills' and 'stats' show where you stand. The basin rewards the useful and buries the rest."`,
  `"Everything you do out here, somebody keeps score, {name}. Help the wrong crew, cross the right one — check 'rep' now and then. Grudges in this city have long memories and short fuses."`,
  `"You'll hear there's money in cooking and dealing, {name}. There is. There's also addiction, overdoses, and a manufacturing charge that puts the whole precinct on your back. Easy money out here bites."`,
  `"Pay first, trust later — that's policy, {name}, and it's good policy for you too. Somebody buys you a drink and calls you friend inside a minute? They're pricing your pockets."`,
  `"This bar's not the world, {name}, whatever it feels like at three in the morning. There's aircraft to fly, crews to run, a whole city under the city. Survive the first week and it all opens up."`,
];

const GRADUATION = [
  `"That's about all the free wisdom I've got, {name}. The rest you'll earn the way we all did — badly, and in public."`,
  `"You're asking sharper questions now, {name}. You'll do. Or you won't. Either way you're not my greenest guest anymore."`,
];

// Non-newcomer / veteran deflections for the dialogue "advice?" option.
const VETERAN_ADVICE = [
  `"Advice? You've got the calluses, {name}. You know how it works — keep breathing and keep paying."`,
  `"You don't need me holding your hand anymore. Drink up. That's the only tip that never expires."`,
  `"Same advice as ever: trust the room less than it wants you to. You've been here long enough to know I'm right."`,
];

const IDLE = [
  `wipes down the counter with a rag that's seen worse than you.`,
  `polishes a glass that was already clean.`,
  `lines up a fresh row of glasses nobody's asked for.`,
  `"What'll it be? The Reserve, if you're flush. The Swill, if you're honest."`,
  `"Canapés are complimentary with a drink. They are not, in any real sense, complimentary."`,
  `"Tab's running whether you drink or not. Might as well drink."`,
  `draws a slow pour of the Swill and slides it down the bar to no one in particular.`,
  `"Slow night. They're all slow nights. That's the business."`,
];

// ── Coworker banter (Lowry ⇄ Orion Dex) ─────────────────────────────────────────
// A curated back-and-forth between the bartender and the Embassy's house card
// dealer — two old hands running the same little vice-lounge, Lowry pouring the
// reasons to stay, Orion dealing the felt. Each thread is an ordered list of
// [who, line] turns; who is 'L' (Lowry) or 'O' (Orion). Same render convention as
// chitchat: a fully-"quoted" turn is a say bubble, an unquoted turn is an emote.
// These are unique to this pair — nobody else gets them.
const COWORKER = [
  [
    ['L', `"Slow night at the felt, Dex. You've dealt the same four regulars into the ground since sundown."`],
    ['O', `"They keep sitting down. I keep dealing. The chairs do half my work."`],
    ['L', `"The house takes its cut in blood, I take mine in drinks. Somewhere in the middle there's a living."`],
  ],
  [
    ['O', `squares the deck without looking up. "You're telling that story too loud again, Lowry."`],
    ['L', `"I tell it at the volume it's earned. You've worn the same face since this place had a roof worth the name."`],
    ['O', `"It's the only thing in here that's never lost me money."`],
  ],
  [
    ['L', `"Fresh one at the bar tonight, Dex. Green as they come."`],
    ['O', `"Send them over when they've found their legs. Not before. I don't take milk money — bad for repeat business."`],
  ],
  [
    ['L', `"How long's it been, you and me working this room?"`],
    ['O', `riffles the deck, bridges it, snaps it flat. "Long enough that neither of us tells the truth about it anymore."`],
    ['L', `"Valued colleague. Sincerity optional."`],
  ],
  [
    ['L', `"Pour you something? On the house. The house being me."`],
    ['O', `"Never on shift. A dealer with a drink in him is a dealer counting wrong."`],
    ['L', `"That's the most honest thing said in this building all week."`],
  ],
  [
    ['O', `"Two by the door have been nursing the same drink an hour. Watching the till, not the cards."`],
    ['L', `polishes a glass, eyes flicking to the door. "Noted. You deal — I'll keep the bad thoughts warm."`],
  ],
  [
    ['L', `"You deal them the cards, I pour them the reason to keep sitting there."`],
    ['O', `"Two halves of the same robbery. Difference is I make them sign for it."`],
  ],
  [
    ['O', `taps the felt twice, an old habit. "Quiet tonight."`],
    ['L', `"They're all quiet, Dex. That's the business."`],
    ['O', `"That's your line."`],
    ['L', `"Everything in here's on loan. The lines included."`],
  ],
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmt  = (line, name) => line.replace(/\{name\}/g, name || 'guest');
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// Play a coworker exchange turn-by-turn, re-validating before each line: both must
// still be on the floor, alive, and someone must still be around to witness it.
// Shares Lowry's lastSpoke clock so his solo ambient tick won't talk over the scene.
function playCoworkerScene(lowry, orion, zoneId, thread) {
  sceneZones.add(zoneId);
  let i = 0;
  const step = () => {
    const bothHere = lowry && orion && !lowry._dead && !orion._dead
      && lowry.zone_id === zoneId && orion.zone_id === zoneId;
    if (i >= thread.length || !bothHere || !getZonePlayers(zoneId).length) {
      sceneZones.delete(zoneId);
      return;
    }
    const [who, line] = thread[i++];
    const speaker = who === 'O' ? orion : lowry;
    sendToZone(zoneId, formatChitchat(speaker.name, line));
    const now = Date.now();
    lastSpoke.set(lowry.id, now);
    if (speaker._ai) speaker._ai.lastSay = now;
    if (i >= thread.length) { sceneZones.delete(zoneId); return; }
    setTimeout(step, randInt(COWORKER_TURN_MS[0], COWORKER_TURN_MS[1]));
  };
  step();
}

// ── Live reads ────────────────────────────────────────────────────────────────
function isNewPlayer(player) {
  const c = Number(player?.created_at);           // BIGINT → string over pg; epoch seconds
  return Number.isFinite(c) && c > 0 && (Date.now() - c * 1000) < NEW_PLAYER_MS;
}

function activePokerInZone(zoneId) {
  for (const t of activeTables.values()) {
    if (t.zoneId === zoneId && t.phase === 'InProgress' && t.game) return t;
  }
  return null;
}

function pokerLine(table) {
  const pot     = table.game?.pot || 0;
  const seated  = table.seats.filter(Boolean).length;
  const street  = (table.game?.community || []).length; // 0 pre-flop, 3 flop, 4 turn, 5 river
  if (street >= 5) return `"Cards are all out over there. Now we find out who was praying and who was counting."`;
  if (seated === 2) return `"Down to two at the table and the pot's getting fat. This is the part where somebody learns something about themselves."`;
  if (pot > 0) return `"Pot's up to ₵${pot} at the table. House doesn't take a cut — the house is me, and I take mine in drinks."`;
  return `nods toward the poker table, where a fresh hand's being dealt.`;
}

function tvLine(now) {
  if (now.program)      return `"They're running ${now.program} again. I've heard that jingle in my sleep. Sometimes I hum it while I pour."`;
  if (now.stationName)  return `"${now.stationName}'s on the set${now.number != null ? `, channel ${now.number}` : ''} — same loop as ever. It's not company, but it beats the quiet in here."`;
  return `glances up at the flickering set and shakes his head.`;
}

// Pull an unused tip for this player, marking it given. Returns { line } or null
// when they've heard them all. Shared by the ambient tick and BARTENDER_ADVICE so
// a player never gets the same tip twice across either path.
function nextTipFor(player) {
  const given = tipsGiven.get(player.id) || new Set();
  const unused = [];
  for (let i = 0; i < TIPS.length; i++) if (!given.has(i)) unused.push(i);
  if (!unused.length) return null;
  const idx = unused[Math.floor(Math.random() * unused.length)];
  given.add(idx);
  tipsGiven.set(player.id, given);
  return fmt(TIPS[idx], player.handle);
}

// ── Tick ──────────────────────────────────────────────────────────────────────
let ticking = false;
function bartenderTick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const npc of world.npcs.values()) {
      if (npc?.flags?.personality !== 'bartender') continue;
      if (!isNpcAtWork(npc)) continue;
      const zoneId = npc.zone_id;
      const players = getZonePlayers(zoneId);
      if (!players.length) continue;                 // never talk to an empty room
      const spoke = lastSpoke.get(npc.id) || 0;

      // 1) Prompt welcome for an ungreeted newcomer (bypasses the quiet-chance).
      const toWelcome = players.find(p =>
        isNewPlayer(p) && (now - (welcomedAt.get(p.id) || 0) > WELCOME_REPEAT_MS));
      if (toWelcome && now - spoke > WELCOME_MIN_GAP_MS) {
        welcomedAt.set(toWelcome.id, now);
        sendToZone(zoneId, formatChitchat(npc.name, fmt(pick(WELCOMES), toWelcome.handle)));
        lastSpoke.set(npc.id, now);
        continue;
      }

      // 1.5) Coworker banter — a rare, curated two-hander with Orion Dex when the
      // house dealer is on the same floor. Owns the tick when it fires; its own
      // long cooldown keeps it special rather than a loop.
      if (!sceneZones.has(zoneId) && now - spoke > AMBIENT_GAP_MS
          && now - (coworkerAt.get(npc.id) || 0) > COWORKER_GAP_MS
          && Math.random() < COWORKER_CHANCE) {
        const orion = world.npcs.get(ORION_ID);
        if (orion && !orion._dead && orion.zone_id === zoneId) {
          coworkerAt.set(npc.id, now);
          lastSpoke.set(npc.id, now);
          playCoworkerScene(npc, orion, zoneId, pick(COWORKER));
          continue;
        }
      }

      // 2) Ambient reaction — throttled, and sometimes he just works in silence.
      if (now - spoke < AMBIENT_GAP_MS) continue;
      if (Math.random() > SPEAK_CHANCE) continue;

      const buckets = [];
      const newcomer = players.find(isNewPlayer);
      if (newcomer) {
        const tip = nextTipFor(newcomer);            // drip a real tip, else graduate them
        buckets.push({ w: 3, line: tip || fmt(pick(GRADUATION), newcomer.handle) });
      }
      const table = activePokerInZone(zoneId);
      if (table) buckets.push({ w: 2, line: pokerLine(table) });
      const nowPlaying = getZoneNowPlaying(zoneId);
      if (nowPlaying) buckets.push({ w: 2, line: tvLine(nowPlaying) });
      buckets.push({ w: 2, line: pick(IDLE) });      // bar business — always available

      const total = buckets.reduce((s, b) => s + b.w, 0);
      let roll = Math.random() * total;
      let chosen = buckets[buckets.length - 1];
      for (const b of buckets) { roll -= b.w; if (roll <= 0) { chosen = b; break; } }
      if (chosen?.line) {
        sendToZone(zoneId, formatChitchat(npc.name, chosen.line));
        lastSpoke.set(npc.id, now);
      }
    }
  } finally {
    ticking = false;
  }
}

schedule('30s', bartenderTick);

// ── Dialogue actions (reactive — answer when a player talks to the bartender) ───
// Each returns a { type:'dialogue_line', text } that the dialogue handler appends
// to the node's spoken reply. They read the same live room as the tick.

registerAction({
  type: 'BARTENDER_ADVICE',
  handler: ({ actor }) => {
    if (!actor) return { type: 'dialogue_line', text: pick(VETERAN_ADVICE) };
    if (!isNewPlayer(actor)) return { type: 'dialogue_line', text: pick(VETERAN_ADVICE) };
    const tip = nextTipFor(actor);
    return { type: 'dialogue_line', text: tip || fmt(pick(GRADUATION), actor.handle) };
  },
});

registerAction({
  type: 'BARTENDER_TV',
  handler: ({ actor }) => {
    const now = actor && getZoneNowPlaying(actor.current_zone);
    if (!now) return { type: 'dialogue_line', text: `"Set's dark. Nobody's paying the power bill, and I'm not squinting at static for company."` };
    return { type: 'dialogue_line', text: tvLine(now) };
  },
});

registerAction({
  type: 'BARTENDER_POKER',
  handler: ({ actor }) => {
    const table = actor && activePokerInZone(actor.current_zone);
    if (!table) return { type: 'dialogue_line', text: `"Table's cold right now. Pull up a chair and start something — the house always appreciates the traffic."` };
    return { type: 'dialogue_line', text: pokerLine(table) };
  },
});

export const commands = {};

// Exposed for the regress suite.
export const _test = { isNewPlayer, nextTipFor, pokerLine, tvLine, bartenderTick, TIPS, tipsGiven, welcomedAt, lastSpoke, COWORKER, ORION_ID };
