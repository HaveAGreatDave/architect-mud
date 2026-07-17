// Corps plugin regression suite — run by tests/regress.js (never in production).
// Covers the corp-recruitment-poster `furniture.describe` branch: it claims only
// `corp_poster` furniture and returns undefined for everything else, so the
// posters plugin's own hook still runs (hook contract: last non-undefined wins).
import { _corpPosterPitch, colorDistance, MIN_COLOR_DISTANCE } from './index.js';
import { CORP_ASSET_TYPES, ventureConsoleBlock, warehouseStoreCapacity } from './ventures.js';

export default async function regress({ run, check }) {
  // ── Corporate Assets (ventures.js) — registry + console block ──────────────
  // The type registry is the "building framework"; every type must be well-formed
  // so the tick/console can trust its fields without guards.
  const R = CORP_ASSET_TYPES.restaurant;
  check('ventures: restaurant type exists', !!R, R);
  check('ventures: restaurant has a positive passive floor', R?.passiveFloor > 0, R?.passiveFloor);
  check('ventures: restaurant active share is a sane fraction', R?.activeShare > 0 && R?.activeShare <= 1, R?.activeShare);
  check('ventures: restaurant upkeep is non-negative', (R?.upkeep ?? -1) >= 0, R?.upkeep);
  check('ventures: all four types registered', ['restaurant', 'warehouse', 'security_office', 'front_office'].every(k => CORP_ASSET_TYPES[k]));
  check('ventures: every type has a label + numeric fields', Object.values(CORP_ASSET_TYPES).every(t =>
    typeof t.label === 'string' && typeof t.passiveFloor === 'number' && typeof t.upkeep === 'number' && typeof t.influenceProjection === 'number'));
  // The console block is safe for an org that owns nothing (empty array, never throws).
  const emptyBlock = ventureConsoleBlock('org-that-does-not-exist');
  check('ventures: console block for an assetless org is an empty array', Array.isArray(emptyBlock) && emptyBlock.length === 0);

  // ── Warehouse venture + pooled Logistics Store (the Yards build) ────────────
  const W = CORP_ASSET_TYPES.warehouse;
  check('ventures: warehouse type is fleshed (no longer a stub)', !!W && W.passiveFloor > 0 && (W.upkeep ?? -1) >= 0 && !W.TODO, W);
  check('ventures: warehouse has no storefront share (activeShare 0)', W?.activeShare === 0, W?.activeShare);
  check('ventures: warehouse projects territory influence', W?.influenceProjection > 0, W?.influenceProjection);
  // Pooled store capacity = 200kg × level, summed over WAREHOUSE ventures only
  // (a restaurant contributes nothing) — the pure, world-cache-free math.
  const cap = warehouseStoreCapacity([
    { asset_type: 'warehouse', level: 1 },
    { asset_type: 'warehouse', level: 2 },
    { asset_type: 'restaurant', level: 5 },
  ]);
  check('ventures: logistics store capacity = 200kg × level over warehouses only', cap === 600000, cap);
  check('ventures: store capacity for no warehouses is zero', warehouseStoreCapacity([]) === 0);
  // `corp warehouse` routes through the dispatcher (not an "unknown corp command").
  const wh = await run('corp warehouse');
  check('corp warehouse → routes through the corp dispatcher', !!wh && !/Unknown corp command/.test(wh.message || ''), (wh?.message || '').slice(0, 60));

  // `corp territory` — the big-map overlay layer: a corp-free control projection
  // the client merges onto the engine `map` tiles. Returns a control map keyed by
  // zone id + an org legend, and opens nothing (unlike `corp map`).
  const terr = await run('corp territory');
  check('corp territory → map_territory payload', terr?.type === 'map_territory', terr?.type);
  check('corp territory → control is an object', terr && terr.control && typeof terr.control === 'object' && !Array.isArray(terr.control));
  check('corp territory → orgs is an array', Array.isArray(terr?.orgs));

  const poster = _corpPosterPitch({ name: 'a recruitment poster', flags: { corp_poster: true } });
  check('corp poster → leads to the recruiter, not a command list', typeof poster === 'string' && /Denny Corliss/.test(poster) && !/corp found/.test(poster), (poster || '').slice(0, 80));
  check('corp poster → no clickable command link (mechanics live in dialogue)', !/action-link/.test(poster || ''));

  const wink = _corpPosterPitch({ name: 'a poster', flags: { corp_poster: true, architect_wink: true } });
  check('architect-wink poster → adds the fine-print motif', /NORTHERN ACCESS|—A/.test(wink || ''));
  check('plain corp poster → no wink motif', !/NORTHERN ACCESS/.test(poster || ''));

  // `corp edit color` distinctness gate — corps must keep a visibly different map
  // colour. colorDistance is the pure perceptual check the command guards on.
  check('color: identical colours have zero distance', colorDistance('#3366ff', '#3366ff') === 0);
  check('color: near-identical shades are below the distinct threshold', colorDistance('#ff2020', '#ff0000') < MIN_COLOR_DISTANCE);
  check('color: red vs green are comfortably distinct', colorDistance('#ff0000', '#00ff00') >= MIN_COLOR_DISTANCE);
  check('color: adjacent greys are too close', colorDistance('#888888', '#999999') < MIN_COLOR_DISTANCE);

  check('non-corp furniture → undefined (yields to other hooks)', _corpPosterPitch({ name: 'a chair', flags: { hero_poster: true } }) === undefined);
  check('flagless furniture → undefined', _corpPosterPitch({ name: 'a crate', flags: {} }) === undefined);
  check('null furniture → undefined (no throw)', _corpPosterPitch(null) === undefined);
}
