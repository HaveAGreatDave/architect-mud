/**
 * THE BIRD CENSUS — what the fauna arithmetic says is in the world right now.
 *
 * ⚠ IT ANSWERS A QUESTION NOTHING ELSE COULD, and that is the reason it exists rather than
 * tidiness. A flock is not an entity: it is a pure function of its anchor tile and the wall clock
 * (see the header of client/shared/birds.js), so there is no table to SELECT from and no list of
 * live birds anywhere in the process. The only way to know what is out there has been to fly to it
 * and look — and every bug this system has ever had was the kind you cannot see that way:
 *
 *   · 699 of the ~1,600 standable city tiles silently dropped every pigeon, gull and songbird,
 *     while the room description said the birds were there
 *   · `pushFauna` took a literal 'goose' for months, so every bird in the world was built out of
 *     the goose mesh while the budget was charged per species and the prose named the right animal
 *   · the vulture was fully authored — row, model, bake, voice, prose, gate — and lived NOWHERE,
 *     because `speciesAt` answered null on every terrain it owned
 *   · the settle window read `U_GROUND`, the GOOSE's ground share, pinning a flock in the formation
 *     it landed in for half its time down
 *
 * Every one of those is one glance at a species × count table. None of them threw, and each one's
 * wrong answer looked completely legitimate.
 *
 * ⚠ AND THE SEASON IS THE CASE THAT FORCED IT. `BIRD_TUNE.season` makes a starling flock swing from
 * a party of nine to a cloud of a thousand across the game year, and a game year is a real year at
 * timeScale 1 — so "is it working" is not a question anybody can answer by looking out of a window.
 * The year and day curves below are that question answered as arithmetic.
 *
 * ⚠ IT IS A DEV SURFACE AND MUST STAY ONE. Nothing here may ever reach a player: the unrest system
 * already settled this argument for the whole codebase — the moment a sim has a readout, it becomes
 * a dashboard to optimise and the flavour dies, so the line is the CLIENT BOUNDARY rather than the
 * data, and the dev panel is the deliberate opposite and gets every scalar.
 *
 * ⚠ ZERO QUERIES, BY CONTRACT. `world.zones` and `tileIndex()` are already in RAM and the flock
 * arithmetic is pure, so a whole-world sweep is a walk over a Map. Do not make this await anything
 * in a loop — see the read tiers in docs/architecture.md.
 *
 * ⚠ AND IT REUSES birds.js RATHER THAN RESTATING IT. A census that derived habitat or size its own
 * way would be a second opinion about the same question, which is the bug this repo keeps
 * recording — and the one place it would be most convincing, because a plausible wrong census is
 * indistinguishable from a right one.
 */
import { world, tileSurroundings } from '../engine/world.js';
import { getEnvironmentState, getGameHour, getGameDate } from '../engine/environment.js';
import {
  SPECIES, BIRD_TUNE, flockAt, flockState, speciesAt, placeOf, habitatState,
  birdDaylight, perchedNow, skeinForm, FORM_WORDS, seasonFactor, roostFactor, doyOf,
} from '../../client/shared/birds.js';

