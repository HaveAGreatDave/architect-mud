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
import { query } from '../../server/models/db.js';
import { getZone } from '../../server/engine/world.js';

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
    // A scheduled hero event replaces the ordinary icon and label — the widget
    // has to name the thing, not bury it under "rain".
    icon: f.heroEventIcon || f.icon || '',
    weatherType: f.heroEventLabel || f.weatherType,
    heroEvent: f.heroEvent || null,
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

async function blotterSection(player) {
  const [warrants, deaths] = await Promise.all([
    dispatchAction({ type: 'WANTED_LIST', actor: player }).catch(() => null),
    query(
      `SELECT d.cause_label, d.cause_type, d.game_time, d.zone_id, p.handle
         FROM player_deaths d LEFT JOIN players p ON p.id = d.player_id
        ORDER BY d.real_ts DESC LIMIT 6`
    ).catch(() => ({ rows: [] })),
  ]);

  const entries = [];
  for (const w of (warrants?.wanted || []).slice(0, 5)) {
    entries.push({
      kind: 'warrant',
      stars: w.stars,
      who: w.handle,
      what: w.charges?.length ? w.charges.map(prettyCharge).join(', ') : 'outstanding charges',
    });
  }
  for (const d of (deaths?.rows || [])) {
    entries.push({
      kind: 'incident',
      who: d.handle || 'an unidentified body',
      what: d.cause_label || prettyCharge(d.cause_type) || 'cause undetermined',
      where: zoneName(d.zone_id),
      when: d.game_time || '',
    });
  }

  // Nothing at all is a real state and reads better said out loud than as an
  // empty box — a quiet night is characterful in a city like this one.
  if (!entries.length) {
    return {
      id: 'blotter', title: '🚔 Police Blotter', type: 'blotter',
      subtitle: 'Filed by Precinct 9',
      entries: [], quiet: 'No arrests, no bodies, no complaints upheld. Enjoy it.',
    };
  }
  const warrantCount = (warrants?.wanted || []).length;
  return {
    id: 'blotter', title: '🚔 Police Blotter', type: 'blotter',
    subtitle: warrantCount
      ? `${warrantCount} active warrant${warrantCount === 1 ? '' : 's'} · Filed by Precinct 9`
      : 'Filed by Precinct 9',
    entries,
  };
}

// crime keys are snake_case machine strings; a newspaper prints English.
function prettyCharge(k) {
  if (!k) return '';
  return String(k).replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}
function zoneName(id) {
  if (!id) return '';
  return getZone(id)?.name || '';
}


// The section roster, in feed order. Each entry is an async builder; a builder
// that throws or returns null is simply skipped so one dead section never blanks
// the whole feed.
// Front-page order: the headline column leads (it's the lead article, drop-capped
// on the client), then the weather bureau box, then the sports box.
// Standings left the front page when the Sports app landed — a league table is a
// screen of its own, not a squeezed box, and the blotter is the better lead.
const SECTIONS = [headlinesSection, weatherSection, blotterSection];

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
