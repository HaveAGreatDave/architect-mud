// Tablet OS: the Admin app. A skin over the `sysop` verbs in index.js and
// time.js: every control calls the same function its verb does, so the app
// holds no logic. Staff only. The shell's `visible` gate hides the tile, but
// tabletnav and tabletaction don't re-check it, so buildScreen and handleAction do.
//
// Layout uses the tablet's shared detail pieces: a hero card for the headline
// state, tiles for the numbers, sliders and chip rows for the controls.
import { registerTabletApp } from '../tablet/registry.js';

const TABS = [
  { id: 'weather', label: '☁ Weather' },
  { id: 'time', label: '⏱ Time' },
  { id: 'esp', label: '🚨 ESP' },
  { id: 'players', label: '👥 Players' },
  { id: 'staff', label: '💬 Staff chat' },
];

const DENIED = { view: 'error', message: 'This app needs staff clearance.' };

const cap = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

const frame = (tab, detail, actions, res) => ({
  view: 'detail', breadcrumb: [], tabs: TABS, activeTab: tab,
  detail, actions,
  notice: res ? (res.ok ? res.message : res.error) : undefined,
  noticeKind: res?.ok ? 'ok' : undefined,
});

async function weatherScreen(res) {
  const { weatherView, weatherEventOptions } = await import('./index.js');
  const { WEATHER_TYPES } = await import('../../server/engine/environment.js');
  const w = weatherView();
  const detail = {
    hero: {
      icon: w.icon || '☁',
      title: `${w.tempC}°C · ${cap(w.weatherType)}`,
      sub: `Feels ${w.feelsLikeC}°C · right now ${w.current ? String(w.current).replace(/_/g, ' ') : 'calm'}${w.intensity ? `, ${w.intensity}` : ''}`,
      badge: w.override ? 'Override' : 'Forecast',
      badgeKind: w.override ? 'warn' : undefined,
    },
    tiles: [
      { label: 'Wind', value: `${w.windKph} kph` },
      { label: 'Precip', value: `${w.precipPct}%` },
      ...(w.humidityPct != null ? [{ label: 'Humidity', value: `${Math.round(w.humidityPct)}%` }] : []),
      { label: 'Event', value: w.event ? `${cap(w.event.type)} (${w.event.phase})` : 'None' },
    ],
  };
  const actions = [
    { id: 'w_temp', label: 'Temperature', slider: { min: -40, max: 50, step: 1, value: w.tempC, unit: '°C' } },
    { id: 'w_wind', label: 'Wind', slider: { min: 0, max: 150, step: 5, value: w.windKph, unit: ' kph' } },
    { id: 'w_rain', label: 'Precipitation chance', slider: { min: 0, max: 100, step: 5, value: w.precipPct, unit: '%' } },
    { id: 'w_set', label: 'Condition', chips: { options: WEATHER_TYPES.map(t => ({ value: t, label: cap(t) })), active: w.weatherType } },
    { id: 'w_event', label: 'Named event', chips: { options: weatherEventOptions().map(e => ({ value: e.type, label: cap(e.label) })), active: w.event?.type } },
  ];
  if (w.override) actions.push({ id: 'w_reset', label: 'Return to forecast', kind: 'ghost', confirm: 'Clear the override and go back to the forecast?' });
  return frame('weather', detail, actions, res);
}

async function timeScreen(res) {
  const { timeView, SKIP_HOURS, SPEEDS } = await import('./time.js');
  const t = timeView();
  const detail = {
    hero: {
      icon: t.icon || '🕒',
      title: t.time,
      sub: `${t.dayOfWeek ? `${cap(t.dayOfWeek)}, ` : ''}${t.date} · ${cap(t.phase)}${t.season ? ` · ${cap(t.season)}` : ''}`,
      badge: t.frozen ? 'Frozen' : `${t.scale}x speed`,
      badgeKind: t.frozen ? 'warn' : undefined,
    },
    tiles: [
      { label: 'Clock', value: t.frozen ? 'Stopped' : 'Running' },
      { label: 'Day lasts', value: `${(24 / t.scale).toFixed(1)} h real` },
    ],
  };
  const actions = [
    { id: 't_speed', label: 'Game speed', chips: { options: SPEEDS.map(s => ({ value: String(s), label: `${s}x` })), active: String(t.scale) } },
    ...SKIP_HOURS.map(h => ({ id: `t_skip_${h}`, label: `+${h}h`, confirm: `Skip ${h} hours for everyone? The street horns will announce it.` })),
    { id: 't_set', label: 'Set time', kind: 'ghost', title: 'Set the clock', prompt: `The 24-hour time to set, like 18:00 or 0630. It's ${t.time} now.` },
    { id: 't_freeze', label: t.frozen ? 'Resume clock' : 'Freeze clock', kind: t.frozen ? undefined : 'danger' },
  ];
  return frame('time', detail, actions, res);
}

