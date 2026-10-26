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
  { id: 'unrest', label: '🔥 Unrest' },
  { id: 'roof', label: '🏟 Roof' },
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

// Unrest: the city as a map of blocks coloured by mood, and one block's gauges and
// controls when you tap it. Cell actions carry the block in the action id
// (u_grip@7,8), because a slider or a pick sends only its own value.
async function unrestScreen(player, key, res) {
  const u = await import('./unrest.js');
  if (key) return unrestCellScreen(player, key, res, u);
  const v = await u.cityView(player);
  const B = u.BANDS;
  const hot = v.cells.filter(c => c.band !== 'quiet');
  const counts = ['flashpoint', 'tense', 'watchful'].map(b => [b, hot.filter(c => c.band === b).length]).filter(([, n]) => n);
  const worstCell = [...v.cells].sort((a, b) => b.score - a.score)[0];
  const xs = v.cells.map(c => c.bx), ys = v.cells.map(c => c.by);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const detail = {
    hero: {
      icon: B[v.worst].icon,
      title: hot.length ? `${hot.length} of ${v.cells.length} blocks unsettled` : 'The city is quiet',
      sub: hot.length
        ? `${counts.map(([b, n]) => `${n} ${B[b].label.toLowerCase()}`).join(', ')}. Worst: ${worstCell.name}`
        : `${v.cells.length} blocks watched. Nothing is building anywhere.`,
      badge: B[v.worst].label,
      badgeKind: B[v.worst].level >= 2 ? 'warn' : undefined,
    },
    desc: 'Each square is a block of the city, north at the top. Tap one for its gauges and controls.',
    grid: {
      screen: 'unrest',
      cols: Math.max(...xs) - x0 + 1,
      rows: Math.max(...ys) - y0 + 1,
      cells: v.cells.map(c => ({
        id: c.key, x: c.bx - x0, y: c.by - y0, level: B[c.band].level, here: c.here,
        label: c.landmark || c.part, sub: c.landmark ? c.part : '',
        marks: `${c.lit ? '🔥' : ''}${c.live.length ? '⚠' : ''}${c.here ? '📍' : ''}`,
        title: `${c.name}: ${B[c.band].label}${c.lit ? ', burning' : ''}${c.live.length ? `, ${c.live[0].name}` : ''}${c.here ? ', you are here' : ''}`,
      })),
      legend: [
        ...Object.values(B).map(b => ({ level: b.level, label: b.label })),
        { label: '🔥 burning' }, { label: '⚠ incident' }, { label: '📍 you' },
      ],
    },
    tiles: [
      { label: 'Incidents', value: `${v.live.length} of ${v.cap}` },
      { label: 'Burning', value: String(v.cells.filter(c => c.lit).length) },
      { label: 'Wildblood', value: v.wildblood.open ? `Out: ${v.wildblood.place}` : 'Not tonight yet' },
    ],
    rows: [
      { label: 'Live incidents', heading: true },
      ...(v.live.length
        ? v.live.map(i => ({ label: i.name, value: `${i.place} · ${i.minsLeft} min left` }))
        : [{ label: 'None', value: 'Nothing is staged anywhere.' }]),
    ],
  };
  const actions = [
    { id: 'u_tick', label: 'Run a tick now', confirm: 'Run one 30-minute tick of the sim now? Moods move, the street and the news may speak, and an incident may start.' },
    ...(v.live.length ? [{
      id: 'u_end', label: 'End an incident', kind: 'ghost', title: 'End an incident',
      pick: v.live.map(i => ({ value: i.instanceId, label: `${i.name}, ${i.place}` })),
      prompt: `The incident to end: ${v.live.map(i => i.instanceId).join(', ')}`,
    }] : []),
    ...(hot.length ? [{ id: 'u_calm@all', label: 'Calm the whole city', kind: 'danger', confirm: 'Put every block back to its baseline? Anything burning goes out on the next tick. Live incidents keep running.' }] : []),
  ];
  return frame('unrest', detail, actions, res);
}

