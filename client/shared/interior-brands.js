// THE MAKERS: who built each 2076 airframe, and what that does to the cockpit.
//
// Four firms share the fleet. A maker sets the cabin's colours, the colour of its light lines and how
// its surfaces finish; the seat's own file still decides where everything goes. Warning colours are
// never a maker's: red, amber and green mean the same thing in every seat.
//
// `brandTrim` runs once, when a seat's module loads, after its own TEXTURE and SHINY lines. It writes
// into the trim's existing arrays rather than replacing them, because TEXTURE and SHINY are keyed on
// those arrays. A tone a trim doesn't have is skipped.

export const BRANDS = {
  // Military. Flat dark cabins and cold violet lines, nothing in the cabin to catch the eye at night.
  corvane: {
    name: 'Corvane Aerospace',
    tones: { lining: [58, 60, 62], liningDk: [42, 44, 46], headliner: [50, 52, 54], carbon: [28, 29, 30], carbonLt: [46, 47, 48], tub: [20, 21, 22],
      glow: [186, 176, 255], glowDim: [70, 64, 110], screen: [8, 8, 13] },
    line: [160, 150, 255],
    finish: { carbon: { spec: 0.18, pow: 14 }, carbonLt: { spec: 0.16, pow: 12 }, tub: { spec: 0.12, pow: 10 }, metal: { spec: 0.45, pow: 22 } },
  },
  // Transports. Warm grey, warm white lines, stitched leather: built for a ten-hour shift.
  harcourt: {
    name: 'Harcourt Airframes',
    tones: { lining: [122, 116, 106], liningDk: [92, 87, 80], headliner: [146, 140, 130], carbon: [52, 50, 48], carbonLt: [78, 75, 71], tub: [38, 36, 34],
      glow: [244, 232, 208], glowDim: [98, 90, 76], screen: [12, 11, 9] },
    line: [240, 226, 200],
    finish: { carbon: { spec: 0.3, pow: 22 }, carbonLt: { spec: 0.28, pow: 20 }, metal: { spec: 0.75, pow: 44 } },
    textures: { fabric: 'leather', fabricDk: 'leather' },
  },
  // Light craft. Pale gloss shells and a soft blue: an owner's aircraft, kept clean.
  lumen: {
    name: 'Lumen Light Aircraft',
    tones: { lining: [188, 190, 192], liningDk: [150, 153, 156], headliner: [206, 208, 210], carbon: [40, 44, 52], carbonLt: [70, 76, 86], tub: [30, 33, 40],
      glow: [130, 190, 255], glowDim: [48, 76, 112], screen: [6, 10, 18] },
    line: [112, 176, 255],
    finish: { carbon: { spec: 0.65, pow: 48 }, carbonLt: { spec: 0.6, pow: 44 }, tub: { spec: 0.5, pow: 40 }, lining: { spec: 0.35, pow: 30 }, metal: { spec: 0.85, pow: 56 } },
  },
  // Working aircraft. Bare olive enamel and yellow-green lines, cheap to hose down.
  ostler: {
    name: 'Ostler Works',
    tones: { lining: [92, 94, 72], liningDk: [68, 70, 54], headliner: [80, 82, 64], carbon: [38, 39, 32], carbonLt: [62, 64, 52], tub: [28, 29, 24],
      glow: [206, 236, 110], glowDim: [80, 92, 44], screen: [8, 11, 6] },
    line: [190, 226, 90],
    finish: { carbon: { spec: 0.22, pow: 16 }, carbonLt: { spec: 0.2, pow: 14 }, lining: { spec: 0.3, pow: 18 }, metal: { spec: 0.35, pow: 16 } },
  },
};

// Which firm built which seat, by the seat's trim prefix.
export const SEAT_BRAND = {
  viper: 'corvane', reaper: 'corvane', shrike: 'corvane',
  mule: 'harcourt', leviathan: 'harcourt',
  mayfly: 'lumen', dragonfly: 'lumen', grasshopper: 'lumen',
  locust: 'ostler', carcass: 'ostler',
};

export function brandTrim(T, seat, TEXTURE, SHINY) {
  const B = BRANDS[SEAT_BRAND[seat]];
  if (!B) return T;
  for (const [k, rgb] of Object.entries(B.tones)) if (T[k]) { T[k][0] = rgb[0]; T[k][1] = rgb[1]; T[k][2] = rgb[2]; }
  for (const [k, sh] of Object.entries(B.finish)) if (T[k]) SHINY.set(T[k], sh);
  for (const [k, tx] of Object.entries(B.textures || {})) if (T[k]) TEXTURE.set(T[k], tx);
  T.line = B.line;
  return T;
}
