// Tablet OS — Calendar app. A single stream of dated events on the *game*
// calendar: rent-due dates pulled live from your leases (server/engine/
// apartments.js), plus free-text reminders you set yourself. Reminders persist
// per-player in a single player_flags row ('calendar_reminders', a JSON array)
// — no new columns (CLAUDE.md: per-player scalar state goes in player_flags).
// Pure presenter over the generic list/detail views, so it needs no client CSS.
import { query } from '../../server/models/db.js';
import { getZone, getLivePlayer } from '../../server/engine/world.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { gameToday, ymd, addGameDays, gameDaysBetween, MONTHS } from '../../server/engine/apartments.js';
import { on } from '../../server/engine/events.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { registerTabletApp } from './registry.js';

const REM_FLAG = 'calendar_reminders';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
// Month names (both the short and the full label) come from the engine's shared
// MONTHS table (server/engine/apartments.js) so the calendar reads the same as
// rent notices — the naming-rights-sold-off in-world month names.

// Minimal HTML escape — reminder text is player-authored and lands in a client
// output span, so it can't be trusted to be markup-free.
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The reminders in `list` that have come due (today or overdue) and haven't
// pinged yet. Exported for the regress suite.
function dueReminders(list, today) {
  if (!Array.isArray(list) || !today) return [];
  return list.filter(r => r && !r.fired && r.date && gameDaysBetween(today, r.date) <= 0);
}

// 'YYYY-MM-DD' -> "13 Jul 2087".
function prettyDate(d) {
  if (!d || !DATE_RE.test(d)) return d || '—';
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1] || '?'} ${y}`;
}

// Human countdown from today to a game date.
function countdown(today, date) {
  if (!today || !date) return '';
  const n = gameDaysBetween(today, date);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n > 1) return `in ${n} days`;
  if (n === -1) return 'yesterday';
  return `${-n} days ago`;
}

// --- Reminder store (one JSON array in player_flags) ------------------------

async function loadReminders(player) {
  const raw = await getFlag('player', REM_FLAG, player);
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}
async function saveReminders(player, list) {
  await setFlag('player', REM_FLAG, JSON.stringify(list), player);
}

// --- Event assembly ---------------------------------------------------------

async function rentEvents(playerId) {
  const { rows } = await query(
    'SELECT zone_id, building_name, rent_cost, rent_due_date FROM apartments WHERE owner_id=$1 AND rent_due_date IS NOT NULL',
    [playerId]
  );
  return rows.map(r => ({
    id: `rent:${r.zone_id}`,
    kind: 'rent',
    date: ymd(r.rent_due_date),
    text: `Rent due — ${getZone(r.zone_id)?.name || r.zone_id}`,
    detail: `${r.rent_cost ?? 100}c${r.building_name ? ` · ${r.building_name}` : ''}`,
  }));
}

async function allEvents(player) {
  const rem = (await loadReminders(player)).map(r => ({
    id: r.id, kind: 'reminder', date: r.date, text: r.text, detail: '', fired: !!r.fired,
  }));
  const events = [...await rentEvents(player.id), ...rem];
  events.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return events;
}

// Shift a 'YYYY-MM' month key by whole months.
function shiftMonth(ym, delta) {
  let [y, m] = ym.split('-').map(Number);
  m += delta;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Month-grid data for the given 'YYYY-MM': a list of week-rows of day cells, with
// each dated cell carrying the events that fall on it. Weeks start Monday; leading/
// trailing cells that spill outside the month are `{ day: null }` padding. The game
// calendar is plain Gregorian (server/engine/apartments.js does UTC Date math), so
// the grid is computed the same way.
function monthGrid(ym, today, events) {
  const [y, m] = ym.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Mon=0 … Sun=6

  const byDate = new Map();
  for (const e of events) {
    if (!e.date) continue;
    (byDate.get(e.date) || byDate.set(e.date, []).get(e.date)).push(e);
  }

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push({ day: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${ym}-${String(d).padStart(2, '0')}`;
    const evs = (byDate.get(date) || []).map(e => ({
      kind: e.kind, text: e.text, detail: e.detail || '',
    }));
    cells.push({ day: d, date, isToday: date === today, evs });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null });

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// The agenda list rendered beneath the grid — the same clickable event stream the
// app used to be, so each event still drills into its detail/delete screen.
function agendaItems(today, events) {
  return [
    { id: 'today', label: `📅 Today — ${prettyDate(today)}`, sub: 'In-world date' },
    ...events.map(e => ({
      id: e.id,
      label: `${e.kind === 'rent' ? '🏠 ' : '• '}${e.text}`,
      sub: `${prettyDate(e.date)} · ${countdown(today, e.date)}${e.detail ? ` · ${e.detail}` : ''}${e.fired ? ' · ✓ reminded' : ''}`,
    })),
  ];
}

// --- Screens ----------------------------------------------------------------

