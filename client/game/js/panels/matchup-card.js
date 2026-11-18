// The loading card: a flat 2-D picture over a game's view while its 3-D loads and until the first
// play. The league's mark, then tonight's two clubs, each by its crest and name, away on the left.
//
// It knows no league. The caller hands it the brand (an HTML string from cphl-brand.js or
// deadball-brand.js), the sport the crests are filed under (club-crest.js) and the two names. A club
// whose crest hasn't arrived yet gets a plain roundel with its initials; the caller paints the card
// again when the clubs turn up (onClubs). With no names yet it's the brand and the line alone.

import { loadCss } from '../../../shared/dom.js';
import { crestSvg, clubOf } from './club-crest.js';

const CSS = await loadCss(new URL('./matchup-card.css', import.meta.url));

function ensureCss(doc) {
  if (!CSS || !doc || doc.getElementById('matchup-card-styles')) return;
  const s = doc.createElement('style');
  s.id = 'matchup-card-styles';
  s.textContent = CSS;
  doc.head.appendChild(s);
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function initials(name) {
  const w = String(name).split(/\s+/).filter((x) => x && !/^(the|of|fc)$/i.test(x));
  return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : String(name).slice(0, 2)).toUpperCase();
}

function side(name, sport, cls) {
  const club = clubOf(name, sport);
  const badge = (club && crestSvg(club, 96, { title: name })) ||
    `<span class="mc-roundel">${esc(initials(name))}</span>`;
  return `<div class="mc-side ${cls}"><div class="mc-crest">${badge}</div><div class="mc-name">${esc(String(name).toUpperCase())}</div></div>`;
}

// The card's inner HTML. { brand, sport, away, home, line, venue }
export function matchupCardHtml({ brand = '', sport = '', away = '', home = '', line = '', venue = '' } = {}) {
  const both = away && home;
  return `<div class="mc-brand">${brand}</div>` +
    (both
      ? `<div class="mc-match">${side(away, sport, 'away')}<div class="mc-vs">AT</div>${side(home, sport, 'home')}</div>`
      : '') +
    (venue ? `<div class="mc-venue">${esc(venue)}</div>` : '') +
    (line ? `<div class="mc-line">${esc(line)}</div>` : '');
}

// Paint (or repaint) the card into `el`, adding the sheet to its document the first time.
export function paintMatchupCard(el, info) {
  if (!el) return;
  ensureCss(el.ownerDocument);
  el.classList.add('matchup-card');
  el.classList.toggle('mc-sport-' + (info?.sport || 'x'), true);
  el.innerHTML = matchupCardHtml(info);
}
