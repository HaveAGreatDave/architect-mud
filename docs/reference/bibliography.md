# Bibliography

The outside works Architect names as a model, and what it takes from each. Every entry is one the docs or code state themselves; the linked doc is where. Compiled 2026-11-03.

The rule that runs through the list is the one [house-voice.md](house-voice.md) gives for Fallout: we take techniques, never text, names or assets.

## Games

| Work | What Architect takes | Where |
|---|---|---|
| HellMOO | The whole lineage: text-driven, real-time, brutal and funny. Full-loot PvP, a world on a clock, the six grounded stat names, real-time cooldowns, corps, the gym that turns XP into stats, slapstick violence. Its `hellcore.db` LambdaMOO textdump was read as the basis for combat and stats. Hang all seven hero posters and they spell HELLMOO. | [design.md](../design.md), [goals.md](../goals.md), [story.md](../story.md), [hellmoo-combat-reference.md](hellmoo-combat-reference.md), [posters](../../plugins/posters/README.md) |
| Fallout 1, 2 and New Vegas | The house voice: a plain literal default, rationed stings, documents that tell the story, warm radio hosts. Fallout 2's examine texts are the length benchmark, and the `docs:prose` irony lint is calibrated on them. | [house-voice.md](house-voice.md) |
| GTA IV and V | City media, street barks and talk while the player is busy, with the volume turned down. The 0-5 star wanted level. | [house-voice.md](house-voice.md), [systems-surveillance.md](../systems-surveillance.md) |
| Borderlands | The comic ink look over the whole game: a screen-space outline, ink painted into textures, sharpened shadows. | [comic-ink.md](../proposals/comic-ink.md) |
| NHL '96 | The Cluster Puck League's FM soundset, an homage that copies the character and none of the assets. The vertical camera. | [systems-hockey-sound.md](../systems-hockey-sound.md), [cluster-puck-glass2.md](../proposals/cluster-puck-glass2.md) |
| NHL 99 | The default broadcast framing, high on the near side and close. | [systems-broadcast.md](../systems-broadcast.md) |
| NHL '94 | One person runs a whole team head to head, switching between skaters. | [cluster-puck-ai.md](../proposals/cluster-puck-ai.md) |
| NBA Jam | The unseen momentum meter that helps the side that's behind. | [cluster-puck-ai.md](../proposals/cluster-puck-ai.md) |
| Pilotwings (SNES) | The out-the-window view: soft Mode-7 terrain, sprite trees, a hazy horizon. | [Cockpit_Design_Reference.md](Cockpit_Design_Reference.md) |
| F-Zero | The Mode-7 effect stack and sprite scaling. The cockpit reference rules out its hard racing checker. | [flight-overhaul.md](../proposals/flight-overhaul.md) |
| Star Fox | Runway guidance rectangles on landing. | [Flight_Implementation.md](Flight_Implementation.md) |
| The Movies (Lionhead, 2005) | The broadcast stage's loop: write a script, pick a set, cast it, shoot it. | [broadcast-3d.md](../proposals/broadcast-3d.md) |
| Mudlet, TinTin++, MUSHclient | The THOMAS client's triggers, aliases, timers, speedwalk, split windows and logging. | [thomas-client-guide.html](../../client/game/thomas-client-guide.html), [systems-automation.md](../systems-automation.md) |

## Film, TV and broadcast

