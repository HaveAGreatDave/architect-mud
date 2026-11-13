// The scenes a flat's shutters can show across its glass (README.md "Shutters"). Data only: the Room
// Stage draws each with one of a handful of generic painters (client/game/js/panels/gl/room-shutters.js),
// picked by `kind` and coloured by `a` (the deep), `b` (the middle), `c` (the bright detail). `glow` is
// the light the scene throws into the room. A panel offers the ones its row lists in
// `flags.envctl.scenes`, in that order, or all of them.
//
// `words` are what `shutters <scene>` also answers to, besides the id and the name.

export const SCENES = {
  space: {
    name: 'Deep space', kind: 'stars', a: '#020309', b: '#4a2470', c: '#ffd9a0', glow: '#3c3a66',
    words: ['space', 'stars', 'starfield'],
    shows: 'Stars to the floor, a violet nebula, and a ringed planet turning slowly.',
  },
  underwater: {
    name: 'Underwater', kind: 'water', a: '#01121f', b: '#0b6f8f', c: '#a6f2e4', glow: '#2a7a98',
    words: ['sea', 'reef', 'ocean', 'water'],
    shows: 'Blue water with light coming down through it in bands, and fish going past the glass.',
  },
  storm: {
    name: 'Storm at sea', kind: 'storm', a: '#080d12', b: '#3a4852', c: '#dfe8ff', glow: '#4e5a64',
    words: ['storm', 'waves', 'gale'],
    shows: 'A grey swell under a low sky. Rain, and now and then lightning.',
  },
  desert: {
    name: 'Desert sunset', kind: 'dunes', a: '#2e1030', b: '#ff7a3a', c: '#ffe2a0', glow: '#c86c40',
    words: ['desert', 'dunes', 'sunset'],
    shows: 'Dunes going purple under an orange sky, with the sun on the skyline.',
  },
  aurora: {
    name: 'Aurora', kind: 'aurora', a: '#020812', b: '#34f0a0', c: '#a466ff', glow: '#2e7a68',
    words: ['aurora', 'northern lights', 'snow', 'lake'],
    shows: 'Green curtains of light ripple over a black pine forest, violet at their tops, and a still lake doubles them.',
  },
  matte: {
    name: 'Matte', kind: 'matte', a: '#bcb5a9', b: '#a8a195', c: '#f4efe6', glow: '#b4ac9e',
    words: ['matte', 'plain', 'blank', 'grey', 'gray'],
    shows: 'Plain panels, lit an even warm grey.',
  },
  // not a scene: blue Venetian blinds, slats tilted to let in `level` per cent of the light (BLINDS_KIND)
  blinds: {
    name: 'Blinds', kind: 'blinds', a: '#1f3f5c', b: '#6f9dc4', c: '#d6e8f4', glow: '#7aa6cc',
    words: ['blind', 'venetian blinds', 'curtains'],
    shows: 'Pale blue Venetian blinds, floor to ceiling.',
  },
};

// The kind that's the blinds: no display, and a light level instead of a picture.
export const BLINDS_KIND = 'blinds';

export const SCENE_IDS = Object.keys(SCENES);

// The scenes a panel offers, in its order: the row's `scenes` that are real, or every scene.
export function scenesOf(cfg) {
  const own = Array.isArray(cfg?.scenes) ? cfg.scenes.filter((id) => SCENES[id]) : [];
  return own.length ? own : SCENE_IDS;
}

// A scene by what somebody typed: its id, its name, or one of its words. Only among `offered`.
export function findScene(word, offered = SCENE_IDS) {
  const w = String(word || '').toLowerCase().trim();
  if (!w) return null;
  return offered.find((id) => id === w)
    || offered.find((id) => SCENES[id].name.toLowerCase() === w)
    || offered.find((id) => SCENES[id].words.includes(w))
    || offered.find((id) => SCENES[id].name.toLowerCase().startsWith(w))
    || null;
}

// A colour someone picked for the blinds, as '#rrggbb', or null if it isn't one.
export const hexOf = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim()); return m ? '#' + m[1].toLowerCase() : null; };
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixHex = (h, to, k) => { const a = rgbOf(h), b = rgbOf(to); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, '0')).join(''); };

// What the Room Stage draws a scene with: its painter and colours, nothing else. The blinds take `colour`, the
// cloth's own, if one was picked: the shade side and the light through it are worked out from it.
export function paintOf(id, colour = null) {
  const s = SCENES[id] || SCENES.matte, c = s.kind === BLINDS_KIND ? hexOf(colour) : null;
  if (!c) return { kind: s.kind, a: s.a, b: s.b, c: s.c, glow: s.glow };
  return { kind: s.kind, a: mixHex(c, '#000000', 0.62), b: c, c: mixHex(c, '#ffffff', 0.72), glow: mixHex(c, '#ffffff', 0.25) };
}

// A colour's plain name for the log: "blue", "dark green", "pale pink", "grey".
export function colourName(hex) {
  const h6 = hexOf(hex);
  if (!h6) return 'coloured';
  const [r, g, b] = rgbOf(h6).map((v) => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.15) return l < 0.18 ? 'black' : l > 0.86 ? 'white' : l < 0.4 ? 'dark grey' : l > 0.7 ? 'pale grey' : 'grey';
  let hue = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  const name = hue < 15 || hue >= 340 ? (l > 0.7 ? 'pink' : 'red') : hue < 40 ? (l < 0.4 ? 'brown' : 'orange') : hue < 65 ? 'yellow' : hue < 160 ? 'green' : hue < 195 ? 'teal' : hue < 255 ? 'blue' : hue < 290 ? 'purple' : 'pink';
  return `${l < 0.3 ? 'dark ' : l > 0.75 ? 'pale ' : ''}${name}`;
}
