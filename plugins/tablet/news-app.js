// Tablet OS — News app. A single-screen feed of "sections", each an independent
// widget the client renders by section.type. It owns no news data of its own:
// every section pulls from another plugin's read seam (Actions/getters), the same
// way quests-app.js wraps the quests plugin. This keeps News a pure presenter so
// new sections (weather bulletins, corp-war ticker, market prices, dynamic
// headlines) slot into SECTIONS below without touching the shell.
//
// Adding a section: write an async builder that returns
//   { id, title, type, ... }   (or null to omit it this render)
// and add it to SECTIONS. Give the client a matching renderer for the new
// `type` (client/game/js/panels/tablet-os.js renderNews). That's the whole seam.
import { dispatchAction } from '../../server/engine/actions.js';
import { registerTabletApp } from './registry.js';
import { getStories } from './news-generator.js';

// ── Section: Word on the Street (generated headlines) ────────────────────────
// The amusing world-aware feed — live event-sourced stories padded with today's
// tabloid edition (news-generator.js). Leads the feed so there's always
// something to read even before any games are played.
async function headlinesSection() {
  const stories = await getStories(6);
  if (!stories.length) return null;
  return { id: 'headlines', title: '🗞️ Word on the Street', type: 'headlines', stories };
}

// ── Section: DEADBALL sports standings ──────────────────────────────────────
// Reads the league table + season state through the sportsleague plugin's own
// Action seams (never its tables directly), then shapes a compact league table
// for the widget. Win% and run differential are computed here so the client
// stays a dumb renderer.
async function standingsSection(player) {
  const [standings, season] = await Promise.all([
    dispatchAction({ type: 'sportsleague.getStandings', actor: player }),
    dispatchAction({ type: 'sportsleague.getSeason', actor: player }),
  ]);
  const rows = standings?.rows || [];
  const s = season || {};

  const teams = rows.map((r, i) => {
    const games = r.wins + r.losses;
    const pctRaw = games ? r.wins / games : 0;
    const pct = games ? (pctRaw >= 1 ? '1.000' : pctRaw.toFixed(3).replace(/^0/, '')) : '.000';
    const rd = (r.runs_for || 0) - (r.runs_against || 0);
    return {
      rank: i + 1,
      team: r.team,
      wins: r.wins,
      losses: r.losses,
      pct,
      rd: (rd > 0 ? '+' : '') + rd,
    };
  });

  const seasonLine = (s.phase === 'worldseries' && s.finalistA)
    ? `Season ${s.seasonNo} · WORLD SERIES — ${s.finalistA} vs ${s.finalistB}`
    : `Season ${s.seasonNo || 1} · Regular Season`;

  return {
    id: 'standings',
    title: '⚾ DEADBALL — Coldwater League',
    type: 'standings',
    subtitle: seasonLine,
    teams,
  };
}

// The section roster, in feed order. Each entry is an async builder; a builder
// that throws or returns null is simply skipped so one dead section never blanks
// the whole feed.
const SECTIONS = [headlinesSection, standingsSection];

async function buildSections(player) {
  const built = await Promise.all(SECTIONS.map(fn => fn(player).catch(() => null)));
  return built.filter(Boolean);
}

async function buildScreen(player) {
  return {
    view: 'news',
    breadcrumb: ['News'],
    sections: await buildSections(player),
  };
}

registerTabletApp({
  id: 'news', name: 'News', icon: '📰', category: 'General',
  buildScreen,
});