| Work | What Architect takes | Where |
|---|---|---|
| South Park | The simple comic faces on the broadcast stage. | [broadcast-3d.md](../proposals/broadcast-3d.md) |
| The Fifth Element (1997) | The close-up figure's strap-wrap underwear: pale bands round the body with skin between, and bright braces. The idea only, not the costume. | [hd-figure.md](../proposals/hd-figure.md) |
| Preston Blair, *Cartoon Animation* | The animator's mouth chart: a handful of shapes standing for all the sounds, which is what lip sync's `MOUTHS` are. | [sculpted-figure.md](../proposals/sculpted-figure.md) |
| The Outer Limits (1963) | The Quiet Hour: an unseen voice that takes your set over and gives it back, a black-and-white picture, a story with a monster in it each night and a moral read over the end. The Horizontal and the Vertical are named for the two holds it claimed to control. | [The Quiet Hour's set](../../tools/broadcast-studio/README.md) |
| The FoxTrax puck | The glowing puck halo and the tail that turns red at speed. | [systems-broadcast.md](../systems-broadcast.md) |
| Neon Genesis Evangelion | The bestiary's one accent per enemy, after the Angels' red core; pure geometry for the Architect's own. | [bestiary-art-direction.md](../proposals/bestiary-art-direction.md) |
| Princess Mononoke and Nausicaä (Studio Ghibli) | The fused masses as the tatarigami's writhing black flesh; eyes that carry a state, after the Ohmu; designed shadow colours, after Michiyo Yasuda. | [bestiary-art-direction.md](../proposals/bestiary-art-direction.md) |
| Promare and Cyberpunk: Edgerunners (Studio Trigger) | A shape grammar per faction; rim colour set by the feeling; the street animals' neon back light. | [bestiary-art-direction.md](../proposals/bestiary-art-direction.md) |
| Akira | A glow's white core with its halo shifting to cyan. | [bestiary-art-direction.md](../proposals/bestiary-art-direction.md) |
| Ghost in the Shell (the Tachikoma) | The maintenance drone's curious head tilt. | [bestiary-art-direction.md](../proposals/bestiary-art-direction.md) |

## Writing

| Source | What Architect takes | Where |
|---|---|---|
| programasweights/claudish, `claudish-to-english.md` | The plain-writing standard. The rules are theirs; the carve-outs are ours. | [plain-writing.md](plain-writing.md) |
| Elmore Leonard, Palahniuk, John Gardner, Le Guin's *Steering the Craft*, Chekhov, Hemingway, Vonnegut | One stated rule each: speech tags, thought verbs, psychic distance, rhythm, the gun, subtext. Vonnegut's rules are held, not counted. | [plain-writing.md](plain-writing.md) |
| The Turkey City Lexicon (Shiner and Sterling) | Names for the SF failure modes to avoid. Heinlein's dilating door, stating the strange thing flatly, is a technique to use. | [plain-writing.md](plain-writing.md) |
| Orwell's Newspeak | Narrowed to institutional euphemism. | [plain-writing.md](plain-writing.md) |
| Kobak et al. 2024, Wikipedia's "Signs of AI writing", the EQ-Bench slop lists | The `docs:prose` lint rules. | [prose.mjs](../../scripts/docs/prose.mjs) |
| Forster, Swift, Zamyatin, Wells, Voltaire, London | The prose models in "what to do instead", drawn from the library's own public-domain shelf. | [plain-writing.md](plain-writing.md), [systems-faction-arcs.md](../systems-faction-arcs.md) |

The library's book texts come from Project Gutenberg, or English Wikisource where Gutenberg has no US copy, and every title must be public domain in the United States. The titles themselves are listed in [systems-library.md](../systems-library.md).

## Music and sound

| Source | What Architect takes | Where |
|---|---|---|
| SNES audio | The procedural audio plugin's character, SNES-style sample playback, the BRR-like 4-bit crush. | [audio plugin](../../plugins/audio/README.md) |
| Amiga ProTracker `.MOD` | The tracker importer, down to the 8287 Hz C2 rate and L-R-R-L panning. | [amp-format.md](../amp-format.md) |
| Yamaha DX7, Akai MPC, the Rhodes | The FM bass, the swing convention, the `rhodes` voice's bell attack. | [game-music-craft.md](game-music-craft.md), [systems-instruments.md](../systems-instruments.md) |
| Tracker and game-music writing (Hugi, OpenMPT, NESdev and others) | The arrangement rules and the `song-lint` critic. | [game-music-craft.md](game-music-craft.md) |

The papers behind the FM matcher, the music critic and ORACLE are under [Papers and published methods](#papers-and-published-methods).

## Buildings, places and machines

| Source | What Architect takes | Where |
|---|---|---|
| LAX and the Tom Bradley terminal | The airport terminal and its wave roof. | [world-rendering.md](world-rendering.md) |
| The Hope Memorial Bridge, Cleveland | The Guardians on the Coliseum gate. | [hughson-coliseum.md](../proposals/hughson-coliseum.md) |
| Toronto's SkyDome | How the Hughson Dome opens: shells on rails that slide over the fixed end and nest under it. The dress is deco. | [hughson-coliseum.md](../proposals/hughson-coliseum.md) |
| Hollywood studio lots, CBS's Columbia Square, NBC's Radio City | The walled Media Lot in 1930s streamline moderne. | [media-lot.md](../proposals/media-lot.md) |
| The Daily Express buildings in Fleet Street and Manchester | The Coldwater Sentinel building. | [media-lot.md](../proposals/media-lot.md) |
| Diamond DA42 and the Garmin G1000 | The cockpit's layout and reading order. It must never look like a Garmin. | [Cockpit_Design_Reference.md](Cockpit_Design_Reference.md) |
| Real aircraft | Each class's frame (the Mule is a Twin Otter, the Reaper an A-10, the Leviathan an An-124), each 2076 body (the Drake after the Sikorsky Raider X, the Viper after the Bell V-280) and each cockpit, held against Wikimedia Commons photos. | [systems-flight.md](../systems-flight.md), [fleet-2076.md](../proposals/fleet-2076.md) |
| Charles Hughson | Sir Charles, and the Coliseum's name. | [hughson-coliseum.md](../proposals/hughson-coliseum.md) |

## Papers and published methods

The research the simulations are tuned against. Each paper is also cited where its number is used, in the linked doc or file. Only three docs keep a source list of their own: [systems-fauna.md](../systems-fauna.md) (the two starling studies), [fm-sound-matching.md](fm-sound-matching.md) and [game-music-craft.md](game-music-craft.md).

### Starlings

Most of the murmuration's numbers come from the STARFLAG and COBBS reconstructions of flocks over Rome and from Hemelrijk's StarDisplay model. Code: [murmur.js](../../client/game/js/panels/murmur.js), [murmur-gpu.js](../../client/game/js/panels/gl/murmur-gpu.js), [birds.js](../../client/shared/birds.js). Doc: [systems-fauna.md](../systems-fauna.md).

| Paper | What it gives |
|---|---|
| Ballerini et al. 2008, *An empirical study of large, naturally occurring starling flocks* ([arXiv 0802.1667](https://arxiv.org/abs/0802.1667)) | The flock's shape, 1 : 2.8 : 5.6; neighbours 0.7 to 1.5 m apart; an edge denser than the middle. |
| Ballerini et al. 2008, PNAS | Topological neighbours: each bird follows its seven nearest, whatever the distance. |
| Cavagna et al. 2010 | Polarisation of 0.96 and a centre moving at about 10 m/s. |
| Cavagna 2022 | Speed varies between birds by a few per cent, in smooth domains, and slowing is easier than speeding up. |
| Attanasi et al. 2014, Nature Physics | Turns that start at an edge and cross the flock at 10 to 20 m/s; a bird matches its neighbours' turning (the inertial spin model). |
| Attanasi 2015 | The long axis lies 60 to 90° across the course in straight flight. |
| Bialek et al. 2014, PNAS 111:7212 | A cruise of 11 m/s, the median centre speed over 21 flocks. |
| Hildenbrandt, Carere and Hemelrijk 2010, Behavioral Ecology 21:1349 | StarDisplay: stronger cohesion for a bird on the edge, and spacing that gives the measured neighbour distances. |
| Hemelrijk and Hildenbrandt 2011, *Some causes of the variable shape of flocks of birds* ([PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0022479)) | 6.5 topological neighbours. |
| Hemelrijk 2015 | Dark bands are wings shown to the eye, so the dot is shaded by its wing plane. |
| Hemelrijk 2019 | Each pulse of a wave banks less than the one before. |
| Costanzo 2021 | Seen from below, a flock rolling through a turn goes lighter. |
| Procaccini 2011 | Agitation waves travel at 13.4 m/s. |
| Storms et al. 2019 | 795 filmed escapes from a hawk: 1 to 6 pulses 0.86 s apart, and a hole in the flock after one attack in four. |
| Goodenough et al. 2017 | A display lasts about 26 minutes, and murmurations peak in early February. |
| Kirchhefer et al. 2013 | A starling's wingbeat, 13.3 Hz at 12 m/s. |
| Tobalske 1995 | Flap-and-glide flight. |

### Other birds

| Paper | What it gives |
|---|---|
| Cutts and Speakman 1994; Portugal et al. 2014; Mirzaeinia and Hassanalian 2019, 2020 | The skein: V, J and echelon shapes, spacing, station-keeping and the rotating lead. |
| Blackwell et al. 2009, 2012 | How far off birds notice an aircraft and how late they react. |

All in [birds.js](../../client/shared/birds.js).

### Cats

| Paper | What it gives |
|---|---|
| Litchfield et al. 2017, "The 'Feline Five'" (PLOS ONE) | The five axes of a cat's personality: skittish, outgoing, dominant, impulsive and friendly. |
| Inigo Quilez, distance functions | The ellipsoid and round-cone estimates and the smooth union the cat is carved from, as the statue was. |

In [pets.md](../proposals/pets.md) and [cat-kit.js](../../client/game/js/panels/gl/cat-kit.js).

### The sea

Code: [sea-swell.js](../../client/shared/sea-swell.js), [water.js](../../client/game/js/panels/gl/water.js). Doc: [glass-notes.md](glass-notes.md).

| Source | What it gives |
|---|---|
| JONSWAP | Fetch-limited wave growth, because the Basin is enclosed. Pierson-Moskowitz (a fully developed ocean) was rejected. |
| Gerstner waves | The swell trains. A Tessendorf FFT ocean was rejected, since four readers would need it on the CPU. |
| Green's law; McCowan 1894 | Shoaling, and breaking at 0.78 of the depth. |
| Monahan and O'Muircheartaigh 1980 | Whitecap coverage by wind speed. |
| Monahan and Lu 1990 | Foam stages A and B. |
| Cox and Munk 1954, JOSA 44:838 | Sun glitter from the surface slope distribution. |
| Beer-Lambert | Absorption by colour for clear coastal water. |

### Rendering

| Source | What it gives | Where |
|---|---|---|
| Saito and Takahashi 1990 | The comic ink edge from the depth buffer. | [ssao.js](../../client/game/js/panels/gl/ssao.js), [glass-notes.md](glass-notes.md) |
| Narkowicz's ACES fit | The tone curve. | [hdr.js](../../client/game/js/panels/gl/hdr.js) |
| Lottes' FXAA | Anti-aliasing, cut down. | [hdr.js](../../client/game/js/panels/gl/hdr.js) |
| Halton (2,3) | The TAA jitter sequence. | [glass-lights-and-taa.md](../proposals/glass-lights-and-taa.md) |
| GGX, Smith shadowing, Schlick's Fresnel | The materials pass, aimed at three.js's MeshStandardMaterial. | [glass-materials.md](../proposals/glass-materials.md) |
| Catmull-Rom with Kochanek-Bartels | Animation playback between keys. | [deadball-glass2.md](../proposals/deadball-glass2.md) |
| Newell's method | Polygon normals. | [glass-notes.md](glass-notes.md) |
| Roystan's toon shader; GPU Gems ch. 16 (wrap lighting) | The beasts' rim and the scatter band through a membrane or a slime. | [beast-light.js](../../client/game/js/panels/gl/beast-light.js) |
| Belcour and Barla; Stavenga et al. on jewel beetles | The stepped thin film on chitin, oil and glass, bluer at a grazing angle. | [beast-light.js](../../client/game/js/panels/gl/beast-light.js) |
| Helland's colour-temperature fit; UCSB dragonfish data | The burn family's blackbody ramp and the deep family's blue-green and far-red. | [bestiary-art-direction.md](../proposals/bestiary-art-direction.md) |
| Catster's cat paw anatomy (catster.com, "Cat Paw Facts") | A cat's paw: four toes in an arc with a bean under each, the big pad behind them, the carpal pad up the back of the wrist and the dewclaw on the inside, on the forepaws only. | [beast-legs.js](../../client/game/js/panels/gl/beast-legs.js) |
| Chris Wilson, "How to Draw Cat Paws" and "How to Draw a Cat Face" (chriswilsonstudio.com) | The paw wider than the leg, its outline running on from it, the middle toes forward; the face's eyes one eye's width apart and the nose lower than you'd think. | [beast-legs.js](../../client/game/js/panels/gl/beast-legs.js), [bestiary-art-direction.md](../proposals/bestiary-art-direction.md) |
| Shell fur (Lengyel et al., "Real-Time Fur over Arbitrary Surfaces", 2001) | Fur drawn as layers over the skin, each cut down to the strands that reach it. | [beast-light.js](../../client/game/js/panels/gl/beast-light.js) |

### Speech

All in [systems-library.md](../systems-library.md) unless noted.

| Source | What it gives |
|---|---|
| CMUdict (Carnegie Mellon, BSD-style licence) | The 28,511-word lexicon. Its attribution has to stay in the header of [formant-cmudict.js](../../client/shared/formant-cmudict.js). |
| Klatt 1979, as used in MITalk and DECtalk | Segment durations, and the parallel formant branch. |
| Rosenberg | The pulse `glottalWave()` builds. |
| Liljencrants-Fant; Fant 1995 | The glottal pulse built per cycle, and the Rd voice-quality relations. |
| Peterson and Barney | The vowels the pre-emphasis is calibrated against. |
| House, Williams, Hecker and Kryter 1965 | The Modified Rhyme Test's 50 six-word sets ([voicelab.js](../../client/devpanel/js/panels/voicelab.js)). |
| The Harvard sentences | Intelligibility scoring with Whisper and a NeMo recogniser ([systems-procedural-audio.md](../systems-procedural-audio.md)). |
| Paul Kellett's filter | Pink noise ([audio-engine.js](../../client/shared/audio-engine.js)). |

### Sound and music

| Source | What it gives |
|---|---|
| Chowning 1973, *The synthesis of complex audio spectra by means of frequency modulation* | The FM recipes. |
| Carson's rule | FM bandwidth. |
| Horner, Beauchamp and Haken 1993; Mitchell and Creasey; Caspe et al. 2022 (DDX7, [arXiv 2208.06169](https://arxiv.org/abs/2208.06169)); "Instrumental" 2026 ([arXiv 2603.15905](https://arxiv.org/abs/2603.15905)); Torres et al. 2023 ([arXiv 2312.14507](https://arxiv.org/abs/2312.14507)) | How the sound matcher searches. |
| de Cheveigné and Kawahara 2002 (YIN) | Pitch detection in the matcher. |
| Witek et al. 2014, PLoS ONE | Syncopation and groove. |
| Yang and Lerch 2018; MusPy | The song critic's metrics. |
| von Hippel and Huron, via Shanahan | Melodies regress to the mean. |

The FM list is in [fm-sound-matching.md](fm-sound-matching.md) and the music list in [game-music-craft.md](game-music-craft.md), with the non-academic sources too.

### Field recordings

Every recording the game plays from [field-recordings.js](../../client/shared/field-recordings.js). All are from Freesound under CC0 1.0, checked on each sound's page when [build-field-recordings.mjs](../../scripts/audio/build-field-recordings.mjs) fetched it; CC0 asks for no credit, and they are credited here anyway. Doc: [systems-procedural-audio.md](../systems-procedural-audio.md#field-recordings).

| Recording | By | Used as |
|---|---|---|
| [Light Rain](https://freesound.org/people/soundrecorder7/sounds/167034/) | soundrecorder7 | `rain_light`, loop |
| [Rain heavy 2 (rural)](https://freesound.org/people/jmbphilmes/sounds/200272/) | jmbphilmes | `rain_heavy`, loop |
| [Rain from Indoors - Perfect loop](https://freesound.org/people/samesamesame/sounds/242889/) | samesamesame | `rain_indoor`, loop |
| [Rain and Thunder 4](https://freesound.org/people/FlatHill/sounds/237729/) | FlatHill | `rain_thunder`, loop |
| [Thunder.ogg](https://freesound.org/people/lennyboy/sounds/244053/) | lennyboy | `thunder_a`, one-shot |
| [thunder](https://freesound.org/people/netaj/sounds/193170/) | netaj | `thunder_b`, one-shot |
| [wind.wav](https://freesound.org/people/nithala/sounds/525292/) | nithala | `wind`, loop |
| [Wind__Artic__Cold.wav](https://freesound.org/people/cobratronik/sounds/117136/) | cobratronik | `blizzard`, loop |
| [hail_rain.wav](https://freesound.org/people/MLaudio/sounds/521375/) | MLaudio | `hail`, loop |
| [Wind 2.mp3](https://freesound.org/people/FunWithSound/sounds/390740/) | FunWithSound | `wind_breeze`, loop |
| [Forest, close up of trees rustling in the wind.wav](https://freesound.org/people/Anya_Media/sounds/523389/) | Anya_Media | `leaves`, loop |
| [Wind-Gusts-late-autumn.wav](https://freesound.org/people/BudJillett/sounds/109485/) | BudJillett | `wind_gusty`, loop |
| [Howling Wind Ambience](https://freesound.org/people/DBlover/sounds/405601/) | DBlover | `wind_strong`, loop |
| [Gale Wind.wav](https://freesound.org/people/LanDub/sounds/181935/) | LanDub | `wind_gale`, loop |
| [Heavy gusts of wind](https://freesound.org/people/SamsterBirdies/sounds/565140/) | SamsterBirdies | `gusts`, calls |
| [rain 1.wav](https://freesound.org/people/FenrirFangs/sounds/231687/) | FenrirFangs | `rain_drizzle`, loop |
| [Light rain on street.wav](https://freesound.org/people/BonnyOrbit/sounds/380651/) | BonnyOrbit | `rain_street`, loop |
| [rain-on-canvas-awning.wav](https://freesound.org/people/1888software/sounds/554577/) | 1888software | `rain_awning`, loop |
| [AMB_Ext_Rain_Residential_002.wav](https://freesound.org/people/conleec/sounds/149240/) | conleec | `rain_yards`, loop |
| [Hard Rain Strong Winds](https://freesound.org/people/Syphon64/sounds/135162/) | Syphon64 | `rain_windy`, loop |
| [Passing cars on wet cobblestone street, light rain, city](https://freesound.org/people/Pfannkuchn/sounds/258163/) | Pfannkuchn | `wet_traffic`, loop |
| [Small quiet street ambience](https://freesound.org/people/Oper8/sounds/241135/) | Oper8 | `street_quiet`, loop |
| [People Ambience In The Old Town](https://freesound.org/people/WhiteNoiseSleeper/sounds/725605/) | WhiteNoiseSleeper | `street_people`, loop |
| [Morning Ambience city](https://freesound.org/people/davidco80/sounds/164213/) | davidco80 | `city_day`, loop |
| [Night city atmosphere](https://freesound.org/people/Soundkrampf/sounds/237329/) | Soundkrampf | `city_night`, loop |
| [NightCity-1.wav](https://freesound.org/people/Dr.%20Macak/sounds/252690/) | Dr. Macak | `city_roof`, loop |
| [Water wave Beach Field-recording 200815_0036.wav](https://freesound.org/people/szegvari/sounds/530699/) | szegvari | `surf_beach`, loop |
| [Crashing Waves into Rocks 2](https://freesound.org/people/amholma/sounds/376801/) | amholma | `surf_rocks`, loop |
| [Water_Lapping_Windy_Day_Gore_Creek_2.wav](https://freesound.org/people/DangerLaef/sounds/692542/) | DangerLaef | `harbour_lap`, loop |
| [Ocean Waves.wav](https://freesound.org/people/Noted451/sounds/531015/) | Noted451 | `ocean`, loop |
| [Canada Geese Honks](https://freesound.org/people/Kinoton/sounds/423346/) | Kinoton | `goose`, calls |
| [Canada Goose Chatter](https://freesound.org/people/qubodup/sounds/859152/) | qubodup | `goose_chatter`, calls |
| [Seagull single call](https://freesound.org/people/steaq/sounds/263786/) | steaq | `gull_single`, calls |
| [Gull.wav](https://freesound.org/people/nigelcoop/sounds/73497/) | nigelcoop | `gull`, calls |
| [Seagull trill and whine.wav](https://freesound.org/people/nigelcoop/sounds/75195/) | nigelcoop | `gull_trill`, calls |
| [Seagulls_short.wav](https://freesound.org/people/Lydmakeren/sounds/510917/) | Lydmakeren | `gulls`, calls |
| [Pigeon cooing](https://freesound.org/people/Fsu2001/sounds/795558/) | Fsu2001 | `pigeon`, calls |
| [House sparrow.wav](https://freesound.org/people/straget/sounds/404663/) | straget | `sparrow`, calls |
| [robin song](https://freesound.org/people/Andrew.soundscape/sounds/671058/) | Andrew.soundscape | `robin`, calls |
| [R30-34-Red Tailed Hawk.wav](https://freesound.org/people/craigsmith/sounds/479610/) | craigsmith | `hawk`, calls |
| [Vulture](https://freesound.org/people/AntumDeluge/sounds/188041/) | AntumDeluge | `vulture`, calls |

### Flight and physics

| Source | What it gives | Where |
|---|---|---|
| Allen 2006, NASA | The thermal's strength by height. | [systems-flight.md](../systems-flight.md) |
| Newton's law of cooling | Body heat and hypothermia. | [systems-survival.md](../systems-survival.md) |
| The Magnus effect | The ball's curve. | [deadball-glass2.md](../proposals/deadball-glass2.md) |
| Dijkstra | Road-preferring pathfinding. | [pathfinding.js](../../server/engine/pathfinding.js) |
| Mulberry32, FNV-1a | The seeded random numbers and hashes. | [rng.js](../../server/engine/rng.js) |
