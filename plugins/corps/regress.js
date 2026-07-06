// Corps plugin regression suite — run by tests/regress.js (never in production).
// Covers the corp-recruitment-poster `furniture.describe` branch: it claims only
// `corp_poster` furniture and returns undefined for everything else, so the
// posters plugin's own hook still runs (hook contract: last non-undefined wins).
import { _corpPosterPitch } from './index.js';

export default async function regress({ check }) {
  const poster = _corpPosterPitch({ name: 'a recruitment poster', flags: { corp_poster: true } });
  check('corp poster → renders the founding pitch', typeof poster === 'string' && /corp found/.test(poster), (poster || '').slice(0, 80));
  check('corp poster → offers the clickable command link', /action-link[^>]*data-action="corp"/.test(poster || ''));

  const wink = _corpPosterPitch({ name: 'a poster', flags: { corp_poster: true, architect_wink: true } });
  check('architect-wink poster → adds the fine-print motif', /NORTHERN ACCESS|—A/.test(wink || ''));
  check('plain corp poster → no wink motif', !/NORTHERN ACCESS/.test(poster || ''));

  check('non-corp furniture → undefined (yields to other hooks)', _corpPosterPitch({ name: 'a chair', flags: { hero_poster: true } }) === undefined);
  check('flagless furniture → undefined', _corpPosterPitch({ name: 'a crate', flags: {} }) === undefined);
  check('null furniture → undefined (no throw)', _corpPosterPitch(null) === undefined);
}