async function buildScreen(player, screenId, params) {
  const today = gameToday();
  const events = await allEvents(player);
  const id = (params || '').trim();
  const sid = String(screenId || '').toLowerCase();

  // Month navigation: the grid's prev/next arrows nav with screenId 'month' and a
  // 'YYYY-MM' params token. Kept distinct from the event-detail path (below), which
  // also arrives via params, so a month key is never mistaken for an event id.
  if (sid === 'month') {
    const ym = MONTH_RE.test(id) ? id : (today ? today.slice(0, 7) : '2087-01');
    return calendarScreen(today, events, ym);
  }

  // Detail for a single event, clicked from the agenda list.
  if (id && id !== 'today') {
    const ev = events.find(e => e.id === id);
    if (!ev) return calendarScreen(today, events, today ? today.slice(0, 7) : '2087-01');
    const rows = [
      { label: 'Date', value: prettyDate(ev.date) },
      { label: 'When', value: countdown(today, ev.date) || '—' },
    ];
    if (ev.detail) rows.push({ label: ev.kind === 'rent' ? 'Cost' : 'Note', value: ev.detail });
    return {
      view: 'detail',
      // Two crumb levels so Back drills up to the calendar root, not straight home.
      breadcrumb: ['Calendar', ev.kind === 'rent' ? 'Rent' : 'Reminder'],
      detail: {
        id: ev.id,
        name: ev.text,
        desc: ev.kind === 'rent' ? 'Auto-tracked from your lease. Rent drafts from your bank, then cash on hand.' : '',
        rows,
      },
      actions: ev.kind === 'reminder'
        ? [{ id: 'del', label: '🗑 Delete reminder', confirm: 'Delete this reminder?' }]
        : [],
    };
  }

  // Root: the month grid for the current in-world month.
  return calendarScreen(today, events, today ? today.slice(0, 7) : '2087-01');
}

function calendarScreen(today, events, ym) {
  const [y, m] = ym.split('-').map(Number);
  return {
    view: 'calendar',
    // Non-empty breadcrumb is required, not cosmetic: the client's list-item click
    // handler resends the current breadcrumb's last entry as the screenId token
    // alongside the clicked id as params. An empty breadcrumb sends screenId:null
    // and shoves the event id into the wrong slot, so buildScreen never sees it
    // (see vehicles-app.js's note on the same trap).
    breadcrumb: ['Calendar'],
    monthLabel: `${MONTHS[m - 1] || '?'} ${y}`,
    weekdays: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
    prevMonth: shiftMonth(ym, -1),
    nextMonth: shiftMonth(ym, 1),
    weeks: monthGrid(ym, today, events),
    items: agendaItems(today, events),
    actions: [{
      id: 'add',
      label: '✚ New reminder',
      prompt: 'Reminder — start with a date, then your note.\nUse YYYY-MM-DD (e.g. 2087-07-20 Meet Voss) or +N for N days from today (e.g. +7 Pay rent).',
    }],
  };
}

async function handleAction(player, actionId, params) {
  if (actionId === 'add') {
    const raw = (params || '').trim();
    const sp = raw.indexOf(' ');
    const first = sp === -1 ? raw : raw.slice(0, sp);
    const text = sp === -1 ? '' : raw.slice(sp + 1).trim();

    const today = gameToday();
    let date = null;
    if (DATE_RE.test(first)) date = first;
    else if (/^\+\d+$/.test(first) && today) date = addGameDays(today, parseInt(first.slice(1), 10));

    if (!date) return { view: 'error', message: 'Start the reminder with a date: YYYY-MM-DD or +N (days from today), then your note.' };
    if (!text) return { view: 'error', message: 'Add a note after the date, e.g. "2087-07-20 Meet Voss".' };

    const list = await loadReminders(player);
    list.push({ id: `rem_${Date.now()}`, date, text });
    await saveReminders(player, list);
    return buildScreen(player, null, '');
  }

  if (actionId === 'del') {
    const remId = (params || '').trim();
    const list = (await loadReminders(player)).filter(r => r.id !== remId);
    await saveReminders(player, list);
    return buildScreen(player, null, '');
  }

  return buildScreen(player, null, '');
}

// --- Day-of ping ------------------------------------------------------------
//
// On each game-day rollover, DM online players any reminders that have come due.
// Offline players are skipped (not marked fired), so a reminder waits for the
// next rollover the player IS online for rather than being silently lost. Runs
// on the same event rent collection does, so it tracks the game-speed knob.
async function remindTick() {
  const today = gameToday();
  if (!today) return;
  const { rows } = await query('SELECT player_id, flag_value FROM player_flags WHERE flag_key=$1', [REM_FLAG]);
  for (const row of rows) {
    const live = getLivePlayer(row.player_id);
    if (!live) continue; // only ping online players
    let list;
    try { list = JSON.parse(row.flag_value); } catch { continue; }
    const due = dueReminders(list, today);
    if (!due.length) continue;
    for (const r of due) {
      r.fired = true;
      const when = gameDaysBetween(today, r.date) === 0 ? 'today' : `was due ${prettyDate(r.date)}`;
      sendToPlayer(live.id, { type: 'output', message: `<span style="color:var(--yellow)">📅 REMINDER — ${esc(r.text)} (${when}).</span>` });
    }
    await setFlag('player', REM_FLAG, JSON.stringify(list), live);
  }
}

on('environment.dayRollover', remindTick);

export const _test = { dueReminders };

registerTabletApp({
  id: 'calendar', name: 'Calendar', icon: '📅', category: 'General',
  buildScreen, handleAction,
});
