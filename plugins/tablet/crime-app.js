// Tablet OS — CRIME. Your rap sheet, as the city keeps it.
//
// It owns NO law: heat and priors come from the surveillance plugin's own record
// (crimeRecordOf), the current stint from jail (custodyOf), the statute weights
// from the engine's crime catalogue (getCrimeList), and the seized-property list
// from the police evidence locker. This is the window, not a second ledger — a
// number here disagreeing with the one that shot at you would be a bug.
//
// Four screens:
//   RECORD    — what the law wants you for RIGHT NOW: stars, live charges, whether
//               units are rolling, and your current stint if you're in a cell.
//   PRIORS    — the permanent tally, plus the recent case history and its outcomes.
//   STATUTES  — every offence and what it costs you in stars. The one screen that
//               is genuinely useful BEFORE you commit a crime rather than after.
//   PROPERTY  — what the evidence locker took off you. There is no reclaim path;
//               the screen says so, because a list that looks like a claim ticket
//               would be a lie.
import { query } from '../../server/models/db.js';
import { getFlag } from '../../server/engine/flags.js';
import { getCrimeList, getCrimeLabel, getCrimeStars } from '../../server/engine/crimes.js';
import { registerTabletApp, normScreen } from './registry.js';

// Dynamic imports (cached modules — the same instances the plugin loader booted),
// so the tablet stays load-order-agnostic about surveillance and jail.
const surv = () => import('../surveillance/index.js');
const jail = () => import('../jail/index.js');

const TABS = [
  { id: 'record', label: 'Record' },
  { id: 'priors', label: 'Priors' },
  { id: 'statutes', label: 'Statutes' },
  { id: 'property', label: 'Property' },
];
const MAX_STARS = 5;

