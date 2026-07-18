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
import { getHUDPayload, getForecast } from '../../server/engine/environment.js';
import { registerTabletApp } from './registry.js';
import { getStories } from './news-generator.js';

// ── Section: Weather ─────────────────────────────────────────────────────────
// A self-contained weather widget: today's conditions up top (the same live
// snapshot the HUD shows, via getHUDPayload) plus the full 7-day forecast
// (getForecast — one WEATHER_ICON source of truth) folded into the payload so
// the client can expand it in place. Owns nothing itself; it just reads the two
// engine seams directly, so it stands alone even if the Weather app is retired.
async function weatherSection() {
  const hud = getHUDPayload();
  if (!hud) return null;
  const days = (getForecast() || []).map(f => ({
    day: f.forecastDay,
    date: f.date,
    icon: f.icon || '',
    weatherType: f.weatherType,
    tempC: f.tempC,
    windKph: f.windKph,
    humidityPct: f.humidityPct,
  }));
  return {
    id: 'weather',
    title: '⛅ Weather',
    type: 'weather',
    now: {
      icon: hud.currentWeatherIcon || hud.weatherIcon || '',
      conditions: hud.currentWeatherType,
      intensity: hud.currentIntensity,
      tempC: Math.round(hud.tempC),
      tempF: hud.tempF,
      feelsLikeC: Math.round(hud.feelsLikeC),
      humidityPct: hud.humidityPct,
      windKph: hud.windKph,
    },
    days,
  };
}

// ── Section: Word on the Street (generated headlines) ────────────────────────
// The amusing world-aware feed — live event-sourced stories, then date-seeded
// canonical-lore "wire" stories, padded with today's tabloid edition
// (news-generator.js: live → wire → tabloid). Leads the feed so there's always
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
//
// The standings table only carries teams that have PLAYED; the full DEADBALL
// roster lives in the broadcast plugin (broadcast.getSportsTeams). We union the
// two so the whole league shows from the start — a never-played team appears at
// 0-0 and sinks below any team that's on the board, matching the command's sort.
async function standingsSection(player) {
  const [standings, season, roster] = await Promise.all([
    dispatchAction({ type: 'sportsleague.getStandings', actor: player }),
    dispatchAction({ type: 'sportsleague.getSeason', actor: player }),
    dispatchAction({ type: 'broadcast.getSportsTeams', actor: player }).catch(() => null),
  ]);
  const played = standings?.rows || [];
  const s = season || {};

  // Merge played rows with the full roster; anyone missing plays at 0-0.
  const byTeam = new Map(played.map(r => [r.team, r]));
  for (const name of (roster?.teams || [])) {
    if (!byTeam.has(name)) byTeam.set(name, { team: name, wins: 0, losses: 0, runs_for: 0, runs_against: 0 });
  }

  // Canonical order: win% → wins → run diff → name, with never-played teams last
  // (a played 0-1 team still outranks an unplayed 0-0 team, mirroring the SQL sort).
  const rd = (r) => (r.runs_for || 0) - (r.runs_against || 0);
  const rows = [...byTeam.values()].sort((a, b) => {
    const ga = a.wins + a.losses, gb = b.wins + b.losses;
    const pa = ga ? a.wins / ga : -1, pb = gb ? b.wins / gb : -1;
    if (pb !== pa) return pb - pa;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (rd(b) !== rd(a)) return rd(b) - rd(a);
    return a.team.localeCompare(b.team);
  });

  const teams = rows.map((r, i) => {
    const games = r.wins + r.losses;
    const pctRaw = games ? r.wins / games : 0;
    const pct = games ? (pctRaw >= 1 ? '1.000' : pctRaw.toFixed(3).replace(/^0/, '')) : '.000';
    const diff = rd(r);
    return {
      rank: i + 1,
      team: r.team,
      wins: r.wins,
      losses: r.losses,
      pct,
      rd: (diff > 0 ? '+' : '') + diff,
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
// Front-page order: the headline column leads (it's the lead article, drop-capped
// on the client), then the weather bureau box, then the sports box.
const SECTIONS = [headlinesSection, weatherSection, standingsSection];

async function buildSections(player) {
  const built = await Promise.all(SECTIONS.map(fn => fn(player).catch(() => null)));
  return built.filter(Boolean);
}

// The Coldwater Sentinel — the Basin's paper of record (and the Architect's
// paper of permission). The masthead reads the live game date off the same HUD
// snapshot; the client lays out the rest as newsprint.
function buildMasthead() {
  const hud = getHUDPayload();
  return {
    name: 'The Coldwater Sentinel',
    motto: 'All the truth the Architect permits.',
    dayOfWeek: hud?.dayOfWeek || '',
    date: hud?.date || '',
    season: hud?.season || '',
    edition: 'Basin Edition',
    price: '₵2',
  };
}

async function buildScreen(player) {
  return {
    view: 'news',
    breadcrumb: ['News'],
    masthead: buildMasthead(),
    sections: await buildSections(player),
  };
}

registerTabletApp({
  id: 'news', name: 'News', icon: '📰', category: 'General',
  buildScreen,
});