// ── The one derivation, shared with describe.js ────────────────────────────────
//
// ⚠ THIS IS gooseLine's OWN PREAMBLE AND IT IS COPIED DELIBERATELY RATHER THAN IMPORTED. That
// function returns PROSE — it picks a sentence and formats it — and what is wanted here is the
// facts it threw away on the way. What matters is that every STEP below calls the same shared
// function describe.js calls, in the same order, so the two cannot disagree about what is on a
// tile; the rule is one source for each ANSWER, not one function for both callers.
//
// ⚠ AND THE PLACE IS NOT THE PAINT. `flags.terrain` says what the ground is made of and nothing
// about who lives on it — Coldwater's streets are painted `redrock` — so the place comes from
// counting building neighbours, which is what put the pigeon on more than one tile in the world.
function birdsOnTile(zone, weather, hour, doy) {
  const t = zone?.flags?.terrain;
  if (!t) return null;
  const gx = zone.grid_x, gy = zone.grid_y;
  if (gx == null || gy == null || (gx === 0 && gy === 0)) return null;
  if (zone.flags?.is_building || zone.flags?.building_type) return null;
  const sur = tileSurroundings(zone);
  const place = placeOf(t, sur.bld, sur.shore);
  const sid = speciesAt(place, gx, gy, { weather });
  if (!sid) return null;
  const habitat = habitatState(sid, place);
  if (!habitat) return null;
  const daylight = birdDaylight(sid, hour);
  const flock = flockAt(gx, gy, 1, sid);
  if (!flock) return { zone, gx, gy, terrain: t, place, sid, habitat, daylight, flock: null };
  // ⚠ THE SAME (hour, doy) PAIR BOTH OTHER SURFACES GET. Hand this one a different season and the
  // census would confidently disagree with both the room and the window about the same birds.
  const st = flockState(flock, Date.now(), null, { hour, doy });
  return {
    zone, gx, gy, terrain: t, place, sid, habitat, daylight, flock,
    n: st.n, airborne: st.airborne, u: st.u, z: st.z, period: st.period,
    cx: st.cx, cy: st.cy, heading: st.heading,
    // ⚠ perchedNow IS THE SHARED HALF AND THE LEDGE IS NOT. Whether a flock WANTS to be up on
    // something is arithmetic both surfaces run; WHICH ledge it stands on is captured GLASS
    // geometry the server has never had, so this can only ever answer the first half. That split
    // is the known one describe.js documents, and it costs 11 of the city's 375 buildings a
    // disagreement between the room and the window.
    perched: !st.airborne && sur.bld > 0 && perchedNow(flock, Date.now()),
    form: st.airborne ? (FORM_WORDS[skeinForm(flock, Date.now())] || null) : null,
    cloud: !!SPECIES[sid]?.thin && st.airborne,   // a species with a `thin` floor is a boids cloud
  };
}

const median = (xs) => (xs.length ? xs.slice().sort((a, b) => a - b)[xs.length >> 1] : 0);

/** Every surface tile the world holds, once, in RAM. */
function surfaceTiles(mapId) {
  const out = [];
  for (const z of world.zones.values()) {
    if (mapId && z.map_id !== mapId) continue;
    if (z.grid_x == null || z.grid_y == null) continue;
    if ((z.grid_z ?? 0) !== 0) continue;         // the sewer layer is not sky
    out.push(z);
  }
  return out;
}

/**
 * GET /fauna-census  — the whole world, by species.
 *   ?map=map_world   ?hour=20.3   ?doy=8   ?top=40
 *
 * `hour` and `doy` override the live clock so the season can be READ rather than waited for; both
 * are the dev-panel twin of RENDER_TUNE.hourForce / doyForce on the renderer side.
 */
