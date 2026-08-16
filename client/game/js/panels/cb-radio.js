// THE CB — the client half. One arriving `cb_msg`, three places it has to land.
//
// THE RULE THIS FILE EXISTS TO KEEP: a transmission is ONE event with THREE SINKS, and no sink is
// allowed to be the only one. It goes to the log (so the bottom rung of Display Mode, the
// transcript, the find bar, triggers and a real screen reader all get it for free), to the
// Deadhead window (so it reads as a conversation rather than as scrolling weather), and to the
// speaker if the driver has thumbed it on. Building it as a chat message that ALSO gets logged, or
// as a log line that a window happens to scrape, would have made one of those three the truth and
// the other two a copy — and the copy is the one that silently stops working.
//
// WHY THE WINDOW IS NOT A NEW WINDOW. Chat conversations are owned by whisper.js, the floating
// panel, and the tablet's Chat app is already an embedder of that same state (getChatTabs /
// getChatMessages / sendChatMessage / onChatUpdate). So the CB registers itself there as a local
// conversation and gets the tab strip, the unread badge, the scrollback cap, the tablet rendering
// and the Users hub without any of them knowing what a radio is. The one thing it needs that a
// `#channel` does not do is send with a different verb — hence `registerLocalChannel`'s `send`.
//
// ⚠ THE TAB KEY CHANGES WHEN YOU TUNE. `#cb:19` and `#cb:21` are different conversations, on
// purpose: what you heard on 19 is not what is being said on 21, and merging them into one window
// would produce a transcript of two rooms with no way to tell which was which.
import { appendHtml } from '../render.js';
import { enqueueForReading } from '../logreader.js';
import { registerLocalChannel, dropLocalChannel, receiveChannelMsg, echoLocalChannel } from './whisper.js';
import { sendCmdSilent } from '../net.js';

export const CB_MIN = 1;
export const CB_MAX = 40;

// What the set is doing, as last told to us by the server. The client NEVER decides any of this —
// the knob sends a verb and waits, exactly as the hitch button does, because the set is in a truck
// on the server and a dial that moved locally would be lying about what channel you are on.
let cb = { on: true, chan: 19, spk: false, mounted: false };
const knobs = new Set();          // live knob widgets to repaint
const listeners = new Set();      // anything else that wants to know (the tablet tile)

export function cbStateNow() { return { ...cb }; }
export function onCbChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function announce() {
  for (const k of knobs) { try { k.paint(); } catch { /* a dead knob must not stop the rest */ } }
  for (const fn of listeners) { try { fn(cbStateNow()); } catch { /* ditto */ } }
}

export const cbTabKey = (chan = cb.chan) => `#cb:${chan}`;
const cbLabel = (chan) => `Deadhead ${chan}`;

// ── Mount / tune / unmount ───────────────────────────────────────────────────
// Driven entirely by `truck_ctx.cb`, which every cab push carries. That is deliberately the only
// input: there is no separate "you tuned" message to miss, and a client that reconnects mid-drive
// is correct on the first frame it receives.
export function applyCbContext(next) {
  if (!next) return;
  const before = { ...cb };
  cb = { on: !!next.on, chan: Number(next.chan) || 19, spk: !!next.spk, mounted: true };
  if (!before.mounted || before.chan !== cb.chan) {
    if (before.mounted && before.chan !== cb.chan) dropLocalChannel(cbTabKey(before.chan));
    ensureCbTab(cb.chan);
  }
  announce();
}

// Leaving the cab takes the set with it — the window closes because the radio is gone, not
// because anybody pressed anything.
export function clearCbContext() {
  if (cb.mounted) dropLocalChannel(cbTabKey(cb.chan));
  cb = { on: true, chan: 19, spk: false, mounted: false };
  announce();
}

