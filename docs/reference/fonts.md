# Fonts: the self-hosted library

**Status: the files are in `client/shared/fonts/`. Of the faces added on 2026-11-15, the graffiti
hands use eight (see [Graffiti](#graffiti)); the rest aren't wired to anything yet.** `SIGN_FONT`
in `windshield.js` still uses only the 17 faces that were here before. This page says what each
face is for, so wiring one in is a choice between a few rather than a search.

Open [tools/sandbox/font-specimen.html](../../tools/sandbox/font-specimen.html) to see every face
set in its own sample, with your own text and a wall, night or paper ground.

## Rules

- **Every face is free to ship.** CC0 (public domain), OFL 1.1 or Apache 2.0, with the licence file
  beside the font. OFL lets us bundle, subset and modify a face in the game; it only forbids selling
  the font file on its own and reusing its reserved name for a modified version. Check a new face's
  licence before it goes in, and add the file beside it.
- **Licence files are named for the font.** `OFL-<name>.txt`, `LICENSE-<name>.txt` (Apache) or
  `CC0-<name>.txt`.
- **The Google Fonts files are the latin subset**, which covers English, the `₵` sign excepted.
  Check a glyph you need is there before relying on it; every font stack ends in a generic family
  (see [world-rendering.md](world-rendering.md#sign-styles-faces-and-fascia-kinds-as-built)).
- **Load a face when its view opens**, with `new FontFace(...)` as `loadNeonFaces` and
  `stadium-signs.js` do, never from a global stylesheet. Most of these are display faces that one
  view uses.
- **The order briefs still decide who letters what**
  ([building-styles.md §3](building-styles.md#3-the-regions-and-the-orders-that-own-them)). The
  Wildblood and the Exodus put up no signage at all, the Null paint stencil or mono on plate, and
  nothing that puts up a sign may use blackletter.

★ marks the first choice in each group.

## Graffiti

The tag hands in `tag-bake.js` set their letters in these, fetched by `loadTagFaces` on the first
bake, with the old Windows stacks (Segoe Script, Arial Narrow, Arial Black) as the fallback:

- `hand` rolls Sedgwick Ave Display (three times in six), Rock Salt, Rainbow 2000 or Permanent
  Marker on the words, so one name is in one hand everywhere. Each face has its own size and nib in
  `TAG_HAND_FACES`, because the stroke that made a thin system script read as marker closed every
  counter in Sedgwick.
- `stencil` rolls Big Shoulders Stencil Display, Operation Napalm or Allerta Stencil (see
  [Stencil](#stencil-and-the-works-the-null-depots-and-yards)). A stencil face has its own bridges,
  so the bake only cuts random ones over the fallback.
- `roller` is Bowlby One SC, stretched 1.75 wide rather than Arial Black's 2.1.
- The scrawls round a throw-up and on a buff are Sedgwick Ave.
- The throw-up's own letters come from `tag-glyphs.js` and `tag-strokes.js`, not a font. Its font
  fallback, for `&`, `@` and `#`, stays a system face: Rubik Bubbles under the bake's inflation
  closed an `&` into a blob.

| Face | File | Licence | Use |
|---|---|---|---|
| ★ Sedgwick Ave Display | `sedgwick-ave-display.woff2` | OFL | The tag. A New York handstyle, named for Sedgwick Avenue in the Bronx |
| Sedgwick Ave | `sedgwick-ave.woff2` | OFL | The same hand, lighter, for the scrawls round a piece |
| Rubik Spray Paint | `rubik-spray-paint.woff2` | OFL | A heavy letter with overspray on its edges: a throw-up fill |
| Rubik Wet Paint | `rubik-wet-paint.woff2` | OFL | Drips off every letter |
| Rubik Bubbles | `rubik-bubbles.woff2` | OFL | Bubble letters, for a throw-up without inflating a font letter |
| Knewave | `knewave.woff2` | OFL | A fat brush letter, slanted: a piece done quickly |
| Rock Salt | `rock-salt.woff2` | Apache | Scratchy marker capitals: a name on a toilet door |
| Lacquer | `lacquer.woff2` | OFL | Wobbly painted capitals with the odd run |
| Drybrush | `drybrush.ttf` | CC0 | A dry brush or roller, streaks showing. 285 KB: the only `.ttf`, the largest file here |
| Rainbow 2000 | `rainbow-2000.woff2` | CC0 | Hand-written marker capitals |

Already here: Permanent Marker (marker), UnifrakturMaguntia (the `gothic` placa).

## Blood: the Wildblood, and anything written in it

The Scarletwastes and the Thornwarren carry no lettering, and the inside of the wall is a home, not
a horror set. So these are for marks made elsewhere: a warning daubed on the approach road, a
handprint and a word in the Under, a kill tally, the Wildblood's own screens on the tablet.
Nosifer and Creepster are B-movie horror and read as costume past a word or two; Splash, Finger
Paint and Scabber are the plainer choices.

| Face | File | Licence | Use |
|---|---|---|---|
| ★ Splash | `splash.woff2` | OFL | A fast, rough brush hand, as if written with a rag or a finger. 260 KB |
| Finger Paint | `finger-paint.woff2` | OFL | Daubed with a fingertip, round ends, uneven strokes |
| Scabber | `scabber.woff2` | CC0 | Ragged edges with crusted blobs on them |
| Nosifer | `nosifer.woff2` | OFL | Heavy capitals dripping from the top bar. The loudest face here |
| Creepster | `creepster.woff2` | OFL | Condensed drip capitals, smaller drips than Nosifer |
| Eater | `eater.woff2` | OFL | Torn, gnawed capitals |
| Rubik Beastly | `rubik-beastly.woff2` | OFL | A furred letter: hide rather than blood |

## Art deco

For the Meridian, the Palais, the Coliseum's deco bowl and anything built in the 1930s.

| Face | File | Licence | Use |
|---|---|---|---|
| ★ Poiret One | `poiret-one.woff2` | OFL | Light geometric deco capitals, as cut over an entrance |
| Monoton | `monoton.woff2` | OFL | Five parallel lines per stroke: a cinema marquee. Wants a big size |
| Federo | `federo.woff2` | OFL | Deco sans with the high-waisted capitals of the period |
| Fascinate Inline | `fascinate-inline.woff2` | OFL | Fat showcard deco with an inline: a dance hall or a hotel bar |
| Plaster | `plaster.woff2` | OFL | Wide, flat-topped stencilled deco: a bus station or a picture house |
| Big Shoulders Inline Display | `big-shoulders-inline-display.woff2` | OFL | The Chicago condensed with an inline: industrial deco. Variable weight |
| Vast Shadow | `vast-shadow.woff2` | OFL | A slab with its own drop shadow, for a hotel or a bank |
| Righteous | `righteous.woff2` | OFL | Streamline moderne: a diner, a garage, a 1940s radio |
| Novem | `novem.woff2` | CC0 | Thin geometric capitals with diamond joints |

Already here: Limelight (`deco`), Italiana (`couture`), Playfair Display SC (`estate`), Bungee Inline.

## Cyberpunk

Neon bars, chrome clinics, data brokers, screens and the street's own hardware.

| Face | File | Licence | Use |
|---|---|---|---|
| ★ Tektur | `tektur.woff2` | OFL | Clipped corners, technical and hard: the default techno sign |
| Oxanium | `oxanium.woff2` | OFL | Squared and tidy: a terminal header, a corp logotype |
| Chakra Petch | `chakra-petch.woff2` | OFL | Angled terminals with a hand-cut feel: a street-level tech shop |
| Rubik Glitch | `rubik-glitch.woff2` | OFL | Sliced and offset, a corrupted screen |
| Tilt Neon | `tilt-neon.woff2` | OFL | A neon tube alphabet with real bends. Pairs with `tube` (Varela Round) |
| Doto | `doto.woff2` | OFL | Dot matrix, round dots: an LED ticker. Variable weight |
| Sixtyfour | `sixtyfour.woff2` | OFL | Wide pixel capitals with scan lines: an old CRT |
| VT323 | `vt323.woff2` | OFL | A DEC terminal face: green-screen text |
| Share Tech Mono | `share-tech-mono.woff2` | OFL | A clean technical mono for readouts |
| Digit Tech 7 | `digit-tech-7.woff2` | CC0 | Seven-segment digits: a clock, a meter, a fuel pump |
| Digit Tech 14 | `digit-tech-14.woff2` | CC0 | Fourteen segments, so it spells words: a vending machine, a lift |
| MatrixType Display | `matrixtype-display.woff2` | CC0 | A square-dot matrix: a bus destination board |
| Home Video | `home-video.woff2` | CC0 | A VCR's on-screen lettering, for KSAB's tapes and replays |

Already here: Audiowide (`techno`), Orbitron, Bungee.

## Clinical: the Ascendants

The Glasshouse and Halcyon Fields: wide, thin, unornamented and exact, set in capitals and tracked
out. Plaques, wayfinding, a clinic door.

| Face | File | Licence | Use |
|---|---|---|---|
| ★ Michroma | `michroma.woff2` | OFL | A wide square grotesque in the Eurostile manner |
| Syncopate | `syncopate.woff2` | Apache | Wide geometric capitals |
| Gruppo | `gruppo.woff2` | OFL | Hairline and wide, for a name in brushed steel |
| Lexend Zetta | `lexend-zetta.woff2` | OFL | A plain sans set very wide. Variable weight |
| Jura | `jura.woff2` | OFL | A light technical sans with squared curves |
| Geist | `geist.woff2` | OFL | A neutral modern sans for small plaques and wayfinding. Variable weight |
| Geist Mono | `geist-mono.woff2` | OFL | Its mono: serial numbers, ward codes, dosage labels. Variable weight |
| AVA | `ava.woff2` | CC0 | A thin, odd sci-fi capital. Use for one word, not a sentence |

## Stencil and the works: the Null, depots and yards

Painted by hand on plate, square and legible. The Null brief allows `stencil` and `mono` only.

| Face | File | Licence | Use |
|---|---|---|---|
| ★ Stardos Stencil | `stardos-stencil.woff2` | OFL | A stencilled serif: crates, plate, a hatch number |
| Allerta Stencil | `allerta-stencil.woff2` | OFL | A stencilled sans, quieter than Black Ops One |
| Big Shoulders Stencil Display | `big-shoulders-stencil-display.woff2` | OFL | Tall condensed stencil for long names. Variable weight |
| Operation Napalm | `operation-napalm.woff2` | CC0 | Military stencil capitals |
| Special Elite | `special-elite.woff2` | Apache | A worn typewriter: tags tied to a part, a servicing card |
| Courier Prime | `courier-prime.woff2` | OFL | A clean typewriter for long labels and forms |

Already here: Black Ops One and Saira Stencil One (`stencil`).

## General signage

Shops, streets, civic buildings and posters across Coldwater and the Reach.

| Face | File | Licence | Use |
|---|---|---|---|
| ★ Overpass | `overpass.woff2` | OFL | Based on Highway Gothic, the US road-sign face: street names and road signs. Variable weight |
| B612 | `b612.woff2` | OFL | Drawn for Airbus cockpits: airfields, hangars, the flight HUD |
| Staatliches | `staatliches.woff2` | OFL | Condensed poster capitals: a notice, a bill |
| Anton | `anton.woff2` | OFL | Heavy condensed: a sale banner, a fight poster |
| League Gothic | `league-gothic.woff2` | OFL | Tall narrow gothic, lighter than Anton |
| Bowlby One SC | `bowlby-one-sc.woff2` | OFL | Fat small capitals: a hardware store, a garage |
| Ultra | `ultra.woff2` | Apache | A fat slab: a butcher, a diner, a boxing bill |
| Abril Fatface | `abril-fatface.woff2` | OFL | A heavy didone for a shop that wants to look dear |
| Shrikhand | `shrikhand.woff2` | OFL | A fat italic with curls: a café, an ice cream van |
| Barrio | `barrio.woff2` | OFL | Hand-painted shop lettering, slightly uneven: a corner shop, a taquería |
| Holtwood One SC | `holtwood-one-sc.woff2` | OFL | Wide wood type: a frontier store, a feed merchant |
| Ewert | `ewert.woff2` | OFL | Ornamented wood type: a saloon, a circus, the Reach |

Already here: Bungee (`block`), Alfa Slab One (`slab`), Big Shoulders Display (`condensed`), Rye
(`western`), Yellowtail (`script`), Sacramento, Varela Round (`tube`).

## The Exodus

No signage, no sigil. These are only for the personal glyph and the order's tablet screens.

| Face | File | Licence | Use |
|---|---|---|---|
| Hexcore | `hexcore.woff2` | CC0 | Latin letters built from angular strokes, close to an invented script |
| Major Mono Display | `major-mono-display.woff2` | OFL | A mono with mixed letterforms, slightly wrong |

## Sources

- The OFL and Apache faces are from [Google Fonts](https://fonts.google.com/), latin subset, with
  licences from [github.com/google/fonts](https://github.com/google/fonts).
- The CC0 faces are by GGBotNet, from [github.com/ggbotnet/fonts-cc0](https://github.com/ggbotnet/fonts-cc0).
