// Corps plugin regression suite — run by tests/regress.js (never in production).
// Covers the corp-recruitment-poster `furniture.describe` branch: it claims only
// `corp_poster` furniture and returns undefined for everything else, so the
// posters plugin's own hook still runs (hook contract: last non-undefined wins).
import { _corpPosterPitch } from './index.js';

export default async function regress({ run, check }) {
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

  check('non-corp furniture → undefined (yields to other hooks)', _corpPosterPitch({ name: 'a chair', flags: { hero_poster: true } }) === undefined);
  check('flagless furniture → undefined', _corpPosterPitch({ name: 'a crate', flags: {} }) === undefined);
  check('null furniture → undefined (no throw)', _corpPosterPitch(null) === undefined);
}
