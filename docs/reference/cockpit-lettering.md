# Cockpit lettering — the standard

Every label inside a vehicle seat (truck cab, aircraft cockpit, helicopter, boat helm, the Drake, every
craft) is real, readable lettering. This is the standard for all cockpits, set 2026-09-27.

## The rules

1. **Everything that has a name is lettered.** A dial says what it measures (`RPM`, `OIL`, `FUEL`,
   `ALT`), a switch says what it switches, a lamp says what it warns about. A blank coloured stripe
   standing in for a label is not a label.
2. **Small text is the legend face.** [client/shared/legend-font.js](../../client/shared/legend-font.js)
   draws every letter in one thick stroke weight, so the whole letter survives at the one or two
   centimetres a label is from the seat. The Drake's serif (`GLYPH` in interior-drake.js) has hairline
   bars and serifs that vanish below about 15 mm; that is how QUACK read as "GCK".
3. **Display lettering can keep a display face.** Nameplates and badges at `LEGEND_MAX_H` (14.5 mm)
   and above keep the seat's own face (the Drake's serif, the hydro's OFFSHORE badge). Below it,
   the Drake's `engraveText` / `plated_` / `hudText_` hand off to the legend face automatically.
4. **Legible from the seat, not just in the file.** Check it rendered from the driver's eye (the
   Modelshop, `__glSeaShot`). A label hidden behind the wheel or the yoke, or clipped by a panel
   edge, has to move.
5. **Contrast.** Light ink on a dark panel, dark ink on a light face. When the seat has panel
   lighting, labels glow with it.
6. **Keep labels short.** The legend face has A-Z, 0-9, `-` and `/`. Abbreviate the way real panels
   do (`PRESS`, `TEMP`, `HYD`, `GEN`), and keep to a word or two.

## How to letter something

Everything goes through the kit ([interior-kit.js](../../client/shared/interior-kit.js)), so every
seat letters the same way:

| Part | Name it with |
|---|---|
| free text | `Pn.text(str, a, b, h, rgb?, emis?, lift?)` or `Pn.fitText(str, a, b, maxW, h, …)` |
| dial | `Pn.dial(a, b, R, frac, { …, name: 'OIL' })`, lettered on the face under the pivot, in `label`'s colour if given |
| lamp | `Pn.lamp(a, b, ha, hb, on, rgb, 'LOW FUEL')`, name under it |
| rocker | `Pn.rocker(a, b, on, rgb, 'NAV')` |
| toggle | `Pn.toggle(a, b, on, 'MAG')` |
| bar gauge | `Pn.bar(a, b0, b1, w, frac, rgb, 'HYD')`, name under it |

A dial given `label` with no `name` still draws the old blank stripe. That exists only so unnamed dials
don't change shape; new work names every dial.

Seats that letter directly with the Drake helpers (`engraveText` in interior-drake.js) get the
legend face below `LEGEND_MAX_H` automatically.
