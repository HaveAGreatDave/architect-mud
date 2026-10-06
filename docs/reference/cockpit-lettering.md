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
7. **Letter a panel for the way you face to read it.** `K.panel(o, r, u)` turns its normal to face the
   eye but keeps `r` and `u`, so text reads true only when `cross(r, u)` already points at the eye.
   A dash (`r` +x, `u` +z) does. A ceiling doesn't: +x across and +y up points the normal up, away
   from the eye, and every overhead label in the Mule read mirrored. Under the roof, use `r` +x with
   `u` −y for a panel you read facing forward, and `r` −x with `u` +y for one behind your head that
   you read turned round. The same goes for a wall behind you (`r` −x, `u` +z): the Echelon bridge's
   clock ran backwards until it was turned round. `scripts/shapes/cockpit-controls.mjs` fails any
   label in any seat that reads mirrored, and names it.

## Every switch works

A switch with nothing behind it is removed, not drawn for flavour. A 3-D cockpit's clickable controls
come from its profile's `hotspots(live)`, and `cockpit.js` acts on them: a click by its id in
`DK_ACT`, a drag or a hold by its kind, and a tooltip from `DK_TIP`. A hotspot `DK_ACT` doesn't know
still gets the hand cursor and the halo, and the click does nothing.

The circuits a flight seat can switch are the engine master (`ck:master`), the landing lights
(`ck:land`, and `ck:taxi` on the same circuit), the panel lights (`ck:panel`), the dome (`ck:dome`),
flaps (`ck:flaps`), gear (`ck:gear`) and master arm (`ck:arm`). There's no beacon, nav or strobe
circuit; nav lights follow power. A panel that lights with the PANEL switch reads `live.panelLight`,
and falls back to the hour when it's absent, as a seat shot leaves it.

`scripts/shapes/cockpit-controls.mjs` checks every flight seat: each hotspot's kind is one cockpit.js
handles, each click has a `DK_ACT` action, and each control has a `DK_TIP` tooltip.

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