// The conversation for a channel, created on demand.
//
// ⚠ IT IS CALLED FROM BOTH `applyCbContext` AND AN ARRIVING MESSAGE, and the second caller is the
// one that matters: a driver at the `textgames`/`log` rung is driving through textdrive.js, which
// pushes no cab context at all, so tuning alone would never open them a window. Traffic arriving
// is the event they definitely get, so that is what opens it. Same set, same channel, same
// conversation, with or without a windscreen.
function ensureCbTab(chan) {
  registerLocalChannel({
    id: cbTabKey(chan),
    label: cbLabel(chan),
    // A radio conversation cannot outlive the drive, so it is closable and not permanent.
    permanent: false,
    // THE REASON THIS SEAM EXISTS. Everything else in that panel sends `whisper <key> <text>`;
    // this sends the verb a player could have typed, which keeps the server's parse the only
    // parse and means the window can never do something the command line cannot.
    send: (text) => sendCmdSilent(`cb ${text}`),
  });
}

// ── The one arriving message ─────────────────────────────────────────────────
export function receiveCbMsg(msg) {
  const chan = Number(msg.chan) || cb.chan;
  ensureCbTab(chan);
  const from = msg.from || 'Somebody';
  const body = msg.message || '';
  const key = cbTabKey(chan);

  // 1. THE LOG. Always, and first, because this is the record. The class is its own so
  //    `trigger @cb …`, gagging, highlights and routing all treat the radio as a channel.
  appendHtml(
    `<span class="cb-tag">CB${chan === cb.chan ? '' : ` ${chan}`}</span> `
    + `<b>${msg.self ? 'You' : escapeHtml(from)}:</b> ${body}`,
    'cb',
  );

  // 2. THE WINDOW. Your own line is echoed rather than received, so it right-aligns as yours and
  //    is not mistaken for somebody else saying the same thing back to you.
  if (msg.self) echoLocalChannel(key, body);
  else receiveChannelMsg(key, from, body);

  // 3. THE SPEAKER. Never your own transmission — you know what you just said, and a radio that
  //    reads your own words back to you is a fault, not a feature. Routed through the log
  //    reader's queue so it obeys the same voice, rate, cap and drop-the-oldest rules; if the
  //    whole-log reader is also on, that module's own dedupe of `#output` is what stops a double
  //    read, which is why this goes through it rather than speaking directly.
  if (cb.spk && !msg.self) {
    enqueueForReading(`${from} on the CB says: ${stripTags(body)}`);
  }
}

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripTags = (s) => String(s ?? '').replace(/<[^>]*>/g, '');

// ── The knob ─────────────────────────────────────────────────────────────────
// A rotary channel selector, an ON/OFF and a SPKR switch, plus the set itself which opens the
// Deadhead window. It is a `spinbutton` because that is exactly what it is — a value with a range
// and a step — which gets arrow keys, Home/End and a correct screen-reader announcement without
// inventing a keyboard grammar. Drag and wheel are added on top for people using a mouse; neither
// is the only way to do anything.
//
// ⚠ NOTHING HERE MUTATES `cb`. Every control sends the verb and the dial moves when the server
// says it moved. The lag is real and it is the correct behaviour: a knob that snapped locally and
// then corrected itself would be worse than one that took 40ms.
export function cbRadioHTML() {
  return `
    <div class="cab-cb" role="group" aria-label="CB radio">
      <button type="button" class="cab-cb-set" aria-label="Open the Deadhead window"
        title="Open the Deadhead window — everything said on this channel">
        <span class="cab-cb-band">CB</span>
        <span class="cab-cb-chan" aria-hidden="true">19</span>
      </button>
      <div class="cab-cb-dial"
        role="spinbutton" tabindex="0"
        aria-label="CB channel"
        aria-valuemin="${CB_MIN}" aria-valuemax="${CB_MAX}" aria-valuenow="19" aria-valuetext="Channel 19">
        <i class="cab-cb-pointer" aria-hidden="true"></i>
      </div>
      <div class="cab-cb-sw">
        <button type="button" class="cab-btn cab-rocker cab-cb-pwr" aria-pressed="true"
          aria-label="CB power" title="CB on or off (cb on / cb off)"><i></i><u><span>CB</span></u></button>
        <button type="button" class="cab-btn cab-rocker cab-cb-spk" aria-pressed="false"
          aria-label="CB speaker — read incoming traffic aloud"
          title="Speaker — reads incoming traffic out loud so you can keep your eyes on the road (cb speaker)"><i></i><u><span>SPKR</span></u></button>
      </div>
    </div>`;
}

