// THE HORNS YOU CAN BUY FOR A TRUCK — one catalogue with two readers.
//
// The bench sells them (plugins/trucking/bench.js, `rig horn`) and the synth sounds them
// (client/game/js/panels/engine-audio.js `hornFor`). Written once here, because a horn whose price
// row and voice row live in two files is a horn that one day sells as a three-chime and sounds like
// the factory trumpet.
//
// ⚠ `stock` IS NOT A HORN, IT IS THE ABSENCE OF ONE. A truck that has never been to the bench stores
// nothing and sounds its model's own row in engine-audio's `HORN` table, exactly as every truck did
// before this file existed. That is the migration invariant: no stored value, no change.
//
// ⚠ A VOICE IS THE SAME SHAPE AS A `HORN` ROW, with `ratios` in place of the single `ratio`. The
// first ratio is voiced at the stock chord's second-note gain and every further one a step quieter,
// so a two-note row here is built by exactly the arithmetic a stock horn is.
//
// ⚠ NOTHING HERE REACHES THE DRIVING. A horn is for other people, like a fitting — `effTruckParams`
// never reads it — so it is free to swap once bought and it is refused on a hire truck for the same
// reason paint is.
export const TRUCK_HORNS = {
  stock:   { name: 'The one it came with', price: 0,
    desc: 'Whatever the factory bolted to the roof. Nobody chose it and everybody recognises it.' },
  twotone: { name: 'Two-tone', price: 900,
    desc: 'A fifth apart and bright with it. Reads as somebody official, which is most of the point.',
    voice: { base: 392, ratios: [1.5], dur: 0.9, gain: 0.30, air: 0.6 } },
  chime:   { name: 'Three-chime', price: 1600,
    desc: 'A minor chord off three trumpets the length of your arm. The sound of a freight line at night.',
    voice: { base: 247, ratios: [1.189, 1.498], dur: 1.7, gain: 0.30, air: 0.8 } },
  diaphone: { name: 'Diaphone', price: 2100,
    desc: 'One note, very low, and it does not stop when you let go so much as run out.',
    voice: { base: 88, ratios: [1.003], dur: 2.6, gain: 0.44, air: 1.7 } },
  bugle:   { name: 'Bugle', price: 700,
    desc: 'A fourth, up and over. Cheerful, which on a forty-tonne truck is its own kind of threat.',
    voice: { base: 523, ratios: [1.335], dur: 0.8, gain: 0.26, air: 0.5 } },
};
export const HORN_IDS = Object.keys(TRUCK_HORNS);

/** The horn a truck's custom data says it carries, or null for the stock one. */
export function hornOf(cd) {
  const h = cd?.horn;
  return h && h !== 'stock' && TRUCK_HORNS[h]?.voice ? h : null;
}
