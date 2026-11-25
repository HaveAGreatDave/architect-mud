// HOW YOU LOOK TO YOURSELF: the seam for drawing your own body differently in one place.
//
// On foot in GLASS your body is drawn from the neck down in first person (freelook-view.js fpSelf), and whole in the
// view from behind you (V) and in the Pack. Normally that's the figure you're dressed as. A zone can ask for another
// look, a "self look", by name: the In Between draws you as an outline of light before you've made a character
// (docs/proposals/the-inbetween.md). This file only routes the name to whoever draws it; it draws nothing itself.
//
//   setZoneSelfLook(zone, name)   the zone wants `name` (null clears it)
//   registerSelfLook(name, skin)  `skin` is { draw(env) }: called in place of the ordinary figure with
//                                 { gl, self, cam, now, firstPerson } and returning true when it drew you.
//                                 Return false (or register nothing) and the ordinary figure is drawn.
//   selfLookFor(zone)             the name for that zone, or null
//   selfSkin(name)                the registered skin, or null
//
// An unregistered name falls back to the ordinary figure, so a zone can name its look before its shader lands.
const ZONE = new Map();
const SKINS = new Map();

export function setZoneSelfLook(zone, name) {
  if (!zone) return;
  if (name) ZONE.set(String(zone), String(name)); else ZONE.delete(String(zone));
}
export function selfLookFor(zone) { return (zone && ZONE.get(String(zone))) || null; }
export function registerSelfLook(name, skin) {
  if (!name) return;
  if (skin) SKINS.set(String(name), skin); else SKINS.delete(String(name));
}
export function selfSkin(name) { return (name && SKINS.get(String(name))) || null; }