export function wireCbRadio(container, { openDeadhead } = {}) {
  const root = container?.querySelector?.('.cab-cb');
  if (!root) return null;
  const dial = root.querySelector('.cab-cb-dial');
  const chanEl = root.querySelector('.cab-cb-chan');
  const pwr = root.querySelector('.cab-cb-pwr');
  const spk = root.querySelector('.cab-cb-spk');

  const tune = (n) => {
    const chan = Math.max(CB_MIN, Math.min(CB_MAX, n));
    if (chan === cb.chan) return;
    sendCmdSilent(`cb ${chan}`);
  };

  dial.addEventListener('keydown', (e) => {
    const k = e.key;
    let next = null;
    if (k === 'ArrowUp' || k === 'ArrowRight') next = cb.chan + 1;
    else if (k === 'ArrowDown' || k === 'ArrowLeft') next = cb.chan - 1;
    else if (k === 'PageUp') next = cb.chan + 5;
    else if (k === 'PageDown') next = cb.chan - 5;
    else if (k === 'Home') next = CB_MIN;
    else if (k === 'End') next = CB_MAX;
    if (next == null) return;
    e.preventDefault(); e.stopPropagation();   // the cab eats arrow keys for steering
    tune(next);
  });

  // Wheel and drag, for a hand on a mouse. Both accumulate into whole clicks of the dial so a
  // trackpad's fractional deltas cannot skip half the band in one flick.
  let accum = 0;
  dial.addEventListener('wheel', (e) => {
    e.preventDefault();
    accum += e.deltaY > 0 ? -1 : 1;
    if (Math.abs(accum) >= 1) { tune(cb.chan + Math.trunc(accum)); accum = 0; }
  }, { passive: false });

  let dragFrom = null;
  dial.addEventListener('pointerdown', (e) => {
    dragFrom = { y: e.clientY, chan: cb.chan };
    dial.setPointerCapture?.(e.pointerId);
    dial.focus();
  });
  dial.addEventListener('pointermove', (e) => {
    if (!dragFrom) return;
    tune(dragFrom.chan + Math.round((dragFrom.y - e.clientY) / 8));
  });
  const endDrag = () => { dragFrom = null; };
  dial.addEventListener('pointerup', endDrag);
  dial.addEventListener('pointercancel', endDrag);

  pwr.addEventListener('click', () => sendCmdSilent(cb.on ? 'cb off' : 'cb on'));
  spk.addEventListener('click', () => sendCmdSilent('cb speaker'));
  root.querySelector('.cab-cb-set')?.addEventListener('click', () => openDeadhead?.(cbTabKey()));

  const widget = {
    paint() {
      chanEl.textContent = String(cb.chan);
      dial.setAttribute('aria-valuenow', String(cb.chan));
      // The number alone reads as "19" with no unit; the text is what a screen reader actually
      // says, and it is the place the OFF state has to be said, since a dial that still reads
      // "channel 19" on a dead set is a lie told quietly.
      dial.setAttribute('aria-valuetext', cb.on ? `Channel ${cb.chan}` : `Channel ${cb.chan}, set off`);
      dial.style.setProperty('--cb-turn', String((cb.chan - CB_MIN) / (CB_MAX - CB_MIN)));
      root.classList.toggle('off', !cb.on);
      pwr.classList.toggle('on', cb.on);
      pwr.setAttribute('aria-pressed', String(cb.on));
      spk.classList.toggle('on', cb.spk);
      spk.setAttribute('aria-pressed', String(cb.spk));
    },
    dispose() { knobs.delete(widget); },
  };
  knobs.add(widget);
  widget.paint();
  return widget;
}
