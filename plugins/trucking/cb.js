// THE CB — the radio as a channel people actually talk on.
//
// The set was already in the cab: `cbLine` (state.js) has been putting voices on the corridor since
// phase 1, and every one of them was ours. This is the half where the voice is somebody else's.
//
// FOUR DECISIONS SHAPE IT, and each one is a decision not to build something bigger:
//
//  1. THE SET IS IN THE TRUCK, AND THAT IS THE WHOLE ACCESS RULE. A listener is a rig in `rigs`
//     with the radio on, tuned to your channel — nothing else. There is no membership table, no
//     subscribe/unsubscribe, no per-player row, and no way to be on the air while standing in a
//     bar: mounting puts you on it and dismounting takes you off, because the state that decides
//     is state the drive already keeps. `getPlayerChannels` (server/engine/channels.js) is
//     deliberately NOT touched — that list is computed once at login and a radio you are on for
//     eleven minutes of a crossing is not a thing to hand somebody at login.
//
//  2. IT IS RAM-ONLY AND NOTHING IS REPLAYED. A CB is live: what was said while you were off the
//     air is gone. So no `channel_messages` row, no history query, no write on a path players
//     will absolutely spam — the same call `docs/systems-nullcraft.md` makes about trace, for the
//     same reason. The scrollback the tablet window shows is the CLIENT's copy of what it has
//     heard this session, which is exactly what a radio gives you.
//
//  3. CHANNELS ARE 1-40 AND EVERYBODY STARTS ON 19. A frequency nobody can guess is a frequency
//     nobody is ever on, so the real CB convention does the discovery for us: 19 is where the
//     traffic is, 9 reads as the emergency channel to anyone who has ever seen a film about
//     trucks, and the other thirty-eight are private rooms you have to TELL somebody about. That
//     last part is the point — a channel number is a thing you say out loud on 19.
//
//  4. EVERY LINE REACHES THE LOG. The wire message is one `cb_msg` and the client feeds it to
//     three sinks (the log, the Deadhead window, the speaker). It is not a `channel_msg`, which
//     goes to the chat panel and nowhere else: the display-mode contract is that if a system's
//     record does not reach the log, the bottom rung is not done for it, and a radio you cannot
//     hear at the log rung would be a radio for some players only.
import { sendToPlayer } from '../../server/engine/messaging.js';
import { getLivePlayer } from '../../server/engine/world.js';
import { rigs } from './state.js';

export const CB_MIN = 1;
export const CB_MAX = 40;
export const CB_DEFAULT = 19;      // where everybody starts, and therefore where everybody is
export const CB_EMERGENCY = 9;     // said, never enforced — see below

// Anti-flood. A CB with no limiter is a wall of text arriving in somebody else's cab while they
// are trying to drive, and unlike a chat window there is no way to look away from it. Deliberately
// generous enough that a conversation is a conversation.
const SEND_GAP_MS = 1200;
const MAX_LEN = 240;

export const clampChan = (n) => Math.max(CB_MIN, Math.min(CB_MAX, Math.round(Number(n) || CB_DEFAULT)));

// The set's state, all of it, derived from the rig it is bolted into. `cbOff` is the field that
// already existed (the squelch), and it keeps its polarity so nothing that reads it changes.
export const cbState = (rig) => ({
  on: !rig.cbOff,
  chan: clampChan(rig.cbChan ?? CB_DEFAULT),
  spk: !!rig.cbSpeaker,
});

// Who is listening on a channel, right now. Sync, no queries, and one pass over a Map that is
// already in memory — this runs on a transmission, not on a tick, but a corridor full of rigs is
// still not a thing to go to Postgres about.
function listeners(chan, exceptPlayerId = null) {
  const out = [];
  for (const rig of rigs.values()) {
    if (rig.playerId === exceptPlayerId) continue;
    if (rig.cbOff) continue;
    if (clampChan(rig.cbChan ?? CB_DEFAULT) !== chan) continue;
    const p = getLivePlayer(rig.playerId);
    if (p) out.push({ player: p, rig });
  }
  return out;
}

