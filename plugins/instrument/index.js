/**
 * INSTRUMENT — playable musical instruments, heard by the room.
 *
 * Furniture carrying `flags.instrument` (a voice name from the INSTRUMENTS table
 * in client/shared/procedural-sfx.js) can be sat down at and played, key by key,
 * by a real person at a real keyboard. Everyone else in the zone hears it.
 *
 * THE SHAPE OF IT, AND WHY
 *
 * A note is not a command. Every other player-driven surface in this game routes
 * back through `handleCommand`, and that is correct for a surface where the unit
 * of action is a decision — a bet, a move, a swing. It is wrong here: a player
 * noodling produces eight to twelve inputs a second, each of which would run the
 * blackout gate, the posture gate, SIFT and the dispatch table, and each of which
 * would print a line into the log. So notes arrive on their own thin ws route
 * (`instrument_note` in server/index.js) which does nothing but `emit` — the same
 * shape as `tv_watch` and `deck_watch`, for the same reason.
 *
 * THE SERVER DECIDES NOTHING ACOUSTIC. It relays `{instrument, note, velocity}`
 * and the ear rebuilds the voice locally (see the INSTRUMENTS table). That is the
 * procedural-audio contract, and here it is also a latency argument: the player's
 * OWN note sounds the instant the key goes down, client-side, before the server
 * has heard about it. A round trip between pressing a key and hearing it is the
 * difference between an instrument and a website.
 *
 * WHAT IS AUTHORITATIVE ANYWAY. The server owns who is at the instrument, whether
 * they are still in the room, and how fast they are allowed to play. It re-checks
 * all three on every single note rather than trusting the seat it handed out — a
 * client that keeps sending after walking away is the ordinary case (the panel's
 * keyup lands after the move), not an attack.
 *
 * NO SKILL, NO FUMBLES, DELIBERATELY. Every other action in the game rolls against
 * a stat. This one doesn't, and shouldn't: the skill being exercised is the
 * player's, sitting at their own keyboard, and rolling dice over it would mean
 * punishing someone for playing well. There is nothing to award IP for.
 */
import { getZoneFurniture, getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone, teachVerb } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { setPosture } from '../../server/engine/posture.js';
import { textMinigamesSync } from '../../server/engine/presentation.js';

// The voices the client knows how to build. Kept as a plain list rather than an
// import of the shared table: this is a VALIDATION set (is `flags.instrument`
// spelled right?), and the client falls back to piano for anything unknown, so a
// voice added there and not here still works — it just isn't advertised.
const VOICES = ['piano', 'rhodes', 'musicbox', 'pluck', 'organ'];

// What the room reads when somebody sits down. Keyed by voice so a rhodes in a
// bar doesn't get described as an upright.
const VOICE_NOUN = {
  piano: 'piano', rhodes: 'electric piano', musicbox: 'music box',
  pluck: 'strings', organ: 'organ',
};

// ── Who is sitting at what ───────────────────────────────────────────────────
// In memory only, and correctly so: a performance does not survive a restart any
// more than a conversation does, and there is nothing here worth a DB write.
// playerId -> { furnId, name, voice, zoneId, tokens, last, notes }
const seated = new Map();

// Rate limit. A token bucket rather than a flat interval, because real playing is
// bursty — a chord is four notes in the same millisecond and must not be thinned
// to one. RATE sustains faster than any human plays; BURST covers the chord.
const RATE = 14;   // notes per second sustained
const BURST = 24;  // notes that may land at once

function takeToken(s) {
  const now = Date.now();
  s.tokens = Math.min(BURST, s.tokens + ((now - s.last) / 1000) * RATE);
  s.last = now;
  if (s.tokens < 1) return false;
  s.tokens -= 1;
  return true;
}

