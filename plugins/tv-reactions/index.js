/**
 * tv-reactions — somebody in the room answers the screen.
 *
 * The broadcast tick already emits `broadcast.message` for every beat it puts
 * into every room with a tuned device: the channel, the zone, the line itself,
 * and (since this plugin) the programme's name and its playback_mode. Nothing in
 * the game listened to it. This does.
 *
 * THE PLUGIN OWNS THE WHEN, AND THE WHEN IS THE WHOLE DESIGN. A television is
 * background, and a room where every line gets a comment is not a bar with a set
 * in the corner, it is a laugh track. So the restraint here is deliberate and it
 * matches the restraint the broadcast tick already shows on `broadcast_ambient`
 * (see the comment at that send: somebody ELSE's set leaks ONE line into the room
 * occasionally, on purpose):
 *
 *   • one reaction per zone per REACT_GAP_MS, whatever else airs in between
 *   • and even then, only REACT_CHANCE of the time
 *   • never on a studio floor, where the cast are SAYING the lines rather than
 *     watching them (the emit flags that with `onStage`)
 *   • never without a player in the room. A camera feed is somebody watching the
 *     ROOM, not watching the television with the NPCs, and an empty bar muttering
 *     at a game show into a spy cam is atmosphere nobody asked to pay for.
 *
 * Eligibility is not reimplemented. `eligibleNpcs()` is npc-banter's own export
 * (it exists precisely because ambient-life needed the same predicate), so a
 * sleeper, an NPC on shift, one mid-shop or mid-fight is out of this for exactly
 * the reasons they are out of banter. The chosen speaker's `_ai.lastSay` is both
 * read and written, which is what keeps this from talking over a running banter
 * scene: a participant mid-exchange has a fresh stamp and gets skipped.
 *
 * The lines are keyed on playback_mode, because the mode is the only thing that
 * reliably says what KIND of thing just happened. A groan belongs to a ball game
 * and not to a sermon, and the difference is most of why this is worth building
 * at all: a generic "shakes his head at the set" would have been the bartender's
 * existing tvLine() with more steps.
 */
import { on } from '../../server/engine/events.js';
import { world } from '../../server/engine/world.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { eligibleNpcs } from '../../server/engine/npc-banter.js';
import { formatChitchat } from '../../server/engine/ai-behaviour.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
const REACT_GAP_MS   = 150_000;      // quiet per zone after a reaction, whatever airs
const REACT_CHANCE   = 0.18;         // …and even then, mostly nothing
const SAY_GAP_MS     = 25_000;       // an NPC who just spoke stays quiet (shared with banter)
const BEAT_DELAY_MS  = [2200, 5200]; // land AFTER the line, like a person reacting to it

// Styles that aren't somebody talking. A title card or a music sting is not a
// thing to have an opinion about.
const MUTE_STYLES = new Set(['overlay', 'live_relay', 'title', 'theme', 'music', 'sample']);

// ── Voice ─────────────────────────────────────────────────────────────────────
// Quoted line → speech, bare line → emote. Same convention as banter and chitchat.
// {program} and {station} are filled from the beat; a pool entry that names one is
// skipped when the beat didn't carry it.
const MODE_LINES = {
  sports: [
    '"Oh, come ON."',
    'jabs a finger at the screen without looking away from it.',
    '"Watch. Watch. They are going to do the stupid thing." A pause. "There it is."',
    '"I had money on that. Not much money. Still money."',
    'makes a noise that is not quite a word and goes back to what they were doing.',
    '"Every year. Every single year with these people."',
  ],
  news: [
    '"They have been saying that all week. Nothing has happened all week."',
    '"Who exactly do they think is reassured by that."',
    'glances at the set, then very deliberately does not look at it again.',
    '"That is the third time tonight. Somebody in a booth is asleep on the tape."',
    '"Read it again slower and it still does not mean anything."',
  ],
  dynamic_news: [
    '"Wait, where was that? Did they say where that was?"',
    '"That is four streets from here."',
    'goes still for a second, listening, then shrugs it off.',
  ],
  gameshow: [
    '"I knew that one. I knew that one and they did not."',
    '"How do you not know that. How do you get on television and not know that."',
    'mouths the answer at the screen a full second before the contestant does.',
    '"For that? They are giving away money for THAT?"',
  ],
  talkshow: [
    '"Nobody talks like that. Nobody has ever talked like that."',
    '"He is going to laugh at his own line. Watch him laugh at his own line."',
    'snorts.',
    '"Somebody is being paid to sit there and be interested in that."',
  ],
  morning: [
    '"Too much smiling. It is not a smiling hour."',
    '"They do that voice at this time of day on purpose. It is a choice somebody makes."',
    'rubs their eyes and does not turn it off.',
  ],
  sermon: [
    'goes quiet while the set talks, which is more attention than the news gets.',
    '"My mother used to have that on. Same voice, near enough."',
    '"He is not wrong. He is not right either, but he is not wrong."',
    'looks at the floor until it is over.',
  ],
  film: [
    '"Oh, this bit. This is the good bit."',
    '"I have seen this one about nine times and I still do not know what she wanted."',
    'stops what they are doing for a moment, then remembers themselves.',
    '"They cut this on television. You never get the whole thing."',
  ],
  weather: [
    '"They said that yesterday too."',
    '"Whatever that is, it is already happening. I can hear it on the roof."',
    'looks at the window, then at the screen, then at the window again.',
  ],
  live_camera: [
    '"Is that live? That looks live."',
    'squints at the feed, trying to place the street.',
    '"Somebody is standing in a room somewhere with no idea we are all looking at them."',
  ],
  commercial: [
    '"I would buy that if I could afford that. I cannot afford that."',
    '"Nobody has ever been that pleased about anything."',
    'talks over the advert without noticing they have started doing it.',
  ],
};

