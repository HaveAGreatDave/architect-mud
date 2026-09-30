// Admin time controls: read the clock, skip it forward, set it, freeze it and
// change its speed. A skip or a set is announced to everyone online over the
// street horns (a `pa_announce` message: a chime, a log line, and ORACLE through
// its public-address chain on the client).
import {
  getHUDPayload, devSkipTime, devSetTime, devFreeze, devSetTimeScale,
} from '../../server/engine/environment.js';
import { getAllLivePlayers } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { logActivity } from '../../server/models/db.js';

export const SKIP_HOURS = [4, 8, 12, 24];
export const SPEEDS = [1, 2, 3, 6];

export function timeView() {
  const h = getHUDPayload() || {};
  return {
    time: h.time, date: h.date, dayOfWeek: h.dayOfWeek, season: h.season,
    phase: h.timePhase, icon: h.timeIcon, frozen: !!h.frozen, scale: h.timeScale || 1,
  };
}

// ── Saying the time ──────────────────────────────────────────────────────────
// The horn reads the time the way a municipal PA would: "oh six hundred hours",
// "twenty-one thirty". ORACLE is handed words, not digits.
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];
const num = (n) => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');

export function spokenTime(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  const hour = h === 0 ? 'zero' : h < 10 ? `oh ${ONES[h]}` : num(h);
  if (!m) return `${hour} hundred hours`;
  return `${hour} ${m < 10 ? `oh ${ONES[m]}` : num(m)}`;
}

// {t} is the time, {h} the hours skipped, {p} the part of the day. Each line is
// written once for the log and read aloud with {t} spoken in words.
const SKIP_LINES = [
  'Attention, Coldwater. The time is now {t}. Please adjust your expectations accordingly.',
  'This is a municipal announcement. It is {t}. {h} hours have been accounted for. Do not ask by whom.',
  'Attention. The clocks have been advanced {h} hours. Anything you were late for, you are now later for.',
  'Good {p}, Coldwater. It is {t}. Remain calm and continue working.',
  'Attention, citizens. It is now {t}. If you remember the last {h} hours, keep it to yourself.',
  'The time is {t}. The city thanks you for the {h} hours you did not notice.',
];
const SET_LINES = [
  'Attention, Coldwater. The time is now {t}. It has always been {t}.',
  'This is a municipal announcement. The correct time is {t}. Clocks that disagree will be corrected.',
];

function fill(line, { t, h, p }) {
  return line.replace(/\{t\}/g, t).replace(/\{h\}/g, h).replace(/\{p\}/g, p);
}

export function announce(pool, hours) {
  const v = timeView();
  const line = pool[Math.floor(Math.random() * pool.length)];
  const hr = Number(String(v.time).split(':')[0]);
  const p = hr >= 5 && hr < 12 ? 'morning' : hr >= 12 && hr < 17 ? 'afternoon' : 'evening';
  const hWord = hours ? num(hours) : '';
  const message = fill(line, { t: v.time, h: hours ?? '', p });
  const speech = fill(line, { t: spokenTime(v.time), h: hWord, p });
  const msg = { type: 'pa_announce', message, speech, seed: 'public_address' };
  for (const pl of getAllLivePlayers()) sendToPlayer(pl.id, msg);
  return message;
}

// ── Changing the clock ───────────────────────────────────────────────────────
export async function skipTime(player, hours) {
  const h = Number(hours);
  if (!SKIP_HOURS.includes(h)) return { ok: false, error: `Skip by ${SKIP_HOURS.join(', ')} hours.` };
  await devSkipTime(h * 60);
  logActivity('admin_cmd', player.handle, null, `time skip +${h}h`);
  announce(SKIP_LINES, h);
  const v = timeView();
  return { ok: true, message: `Skipped ${h} hours. It's ${v.time} on ${v.date}.` };
}

// "18:00", "1800", "6:30", "0630".
export function parseClock(text) {
  const m = String(text || '').trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  return h <= 23 && mm <= 59 ? h * 60 + mm : null;
}

export async function setClock(player, text) {
  const minutes = parseClock(text);
  if (minutes === null) return { ok: false, error: 'Give a time on the 24-hour clock, like 18:00 or 0630.' };
  await devSetTime({ minutes });
  logActivity('admin_cmd', player.handle, null, `time set ${text}`);
  announce(SET_LINES);
  return { ok: true, message: `Clock set to ${timeView().time}.` };
}

export function setFrozen(player, frozen) {
  const res = devFreeze(frozen ? 1 : 0);
  logActivity('admin_cmd', player.handle, null, `time ${res.frozen ? 'frozen' : 'unfrozen'}`);
  return { ok: true, message: res.frozen ? 'The clock is frozen.' : 'The clock is running again.' };
}

export async function setSpeed(player, scale) {
  const s = Number(String(scale).replace(/x$/i, ''));
  if (!SPEEDS.includes(s)) return { ok: false, error: `Speeds: ${SPEEDS.map(x => `${x}x`).join(', ')}.` };
  await devSetTimeScale(s, { playerId: player.id });
  return { ok: true, message: `Game speed ${s}x: a day lasts ${(24 / s).toFixed(1)} real hours.` };
}
