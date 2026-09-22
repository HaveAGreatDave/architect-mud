// A HOUSE CAST PER BUILDING — the Glasshouse's polished ramps, nudged off one hue.
//
// THE PROBLEM THIS EXISTS FOR, MEASURED. The Glasshouse quarter is drawn almost entirely by
// `drawFacetDrum` (85.4% of its wall faces), and a drum's surface is the `hfChrome` / `hfGlass`
// closure — no wall texture, no material family, one fixed key direction. Those ramps already
// VARY: 133 calls over 69 distinct lo→hi pairs, every one of them hand-picked. And the quarter
// still reads as one white material, because every one of those 69 ramps is the SAME HUE —
// 17–29% saturation at the dark end and **2–12% at the light end**. `hfChrome` raises the facet's
// light dot to a power ≥ 2, so most of every drum sits at the LIGHT end, which is exactly where
// they are all the same near-white. The variation is entirely in LIGHTNESS and it lands where
// nobody can see it.
//
// ⚠ SO THE CAST IS A HUE, AND IT IS APPLIED HARDEST WHERE THE RAMPS CONVERGE. The nudge scales
// with the colour's own luminance (`k = Y / 255`), so a dark facet at the foot of a ramp moves
// about half as far as a lit one at the top of it. Written as a flat offset it would do its work
// on the shadow side, where every ramp is already 20%-odd saturated and already distinguishable.
//
// ⚠ AND IT IS LUMINANCE-NEUTRAL BY CONSTRUCTION, NOT BY ARITHMETIC SOMEBODY CHECKED. A cast is
// authored as an ANGLE in the YIQ chroma plane, and the I and Q axes are the two directions in
// which RGB moves with `dY = 0` — so `0.299·dr + 0.587·dg + 0.114·db` is zero for every entry in
// the table below, at every amplitude, however the table is retuned. That is what keeps the
// estate reading as one developer's cladding rather than as a set of buildings painted different
// colours, and it is why the night look is unaffected: a cast changes which way a facet is
// tinted, never how bright it is.
//
// ⚠ IT IS A PROPERTY OF THE POLISHED RAMP, NOT OF COLDWATER. Nothing here names a district, a
// tile or a building — a batch of clad panels varying slightly between deliveries is a fact about
// clad panels. The five arms outside the Glasshouse that use the same ramp (`gasholder`,
// `substation`, `exchange`, `fire_station`, `skullbob`) get it too, and should.

// The chroma basis. Inverse YIQ: R = Y + 0.956 I + 0.621 Q, and so on down. Only the I/Q parts
// are here, because the Y part is the colour we are tinting.
const IQ_R = [0.956, 0.621];
const IQ_G = [-0.272, -0.647];
const IQ_B = [-1.106, 1.703];

// How far a cast may move a fully lit facet, in 0..255 on its largest channel. **This is the
// "subtle" knob**, and it was set against the picture rather than against the table.
//
// Measured on a pinned-clock A/B of the quarter from the air (`__castAB` in the Modelshop, control
// 0.00%): **13 moves 7.5% of the frame at a mean of 3.4 levels and a peak of 9; 20 moves 14.1% at
// a mean of 4.2 and a peak of 14.** 13 is at the bottom of what reads at all — side by side you
// can find it, and flying past you cannot — and 20 is where two towers of the same TYPE stop
// looking like the same building without the quarter looking painted. Past about 26 it is no
// longer a batch of cladding, which is the ceiling `hftint.mjs` holds.
export const HF_AMP = 20;

// ⚠ THE FIELD IS CYAN THROUGH VIOLET AND THE TABLE SAYS SO. `building-styles.md` §2.1 gives the
// quarter "cyan and violet in the field, hot magenta as punctuation", so the casts cluster in that
// wedge and the two warm entries are there to stop the wedge itself becoming the new uniform.
// ⚠ AND `as built` IS IN THE TABLE ON PURPOSE. An estate where EVERY building carries a cast is
// as uniform as one where none does; some of them have to be the plain pale blue-grey.
export const HF_CASTS = [
  { name: 'as built', hue: 0, amp: 0 },
  { name: 'ice', hue: 205, amp: 1.00 },
  { name: 'sea glass', hue: 145, amp: 0.85 },
  { name: 'lilac', hue: 285, amp: 0.80 },
  { name: 'pearl', hue: 35, amp: 0.65 },
  { name: 'steel', hue: 230, amp: 0.55 },
  { name: 'aqua', hue: 175, amp: 0.95 },
  { name: 'champagne', hue: 60, amp: 0.50 },
];

// An authored entry resolved to the RGB offset a fully lit facet takes. Normalised on the largest
// channel so `amp` means the same thing at every hue — without it the table's amplitudes would be
// scaled by however long the YIQ basis happens to be in that direction, and retuning one entry
// would silently change what the others mean.
function castRGB(c) {
  const t = (c.hue * Math.PI) / 180, i = Math.cos(t), q = Math.sin(t);
  const o = [IQ_R[0] * i + IQ_R[1] * q, IQ_G[0] * i + IQ_G[1] * q, IQ_B[0] * i + IQ_B[1] * q];
  const mx = Math.max(Math.abs(o[0]), Math.abs(o[1]), Math.abs(o[2])) || 1;
  const s = (HF_AMP * c.amp) / mx;
  return [o[0] * s, o[1] * s, o[2] * s];
}
const CAST_RGB = HF_CASTS.map(castRGB);