// ── Notes ────────────────────────────────────────────────────────────────────
// Same grammar the shared audio code parses, checked here so a malformed note
// never reaches anybody else's speakers. Octave is clamped rather than rejected:
// the panel's transpose can walk off the end of a real keyboard, and silently
// bounding it is friendlier than an error nobody asked for.
const NOTE_RE = /^([A-Ga-g][#b]?)(-?\d)$/;

// Flats are spelled as sharps on the way out. The synth understands both, but
// the panel draws each black key once and looks it up by name — so a Db that
// stayed a Db would sound correctly and light nothing, which reads as a bug.
// One spelling on the wire, and the enharmonic is accepted on the way in.
const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

function normaliseNote(raw) {
  const m = NOTE_RE.exec(String(raw || '').trim());
  if (!m) return null;
  const oct = Math.max(0, Math.min(8, parseInt(m[2], 10)));
  const name = m[1][0].toUpperCase() + (m[1][1] === '#' ? '#' : m[1][1] ? 'b' : '');
  return (FLAT_TO_SHARP[name] || name) + oct;
}

function instrumentIn(zoneId) {
  return getZoneFurniture(zoneId).find(f => f.flags?.instrument);
}

function voiceOf(furn) {
  const v = String(furn?.flags?.instrument || '').toLowerCase();
  return VOICES.includes(v) ? v : 'piano';
}

function nounFor(voice) { return VOICE_NOUN[voice] || 'instrument'; }

// ── Sitting down and getting up ──────────────────────────────────────────────

function leave(player, { quiet = false } = {}) {
  const s = seated.get(player.id);
  if (!s) return false;
  seated.delete(player.id);
  sendToPlayer(player.id, { type: 'instrument_close' });
  if (!quiet) {
    sendToZone(s.zoneId, {
      type: 'zone_event',
      message: s.notes > 4
        ? `${player.handle} lets the last note fade and gets up from the ${nounFor(s.voice)}.`
        : `${player.handle} gets up from the ${nounFor(s.voice)}.`,
    }, player.id);
  }
  // Only stand them up if they are still sitting on the instrument — they may
  // have already stood for some other reason, which is how we got here.
  if (player.sittingOn === s.furnId) setPosture(player, 'standing');
  return true;
}

async function cmdPlay(args, raw, player, broadcast) {
  const sub = (args[0] || '').toLowerCase();

  if (sub === 'stop' || sub === 'off') {
    return leave(player)
      ? { type: 'output', message: 'You get up.' }
      : { type: 'error', message: "You aren't playing anything." };
  }

  const furn = instrumentIn(player.current_zone);
  if (!furn) return { type: 'error', message: "There's nothing here to play." };
  const voice = voiceOf(furn);

  // Already seated: bare `play` is a no-op that re-opens the panel (the player
  // closed it and wants it back), and `play <notes>` is the text route below.
  const already = seated.get(player.id);

  // ── The text route ────────────────────────────────────────────────────────
  // `play c4 e4 g4` — a written phrase rather than a played one. This exists so
  // the textgames rung isn't stranded, but it is unconditionally available:
  // it's also how a macro plays a riff, and how anyone tests a note.
  const tokens = args.filter(a => NOTE_RE.test(a));
  if (tokens.length) {
    if (!already) sit(player, furn, voice, { quiet: false, panel: false });
    const notes = tokens.slice(0, 32).map(normaliseNote).filter(Boolean);
    playPhrase(player, notes);
    return { type: 'output', message: `You pick out ${notes.join(' ')} on the ${furn.name.toLowerCase()}.` };
  }
  // Anything else in the arguments is STRAY WORDS, and is ignored rather than
  // refused. `play` arrives with the object name attached (`play black upright
  // piano`) from the examine Actions link and from the mobile smart bar, and it
  // also arrives as `play the piano` from people typing English. There is only
  // one instrument in a room to resolve against, so none of that is ambiguous —
  // erroring on it just means the advertised affordance doesn't work.

  if (already) { openPanel(player, furn, voice); return { type: 'output', message: `You settle back at the ${furn.name.toLowerCase()}.` }; }

  sit(player, furn, voice, { quiet: false, panel: true });

  const noun = nounFor(voice);
  const help = textMinigamesSync(player)
    ? `Type <span class="text-hl">play c4 e4 g4</span> to pick out a phrase, or ${teachVerb('play stop', 'play', 'stop')} to get up.`
    : `The keys are live — the two bottom rows of your keyboard are the two octaves, <span class="text-hl">Z</span> up through <span class="text-hl">M</span> and <span class="text-hl">Q</span> up through <span class="text-hl">P</span>, black keys on the row above. <span class="text-hl">←</span> and <span class="text-hl">→</span> shift octave. ${teachVerb('play stop', 'play', 'stop')} when you're done.`;
  return { type: 'output', message: `You sit down at the ${furn.name.toLowerCase()} and put your hands on it.<br>${help}` };
}

function sit(player, furn, voice, { quiet, panel }) {
  seated.set(player.id, {
    furnId: furn.id, name: furn.name, voice,
    zoneId: player.current_zone,
    tokens: BURST, last: Date.now(), notes: 0,
  });
  setPosture(player, 'sitting', { sittingOn: furn.id });
  if (!quiet) {
    sendToZone(player.current_zone, {
      type: 'zone_event',
      message: `${player.handle} sits down at the ${furn.name.toLowerCase()}.`,
    }, player.id);
  }
  if (panel) openPanel(player, furn, voice);
}

function openPanel(player, furn, voice) {
  sendToPlayer(player.id, {
    type: 'instrument_panel',
    furnId: furn.id,
    name: furn.name,
    voice,
    // The client needs no other configuration: the keyboard layout is the
    // client's own business (it is a property of the player's keyboard, not of
    // the furniture), and the voice is the only thing the world decides.
    text: textMinigamesSync(player),
  });
}

// A written phrase, spaced out so it reads as playing rather than as a chord.
// Bounded by the token slice above; each beat re-validates exactly like a live
// note does, so walking out mid-phrase stops it.
function playPhrase(player, notes) {
  notes.forEach((n, i) => {
    setTimeout(() => {
      const live = getLivePlayer(player.id);
      if (live) strike(live, n, 0.7);
    }, i * 260);
  });
}

// ── The hot path ─────────────────────────────────────────────────────────────
// One note. Called ~10x/second per player and does no I/O of any kind: three
// in-memory checks, a bucket decrement and a zone broadcast.
function strike(player, note, velocity) {
  const s = seated.get(player.id);
  if (!s) return false;
  // Re-validate rather than trust the seat. A player who walked out is the
  // ordinary case, not an exploit — their keyup arrives after the move.
  if (player.current_zone !== s.zoneId) { leave(player, { quiet: true }); return false; }
  if (!takeToken(s)) return false;

  s.notes++;
  sendToZone(s.zoneId, {
    type: 'instrument_note',
    playerId: player.id,
    voice: s.voice,
    note,
    velocity,
    // The furniture id lets a listener's own panel light up the right keys when
    // two instruments share a room. Cheap, and it is the only way to tell them
    // apart on the wire.
    furnId: s.furnId,
  }, player.id);   // excluded: the player already heard it, locally, with no latency
  return true;
}

// ── Wiring ───────────────────────────────────────────────────────────────────

// Notes off the thin ws route in server/index.js.
on('instrument.note', ({ playerId, note, velocity }) => {
  const player = getLivePlayer(playerId);
  if (!player) return;
  const n = normaliseNote(note);
  if (!n) return;
  const v = Math.max(0.05, Math.min(1, Number(velocity) || 0.75));
  strike(player, n, v);
});

// Leaving the room ends the performance — the same rule the mature layer's
// ongoing acts use, and for the same reason: you cannot keep doing a thing to a
// room you are not in.
on('zone.entered', ({ actor }) => {
  const s = actor && seated.get(actor.id);
  if (s && actor.current_zone !== s.zoneId) leave(actor, { quiet: true });
});

// `stop` stops this too, along with everything else it stops.
on('player.stop', ({ player }) => { if (player) leave(player, { quiet: true }); });

on('player.logout', ({ id }) => {
  const s = seated.get(id);
  if (!s) return;
  seated.delete(id);
  sendToZone(s.zoneId, { type: 'zone_event', message: `The ${nounFor(s.voice)} stops mid-phrase.` });
});

// Standing up by any other route (posture is an engine substrate; plenty of
// things force a stand) has to end this too, or the seat outlives the sitting.
on('posture.changed', ({ player, to }) => {
  if (player && to !== 'sitting' && seated.has(player.id)) leave(player, { quiet: true });
});

// Declaration-only (handler: null) — `play` is an ordinary command-map verb that
// self-resolves the instrument in the room. This entry exists purely so
// availableActions() advertises PLAY when you examine the piano; a verb you can
// only find by being told about it is invisible content.
export const specializedActions = [
  { verb: 'play', requiredFlag: 'instrument', handler: null },
];

export const commands = { play: cmdPlay };

// Exported for the regression suite, which drives notes without a socket.
export const _internals = { seated, strike, normaliseNote, takeToken, RATE, BURST, VOICES };
