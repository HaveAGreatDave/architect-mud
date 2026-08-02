// Tablet OS — Alarm. A clock that runs on GAME time, and an alarm you set
// against it before you sleep.
//
// Why it exists: sleep now takes real minutes and wakes you when your body is
// done, which is fine for a full night and useless when you wanted twenty
// minutes. The alarm turns sleep from an open-ended commitment into a planned
// one — set it, go under, get up when you said you would.
//
// It works ANYWHERE. You set the alarm on the tablet, in a bar if you like, and
// it holds until you next sleep. The tablet is a device you carry; there is no
// reason it should only function beside a bed.
//
// Stored in one player_flags row (CLAUDE.md: per-player scalar state goes in
// player_flags, never a new players column). Pure presenter — no client CSS,
// because the OS theming comes from the shared view shapes.
import { gameMinutes, hhmm, parseTime, minutesUntil, realSecondsFor } from '../../server/engine/clock.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { registerTabletApp } from './registry.js';

export const ALARM_FLAG = 'alarm_at';   // minutes-of-day (0–1439), or absent

// Clock helpers live in the engine (server/engine/clock.js) because the sleep
// tick needs them too, and the engine must not import from a plugin. This app is
// the SCREEN; it owns the flag and the presentation, not the arithmetic.
export { gameMinutes, hhmm, parseTime, minutesUntil, realSecondsFor };

export async function getAlarm(player) {
  const v = await getFlag('player', ALARM_FLAG, player);
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1440 ? n : null;
}
export const setAlarm = (player, mins) => setFlag('player', ALARM_FLAG, String(mins), player);
export const clearAlarm = (player) => setFlag('player', ALARM_FLAG, '', player);

function prettyWait(gameMins) {
  const secs = realSecondsFor(gameMins);
  if (secs < 90) return `${secs}s`;
  return `${Math.round(secs / 60)} min`;
}

async function buildScreen(player) {
  const now = gameMinutes();
  const alarm = await getAlarm(player);
  const until = alarm == null ? null : minutesUntil(now, alarm);

  const rows = [
    { label: 'Time', value: hhmm(now) },
    { label: 'Alarm', value: alarm == null ? 'not set' : hhmm(alarm) },
  ];
  if (alarm != null) {
    rows.push({ label: 'Rings in', value: `${until} game min · about ${prettyWait(until)} real` });
  }

  const actions = [{
    id: 'set',
    label: alarm == null ? '⏰ Set alarm' : '⏰ Change alarm',
    prompt: 'Alarm time, on the 24-hour clock. 07:30, 730 and 0730 all work.',
  }];
  if (alarm != null) actions.push({ id: 'clear', label: '✕ Clear alarm' });

  // Its own view rather than the generic `detail`, because setting a time
  // through a text prompt ("07:30, 730 and 0730 all work") was a parser standing
  // in for a control. The client draws a real clock face and two rolling digit
  // reels; this still owns the state and the arithmetic, and still answers the
  // same `set` action — a client that fell back to the old prompt would work.
  return {
    view: 'alarm',
    title: 'Alarm',
    nowMins: now,
    nowLabel: hhmm(now),
    alarmMins: alarm,
    alarmLabel: alarm == null ? null : hhmm(alarm),
    untilMins: until,
    untilLabel: alarm == null ? null : `${until} game min · about ${prettyWait(until)} real`,
    subtitle: alarm == null
      ? 'No alarm set. You will sleep until your body is done.'
      : `Alarm set for ${hhmm(alarm)}.`,
    rows,
    body: [
      'Set it before you sleep — anywhere, not just at a bed.',
      'It wakes you at that time even if you are not finished resting,',
      'so a short nap is a choice you can actually make.',
    ].join('\n'),
    actions,
  };
}

async function handleAction(player, actionId, params) {
  if (actionId === 'clear') {
    await clearAlarm(player);
    return buildScreen(player);
  }
  if (actionId === 'set') {
    const mins = parseTime(params);
    if (mins == null) {
      return { view: 'error', message: 'That is not a time. Try 07:30, 730 or 0730 (24-hour).' };
    }
    await setAlarm(player, mins);
    return buildScreen(player);
  }
  return buildScreen(player);
}

registerTabletApp({
  id: 'alarm', name: 'Alarm', icon: '⏰', category: 'General',
  verbs: ['alarm'],
  buildScreen, handleAction,
});

export const _test = { parseTime, minutesUntil, hhmm };
