// TRAILER BODIES: a 2076 body for a box you already own (docs/proposals/hover-rigs.md phase 6).
//
// The trailer's half of editions.js. A body is a look and nothing else: same kg, same rating, same
// price on resale, so the scale house and the contracts don't move. It's stored on the BOX
// (`trailers.body`), not the tractor, so a box looks the same whoever pulls it, and it rides the
// variant string as `~t<id>`, which aircraft3d.js reads as mesh_trailer_<id>.json and hangs on the
// tractor's pin.
//
// Each body fits one kind of box, the one it plainly is. Fitted at the yard (`yard body`); going back
// to the stock box is free and the yard keeps nothing, so going back to the body is paid for again.
import { TRAILER_TYPES } from './trailers.js';

export const TRAILER_BODIES = {
  container: { name: 'Container flatbed', fits: 'box', mul: 0.6,
    desc: 'A flatbed with three containers chained to it, the middle one in hazard orange. It holds what a dry box holds.' },
  podtrain: { name: 'Pod train', fits: 'reefer', mul: 0.6,
    desc: 'Three sealed pods on one spine, joined by lit couplers. It swings on one pin like any other box.' },
  cryo: { name: 'Cryo tanker', fits: 'tank', mul: 0.6,
    desc: 'Three insulated tanks with green rings and hazard diamonds. It carries what a tanker carries.' },
};

// Which kind a row is. A row stores its numbers, not its kind, so it's matched on them, as resale is.
export const trailerKindOf = (t) => TRAILER_TYPES.find((r) => r.kg === t?.kg && r.rated === t?.ratedKg)?.id || null;
export const bodiesFor = (t) => Object.entries(TRAILER_BODIES).filter(([, b]) => b.fits === trailerKindOf(t));
// What's on this box, read against the catalogue: a retired id, or one for another kind, is the stock box.
export const bodyOf = (t) => (t?.body && TRAILER_BODIES[t.body]?.fits === trailerKindOf(t) ? t.body : null);
export const bodySuffix = (t) => { const b = bodyOf(t); return b ? '~t' + b : ''; };
export function bodyPrice(t, id) {
  const b = TRAILER_BODIES[id], kind = TRAILER_TYPES.find((r) => r.id === trailerKindOf(t));
  return b && kind ? Math.round(kind.price * b.mul) : 0;
}