export function apiFaunaCensus(qs = {}) {
  const env = getEnvironmentState() || {};
  const mapId = qs.map || 'map_world';
  const weather = qs.weather || env.weatherType || '';
  const hour = qs.hour != null && qs.hour !== '' ? Number(qs.hour) : getGameHour();
  const doy = qs.doy != null && qs.doy !== '' ? Number(qs.doy) : doyOf(getGameDate());
  const top = Math.min(Math.max(Number(qs.top) || 40, 1), 400);

  const tiles = surfaceTiles(mapId);
  const per = new Map();
  const flocksFound = [];
  let habitable = 0;

  for (const z of tiles) {
    const b = birdsOnTile(z, weather, hour, doy);
    if (!b) continue;
    habitable++;
    let row = per.get(b.sid);
    if (!row) {
      const sp = SPECIES[b.sid] || {};
      row = { id: b.sid, tiles: 0, flocks: 0, birds: 0, airborne: 0, perched: 0, clouds: 0,
              sizes: [], daylight: !!b.daylight, offDuty: 0,
              declared: { minFlock: sp.minFlock, maxFlock: sp.maxFlock, thin: sp.thin ?? null,
                          drawRange: sp.drawRange, dayStart: sp.dayStart, dayEnd: sp.dayEnd,
                          hasSeason: !!sp.season, hasRoost: !!sp.roost } };
      per.set(b.sid, row);
    }
    row.tiles++;
    if (!b.flock) continue;
    // ⚠ A FLOCK OUT OF ITS DAY WINDOW IS COUNTED SEPARATELY RATHER THAN DROPPED. It still exists
    // in the arithmetic — `flockAt` answered one — and both other surfaces simply decline to draw
    // or mention it. Folding the two together is how "the birds have gone" and "the birds were
    // never there" become one number, which is exactly the confusion the vulture bug lived in.
    if (!b.daylight) { row.offDuty++; continue; }
    row.flocks++;
    row.birds += b.n;
    row.sizes.push(b.n);
    if (b.airborne) row.airborne++;
    if (b.perched) row.perched++;
    if (b.cloud) row.clouds++;
    flocksFound.push({ x: b.gx, y: b.gy, sp: b.sid, n: b.n, airborne: b.airborne,
                       perched: b.perched, place: b.place, terrain: b.terrain,
                       z: +(b.z ?? 0).toFixed(2), form: b.form, cloud: b.cloud });
  }

  const species = [...per.values()].map((r) => ({
    id: r.id, tiles: r.tiles, flocks: r.flocks, birds: r.birds, airborne: r.airborne,
    perched: r.perched, clouds: r.clouds, offDuty: r.offDuty, daylight: r.daylight,
    minSize: r.sizes.length ? Math.min(...r.sizes) : 0,
    maxSize: r.sizes.length ? Math.max(...r.sizes) : 0,
    medSize: median(r.sizes),
    declared: r.declared,
  })).sort((a, b) => b.birds - a.birds);

  // ⚠ EVERY AUTHORED SPECIES IS LISTED EVEN AT ZERO, which is the whole vulture lesson: a species
  // with no row here reads as "none about at this hour" and a species that is ABSENT FROM THE
  // TABLE reads as nothing at all. It was the second for months and nobody could tell.
  for (const id of Object.keys(SPECIES)) {
    if (per.has(id)) continue;
    const sp = SPECIES[id];
    species.push({ id, tiles: 0, flocks: 0, birds: 0, airborne: 0, perched: 0, clouds: 0,
                   offDuty: 0, daylight: birdDaylight(id, hour), minSize: 0, maxSize: 0, medSize: 0,
                   homeless: true,
                   declared: { minFlock: sp.minFlock, maxFlock: sp.maxFlock, thin: sp.thin ?? null,
                               drawRange: sp.drawRange, dayStart: sp.dayStart, dayEnd: sp.dayEnd,
                               hasSeason: !!sp.season, hasRoost: !!sp.roost } });
  }

  return {
    now: { date: getGameDate(), doy, hour: +Number(hour).toFixed(2), season: env.season || null, weather },
    forced: { hour: qs.hour != null && qs.hour !== '', doy: qs.doy != null && qs.doy !== '' },
    tune: { season: BIRD_TUNE.season },
    scanned: { map: mapId, tiles: tiles.length, habitable },
    species,
    hotspots: flocksFound.sort((a, b) => b.n - a.n).slice(0, top),
    curves: faunaCurves(weather, hour, doy),
  };
}

/**
 * The season and the evening, as numbers, for every species that has them.
 *
 * ⚠ THIS IS THE POINT OF THE WHOLE PANEL. The starling's year is measured in game MONTHS, so no
 * amount of looking out of a window answers whether it works — and the two curves multiply, so the
 * only honest way to read either is beside the other.
 */
function faunaCurves(weather, hour, doy) {
  const out = {};
  for (const id of Object.keys(SPECIES)) {
    const sp = SPECIES[id];
    if (!sp.season && !sp.roost) continue;
    out[id] = {
      // one point a month, at the gathering's own peak hour, so the year reads as the year
      year: Array.from({ length: 12 }, (_, m) => {
        const d = doyOf(`2026-${String(m + 1).padStart(2, '0')}-15`);
        return { month: m + 1, season: +seasonFactor(sp, d).toFixed(3) };
      }),
      // and one point a half-hour through the day at the year's own setting
      day: Array.from({ length: 48 }, (_, i) => {
        const h = i / 2;
        return { hour: h, roost: +roostFactor(sp, h).toFixed(3) };
      }),
      at: { season: +seasonFactor(sp, doy).toFixed(3), roost: +roostFactor(sp, hour).toFixed(3),
            product: +(seasonFactor(sp, doy) * roostFactor(sp, hour)).toFixed(4) },
    };
  }
  return out;
}