// Anything with no pool of its own, plus the fallback when a mode-specific line
// wanted a token the beat did not carry.
const GENERIC_LINES = [
  'glances up at the set, then back down.',
  '"Is anyone actually watching this?"',
  '"Turn it up. No, do not turn it up. Leave it."',
  '"{program}. Again."',
  '"That is {station} all over."',
  'watches the screen for a moment with no expression at all.',
];

const rand    = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

// Fill {program}/{station}. Returns null when the line wants something this beat
// has no value for, exactly the way banter skips an unresolvable topical thread.
function resolveLine(line, beat) {
  let ok = true;
  const out = line.replace(/\{(program|station)\}/g, (m, key) => {
    const v = key === 'program' ? beat.programName : beat.stationName;
    if (!v) { ok = false; return m; }
    return v;
  });
  return ok ? out : null;
}

function pickLine(beat) {
  const pool = MODE_LINES[beat.mode] || [];
  for (let i = 0; i < 4; i++) {
    const src = pool.length && Math.random() < 0.85 ? pool : GENERIC_LINES;
    const line = resolveLine(rand(src), beat);
    if (line) return line;
  }
  return null;
}

// ── The listener ──────────────────────────────────────────────────────────────
const lastReactAt = new Map();   // zoneId → timestamp

function onBroadcastMessage(beat) {
  if (!beat || !beat.zoneId || !beat.text) return;
  if (beat.onStage) return;                            // the cast, not an audience
  if (MUTE_STYLES.has(beat.style)) return;

  const now = Date.now();
  if (now - (lastReactAt.get(beat.zoneId) || 0) < REACT_GAP_MS) return;

  // A player has to be in the room. Cheap, and it is also the whole point.
  const zone = world.zones.get(beat.zoneId);
  if (!zone || zone.players.size === 0) return;

  if (Math.random() > REACT_CHANCE) return;

  // eligibleNpcs already drops sleepers, on-shift staff, fighters and `no_banter`.
  // The only thing added here is the shared speech cooldown, which is also how a
  // running banter scene fences this out: its participants have a fresh lastSay.
  const candidates = eligibleNpcs(beat.zoneId)
    .filter(npc => now - (npc._ai?.lastSay || 0) >= SAY_GAP_MS);
  if (!candidates.length) return;

  const line = pickLine(beat);
  if (!line) return;

  const speaker = rand(candidates);
  // Claim the slot NOW, before the delay, or three beats landing inside the same
  // couple of seconds each queue their own reaction and the room answers the
  // television in chorus.
  lastReactAt.set(beat.zoneId, now);
  if (speaker._ai) speaker._ai.lastSay = now;

  setTimeout(() => {
    // Re-validate. Two seconds is long enough to leave the room, clock on, or die.
    if (!eligibleNpcs(beat.zoneId).some(n => n.id === speaker.id)) return;
    const z = world.zones.get(beat.zoneId);
    if (!z || z.players.size === 0) return;
    sendToZone(beat.zoneId, formatChitchat(speaker.name, line));
  }, randInt(BEAT_DELAY_MS[0], BEAT_DELAY_MS[1]));
}

on('broadcast.message', onBroadcastMessage);

export const commands = {};

// Exposed for the regress suite.
export const _test = { pickLine, resolveLine, onBroadcastMessage, lastReactAt, MODE_LINES, GENERIC_LINES, MUTE_STYLES };