// The city lockdown: sirens, the Curtain shut across the gate and the South Lock's door down.
async function espScreen(res) {
  const { espView } = await import('./esp.js');
  const on = espView().active;
  const detail = {
    hero: {
      icon: '🚨',
      title: on ? 'Lockdown' : 'All clear',
      sub: on ? 'Sirens are sounding. The Curtain is shut and the South Lock is down.' : 'The Emergency Siren Protocol is off.',
      badge: on ? 'Active' : 'Off',
      badgeKind: on ? 'warn' : undefined,
    },
    tiles: [
      { label: 'Curtain', value: on ? 'Shut' : 'Open' },
      { label: 'South Lock', value: on ? 'Door down' : 'Open' },
    ],
  };
  const actions = on
    ? [{ id: 'e_off', label: 'End the lockdown', confirm: 'Stop the sirens and open the Curtain?' }]
    : [
      { id: 'e_on', label: 'Lock down the city', kind: 'danger', confirm: 'Sound the sirens city-wide, shut the Curtain and drop the South Lock?' },
      { id: 'e_on_msg', label: 'Lock down with a message', kind: 'ghost', title: 'Lockdown message', prompt: 'The warning everyone sees with the sirens.' },
    ];
  return frame('esp', detail, actions, res);
}

function soonScreen(tab) {
  const t = TABS.find(x => x.id === tab);
  return frame(tab, {
    hero: { icon: t.label.split(' ')[0], title: t.label.slice(t.label.indexOf(' ') + 1), sub: 'Coming next. Not built yet.' },
  }, []);
}

async function buildScreen(player, screenId, params, res) {
  const { isStaff } = await import('./index.js');
  if (!isStaff(player)) return DENIED;
  const tab = String(screenId || 'weather').toLowerCase();
  if (tab === 'time') return timeScreen(res);
  if (tab === 'esp') return espScreen(res);
  if (tab === 'players' || tab === 'staff') return soonScreen(tab);
  return weatherScreen(res);
}

async function handleAction(player, actionId, params) {
  const admin = await import('./index.js');
  if (!admin.isStaff(player)) return DENIED;
  const val = String(params || '').trim();
  const num = (v) => (v === '' ? NaN : v.replace('%', ''));

  if (actionId.startsWith('t_')) {
    const time = await import('./time.js');
    let res;
    if (actionId.startsWith('t_skip_')) res = await time.skipTime(player, actionId.slice(7));
    else if (actionId === 't_set') res = await time.setClock(player, val);
    else if (actionId === 't_freeze') res = time.setFrozen(player, !time.timeView().frozen);
    else if (actionId === 't_speed') res = await time.setSpeed(player, val);
    return timeScreen(res);
  }

  if (actionId.startsWith('e_')) {
    const { setEsp } = await import('./esp.js');
    const res = actionId === 'e_off' ? await setEsp(player, false) : await setEsp(player, true, actionId === 'e_on_msg' ? val : '');
    return espScreen(res);
  }

  let res;
  if (actionId === 'w_set') res = await admin.setWeather(player, { weatherType: val.toLowerCase() });
  else if (actionId === 'w_temp') res = await admin.setWeather(player, { tempC: num(val) });
  else if (actionId === 'w_wind') res = await admin.setWeather(player, { windKph: num(val) });
  else if (actionId === 'w_rain') res = await admin.setWeather(player, { precipPct: num(val) });
  else if (actionId === 'w_event') res = admin.fireWeatherEvent(player, val);
  else if (actionId === 'w_reset') res = await admin.resetWeather(player);
  return weatherScreen(res);
}

registerTabletApp({
  id: 'admin', name: 'Admin', icon: '🛡', category: 'System',
  verbs: ['sysop'],
  visible: async (player) => ['dev', 'admin', 'builder', 'designer'].includes(player?.role),
  buildScreen, handleAction,
});
