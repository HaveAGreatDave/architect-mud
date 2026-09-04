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
// bar with at least one player watching. All state is in-memory (resets on
// restart) — a bartender's memory of who's new doesn't warrant a persisted Flag.
//
// Voices: the *reactive logic* is shared, the *words* are not. VOICES keys a
// per-bartender line set (welcomes, idle patter, coworker two-hander) off the NPC
// id, falling back to Lowry's. Without this every bartender in the world greets
// players to "the Embassy" in Lowry's name — so a new bar needs a VOICES entry,
// not a second copy of this plugin.

import { schedule } from '../../server/engine/scheduler.js';
import { world, getZonePlayers } from '../../server/engine/world.js';
import { isNpcAtWork, formatChitchat } from '../../server/engine/ai-behaviour.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { registerAction, dispatchAction } from '../../server/engine/actions.js';
import { activeTables } from '../gametable/game-table.js';
import { getZoneNowPlaying } from '../broadcast/index.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
const NEW_PLAYER_MS     = 7 * 24 * 60 * 60 * 1000; // "first week or so"
const WELCOME_REPEAT_MS = 12 * 60 * 60 * 1000;     // re-greet a returning newcomer after this
const AMBIENT_GAP_MS    = 45_000;                  // min gap between ambient lines (not welcomes)
const WELCOME_MIN_GAP_MS = 8_000;                  // tiny anti-double-talk gap before a welcome
const SPEAK_CHANCE      = 0.65;                     // an eligible tick where he just works quietly

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

const LOWRY_WELCOMES = [
  `"Well. Fresh meat in a clean jacket. Welcome to the Embassy, {name} — Lowry's the name. You've got the look of someone who booted up about ten minutes ago."`,
  `"New face, and a green one. First week, unless I've lost my eye — and I haven't. Sit down, {name}. Let me point you at a few things before the basin does it the hard way."`,
  `"Valued guest, freshly minted. Welcome to the Embassy Lounge, {name}. Stick near the bar a while — I've kept more newcomers breathing than any clinic in this city."`,
];

