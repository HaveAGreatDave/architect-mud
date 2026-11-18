# The Merlin menu: tuning and the stereo

**Status: steps 1 and 2 built** (the menu on a touch screen with the HUD page and its colour wheel, a status panel, and the LIGHTS page's underglow); TUNE and AUDIO are design. The Merlin itself is [road-vtol.md](road-vtol.md).

## As built

- **LIGHTS** shows the same wheel for the **underglow**; its middle is OFF. A tap sends `underglow #rrggbb quiet` (or `off`), the flight plugin keeps it on `aircraft.custom_data.underglow`, and `airContact` sends it in the contact's `livery`, so other pilots see it. GLASS draws it as light pooled under the hull (`UNDERGLOW_STATIONS` in windshield.js), never as faces.
- The **HUD knob** is on the dash fascia left of the yoke (`hudKnobAt` in `interior-merlin.js`, hotspot `ck:hud`). It used to sit on the spine, where the yoke's hub hid it.
- The menu opens on a **touch screen**: while it's open, the FANS and CHG pages become one pane (`TOUCH`), rows down the left (`ck:mnu:<i>`). A tap on either page opens it (`ck:touch`).
- The right half shows the **status panel**: a turning wireframe of the Merlin off `MERLIN_STATIONS`, its hull members going red as the hull is lost, the battery filling with the charge, then HULL and CHG and the registered owner and registration (`live.owner`, `live.reg` from `F.owner`, `F.reg`).
- On the HUD page the right half is a **colour wheel**: twelve hues (`HUD_WHEEL`, `ck:hue:<i>`) and the standard green in the middle (`ck:hue:green`). A wheel colour is stored as `'#rrggbb'` in the same localStorage key; `hudTint()` makes its line and dim once and keeps them.

## What exists today

- The **HUD knob** on the carbon spine between the seats (`interior-merlin.js`, drawn at the spine block, hotspot `ck:hud`). A click cycles `HUD_TINTS` (`interior-cockpit-kit.js`); the choice is kept per craft type in localStorage (`fsim.hudTint.merlin`, cockpit.js `savedHudTint`).
- Three pages on the dash band: `map` (clickable), `fans`, `energy` (`SCREENS` in `interior-merlin.js`).
- Four drive buttons on the wheel (HOVER, LOCK, BOOST, PIT) whose numbers live in `MR` (`merlin-modes.js`). The server never hears about the modes.
- No radio, stereo or music in any cockpit. Songs exist: 36 tracker songs under `content/audio_songs/`, played by `AudioEngine.playMusic(def, { owner })` on the `music` bus.

## The idea

The knob stays where it is and becomes the menu's control: a **click opens the menu** on the centre (`map`) page, **turning** moves through it (wheel or drag on the knob), a click picks. The map comes back when the menu shuts or after 8 s untouched. A long press still steps the HUD colour, so the old habit works.

The menu is a dash page drawn like the other pages (legend faces, the HUD tint), never an HTML overlay: the Drake bar says every drawn control works and is lettered.

```
 CORVANE ─ SETUP
 > TUNE
   LIGHTS
   HUD
   AUDIO
   ← BACK
```

## The pages

### TUNE: how it drives

Every option is a preset over the numbers already in `MR` and the `merlin_road` row. Client only, like the modes; the server's reconcile and odometer are unchanged, so nothing here can move the car further than the sim allows.

| Option | Choices | What it changes |
|---|---|---|
| Drive mode | COMFORT / SPORT / TRACK | road row's steering rate and grip; TRACK lowers ride height a little |
| Boost map | ECO / STOCK / OVERDRIVE | boost thrust against heat: `BOOST_HEAT_S`, `COOL_S`, thrust multiplier |
| Pit limit | 10 / 16 / 22 kt | `PIT_KT` |
| Hover response | SOFT / FIRM | `DOWN_S`, `UP_S` |
| Fan voice | QUIET / STOCK / LOUD | engine-audio gain and drive on the fan sound |

Ceilings: no option raises top speed or the `HOVER_MAX_*`/`LOCK_*` refusals. OVERDRIVE's extra thrust pays in heat, not in a faster car overall.

### LIGHTS

- **Cabin accent**: the colour of the cabin glow (`T.glow` in `MERLIN_TRIM`), from the same six-colour list as the HUD, plus OFF.
- **Dash brightness**: 3 steps (the panel dimmer).
- **Underglow**: off / on, colour from the same list (the exterior mesh's under-tray, drawn by GLASS for others to see; this one is sent with the craft state, see Open questions).

### HUD

The colour (today's knob behaviour) and a brightness. Warnings stay red and cautions amber.

### AUDIO: the stereo

A head unit page: the track name scrolling across, a seek bar, and four keys: ◀◀ ▶/❚❚ ▶▶ and SRC.

- **Sources:** **TAPE** plays the game's songs (the ambient, cyberpunk and misc categories, about 12 tracks; not jingles or show themes). **RADIO** follows a broadcast channel's audio where one has music, if broadcast exposes it (later).
- **Settings:** volume, BASS/TREBLE (a low shelf and a high shelf on the stereo's path), SHUFFLE, and **FIDELITY**: CLEAN or WORN (a band-limit plus drive, the cheap-speaker sound).
- **Where it plays:** through `playMusic(def, { owner: 'merlin-stereo' })`, so the zone's music gives way while the stereo plays and `stopMusicOwnedBy('merlin-stereo')` ends it when you get out. Inside the cabin only; others don't hear it (first version).
- **Getting the songs:** the client has no song list today; songs arrive from the server per message. A `stereo` request returns the playlist's defs once per session and the client keeps them.

## Where it's kept

Everything is a pilot preference, kept like the HUD tint: localStorage per craft type (`fsim.merlin.setup`), a convenience, not state. Underglow is the exception if other players should see it.

## Steps

1. The menu page and the knob's click/turn/long-press, HUD page only. Gate: the cockpit smoke opens and walks every row.
2. LIGHTS and TUNE presets.
3. The stereo: the playlist request, the head unit page, playback, EQ and FIDELITY.
4. Later: RADIO source, underglow seen by others, the stereo heard from outside with the doors open.

## Open questions

1. Should TUNE presets be per car (the server holds them, they follow the Merlin) or per pilot (localStorage, as above)?
2. ~~Underglow seen by others~~ Answered 2026-11-17: yes, and built (the contact's livery carries it).
3. Is "AMP" the stereo above, or playing `.amp` audio presets from the Audio tab?
