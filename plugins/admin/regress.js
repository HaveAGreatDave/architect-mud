// admin plugin regression suite, run by tests/regress.js (never in production).
// Setting the weather writes world_clock and weather_forecast and broadcasts to
// every client, so this checks the gates and the validation that refuses a bad
// value before any write, not the override itself.
import { findTabletApp } from '../tablet/registry.js';
import { weatherView, weatherEventOptions, setWeather } from './index.js';
import { spokenTime, parseClock, skipTime, setClock, setSpeed } from './time.js';
import { espView, setEsp } from './esp.js';
import { bringWetCellOver } from '../weather/index.js';
import { getWeatherFieldSnapshot } from '../../server/engine/environment.js';

export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const savedRole = p.role;
  const app = findTabletApp('admin');
  try {
    p.role = 'player';
    let r = await run('sysop weather');
    check('sysop refused for a player', /unknown command/i.test(r?.message || ''), r?.message);
    r = await run('sysop weather set storm');
    r = await run('sysop time skip 4');
    check('sysop time skip refused for a player', /unknown command/i.test(r?.message || ''), r?.message);
    check('sysop weather set refused for a player', /unknown command/i.test(r?.message || ''), r?.message);
    check('Admin app hidden from a player', app && !(await app.visible(p)), String(app && await app.visible(p)));
    const scr = await app.buildScreen(p, 'weather', '');
    check('Admin app screen refused to a player', scr?.view === 'error', JSON.stringify(scr)?.slice(0, 120));
    const act = await app.handleAction(p, 'w_set', 'storm');
    check('Admin app action refused to a player', act?.view === 'error', JSON.stringify(act)?.slice(0, 120));

    for (const role of ['admin', 'dev', 'builder', 'designer']) {
      p.role = role;
      check(`Admin app visible to ${role}`, await app.visible(p) === true);
    }

    p.role = 'admin';
    r = await run('sysop weather');
    check('sysop weather reports the live state', /Weather/.test(r?.message || '') && /Override/.test(r?.message || ''), r?.message);
    const w = weatherView();
    check('weatherView reads a type and a temperature', typeof w.weatherType === 'string' && Number.isFinite(w.tempC), JSON.stringify(w));
    check('weather event options include ion_storm', weatherEventOptions().some(e => e.type === 'ion_storm'));
    // Moving a cell is in-memory only (the field is reseeded from the date), so it is safe to drive.
    check('bringWetCellOver refuses a missing tile', bringWetCellOver(null, null) === false);
    const wetBefore = (getWeatherFieldSnapshot()?.systems || []).some(s => s.type === 'precip' || s.type === 'storm');
    const moved = bringWetCellOver(900, 900);
    check('bringWetCellOver puts a wet cell on the tile when the day has one',
      moved === wetBefore && (!moved || getWeatherFieldSnapshot().systems.some(s => (s.type === 'precip' || s.type === 'storm') && s.x === 900 && s.y === 900)),
      JSON.stringify({ moved, wetBefore }));

    r = await run('sysop weather set monsoon');
    check('an unknown weather type is refused', /Unknown weather/i.test(r?.message || ''), r?.message);
    let res = await setWeather(p, { tempC: 99 });
    check('an out-of-range temperature is refused before any write', res.ok === false && /-60 and 60/.test(res.error), JSON.stringify(res));
    res = await setWeather(p, { precipPct: 140 });
    check('an out-of-range precipitation chance is refused', res.ok === false && /0 to 100/.test(res.error), JSON.stringify(res));
    r = await run('sysop weather event nothing_real');
    check('an unknown named event is refused', /Unknown event/i.test(r?.message || ''), r?.message);

    const screen = await app.buildScreen(p, 'weather', '');
    check('Weather tab shows rows and the set actions',
      screen?.view === 'detail' && !!screen.detail.hero && screen.detail.tiles.length >= 3 && screen.actions.some(a => a.id === 'w_set' && a.chips?.options?.length),
      JSON.stringify(screen)?.slice(0, 160));
    check('Weather tab has temperature, wind and precipitation sliders',
      ['w_temp', 'w_wind', 'w_rain'].every(id => screen.actions.find(a => a.id === id)?.slider), JSON.stringify(screen.actions.map(a => a.id)));
    res = await setWeather(p, { windKph: 500 });
    check('an out-of-range wind is refused', res.ok === false && /0 to 200/.test(res.error), JSON.stringify(res));
    // Time: the pure parts and the refusals. A real skip runs tick24h (date,
    // forecast, power) and announces to every socket, so it isn't driven here.
    r = await run('sysop time');
    check('sysop time reports the clock', /Time/.test(r?.message || '') && /speed/.test(r?.message || ''), r?.message);
    check('spokenTime reads the hour as a PA would', spokenTime('06:00') === 'oh six hundred hours' && spokenTime('21:30') === 'twenty-one thirty' && spokenTime('00:05') === 'zero oh five', [spokenTime('06:00'), spokenTime('21:30'), spokenTime('00:05')].join(' | '));
    check('parseClock takes 18:00 and 0630 and refuses 25:00', parseClock('18:00') === 1080 && parseClock('0630') === 390 && parseClock('25:00') === null);
    res = await skipTime(p, 5);
    check('a skip outside 4/8/12/24 is refused', res.ok === false, JSON.stringify(res));
    res = await setClock(p, 'noon');
    check('a bad clock time is refused', res.ok === false, JSON.stringify(res));
    res = await setSpeed(p, 9);
    check('an unlisted speed is refused', res.ok === false, JSON.stringify(res));
    const tscr = await app.buildScreen(p, 'time', '');
    check('Time tab has a hero, the four skips and the speed chips',
      tscr?.activeTab === 'time' && !!tscr.detail.hero && ['t_skip_4', 't_skip_8', 't_skip_12', 't_skip_24'].every(id => tscr.actions.some(a => a.id === id && a.confirm)) && tscr.actions.some(a => a.id === 't_speed' && a.chips),
      JSON.stringify(tscr?.actions?.map(a => a.id)));
    check('Weather tab carries the five tabs', screen?.tabs?.length === 5 && screen.activeTab === 'weather');

    // The ESP: on and off through the verb, the tab following it, and a player refused.
    const escr = await app.buildScreen(p, 'esp', '');
    check('ESP tab offers a lockdown while it is off', escr?.activeTab === 'esp' && escr.actions.some(a => a.id === 'e_on' && a.confirm), JSON.stringify(escr?.actions?.map(a => a.id)));
    try {
      r = await run('sysop esp on regress lockdown');
      check('sysop esp on starts the lockdown', espView().active === true && /ESP on/.test(r?.message || ''), r?.message);
      const on = await app.buildScreen(p, 'esp', '');
      check('…and the tab shows it with a way to end it', on?.detail?.hero?.badge === 'Active' && on.actions.some(a => a.id === 'e_off'), JSON.stringify(on?.detail?.hero));
      r = await run('sysop esp off');
      check('sysop esp off ends it', espView().active === false && /ESP off/.test(r?.message || ''), r?.message);
    } finally { if (espView().active) await setEsp(p, false); }
    p.role = 'player';
    r = await run('sysop esp on');
    check('sysop esp refused for a player', /unknown command/i.test(r?.message || '') && !espView().active, r?.message);
    const pe = await app.handleAction(p, 'e_on', '');
    check('the ESP tab refuses a player', pe?.view === 'error' && !espView().active, JSON.stringify(pe)?.slice(0, 120));
  } finally {
    p.role = savedRole;
  }
}