// Ordered roughly by how soon a newcomer needs it. Every verb here is real.
const TIPS = [
  `"Word of advice, {name}: hunger and thirst kill more newcomers than bullets do. Keep something in your gut. The cheap stuff's a few credits and it counts as both."`,
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

const LOWRY_GRADUATION = [
  `"That's about all the free wisdom I've got, {name}. The rest you'll earn the way we all did — badly, and in public."`,
  `"You're asking sharper questions now, {name}. You'll do. Or you won't. Either way you're not my greenest guest anymore."`,
];

// Non-newcomer / veteran deflections for the dialogue "advice?" option.
const LOWRY_VETERAN_ADVICE = [
  `"Advice? You've got the calluses, {name}. You know how it works — keep breathing and keep paying."`,
  `"You don't need me holding your hand anymore. Drink up. That's the only tip that never expires."`,
  `"Same advice as ever: trust the room less than it wants you to. You've been here long enough to know I'm right."`,
];

// A guest walks in wearing heat. Lowry runs a respectable house and does NOT want
// it — the Reach voice below inverts this, which is the whole point of the place.
const LOWRY_HEAT = [
  `"{name}. You're lit up like a signal fire and you brought it through my door. Drink fast."`,
  `wipes the same spot twice, eyes on the door behind you. "Whatever's chasing you — settle up before it arrives."`,
  `"I don't ask what you did. I do ask that you do the next one somewhere else."`,
];

const LOWRY_IDLE = [
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
const LOWRY_COWORKER = [
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

// ── Marla Kest ⇄ Ambrose "Doc" Teller (The Coyote's Rest, the Reach) ───────────
// The frontier mirror of Lowry & Orion: a bartender and a card dealer keeping the
// only lit room for a hundred miles. Where the Embassy pair trade in polish, these
// two trade in what nobody says out loud.
const MARLA_COWORKER = [
  [
    ['L', `"Quiet strip tonight, Doc. Nothing's come in since the light went."`],
    ['O', `squares the deck without looking up. "Something'll come in. Always does. That's what the strip is for."`],
    ['L', `"That's what I'm afraid of."`],
  ],
  [
    ['O', `"You water that bottle, Marla, or is it just old?"`],
    ['L', `"It's old. Everything out here's old. Including the joke."`],
  ],
  [
    ['L', `"New face at the bar, Doc. Flew in on their own wings."`],
    ['O', `"Then they've got money or they've got trouble. Sit them down either way — the felt sorts it out faster than you will."`],
  ],
  [
    ['O', `"Nobody's asked me for a marker in a month. Reach is getting honest."`],
    ['L', `pours without being asked. "Reach is getting broke. Different thing."`],
    ['O', `"From where I sit they pay the same."`],
  ],
  [
    ['L', `"You ever think about flying out, Doc?"`],
    ['O', `fans the deck one-handed, then folds it flat. "I thought about it once. Then I dealt myself a hand and stayed."`],
    ['L', `"That's not an answer."`],
    ['O', `"It's the one I've got."`],
  ],
  [
    ['O', `"Dust is coming. My knuckles say so."`],
    ['L', `"Your knuckles said so last week and we got nothing but heat."`],
    ['O', `"Then my knuckles are patient."`],
  ],
  [
    ['L', `"They come in here running from something. Every one of them."`],
    ['O', `"So did we, Marla."`],
    ['L', `wipes the bar down, slow. "So did we."`],
  ],
];

// ── Voices ────────────────────────────────────────────────────────────────────
// Per-bartender words behind the shared reactive logic. Keyed by NPC id; anyone
// unlisted gets Lowry's set (he's the original and the safe default).
const LOWRY_VOICE = {
  welcomes: LOWRY_WELCOMES,
  graduation: LOWRY_GRADUATION,
  veteranAdvice: LOWRY_VETERAN_ADVICE,
  heat: LOWRY_HEAT,
  idle: LOWRY_IDLE,
  coworkerId: 'npc_orion_dex',
  coworker: LOWRY_COWORKER,
};

const VOICES = {
  // Sully Holt — The Dead Pigeon, Coldwater. A dive with a back room, so his
  // read on heat is neither moral nor admiring: there is a PD street camera in
  // his bar (secdev_pd_zone_mq_pigeon_bar), he has never pretended otherwise,
  // and a wanted guest is a problem for his till rather than for his conscience.
  // No coworker keys — nobody else works the Pigeon, and the tick guards on
  // coworkerId, so omitting them is the whole opt-out.
  npc_barkeep: {
    welcomes: [
      `"New face. New faces drink the swill until they can afford not to." <span class="text-dim">He is already pouring one.</span> "Sully. Sit anywhere that holds."`,
      `"You've got that look, {name}. Vat-fresh, and reading every sign in here twice."`,
      `sets a glass down without being asked. "Four credits. Welcome to the Pigeon. Don't ask about the pigeon."`,
    ],
    graduation: [
      `"You've stopped counting your credits out on the bar, {name}. That's the graduation. Nobody claps."`,
      `"You come in, you order, you don't look at the camera. You'll do."`,
    ],
    veteranAdvice: [
      `"Advice? You know where the swill is and you know where the door is. That's the tour."`,
      `"Same as always, {name}. Bank it before you drink it."`,
      `"You've drunk here long enough to know what I sell, and long enough not to say it out loud."`,
    ],
    heat: [
      `"You're wearing stars, {name}." <span class="text-dim">He tips his head toward the corner without looking at it.</span> "So is that camera. Drink fast."`,
      `"I don't care what you did. I care that it's pointed at my till."`,
      `"Money's money and heat's heat, and only one of those gets my licence pulled."`,
      `pours yours a little short, which is the only opinion he intends to offer.`,
    ],
    idle: [
      `wipes a glass with a cloth that is making it worse.`,
      `"Swill's four, whiskey's nine, and the cocktail is fourteen and a decision."`,
      `"Espresso rig works. That surprises people more than it should."`,
      `looks up at the taxidermied pigeon, then back down, the way you check a clock.`,
      `"Tab's for regulars. You're not a regular until I say the word out loud."`,
      `"Somebody asked me once if the pigeon was a joke. He doesn't drink here now."`,
      `"If the back booth curtain's shut, it's shut. That's the whole sentence."`,
      `rings something into the till that you did not see change hands.`,
    ],
  },

  // Marla Kest — The Coyote's Rest, the Reach. A haven bartender: she doesn't
  // hand out survival tips so much as house rules, and heat on a guest is a
  // credential here rather than a problem.
  npc_1784515589442: {
    welcomes: [
      `"Haven't seen you before, and I see everybody. Marla. That's my bar you're leaning on, {name}."`,
      `"You came in by air, so you came in on purpose. Sit down, {name}. First one's poured straight."`,
      `"New, and still clean about the boots. Won't last." <span class="text-dim">She sets a glass in front of you anyway.</span>`,
    ],
    graduation: [
      `"You've stopped asking the green questions, {name}. That's the whole graduation. There's no certificate."`,
      `"You know where the door is and you know why nobody uses it. You'll keep."`,
    ],
    veteranAdvice: [
      `"Advice? You've been here long enough to know the Reach doesn't give any. It just watches."`,
      `"Same as ever, {name}: fly in clean, drink slow, and don't ask whose crates those are."`,
      `"You want advice, ask Doc. He'll deal you a hand and call it wisdom."`,
    ],
    // Inverted heat read — this is the haven's thesis. Wanted elsewhere is a
    // reference here, not a liability.
    heat: [
      `"You've got heat on you, {name}. Out there that's a problem." <span class="text-dim">She fills your glass a little past the line.</span> "In here it's a reference."`,
      `"Somebody wants you badly enough to put stars on it. Good. Means you're not a tourist."`,
      `nods at you, unbothered. "Whatever they've got you for, it doesn't have wings. Sit down."`,
      `"Half this room came in hotter than you, {name}. The other half's lying about it."`,
    ],
    idle: [
      `wipes the bar with a rag that's mostly holes.`,
      `"Kitchen's whatever's in the tin. The tin's whatever came in on the last plane."`,
      `holds a glass up to the lamp, decides it's clean enough, sets it down.`,
      `"Tab's cash. There's no bank out here and I wouldn't trust one if there was."`,
      `"Music's the same three songs. Nobody's flown a new one in since spring."`,
      `pours a measure for herself, thinks better of it, and puts it back in the bottle.`,
      `"You hear an engine, you look up. Everybody here does it. You will too, give it a week."`,
      `"Don't go out past the last light. There's nothing out there but scrub, and the scrub's got nothing but patience."`,
    ],
    coworkerId: 'npc_reach_dealer',
    coworker: MARLA_COWORKER,
  },
};

const voiceFor = (npc) => VOICES[npc?.id] || LOWRY_VOICE;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmt  = (line, name) => line.replace(/\{name\}/g, name || 'guest');
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// Play a coworker exchange turn-by-turn, re-validating before each line: both must
// still be on the floor, alive, and someone must still be around to witness it.
// Shares Lowry's lastSpoke clock so his solo ambient tick won't talk over the scene.
function playCoworkerScene(barkeep, mate, zoneId, thread) {
  sceneZones.add(zoneId);
  let i = 0;
  const step = () => {
    const bothHere = barkeep && mate && !barkeep._dead && !mate._dead
      && barkeep.zone_id === zoneId && mate.zone_id === zoneId;
    if (i >= thread.length || !bothHere || !getZonePlayers(zoneId).length) {
      sceneZones.delete(zoneId);
      return;
    }
    const [who, line] = thread[i++];
    const speaker = who === 'O' ? mate : barkeep;
    sendToZone(zoneId, formatChitchat(speaker.name, line));
    const now = Date.now();
    lastSpoke.set(barkeep.id, now);
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
//
// Keyed per bartender: hearing Lowry out shouldn't leave Marla with nothing to say.
function nextTipFor(player, npcId = '') {
  const key = `${npcId}:${player.id}`;
  const given = tipsGiven.get(key) || new Set();
  const unused = [];
  for (let i = 0; i < TIPS.length; i++) if (!given.has(i)) unused.push(i);
  if (!unused.length) return null;
  const idx = unused[Math.floor(Math.random() * unused.length)];
  given.add(idx);
  tipsGiven.set(key, given);
  return fmt(TIPS[idx], player.handle);
}

// Current (decayed) wanted stars, via the surveillance plugin's cross-plugin seam.
// In-memory Map read — no DB round trip, safe in a 30s tick.
async function starsFor(player) {
  try {
    const r = await dispatchAction({ type: 'WANTED_STARS', actor: player, params: {}, context: {} });
    return Number(r?.stars) || 0;
  } catch { return 0; }
}

// First player in the room carrying real heat (1★+), or null.
async function firstWantedIn(players) {
  for (const p of players) if (await starsFor(p) >= 1) return p;
  return null;
}

// ── Tick ──────────────────────────────────────────────────────────────────────
let ticking = false;
async function bartenderTick() {
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
      const voice = voiceFor(npc);
      const spoke = lastSpoke.get(npc.id) || 0;

      // 1) Prompt welcome for an ungreeted newcomer (bypasses the quiet-chance).
      const toWelcome = players.find(p =>
        isNewPlayer(p) && (now - (welcomedAt.get(`${npc.id}:${p.id}`) || 0) > WELCOME_REPEAT_MS));
      if (toWelcome && now - spoke > WELCOME_MIN_GAP_MS) {
        welcomedAt.set(`${npc.id}:${toWelcome.id}`, now);
        sendToZone(zoneId, formatChitchat(npc.name, fmt(pick(voice.welcomes), toWelcome.handle)));
        lastSpoke.set(npc.id, now);
        continue;
      }

      // 1.5) Coworker banter — a rare, curated two-hander with this bar's other
      // old hand when they're on the same floor. Owns the tick when it fires; its
      // own long cooldown keeps it special rather than a loop.
      if (!sceneZones.has(zoneId) && now - spoke > AMBIENT_GAP_MS
          && now - (coworkerAt.get(npc.id) || 0) > COWORKER_GAP_MS
          && Math.random() < COWORKER_CHANCE) {
        const mate = voice.coworkerId ? world.npcs.get(voice.coworkerId) : null;
        if (mate && !mate._dead && mate.zone_id === zoneId) {
          coworkerAt.set(npc.id, now);
          lastSpoke.set(npc.id, now);
          playCoworkerScene(npc, mate, zoneId, pick(voice.coworker));
          continue;
        }
      }

      // 2) Ambient reaction — throttled, and sometimes they just work in silence.
      if (now - spoke < AMBIENT_GAP_MS) continue;
      if (Math.random() > SPEAK_CHANCE) continue;

      const buckets = [];
      const newcomer = players.find(isNewPlayer);
      if (newcomer) {
        const tip = nextTipFor(newcomer, npc.id);    // drip a real tip, else graduate them
        buckets.push({ w: 3, line: tip || fmt(pick(voice.graduation), newcomer.handle) });
      }
      // A guest wearing stars — the one live read that says what kind of house
      // this is. Weighted high because it's rare and it's the whole character.
      const hot = await firstWantedIn(players);
      if (hot) buckets.push({ w: 3, line: fmt(pick(voice.heat), hot.handle) });
      const table = activePokerInZone(zoneId);
      if (table) buckets.push({ w: 2, line: pokerLine(table) });
      const nowPlaying = getZoneNowPlaying(zoneId);
      if (nowPlaying) buckets.push({ w: 2, line: tvLine(nowPlaying) });
      buckets.push({ w: 2, line: pick(voice.idle) }); // bar business — always available

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
  handler: ({ actor, context }) => {
    const voice = voiceFor(context?.npc);
    const deflect = () => ({ type: 'dialogue_line', text: fmt(pick(voice.veteranAdvice), actor?.handle) });
    if (!actor || !isNewPlayer(actor)) return deflect();
    const tip = nextTipFor(actor, context?.npc?.id || '');
    return { type: 'dialogue_line', text: tip || fmt(pick(voice.graduation), actor.handle) };
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
export const _test = { isNewPlayer, nextTipFor, pokerLine, tvLine, bartenderTick, TIPS, tipsGiven, welcomedAt, lastSpoke, voiceFor, VOICES, LOWRY_VOICE };