// ⚠ THE SEED IS HASHED AND NOT TAKEN MODULO. The tile seed is `(wx + 512)·73 + (wy + 512)·149`,
// which is linear in both coordinates — so `seed % 8` walks the table in lockstep along a street
// and lays the casts down in stripes. `frac` is windshield's own sine hash and is what every other
// per-tile roll in the renderer already uses.
const frac = (n) => { const x = Math.sin((n + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); };

// Which cast this tile's building wears. Pure in the seed, which is what lets GLASS 2 carry it:
// `meshParams` already includes the seed, so the per-model mesh memo is per-TILE and a seeded
// colour reaches the depth buffer correctly. A colour derived from anything else — the hour, the
// camera, the power state — would be frozen at capture and is what `POWER_NB` has to ride the
// group to avoid.
export function hfCastFor(seed) {
  return CAST_RGB[(frac(seed * 1.37 + 17) * CAST_RGB.length) | 0] || CAST_RGB[0];
}

// ── AND WHAT THE BUILDING IS FACED IN ────────────────────────────────────────────────────────
//
// A cast varies the HUE of one material. This varies the MATERIAL — chrome, glass, marble and gold
// are all the Glasshouse, and a quarter faced entirely in clad panel is as uniform in material as
// it was in colour. A house is a remap of the three cladding keys the arms actually paint with, so
// **no arm is edited**: thirteen silhouettes, one table, and some of the estate comes out mirrored,
// some in Calacatta, some in blue onyx, some with gilt collars.
//
// ⚠ `as built` IS IN HERE THREE TIMES ON PURPOSE. The brief was *some* of the buildings, and an
// estate where every tower is a different stone is a showroom. Three in eight stay clad panel.
//
// ⚠ AND THE PALE KEY IS THE ONE THAT CARRIES GOLD. `ty_hf_ice` is what the arms use for collars,
// canopies, crowns and entrance discs — gold on those is a gilt building, where gold on the SHAFT
// key is a gold building, which is not a thing anyone has ever built at this size.
//
// ⚠ AND THE GLAZING IS NOT REMAPPED AT ALL, WHICH IS AN ATLAS BUDGET AND NOT A DESIGN CHOICE. A
// deeper blue curtain wall was authored here and taken straight back out: the city packs 846
// surfaces into a page that is EXACTLY 2048×2048 at texRes 2 and 3, so it is at the WebGL2 floor
// guarantee already and every new palette key costs headroom — nine of them pushed `atlasfit` over
// and the whole city would have drawn flat colours on a floor-spec device. Six ship. Anything else
// wanting a key here has to take one out, or the atlas has to learn to pack what a WINDOW holds
// rather than what the city holds.
export const HF_HOUSES = [
  { name: 'as built', skin: {} },
  { name: 'as built', skin: {} },
  { name: 'as built', skin: {} },
  { name: 'mirror', skin: { ty_hf_chrome: 'ty_hf_mirror', ty_hf_chrome_dk: 'ty_hf_mirror_dk' } },
  { name: 'mirror + gilt', skin: { ty_hf_chrome: 'ty_hf_mirror', ty_hf_chrome_dk: 'ty_hf_mirror_dk', ty_hf_ice: 'ty_hf_gold' } },
  { name: 'calacatta', skin: { ty_hf_chrome: 'ty_hf_marble', ty_hf_chrome_dk: 'ty_hf_marble_dk', ty_hf_ice: 'ty_hf_marble' } },
  { name: 'calacatta + gold', skin: { ty_hf_chrome: 'ty_hf_marble', ty_hf_chrome_dk: 'ty_hf_marble_dk', ty_hf_ice: 'ty_hf_gold' } },
  { name: 'blue onyx', skin: { ty_hf_chrome: 'ty_hf_marble_blue', ty_hf_chrome_dk: 'ty_hf_marble_dk' } },
];


// ⚠ A DIFFERENT HASH FROM THE CAST, OR THE TWO CO-VARY. Sharing one roll would mean every mirrored
// tower in the quarter wore the same hue and there would be eight buildings rather than sixty-four.
export function hfSkinFor(seed) {
  return (HF_HOUSES[(frac(seed * 2.71 + 91) * HF_HOUSES.length) | 0] || HF_HOUSES[0]).skin;
}

// Apply a cast to one ramp endpoint. `null` is no cast and returns the input array itself, so a
// caller with the feature off is byte-for-byte what it always was.
//
// ⚠ CLAMPING AT NEAR-WHITE IS A HUE SHIFT AND NOT A FAILURE. The light ends of these ramps run to
// [246,250,252], so the channel a cast pushes UP has a few levels of headroom and the two it pushes
// down have plenty. Clipped, the result is the same hue arriving by the other route — the wall
// reads warmer because its blue dropped rather than because its red rose — which is the read we
// want and costs about a level of luminance at the very top of the ramp.
export function hfTint(rgb, cast) {
  if (!cast || !rgb) return rgb;
  const k = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return [
    Math.max(0, Math.min(255, rgb[0] + cast[0] * k)),
    Math.max(0, Math.min(255, rgb[1] + cast[1] * k)),
    Math.max(0, Math.min(255, rgb[2] + cast[2] * k)),
  ];
}