// Half-star aware, and the same shape surveillance prints to the room, so the
// tablet and the siren agree about how hot you are.
function starBar(n) {
  const full = Math.floor(n);
  const half = (n - full) >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, MAX_STARS - full - (half ? 1 : 0)));
}
const ago = (ts) => {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'moments ago';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const agoSecs = (epochSecs) => (epochSecs ? ago(epochSecs * 1000) : '');

// ── Record ───────────────────────────────────────────────────────────────────

async function recordScreen(player, rec) {
  const rows = [];
  const w = rec?.wanted;

  if (w?.stars > 0) {
    rows.push({ label: 'WANTED', value: `${starBar(w.stars)}  (${w.stars})` });
    if (w.charges?.length) rows.push({ label: 'Charges', value: w.charges.map(getCrimeLabel).join(' · ') });
    rows.push({ label: 'Status', value: w.hunted ? 'Units are rolling on your last known position.' : 'On file. No units dispatched yet.' });
  } else {
    rows.push({ label: 'WANTED', value: `${starBar(0)}  no active warrants` });
  }

  // In a cell right now? That's the first thing you want off this screen.
  const custody = await (await jail()).custodyOf(player.id).catch(() => null);
  if (custody) {
    rows.push({ label: '—', value: '' });
    rows.push({ label: 'IN CUSTODY', value: 'Precinct 9 holding' });
    if (custody.charge) rows.push({ label: 'Booked for', value: custody.charge });
    rows.push({ label: 'Out in', value: custody.minutesLeft <= 1 ? 'any minute' : `${custody.minutesLeft} minutes` });
    if (custody.fine) {
      rows.push({
        label: 'Fine due', value: `₵${custody.fine.toLocaleString()} — taken from the ₵${custody.held.toLocaleString()} the desk is holding`
          + (custody.fine > custody.held ? `. You'll walk out ₵${(custody.fine - custody.held).toLocaleString()} down.` : '.'),
      });
    }
  }

  if (rec?.active?.length) {
    rows.push({ label: '—', value: '' });
    rows.push({ label: 'OPEN CASES', value: `${rec.active.length} on the board` });
    for (const c of rec.active.slice(0, 6)) {
      rows.push({ label: `  ${c.crime}`, value: `${c.zone} · ${ago(c.ts)}` });
    }
  }

  rows.push({ label: '—', value: '' });
  rows.push({ label: 'PRIOR RECORD', value: '' });
  rows.push({ label: '  Offences charged', value: String(rec?.priorsTotal || 0) });
  const arrests = Number(await getFlag('player', 'crime_arrests', player).catch(() => 0)) || 0;
  const fines = Number(await getFlag('player', 'crime_fines', player).catch(() => 0)) || 0;
  const served = Number(await getFlag('player', 'crime_served_min', player).catch(() => 0)) || 0;
  rows.push({ label: '  Arrests', value: String(arrests) });
  rows.push({ label: '  Fines paid', value: `₵${fines.toLocaleString()}` });
  rows.push({ label: '  Time served', value: served >= 60 ? `${Math.floor(served / 60)}h ${served % 60}m` : `${served}m` });
  if (rec?.firstAt) rows.push({ label: '  First offence', value: agoSecs(rec.firstAt) });
  if (rec?.lastAt) rows.push({ label: '  Last offence', value: agoSecs(rec.lastAt) });
  if (!rec?.priorsTotal && !arrests) {
    rows.push({ label: '', value: 'Nothing on file. As far as the city knows, you have never done a thing wrong.' });
  }

  return {
    view: 'list',
    breadcrumb: ['Crime', 'Record'],
    activeTab: 'Record',
    tabs: TABS.map(t => ({ id: t.label, label: t.label })),
    boardName: `⚖ ${player.handle} — file open`,
    items: [],
    rows,
  };
}

// ── Priors ───────────────────────────────────────────────────────────────────

function priorsScreen(player, rec) {
  const priors = rec?.priors || {};
  const items = Object.entries(priors)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => ({
      id: '',
      label: `${String(n).padStart(3)} ×  ${getCrimeLabel(key)}`,
      sub: `${getCrimeStars(key)}★ apiece · ${(getCrimeStars(key) * n).toFixed(1)}★ charged in total`,
      badge: 'active',
      badgeLabel: getCrimeStars(key) >= 4 ? 'FELONY' : getCrimeStars(key) >= 2 ? 'SERIOUS' : 'MINOR',
    }));
  if (!items.length) {
    items.push({ id: '', label: 'No priors on file.', sub: 'Every charge that sticks is added here for good.', badge: 'active', badgeLabel: '—' });
  }

  // The case history is the LIVE police board's memory — in-memory, capped, and
  // reset by a server restart. Said plainly rather than presented as the archive,
  // because the tally above is the part that actually persists.
  const rows = [];
  if (rec?.history?.length) {
    rows.push({ label: 'RECENT CASES', value: '' });
    for (const h of rec.history.slice(0, 12)) {
      rows.push({ label: `  ${h.crime}`, value: `${h.zone} · ${ago(h.ts)} · ${h.outcome}` });
    }
    rows.push({ label: '', value: 'Case notes are the duty board\'s working memory — the tally above is the permanent file.' });
  }

  return {
    view: 'list',
    breadcrumb: ['Crime', 'Priors'],
    activeTab: 'Priors',
    tabs: TABS.map(t => ({ id: t.label, label: t.label })),
    boardName: `⚖ ${rec?.priorsTotal || 0} charges on file`,
    items,
    rows,
  };
}

// ── Statutes ─────────────────────────────────────────────────────────────────
// The price list. Every enabled offence and the heat it earns, heaviest first —
// which makes this the only screen in the app worth reading BEFOREHAND.

function statutesScreen() {
  const list = getCrimeList().filter(c => c.enabled).sort((a, b) => b.stars - a.stars || a.label.localeCompare(b.label));
  const witnessNote = {
    always: 'reports itself',
    camera: 'needs a camera on you',
    any: 'camera, cop or bystander',
  };
  const items = list.map(c => ({
    id: c.id,
    label: `${starBar(c.stars).slice(0, 5)}  ${c.label}`,
    sub: `${c.stars}★ · ${witnessNote[c.witness] || c.witness}`,
    badge: c.stars >= 4 ? 'ready' : 'active',
    badgeLabel: `${c.stars}★`,
  }));
  return {
    view: 'list',
    breadcrumb: ['Crime', 'Statutes'],
    activeTab: 'Statutes',
    tabs: TABS.map(t => ({ id: t.label, label: t.label })),
    boardName: '⚖ Municipal statutes — what it costs you',
    items,
    rows: [
      { label: 'Note', value: 'Stars are what a charge ADDS. They decay on their own if nobody catches up with you.' },
      { label: '', value: "Outside city limits there's no apparatus to report anything. The wastes charge nothing." },
    ],
  };
}

