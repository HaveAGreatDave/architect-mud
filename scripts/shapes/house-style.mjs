// GATE · THE HOUSE STYLE (client/game/js/panels/gl/house-style.js).
//
// The comic look is one switch that every 3-D view reads. With it off, every view has to draw
// exactly as before: each helper hands back the view's own numbers, and the city's tune keys for
// 'off' and 'on' are windshield.js's shipped defaults. With it on, every view gets the same ink and
// heavier lines, and the city its cel look at the house numbers.
//
// No DOM, no GL, no files written.

import { HOUSE, comicOn, inkOf, bandsOf, cityInkCol, cityTuneFor, figureLightOf } from '../../client/game/js/panels/gl/house-style.js';
import { readFileSync } from 'node:fs';

let fails = 0;
const check = (ok, what) => { if (!ok) { fails++; console.error('✗ ' + what); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The city's shipped defaults, read from windshield.js so the gate follows them if they move.
const ws = readFileSync(new URL('../../client/game/js/panels/windshield.js', import.meta.url), 'utf8');
const def = (k) => { const m = ws.match(new RegExp(`\\n\\s*${k}: ([0-9.]+),`)); return m ? +m[1] : NaN; };
const shipped = { glToonBands: def('glToonBands'), glInkPx: def('glInkPx'), glInkFar: def('glInkFar') };

const own = { ft: 0.09, px: [1.2, 3.6], col: [0.035, 0.04, 0.05] };

// off
delete globalThis.__houseComic;
check(!comicOn(), 'off by default');
check(inkOf(own) === own, 'off: a view keeps its own ink');
check(bandsOf(3) === 3, 'off: a view keeps its own bands');
{
  const fl = figureLightOf({ bands: 3, shade: [0.6, 0.62, 0.8] });
  check(fl.bands === 3 && same(fl.shade, [0.6, 0.62, 0.8]) && fl.comic === 0 && fl.weigh === 1, 'off: a figure keeps its bands and shade, no comic lines, an even line');
}
check(cityInkCol(own.col) === own.col, 'off: the city keeps its own ink colour');
for (const [mode, on] of [['off', 0], [false, 0], [undefined, 0], ['nonsense', 0], ['on', 1], [true, 1]]) {
  const t = cityTuneFor(mode);
  check(t.glToon === on && t.glInk === on, `cityTuneFor(${String(mode)}): toon and ink ${on}`);
  check(t.glToonBands === shipped.glToonBands && t.glInkPx === shipped.glInkPx && t.glInkFar === shipped.glInkFar,
    `cityTuneFor(${String(mode)}): the city's shipped bands, width and reach (${JSON.stringify(shipped)})`);
}

// comic
globalThis.__houseComic = 1;
check(comicOn(), 'on when __houseComic is set');
const c = inkOf(own);
check(Math.abs(c.ft - own.ft * HOUSE.widen) < 1e-9, 'comic: the line widens by HOUSE.widen in the view\'s own units');
check(same(c.px, HOUSE.px) && same(c.col, HOUSE.ink), 'comic: the house pixels and the house ink');
check(c.px[0] >= own.px[0], 'comic: never thinner than the view\'s own minimum');
check(bandsOf(3) === HOUSE.bands, 'comic: the house bands');
{
  const fl = figureLightOf({ bands: 3, shade: [0.6, 0.62, 0.8] });
  check(fl.bands === HOUSE.bands && same(fl.shade, HOUSE.shade) && fl.comic === 1 && fl.weigh === HOUSE.weigh && HOUSE.weigh > 1, 'comic: a figure gets the house bands and painted shade, the lines, and a weighted line');
}
check(same(cityInkCol(own.col), HOUSE.ink), 'comic: the city takes the house ink');
const t = cityTuneFor('comic');
check(t.glToon === 1 && t.glInk === 1 && t.glToonBands === HOUSE.bands && t.glInkPx === HOUSE.cityPx, 'cityTuneFor(comic): the cel look on at the house numbers');
delete globalThis.__houseComic;

if (fails) { console.error(`house-style: ${fails} failed`); process.exit(1); }