/**
 * GET /fauna-tile?x=&y=  — everything about one tile, including why it holds nothing.
 *
 * ⚠ THE REFUSALS ARE THE USEFUL HALF. "No birds here" has six different causes — no terrain, a
 * building, off the grid, no species claims the place, the species does not use that ground, or the
 * per-tile roll simply failed — and they are not the same finding. Four of the bugs in this file's
 * header were one of those six being wrong while the other five looked fine.
 */
export function apiFaunaTile(qs = {}) {
  const env = getEnvironmentState() || {};
  const mapId = qs.map || 'map_world';
  const gx = Number(qs.x), gy = Number(qs.y);
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return { error: 'x and y are required' };
  const weather = qs.weather || env.weatherType || '';
  const hour = qs.hour != null && qs.hour !== '' ? Number(qs.hour) : getGameHour();
  const doy = qs.doy != null && qs.doy !== '' ? Number(qs.doy) : doyOf(getGameDate());

  let zone = null;
  for (const z of world.zones.values()) {
    if (z.map_id === mapId && z.grid_x === gx && z.grid_y === gy && (z.grid_z ?? 0) === 0) { zone = z; break; }
  }
  if (!zone) return { x: gx, y: gy, found: false, why: 'no zone at that grid position on ' + mapId };

  const base = { x: gx, y: gy, found: true, zoneId: zone.id, name: zone.name,
                 terrain: zone.flags?.terrain || null,
                 building: !!(zone.flags?.is_building || zone.flags?.building_type) };
  if (!base.terrain) return { ...base, why: 'the tile has no flags.terrain, so no ground to live on' };
  if (base.building) return { ...base, why: 'the tile is a building — a flock stands on ground' };

  const sur = tileSurroundings(zone);
  const place = placeOf(base.terrain, sur.bld, sur.shore);
  const out = { ...base, neighbours: sur, place,
                // ⚠ THE PLACE, NOT THE PAINT — printed side by side precisely because the gap
                // between them is where three species lost their homes.
                paintVsPlace: base.terrain === place ? 'same' : `${base.terrain} → ${place}` };

  // Who COULD be here, before the tile's own co-tenant roll picks one. A species that uses this
  // ground and lost the hash is a completely different state from one that never uses it.
  out.candidates = Object.keys(SPECIES).filter((id) => !!habitatState(id, place));
  const sid = speciesAt(place, gx, gy, { weather });
  if (!sid) return { ...out, why: `no species claims the place '${place}'` };
  out.species = sid;
  out.lostTheRoll = out.candidates.filter((id) => id !== sid);
  out.habitat = habitatState(sid, place);
  out.daylight = birdDaylight(sid, hour);

  const sp = SPECIES[sid];
  out.declared = { minFlock: sp.minFlock, maxFlock: sp.maxFlock, drawRange: sp.drawRange,
                   dayStart: sp.dayStart, dayEnd: sp.dayEnd, thin: sp.thin ?? null,
                   hasSeason: !!sp.season, hasRoost: !!sp.roost };
  out.curve = (sp.season || sp.roost)
    ? { season: +seasonFactor(sp, doy).toFixed(3), roost: +roostFactor(sp, hour).toFixed(3) } : null;

  const flock = flockAt(gx, gy, 1, sid);
  if (!flock) return { ...out, why: `the per-tile roll failed — ${sid} lives on '${place}' but not on this tile` };
  const st = flockState(flock, Date.now(), null, { hour, doy });
  return { ...out, flock: {
    n: st.n, airborne: st.airborne, u: +st.u.toFixed(3), period: Math.round(st.period),
    z: +(st.z ?? 0).toFixed(3), cx: +st.cx.toFixed(2), cy: +st.cy.toFixed(2),
    heading: +(st.heading ?? 0).toFixed(2),
    perched: !st.airborne && sur.bld > 0 && perchedNow(flock, Date.now()),
    form: st.airborne ? (FORM_WORDS[skeinForm(flock, Date.now())] || null) : null,
    cloud: !!sp.thin && st.airborne,
  }, now: { doy, hour: +Number(hour).toFixed(2), weather }, tune: { season: BIRD_TUNE.season } };
}