// ── Property ─────────────────────────────────────────────────────────────────
// The evidence locker, filtered to your handle. It is a graveyard, not a store —
// see the police_evidence comment in schema.js — and the screen must say so.

async function propertyScreen(player) {
  const { rows } = await query(
    `SELECT e.item_id, e.quantity, e.created_at, i.name
       FROM police_evidence e LEFT JOIN items i ON i.id = e.item_id
      WHERE e.source_handle = $1
      ORDER BY e.created_at DESC LIMIT 30`,
    [player.handle],
  ).catch(() => ({ rows: [] }));

  const items = rows.map(r => ({
    id: '',
    label: `${r.quantity > 1 ? `${r.quantity} × ` : ''}${r.name || r.item_id}`,
    sub: `logged ${ago(new Date(r.created_at).getTime())}`,
    badge: 'active',
    badgeLabel: 'HELD',
  }));
  if (!items.length) {
    items.push({ id: '', label: 'The locker has nothing of yours.', sub: 'Contraband taken at booking is logged here.', badge: 'active', badgeLabel: '—' });
  }
  return {
    view: 'list',
    breadcrumb: ['Crime', 'Property'],
    activeTab: 'Property',
    tabs: TABS.map(t => ({ id: t.label, label: t.label })),
    boardName: '⚖ Evidence locker',
    items,
    rows: [{ label: 'Note', value: "Nothing in the locker comes back. It's held, then it's purged. Consider it gone." }],
  };
}

// ── Shell ────────────────────────────────────────────────────────────────────

async function buildScreen(player, screenId) {
  const tab = normScreen(screenId);
  if (tab === 'statutes') return statutesScreen();
  if (tab === 'property') return propertyScreen(player);
  const rec = await (await surv()).crimeRecordOf(player).catch(() => null);
  if (tab === 'priors') return priorsScreen(player, rec);
  return recordScreen(player, rec);
}

// The tile badge: your current star count, so the home screen shows heat without
// the widget below being on at all. In-memory read.
async function buildHome(player) {
  const s = await surv();
  const w = s.wantedSnapshot ? s.wantedSnapshot(player.id) : null;
  return { notify: w?.stars ? Math.ceil(w.stars) : 0 };
}

// ── Home widget ──────────────────────────────────────────────────────────────
// Your heat, and nothing at all when you're clean — the card IS the alarm, so it
// has to be absent in the ordinary case rather than reassuring you every render.
// wantedSnapshot() reads the in-memory wanted runtime, no query, which is what
// lets it sit on the most-opened screen in the game.
async function buildWidget(player) {
  const s = await surv();
  const w = s.wantedSnapshot ? s.wantedSnapshot(player.id) : null;
  if (!w || !w.stars) return null;
  return {
    id: 'heat',
    title: 'Wanted',
    kind: 'stat',
    icon: '⚠',
    // The one card that ignores the player's home-screen arrangement: every other
    // widget goes away when its app is stashed under ⊕, but an alarm you have to
    // opt into is not an alarm.
    alwaysOn: true,
    big: w.bar,
    sub: w.hunted ? 'units en route' : 'on file',
    note: w.charges.length ? w.charges.map(getCrimeLabel).join(' · ') : null,
    tone: w.stars >= 3 ? 'bad' : 'warn',
  };
}

registerTabletApp({
  id: 'crime', name: 'Crime', icon: '⚖', category: 'General',
  verbs: ['wanted'],
  buildHome, buildScreen, buildWidget,
});
