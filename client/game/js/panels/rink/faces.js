// A rink player's face, from the street figures' head generator.
//
// The head is actor-head.js's and the face is a layout from the baked atlas in actor-faces.js,
// tinted with the player's own skin and hair (docs/proposals/street-figure-heads.md). This picks
// which layout, which eyes and which haircut a body gets, the way `actorFace` does for a figure
// on the street, and works out the colours the head shader tints the layout with.
//
// ⚠ THE PICK COMES OFF THE NAME, NOT THE BODY. The director puts a player's name on whichever
// body is carrying his part, and the body's seed changes from game to game, so a face picked off
// the seed would change with it. Keyed on the name, Lindqvist has the same face every night, in
// the replay and on the live picture. An unnamed body (a spare skater, a linesman) uses its seed.
// ⚠ AND NO MAKEUP LAYOUTS FOR THE PLAYERS OR THE OFFICIALS. The booth calls every one of them "he";
// a medic can have any face. A player's layout leans to stubble and beards (a full beard half as
// likely again as a clean face, the way a dressing room looks by spring), and his lips are a
// little nearer his skin than the street's.
import { FACE_LAYOUTS, actorFace, faceCell, faceHair, faceLip } from '../actor-faces.js';
import { hash } from './util.js';

const PLAIN = FACE_LAYOUTS.map((L, i) => (L.makeup ? -1 : i)).filter((i) => i >= 0);
const PLAIN_W = PLAIN.map((i) => 1 + 0.25 * FACE_LAYOUTS[i].beard), PLAIN_SUM = PLAIN_W.reduce((a, w) => a + w, 0);
function plainLayout(r) {
  let x = r * PLAIN_SUM;
  for (let k = 0; k < PLAIN.length; k++) if ((x -= PLAIN_W[k]) < 0) return PLAIN[k];
  return PLAIN[PLAIN.length - 1];
}
const hex255 = (h, dflt) => {
  const s = /^#[0-9a-f]{6}$/i.test(String(h || '')) ? h : dflt;
  return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const unit = (c) => c.map((v) => v / 255);

const cache = new Map();
// { layout, cell, style, skin, hair, lip, iris, seed }: the colours in 0..1, the cell as
// faceCell gives it, the hair style as hairMesh numbers it.
export function rinkFace(o) {
  const id = o.name ? `name:${o.name}` : `seed:${o.kind || 'skater'}:${o.seed ?? 0}`;
  const key = `${id}|${o.skin}|${o.hair}`;
  let f = cache.get(key);
  if (f) return f;
  const rand = (k) => hash(`face:${id}:${k}`) / 4294967296;
  const pick = actorFace(rand), medic = o.kind === 'medic';
  // (13 is the slot actorFace takes the layout from)
  const layout = medic ? pick.layout : plainLayout(rand(13));
  const skin = hex255(o.skin, '#e0b08c'), lip = faceLip(skin);
  f = {
    layout, cell: faceCell(layout), style: pick.hairStyle,
    skin: unit(skin), hair: unit(faceHair(hex255(o.hair, '#2a1c14'), layout)),
    lip: unit(medic ? lip : lip.map((c, i) => c + (skin[i] * 0.8 - c) * 0.35)),
    iris: unit(pick.iris), seed: (hash(`face:${id}:seed`) % 1000) / 20,
  };
  if (cache.size > 512) cache.clear();
  cache.set(key, f);
  return f;
}