async function unrestCellScreen(player, key, res, u) {
  const c = await u.cellView(player, key);
  if (!c) return unrestScreen(player, null, { ok: false, error: `No block "${key}".` });
  const B = u.BANDS;
  const { IGNITE_HI, IGNITE_LO, BAND_AT } = await import('../unrest/ledger.js');
  const lv = (n, warm, hot) => (n >= hot ? 2 : n >= warm ? 1 : 0);
  const who = (w) => (c.orders[w] ? ` (${c.orders[w]})` : '');
  const live = c.live[0];
  const detail = {
    hero: {
      icon: B[c.band].icon,
      title: B[c.band].label,
      sub: `${c.name}${c.here ? ' · you are here' : ''}`,
      badge: c.lit ? 'Burning' : live ? 'Incident' : undefined,
      badgeKind: c.lit || live ? 'warn' : undefined,
    },
    desc: c.outlook,
    meters: [
      {
        label: 'Mood', value: c.score, level: B[c.band].level, text: String(c.score),
        scale: [{ at: 0, label: 'Quiet' }, { at: BAND_AT.watchful, label: 'Watchful' }, { at: BAND_AT.tense, label: 'Tense' }, { at: BAND_AT.flashpoint, label: 'Flashpoint' }],
        hint: 'Trouble plus half the crackdown.',
      },
      { label: `Crackdown${who('grip')}`, value: c.grip, level: lv(c.grip, 25, 50), hint: `How hard the authority is squeezing. Fades over about 3 hours.` },
      { label: `Trouble${who('heat')}`, value: c.heat, level: lv(c.heat, 20, 45), hint: 'Trouble on the street. Fades in about 20 minutes unless something feeds it.' },
      {
        label: 'Grievance', value: c.pressure, level: c.lit ? 3 : c.pressure > IGNITE_HI ? 2 : lv(c.pressure, IGNITE_HI * 0.6, IGNITE_HI),
        text: `${c.pressure} of ${IGNITE_HI}`,
        scale: [{ at: IGNITE_LO, label: 'Goes out' }, { at: IGNITE_HI, label: 'Boils over' }],
        hint: 'Builds under the crackdown over days. When it boils over the block kicks off, and that spends it.',
      },
    ],
    rows: [
      { label: 'What players have seen', heading: true },
      { label: 'Trouble last showed', value: u.signalAgo(c.signals.heat) },
      { label: 'Crackdown last showed', value: u.signalAgo(c.signals.grip) },
      { label: 'Happening here', heading: true },
      ...(live
        ? [{ label: live.name, value: `${Math.max(0, Math.round((live.endsAt - Date.now()) / 60000))} min left` }]
        : [{ label: 'Nothing', value: 'No incident is staged here.' }]),
      { label: 'Could happen here', heading: true },
      ...c.catalogue.map(d => ({ label: `${d.name}${d.order ? ` (${d.order})` : ''}`, value: d.why ? `Not now: ${d.whyText}` : 'Ready' })),
    ],
  };
  const at = `@${c.key}`;
  const slider = (s, value) => ({
    id: `u_${s}${at}`, label: u.SCALARS[s].label, slider: { min: 0, max: 100, step: 1, value },
    prompt: `${u.SCALARS[s].label}, 0 to 100. It's ${value} now.`,
  });
  const actions = [
    { id: 'u_city', label: '◀ Whole city', kind: 'ghost' },
    slider('grip', c.grip), slider('heat', c.heat), slider('pressure', c.pressure),
    ...(c.band !== 'quiet' || c.lit || c.pressure > IGNITE_LO ? [{ id: `u_calm${at}`, label: 'Calm it down' }] : []),
    ...(!c.lit && c.pressure <= IGNITE_HI ? [{ id: `u_stir${at}`, label: 'Stir it up', kind: 'danger', confirm: 'Push grievance past boiling point? The block kicks off on the next tick.' }] : []),
    live
      ? { id: `u_end${at}`, label: `End ${live.name}`, kind: 'danger', confirm: `End ${live.name} now and take down everything it put up?` }
      : {
        id: `u_stage${at}`, label: 'Start an incident', title: 'Start an incident here',
        pick: c.catalogue.map(d => ({ value: d.id, label: `${d.name}${d.why ? `: forced, ${d.whyText}` : ''}` })),
        prompt: `The incident to start: ${c.catalogue.map(d => d.id.replace(/^incident_/, '')).join(', ')}`,
      },
    { id: `u_tick${at}`, label: 'Run a tick now', kind: 'ghost', confirm: 'Run one 30-minute tick of the whole sim now?' },
  ];
  return { ...frame('unrest', detail, actions, res), params: c.key };
}

// The Coliseum's retractable roof. The forecast sets it each day; a button here holds it till tomorrow.
async function roofScreen(res) {
  const { roofView } = await import('./index.js');
  const r = roofView();
  if (!r.venue) return frame('roof', { hero: { icon: '🏟', title: 'No roof', sub: 'No venue on the map has a retractable roof.' } }, [], res);
  const f = r.forecast;
  const detail = {
    hero: {
      icon: '🏟',
      title: r.shut ? 'Roof shut' : 'Roof open',
      sub: `${r.venue}. The shells take about five minutes to travel.`,
      badge: r.manual ? 'Staff' : 'Forecast',
      badgeKind: r.manual ? 'warn' : undefined,
    },
    tiles: [
      { label: 'Forecast', value: f ? `${cap(f.weatherType)}, ${f.precipPct}%` : 'None' },
      { label: 'Forecast says', value: f ? (f.shut ? 'Shut' : 'Open') : '-' },
      { label: 'Held', value: r.manual ? `${cap(r.manual)} till tomorrow` : 'No' },
    ],
  };
  const actions = [
    r.shut ? { id: 'r_open', label: 'Open the roof' } : { id: 'r_shut', label: 'Close the roof' },
    ...(r.manual ? [{ id: 'r_auto', label: 'Back to the forecast', kind: 'ghost' }] : []),
  ];
  return frame('roof', detail, actions, res);
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
  if (tab === 'unrest') return unrestScreen(player, String(params || '').trim().toLowerCase() || null, res);
  if (tab === 'roof') return roofScreen(res);
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

  if (actionId.startsWith('r_')) return roofScreen(admin.setRoof(player, actionId.slice(2)));

  if (actionId.startsWith('u_')) {
    const u = await import('./unrest.js');
    const [op, key] = actionId.slice(2).split('@');
    let res;
    if (op === 'city') return unrestScreen(player, null);
    if (op === 'tick') res = await u.runTick(player);
    else if (op === 'calm') res = await u.calm(player, key);
    else if (op === 'stir') res = await u.stir(player, key);
    else if (op === 'end') res = await u.endIncident(player, key || val);
    else if (op === 'stage') res = val ? await u.stageIncident(player, key, val.toLowerCase()) : { ok: false, error: 'Choose an incident.' };
    else if (u.SCALARS[op]) res = await u.setScalar(player, key, op, val);
    // A block's own control comes back to the block; the city's come back to the city.
    return unrestScreen(player, key && key !== 'all' ? key : null, res);
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
