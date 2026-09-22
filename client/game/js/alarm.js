// Shop intruder alarm — client-side state.
//
// Two jobs, and they are deliberately in one small file rather than inside a
// panel, because neither is a panel: the alarm is something happening to the
// ROOM you are in, and it has to be legible whether or not any board is open.
//
// ── THE SOUND-OFF RULE ──────────────────────────────────────────────────────
// A timed feature whose only warning is a noise is INVISIBLE to a player with
// audio off — not harder, invisible — so the chirp prints a line when, and only
// when, sound is actually off. esp.js carries exactly this rule for the
// emergency siren and this is the same rule for the same reason; printing it
// unconditionally would have everyone with speakers reading a transcript of a
// sound they can already hear.
//
// It goes through the LOG, which is the one live region in this client, so a
// screen reader gets the countdown without anything being aria-wired here.
import { loadSettings } from '../../shared/settings.js';
import { appendMsg } from './render.js';

function soundOff() {
  const s = loadSettings();
  return !s?.audio?.enabled;
}

// Three bands, matching the server's own chirp cadence (4s / 2s / 1s). The words
// carry the urgency the acceleration carries for somebody who can hear it — which
// is the whole point: there is no number on screen, in either mode.
const CHIRP_LINES = [
  ['Somewhere in here, a panel chirps. Once. Unhurried.',
   'A single electronic chirp from a box on the wall.',
   'Chirp. A pause you could walk across. Chirp.'],
  ['The chirping has picked up. It is not waiting as long between them now.',
   'Chirp. Chirp. Closer together than they were.',
   'The panel is chirping faster. It has made up its mind about something.'],
  ['<span class="text-red">The chirps are almost running together now.</span>',
   '<span class="text-red">Chirp-chirp-chirp — no gap left in it at all.</span>',
   '<span class="text-red">The panel has stopped pausing between chirps. Whatever that means, it means it soon.</span>'],
];

let _last = -1;

function pick(lines) {
  let i;
  do { i = Math.floor(Math.random() * lines.length); } while (i === _last && lines.length > 1);
  _last = i;
  return lines[i];
}

export function handleAlarmChirp({ urgency = 0, muffled = false }) {
  if (!soundOff()) return;
  if (muffled) {
    // Heard from the street through a shutter. Deliberately vaguer — you know
    // something in there is counting and not how far along it is.
    appendMsg('Behind the shutter, something is chirping.', 'ambient');
    return;
  }
  const band = urgency >= 0.75 ? 2 : urgency >= 0.5 ? 1 : 0;
  appendMsg(pick(CHIRP_LINES[band]), 'ambient');
}

// ── The siren's look ────────────────────────────────────────────────────────
//
// esp.js's shape: one body class, and CSS does the rest.
//
// ⚠ NO STROBE. The photosensitivity rule the drug FX are held to applies to any
// flashing surface, and a real alarm strobe is exactly the thing it forbids — so
// the pane BREATHES, on a slow cycle, and the stylesheet drops even that under
// `prefers-reduced-motion`.
//
// ⚠ CLEARED ON EVERY WAY OUT, not just on disarm. Only the server knows when an
// alarm stopped mattering to you, and there is no timeout behind this: a missed
// clear is a player looking at a red room for the rest of the session. Leaving
// the zone, the alarm being killed, death and logout all end it.
export function applyAlarmState({ active }) {
  document.body.classList.toggle('shop-alarm', !!active);
  if (active && soundOff()) {
    appendMsg('The box on the wall opens up — a two-tone howl, rising and falling, and every light in here goes red.', 'ambient');
  }
}

export function clearAlarmState() {
  document.body.classList.remove('shop-alarm');
}