// How many other sets are tuned here. The one piece of information a radio genuinely owes you:
// talking into a dead channel and talking into a live one must not feel the same.
export function cbAudience(rig) {
  return listeners(clampChan(rig.cbChan ?? CB_DEFAULT), rig.playerId).length;
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// One line, to one set. `self` is what lets the client show your own transmission without waiting
// for it to come back off the air, and lets the Deadhead window right-align it.
function deliver(playerId, { chan, from, message, self = false, kind = 'voice' }) {
  sendToPlayer(playerId, { type: 'cb_msg', chan, from, message, self, kind });
}

// ── Transmitting ─────────────────────────────────────────────────────────────
// The radio is not a command that reports success: everybody who hears it hears the same line, and
// the sender hears it too, from their own set. That symmetry is why there is one `deliver` and the
// sender is just another recipient with `self` set.
export function cbTransmit(player, rig, text) {
  const msg = String(text || '').trim().slice(0, MAX_LEN);
  if (!msg) return { type: 'error', message: 'Say what? <span class="text-dim">cb &lt;what you want to say&gt;</span>' };
  if (rig.cbOff) {
    return { type: 'error', message: 'The set is off. <span class="text-dim">cb on</span> first.' };
  }
  const now = Date.now();
  if (now - (rig.cbSentAt || 0) < SEND_GAP_MS) {
    return { type: 'error', message: '<span class="text-dim">You are still keyed down. Let go of the mic for a second.</span>' };
  }
  rig.cbSentAt = now;

  const chan = clampChan(rig.cbChan ?? CB_DEFAULT);
  const from = player.handle;
  const body = esc(msg);
  const heard = listeners(chan, player.id);
  for (const { player: other } of heard) deliver(other.id, { chan, from, message: body });
  deliver(player.id, { chan, from, message: body, self: true });
  return { type: 'noop' };
}

// ── The knob ─────────────────────────────────────────────────────────────────
// Tuning is silent to everybody else — there is no "X has joined" line, because a radio does not
// announce you and because a channel you can watch people arrive on is a channel nobody can
// listen to quietly. What you get instead is the count, which answers the only question tuning
// raises: is there anybody on this one.
export function cbTune(player, rig, n) {
  const chan = clampChan(n);
  const same = chan === clampChan(rig.cbChan ?? CB_DEFAULT);
  rig.cbChan = chan;
  if (rig.cbOff) rig.cbOff = false;          // tuning a set you turned off is asking for it back
  const others = cbAudience(rig);
  const room = others === 0
    ? 'Nothing on it but the hiss.'
    : others === 1 ? 'One other set is up here.' : `${others} other sets are up here.`;
  const note = chan === CB_EMERGENCY
    ? ' <span class="text-amber">Nine is the one people shout for help on. Try not to be the reason it is busy.</span>'
    : '';
  return {
    type: 'output',
    message: `<span class="text-dim">${same ? 'You are already on' : 'The dial clicks round to'} `
      + `<b>channel ${chan}</b>. ${room}</span>${note}`,
    cb: cbState(rig),
  };
}

// ── The speaker ──────────────────────────────────────────────────────────────
// A switch on the set that reads incoming traffic out loud. It is NOT the log reader
// (client/game/js/logreader.js) turned on for everything — it borrows that module's voice and
// queue for CB traffic only, which is the difference between "read me the game" and "read me the
// radio while I watch the road". A driver whose eyes are on the windscreen is exactly the person
// who cannot also be reading a chat window, so this is an accessibility feature that happens to
// be the most natural thing in the world to have on a truck radio.
export function cbSpeaker(player, rig, want = null) {
  rig.cbSpeaker = want == null ? !rig.cbSpeaker : !!want;
  return {
    type: 'output',
    message: rig.cbSpeaker
      ? '<span class="text-dim">You thumb the speaker on. The set will read out what comes in.</span>'
      : '<span class="text-dim">Speaker off. The set goes back to being something you have to look at.</span>',
    cb: cbState(rig),
  };
}

export function cbPower(player, rig, want = null) {
  rig.cbOff = want == null ? !rig.cbOff : !want;
  return {
    type: 'output',
    message: rig.cbOff
      ? '<span class="text-dim">You turn the squelch all the way up and the cab goes quiet.</span>'
      : `<span class="text-dim">You bring the CB back up on <b>channel ${clampChan(rig.cbChan ?? CB_DEFAULT)}</b>. `
        + `${cbAudience(rig) ? 'Somebody is already mid-argument.' : 'Nothing on it yet.'}</span>`,
    cb: cbState(rig),
  };
}

// `cb` with nothing after it. A status line rather than a toggle, because the set now has three
// controls and a toggle that flips one of them silently is a control you cannot check.
export function cbStatus(player, rig) {
  const s = cbState(rig);
  const others = cbAudience(rig);
  return {
    type: 'output',
    message: `<span class="text-dim">CB: <b>${s.on ? 'on' : 'off'}</b>, channel <b>${s.chan}</b>, `
      + `speaker <b>${s.spk ? 'on' : 'off'}</b>. `
      + `${s.on ? (others ? `${others} other set${others === 1 ? '' : 's'} listening.` : 'Nobody else up here.') : ''}</span>\n`
      + '<span class="text-dim">cb &lt;words&gt; to talk · cb 19 to tune · cb speaker · cb off</span>',
    cb: s,
  };
}
