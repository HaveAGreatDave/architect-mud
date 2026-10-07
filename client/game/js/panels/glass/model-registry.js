// The model registries: which model draws a building.
//
// NAMED_MODELS binds one building by the slug of its name; TYPE_MODEL is the default for a
// building_type. modelFor in windshield.js prefers the named model, then the type default, and a
// tile with neither keeps its biome archetype. Authored models (client/shared/building-models.js)
// join both tables when windshield.js loads, never over a hand-written arm; see LEGACY_MODELS there.
//
// Plain data with no imports, so it is safe to load first. Moved out of windshield.js on 2026-10-01.

// ── Dedicated per-building models ─────────────────────────────────────────────
// Every named building on the 1:1 map gets its OWN model here — a type-appropriate
// silhouette (a precinct reads as a precinct, the clinic wears a red cross, the TV
// studio carries an antenna mast + dish, the power plant vents from cooling towers)
// plus a per-building palette/neon so no two buildings — even two of the same type —
// ever share a look. Keyed by a slug of the building's name (shipped as `bn` in the
// map window). A building not in this table falls through to the type/biome archetype
// path in drawWorldObjects, so a new or un-modelled building still renders something.
// Height comes from bldgStyle() (the value the CFIT sweep reads), so the mass you see
// is the mass you can hit; the per-building distinctiveness lives in the footprint,
// palette and rooftop adornments — exactly the parts the collision sweep ignores.
// Memoised: the world pass asks for the same few hundred names several times per building per frame
// (modelFor, from the sweep, the occluder pass and the arms), and the regex was most of namedModel's
// cost. A pure function of the string, so the memo can't go stale; cleared if it ever grows past a
// world's worth of names.
const SLUGS = new Map();
export function bldgSlug(name) {
  const k = name || '';
  let s = SLUGS.get(k);
  if (s === undefined) {
    if (SLUGS.size > 4096) SLUGS.clear();
    s = k.toLowerCase().replace(/[^a-z0-9]+/g, '');
    SLUGS.set(k, s);
  }
  return s;
}
export const NAMED_MODELS = {
  halcyontowers:                  { type: 'luxtower',  pal: 'ty_halcyon',  neon: '#39f0ff' },
  embassyhotelbar:                { type: 'embassy',   pal: 'ty_embassy',  neon: '#ff4a9a' },
  chromecourt:                    { type: 'chrome',    pal: 'ty_chrome' },
  themeridianlobby:               { type: 'meridian',  pal: 'ty_meridian', penthouse: true },
  precinct9:                      { type: 'police',    pal: 'ty_police' },
  // ⚠ THE MAIN TO SECOND HELPINGS IS DRAWN BY THIS BUILDING'S ARM, with its plan in tiles rather
  // than fh (GUT in glass/models/downtown.js). Three earlier junctions tried to make the two tiles
  // agree on a height each one rolls for itself, and every one left a pipe in the air or through
  // the sign. The kit's riser section is declined (KIT_DECLINE): the arm draws the plant.
  coldwaterclonefacility:         { type: 'clone',     pal: 'ty_clone' },
  ksabtvstudiostage:              { type: 'ksabstudio', pal: 'ty_ksab', neon: '#39d6ff' },
  ksabwriterswing:                { type: 'studiogate', pal: 'ty_ksab', neon: '#39d6ff' },
  thegreenroom:                    { type: 'divebar',   pal: 'ty_greenroom', neon: '#7dff6a' },
  solenneresidences:              { type: 'solenne',   pal: 'ty_solenne',   neon: '#ffce78' },
  coldwatersentinel:              { type: 'sentinel',  pal: 'ty_sentinel',  neon: '#5fd0ff' },   // was a recoloured corporate tower; it's a two-storey storefront newsroom
  // These two were keyed to names the buildings no longer have — a rename silently
  // dropped them back to the generic shop/office mesh, because namedModel() misses and
  // TYPE_MODEL catches. Re-keyed to the live building_name and given real silhouettes.
  // ('meltwaterdiner' and 'thecage' were dead the same way, but match NO building in
  // content or the DB, so they were removed rather than re-pointed.)
  batteryacidcoffeeco:            { type: 'stimcafe',  pal: 'ty_jitter',    neon: '#5fd0ff' },   // was `jitter`
  wardninepermitsoffice:     { type: 'permits',   pal: 'ty_ward',      neon: '#9ab08a' },   // was `wardninepermits`
  marrowstreetclinic:          { type: 'clinic',    pal: 'ty_clinic' },
  // ⚠ `inhockwetrust` WAS HERE AND IS GONE WITH THE BUILDING'S NAME. The Marrow Street fence is
  // `Cash & Carrion` now and carries an authored model of its own, so this key matched nothing —
  // the exact silent drop the comment four lines up already describes, which is why it is deleted
  // rather than re-pointed. Re-keying it to `cashcarrion` would be worse than useless: the
  // registry merge is `??=` for a model that claims no `replaces`, so a code entry on that key
  // would WIN and the authored building would never draw. `TYPE_MODEL.fence` still reaches the
  // `pawn` arm for any other fence in the world.
  coldwaterpowerplantturbinehall: { type: 'power',     pal: 'ty_power' },
  coldwaterregionalhangar:        { type: 'hangar',    pal: 'ty_hangar_a', big: true },
  thresholdhelipadhangar:         { type: 'hangar',    pal: 'ty_hangar_b', helipad: true },
  sump:                           { type: 'divebar',   pal: 'ty_bar_a',    neon: '#7dff6a' },
  thedeadpigeon:                  { type: 'divebar',   pal: 'ty_bar_b',    neon: '#5fd0ff', perch: true },
  thecherrypit:                   { type: 'strip',     pal: 'ty_club',     neon: '#ff4a9a' },
  rationnine:                     { type: 'rationnine', pal: 'ty_ration',  neon: '#ffb43a' },
  ohmsweetohm:           { type: 'techstall', pal: 'ty_tech',     neon: '#5fd0ff' },
  deadspaceinteriors:             { type: 'showroom',  pal: 'ty_showroom', neon: '#7dff6a' },
  secondskin:                     { type: 'boutique',  pal: 'ty_boutique', neon: '#ff4a9a' },
  velkspreownedfurnishings:       { type: 'junkshop',  pal: 'ty_junk',     neon: '#ff8a4a' },
  voltage:                        { type: 'nightclub', pal: 'ty_voltage',  neon: '#5cd6ff' },
  aurelia:                        { type: 'atelier',   pal: 'ty_aurelia',  neon: '#b070ff' },
  halloransfixit:                 { type: 'garage',    pal: 'ty_garage',   neon: '#ffb14a' },
  latherlye:                      { type: 'citybathhouse', pal: 'ty_soak', neon: '#7fe3c0' },
  // ── The three walls ────────────────────────────────────────────────────────
  // `ruins` is in neither TYPE_MODEL nor BLDG_TYPE_3D, so all three of these fell through to
  // BLDG_TYPE_3D.default and rendered as a citycore mid-rise — 148 tiles of apartment block
  // standing in for a rampart, a hedge and a dam. Named, because one building_type has to cover
  // three structures that have nothing in common but being long.
  thewall:                        { type: 'trm_wall',  pal: 'ty_trm_wall' },
  thethornwall:                   { type: 'thornwall', pal: 'ty_thorn' },
  thedam:                         { type: 'damwall',   pal: 'ty_dam' },
  // ── The seven civics ───────────────────────────────────────────────────────
  // All seven carried building_type 'civic', which TYPE_MODEL aliased to the police model. Named
  // rather than typed because one type has to cover a nursery, an assembly hall, two checkpoints,
  // a song house, a lookout and a birthing room, in two settlements that agree on nothing.
  // ⚠ Terminus and the Thornwarren both called theirs 'The Gate House'. NAMED_MODELS is keyed on
  // the name slug and the map cell carries no region, so the Thornwarren's was renamed to The
  // Thorn Gate in content rather than widening the per-cell payload for ~5,300 cells a snapshot.
  thecreche:                      { type: 'trm_creche', pal: 'ty_trm_creche' },
  thewakinghall:                  { type: 'trm_hall',   pal: 'ty_trm_hall' },
  thegatehouse:                   { type: 'trm_gate',   pal: 'ty_trm_gate' },
  thethorngate:                   { type: 'sw_gate',    pal: 'ty_sw_gate' },
  thechorusden:                   { type: 'sw_den',     pal: 'ty_sw_den' },
  theroofwalk:                    { type: 'sw_roofwalk', pal: 'ty_sw_walk' },
  thewhelpingroom:                { type: 'sw_whelp',   pal: 'ty_sw_whelp' },
  // ── Terminus, the rest ─────────────────────────────────────────────────────
  // ⚠ 'Glasshouse' and 'The Glasshouse' are two different buildings that were sharing one mesh and
  // reading as a copy-paste from the air. They are the OLD one and the NEW one, and they now say so.
  theglasshouse:                  { type: 'trm_glass_new', pal: 'ty_trm_glass' },
  glasshouse:                     { type: 'trm_glass_old', pal: 'ty_trm_glass' },
  thestillhouse:                  { type: 'trm_still',   pal: 'ty_trm_still' },
  themendingroom:                 { type: 'trm_mending', pal: 'ty_trm_ward' },
  thecisterns:                    { type: 'trm_cistern', pal: 'ty_trm_tank' },
  thebench:                       { type: 'trm_bench',   pal: 'ty_trm_shed' },
  thestandingcharge:              { type: 'trm_charge',  pal: 'ty_trm_dynamo' },
  thelongdormitory:               { type: 'trm_dorm',    pal: 'ty_trm_dorm' },
  theopendoor:                    { type: 'trm_inn',     pal: 'ty_trm_inn' },
  thequietground:                 { type: 'trm_ground',  pal: 'ty_trm_grave' },
  theseedvault:                   { type: 'trm_vault',   pal: 'ty_trm_vault' },
  thelongtable:                   { type: 'trm_table',   pal: 'ty_trm_table' },
  thewashhouse:                   { type: 'trm_wash',    pal: 'ty_trm_wash' },
  lastrequisition:                { type: 'trm_depot',   pal: 'ty_trm_depot' },
  // ── The Thornwarren, the rest ──────────────────────────────────────────────
  thephysic:                      { type: 'sw_physic',  pal: 'ty_sw_physic' },
  thekept:                        { type: 'sw_kept',    pal: 'ty_sw_kept' },
  thefleshery:                    { type: 'sw_flesh',   pal: 'ty_sw_flesh' },
  themilkhouse:                   { type: 'sw_milk',    pal: 'ty_sw_milk' },
  thelongfire:                    { type: 'sw_fire',    pal: 'ty_sw_fire' },
  thefoundry:                     { type: 'sw_foundry', pal: 'ty_sw_foundry' },
  thekiln:                        { type: 'sw_kiln',    pal: 'ty_sw_kiln' },
  thesweetwater:                  { type: 'sw_water',   pal: 'ty_sw_water' },
  thehoundyard:                   { type: 'sw_hound',   pal: 'ty_sw_hound' },
  rindles:                        { type: 'sw_merc',    pal: 'ty_sw_merc' },
  thebathhouse:                   { type: 'sw_bath',    pal: 'ty_sw_bath' },
  thedeadleg:                     { type: 'sw_depot',   pal: 'ty_sw_depot' },
  // ── Deadwater ──────────────────────────────────────────────────────────────
  theturbinehall:                 { type: 'dw_turbine', pal: 'ty_dw_turbine' },
  thedryrun:                      { type: 'dw_depot',   pal: 'ty_dw_depot' },
  // ── The twin pass ──────────────────────────────────────────────────────────
  // Eleven groups of Coldwater buildings were sharing a drawTypeModel arm with a same-type
  // neighbour, eight of those groups sharing a PALETTE too — literal clones from the air. The
  // promoted half of each group is below; the twin named in the comment keeps the type model.
  firedforgotten:                 { type: 'ff_kiln',     pal: 'ty_ff_brick', neon: '#ff8a4a' },
  twocellsupply:                  { type: 'twocell',     pal: 'ty_2cell',    neon: '#9fe8ff' },
  fallowprovisions:               { type: 'fallow',      pal: 'ty_fallow' },
  // The four numbered Units are all EMPTY EX-TENANT SHELLS, and looking alike is correct for
  // them — they are the same landlord's stock. One shared model, seeded so each one's dereliction
  // differs, rather than four bespoke silhouettes or four identical generic shops.
  // ⚠ `unit` IS THE DERELICTION, AND IT IS AUTHORED BECAUSE THE PROSE ALREADY DECIDED IT. The arm
  // rolled `seed % 3` off the TILE, so three of these four wore a state their own zone description
  // contradicts. Each one below is the sentence its room is written around.
  unit3kesslerstreet:             { type: 'vacantunit',  pal: 'ty_unit', unit: 'shutter' },    // "the shutter is down"
  unit4marrowstreet:              { type: 'vacantunit',  pal: 'ty_unit', unit: 'whitewash' },  // "its window whitewashed from the inside"
  unit7vossavenue:                { type: 'vacantunit',  pal: 'ty_unit', unit: 'grille' },     // "the security grille is intact and the glass behind it is not"
  unit9marrowstreet:              { type: 'vacantunit',  pal: 'ty_unit', unit: 'shutter' },    // "its roller door tagged twice over"
  hallofrecords:                   { type: 'papertomb',   pal: 'ty_tomb' },          // twin: Precinct 9 keeps `police`
  ironsidewalkinclinic:                   { type: 'stitch',      pal: 'ty_stitch', neon: '#6affa8' },   // twin: Marrow Street Clinic keeps `clinic`
  campgiardia:                    { type: 'campgiardia', pal: 'ty_giardia' },        // twin: Grease Expectations keeps `diner`
  wattsthedamage:                 { type: 'watts',       pal: 'ty_watts', neon: '#ffcf3e' },    // twin: Marrow Street Hardware keeps `hardware`
  leverlaneboatyard:                    { type: 'hulls',       pal: 'ty_hulls' },          // twin: Kessler Street Wharf keeps `wharf`
  slagwares:                      { type: 'slagwares',   pal: 'ty_slagw' },          // twins: Salvage Rites keeps `junkyard`
  thumbonthescale:                { type: 'thumbscale',  pal: 'ty_thumb' },
  theslip:                        { type: 'slipback',    pal: 'ty_slip' },           // twin: the Marrow Street fence (Cash & Carrion) is authored
  sentimentalvaluepawn:           { type: 'sentimental', pal: 'ty_sentimental', neon: '#ffcf3e' },
  grindhouse:                     { type: 'grindhouse',  pal: 'ty_grind', neon: '#ff8a2a' },    // twin: Second Amendment keeps `armory`
  trackmarksfreight:              { type: 'signalbox',   pal: 'ty_signalbox' },
  // ⚠ THE TRUNK MAIN IS THE POINT OF THIS BUILDING. The shop shares a wall with the Coldwater Clone
  // Facility because that is where the food comes from, and a viewer on Ironside Street should see
  // it arrive without a word of prose: a glass main from the clone's vats into the party wall, up
  // the shop's south corner into the masher on the roof, back down into a header, and a leg into
  // every dispenser. Once a minute a slug of product goes the whole way (`gutPhase`).
  //
  // ⚠ THE CROSSING IS DRAWN BY THE CLONE'S ARM, AND THE PARTY WALL, THE RISER AND THE DOWNCOMER ARE
  // IN TILES. The two tiles roll fh and h separately, so a pipe written in either one's basis meets
  // the other somewhere it wasn't put. Every earlier version of this junction tried to make the two
  // rolls agree, and left a pipe in the air or, on the live seeds, through the clone's sign plate.
  // Now neither side decides where the wall is: both read `GUT` (glass/models/downtown.js), and each
  // side's pipe dies in the wall at its own height, which the wall hides. The riser and its stub
  // out of the wall are glass and drawn in the arm with `tubeRun`; this list is the shop's own pipework.
  //
  // ⚠ AND THE HEADER RUNS AT 0.50, UNDER THE FASCIA, SO THE FASCIA CAN CARRY THE NAME. A service
  // line painted through a shop sign makes a building look like two drawings on top of each other.
  secondhelpings: {
    type: 'helpings', pal: 'ty_helpings_w', neon: '#6aff9a',
    // ⚠ TRIPLES, NOT NUMBERS. A model FILE is authored in plain units and `compileModel` turns each
    // field into its `[a·fh + b·h + c]` basis at the bake; a list written in CODE is already past
    // that and `V()` reads the triple directly. A plain number there is `p[0]` on a number —
    // `undefined` — so every coordinate resolves to NaN, and NaN passes every `if (f <= 0.1) return`
    // guard in these painters. It draws nothing, throws nothing, and reaches the commit: the first
    // cut of this list did exactly that and looked like the parts had simply not been wired up.
    detail: [
      // The product back down beside the riser, fatter because it's carrying more than it went up
      // with, and the header from it across the shopfront to the north end of the wall. The south
      // end is in tiles for the riser's reason: in fh the pair stood inside the party wall at the
      // top of fh's range.
      { kind: 'pipe', cx: [0, 0, -0.27], cy: [1.02, 0, 0], z0: [0, 0.50, 0], z1: [0, 0.855, 0], r: [0.046, 0, 0], pal: 'ty_clone' },
      { kind: 'conduit', cx: [0.42, 0, -0.135], cy: [1.02, 0, 0], z: [0, 0.50, 0], half: [0.42, 0, 0.135], r: [0.040, 0, 0], pal: 'ty_clone' },
      { kind: 'conduit', cx: [0.08, 0, 0], cy: [1.00, 0, 0], z: [0, 0.462, 0], half: [0.72, 0, 0], r: [0.016, 0, 0], pal: 'ty_2cell' },  // the return beside it — one tube is a prop, two is plant
      // ⚠ AND THE TRUNK IS THE PLANT'S COLOUR WHILE THE LEGS ARE THE SHOP'S. The downcomer and the
      // header are `ty_clone` on purpose: a pale clinical line in the FACILITY's palette says where the
      // food comes from. The seven legs and the return are ordinary galvanised (`ty_2cell`), which
      // is both true (they are the shop's own pipework, not the plant's) and the only way they
      // READ: `ty_clone` is
      // [176,200,204] against a `ty_helpings_w` wall at [214,220,220], so seven evenly spaced pale
      // bars on a pale wall came out as fluting rather than as plumbing.
      // ⚠ AND SEVEN LEGS OFF IT, ON THE CABINETS' OWN CENTRES. This is the part that says the
      // machines are plumbed rather than parked, and it is the whole difference between a pipe on
      // a wall and a distribution: the header ends at the canopy over each one, so what a player
      // standing at the rank sees is the supply arriving at the machine they are queueing for.
      // The x list is the arm's `(-0.54 + i * 0.18) * fh` written out — two places, and they have
      // to agree, which is why the arm's loop is written in the same numbers rather than centred.
      ...[-0.54, -0.36, -0.18, 0.00, 0.18, 0.36, 0.54].map((u) => (
        { kind: 'pipe', cx: [u, 0, 0], cy: [1.02, 0, 0], z0: [0, 0.35, 0], z1: [0, 0.50, 0], r: [0.012, 0, 0], pal: 'ty_2cell' })),
      // ⚠ AND THE END DROP AND ITS VENT SIT AT 0.84fh, NOT AT THE CORNER. The wall they are bolted
      // to is the 0.92fh box, and `anchored` counts what hangs off the end of it — a 0.13fh-wide vent
      // centred at 0.94fh puts 0.06 of a tile of louvre in open air beside the building, which draws
      // perfectly and identically every frame and is exactly the case that gate exists for.
      { kind: 'pipe', cx: [0.84, 0, 0], cy: [1.02, 0, 0], z0: [0, 0.26, 0], z1: [0, 0.50, 0], r: [0.040, 0, 0], pal: 'ty_clone' },        // …and down the north end of the wall into the shop
      { kind: 'vent', cx: [0.79, 0, 0], cy: [1.00, 0, 0], z: [0, 0.24, 0], w: [0.12, 0, 0], hh: [0, 0.055, 0], drip: 0.5, pal: 'ty_clone' }, // where it goes in, and what it has left down the wall
    ],
  },
  // ── DEADWATER — the Null's works ───────────────────────────────────────────
  // Ten of these tiles were bare gravel until now: the region's entire settlement was invisible
  // from the air. The Dam and The Turbine Hall had models that could never resolve, because both
  // tiles carried a zone `name` and no `building_name`, which is not what modelFor reads.
  theschoolroom:                  { type: 'dw_school',   pal: 'ty_dw_timber' },
  thesleepers:                    { type: 'dw_sleepers', pal: 'ty_dw_timber' },
  thereckoning:                   { type: 'dw_reckoning', pal: 'ty_dw_stone' },
  theforge:                       { type: 'dw_forge',    pal: 'ty_dw_forge' },
  thewindingshop:                 { type: 'dw_winding',  pal: 'ty_dw_timber' },
  thetally:                       { type: 'dw_tally',    pal: 'ty_dw_slate' },
  thestandpipe:                   { type: 'dw_standpipe', pal: 'ty_dw_iron' },
  thestores:                      { type: 'dw_stores',   pal: 'ty_dw_iron' },
  thesurgery:                     { type: 'dw_surgery',  pal: 'ty_dw_paint' },
  thegaugehouse:                  { type: 'dw_gauge',    pal: 'ty_dw_stone' },
  // The Reach — four hand-built frontier landmarks. Grim-dark meets wild-west; each is a one-off
  // silhouette so the tiny outpost reads as unforgettable from the air (docs/reference/world-rendering.md).
  // ── Yards twins: the distinguished half of each same-type pair ──────────────
  // Each of these shared a TYPE_MODEL with a neighbour of the same building_type and
  // was indistinguishable from it in the air. The twin keeps the generic type model;
  // this one gets a silhouette you can name from a mile out.
  coldlinereeferdepot:            { type: 'reefer',     pal: 'ty_reefer_blk' },
  kesslercontaineryard:               { type: 'interstack', pal: 'ty_stack_dk' },
  ferrofabricationworks:          { type: 'foundry',    pal: 'ty_foundry' },
  yardsfreightoffice:         { type: 'oldoffice',  pal: 'ty_meltoffice', neon: '#ffb43a' },
  bondedstore7:            { type: 'bonded',     pal: 'ty_wh_metal',   neon: '#6affa8' },
  // Promoted off the generic `casino` type model so a future casino still has one.
  theluckybastard:                { type: 'neonvig',    pal: 'ty_vig',        neon: '#ff3e8a' },
  buzzardfield:                   { type: 'buzzard',   pal: 'ty_reach_hangar', neon: '#ffb14a' },
  thecoyotesrest:                 { type: 'saloon',    pal: 'ty_reach_saloon', neon: '#ff6a3a' },
  thedynamo:                      { type: 'dynamo',    pal: 'ty_reach_dynamo', neon: '#6cf0ff' },
  thelayover:                     { type: 'layover',   pal: 'ty_reach_motel',  neon: '#ff5a86' },
  // Main Street, second pass. Four false fronts in an unbroken row plus the freight shed at the
  // south end, so the Reach reads as a STREET from the air and not four landmarks in a field.
  thedrygoods:                    { type: 'mercantile', pal: 'ty_reach_merc',  neon: '#ffd07a' },
  theassay:                       { type: 'assay',      pal: 'ty_reach_assay', neon: '#9fe8ff' },
  thequiettrade:                  { type: 'undertaker', pal: 'ty_reach_grey' },
  thelongsoak:                    { type: 'bathhouse',  pal: 'ty_reach_bath',  neon: '#7affd6' },
  thelastload:                    { type: 'lastload',   pal: 'ty_reach_skin',  neon: '#ffb14a' },
  // ── HALCYON FIELDS, THE FOURTH CAMPAIGN — one silhouette per plot. Sixty-nine buildings stood
  // on fourteen types, so forty-two of them were drawing a building one of their neighbours was
  // already drawing; these are the forty-two, and every type keeps the one plot that best shows
  // what it is. ⚠ BOUND BY NAME AND NOT BY TYPE, which is what makes that possible: `modelFor`
  // prefers a named model, so the type arm is untouched and still draws its own exemplar. Nothing
  // in `content/` moved, no `building_type` changed and no map glyph is new — a map icon says what
  // a building is FOR, and all forty-two are still the programme their tile says they are.
  // The eleven-plot construction site. The type arm keeps Plot 1, Vetch Mews; these are ten other places
  // for the work to have stopped.
  plot7kettlelane:                     { type: 'hf_frame',     pal: 'ty_hft_glass' },
  plot10cowsliprise:              { type: 'hf_jumpform',  pal: 'ty_hft_glass' },
  plot9cinderlane:               { type: 'hf_wrap',      pal: 'ty_hft_glass' },
  plot11cowsliprise:                 { type: 'hf_scaffold',  pal: 'ty_hft_glass' },
  plot8cinderlane:                    { type: 'hf_stalled',   pal: 'ty_hft_glass' },
  plot5kerbstonerow:                   { type: 'hf_hoist',     pal: 'ty_hft_glass' },
  plot2kerbstonerow:            { type: 'hf_halfbuilt', pal: 'ty_hft_glass' },
  plot3kerbstonerow:                     { type: 'hf_climber',   pal: 'ty_hft_glass' },
  plot4kerbstonerow:                      { type: 'hf_flood',     pal: 'ty_hft_glass' },
  plot6kerbstonerow:                      { type: 'hf_topout',    pal: 'ty_hft_glass' },
  // The low ones. Five more ways to put a hole in a building that is wider than it is tall.
  // The slug drops the é, so Sorrel Way Café keys as `sorrelwaycaf`.
  sorrelwaycaf:                   { type: 'hf_cloister',    pal: 'ty_hft_glass', neon: '#a8e2ff' },
  burnetcourt:                     { type: 'hf_ring',        pal: 'ty_hft_glass', neon: '#a8e2ff' },
  yarrowworks:                   { type: 'hf_scissor',     pal: 'ty_hft_glass', neon: '#bfe8ff' },
  halcyonfieldsestatemanagement:                     { type: 'hf_forecourt',   pal: 'ty_hft_glass', neon: '#a8e2ff' },
  campioncourt:                     { type: 'hf_bridgecourt', pal: 'ty_hft_glass', neon: '#bfe8ff' },
  // The estate's tower, with one decision changed each time.
  betonyhouse:                     { type: 'hf_stepdrum',  pal: 'ty_hft_glass', neon: '#7fd8ff' },
  fescuehouse:                    { type: 'hf_fluted',    pal: 'ty_hft_glass', neon: '#9fe0ff' },
  instituteresidences:                     { type: 'hf_pale',      pal: 'ty_hf_marble', neon: '#c8efff' },
  cloverhouse:                       { type: 'hf_chamfer',   pal: 'ty_hft_glass', neon: '#7fd8ff' },
  mallowhouse:                    { type: 'hf_scarf',     pal: 'ty_hft_glass', neon: '#9fe0ff' },
  // The stepped ones: daylight, an offset, a splay, a seam, a balcony.
  sorrelterrace:                  { type: 'hf_sawtooth',   pal: 'ty_hft_glass', neon: '#8ce4c0' },
  cinderterrace:                        { type: 'hf_pixel',      pal: 'ty_hft_glass', neon: '#8ce4c0' },
  cowslipterrace:                     { type: 'hf_splay',      pal: 'ty_hft_glass', neon: '#8ce4c0' },
  rowendterrace:                      { type: 'hf_partywall',  pal: 'ty_hft_glass', neon: '#a8e2ff' },
  halcyonfieldssiteoffice:                   { type: 'hf_lowterrace', pal: 'ty_hft_glass', neon: '#8ce4c0' },
  // The threaded ones — the spine with something else on it.
  primrosehouse:                      { type: 'hf_spindle',   pal: 'ty_hft_glass', neon: '#9fe0ff' },
  bluebellhouse:                      { type: 'hf_links',     pal: 'ty_hft_glass', neon: '#9fe0ff' },
  foxglovehouse:                  { type: 'hf_voidstack', pal: 'ty_hft_glass', neon: '#9fe0ff' },
  heatherhouse:                    { type: 'hf_lozenge',   pal: 'ty_hft_glass', neon: '#9fe0ff' },
  // The bent ones — the crescent's construction spent on four other plans.
  boulevardcrescenteast:                    { type: 'hf_scurve',    pal: 'ty_hft_glass', neon: '#9fe0ff' },
  kettlelanecrescent:                  { type: 'hf_notch',     pal: 'ty_hft_glass', neon: '#9fe0ff' },
  halcyondevelopments:              { type: 'hf_fan',       pal: 'ty_hft_glass', neon: '#9fe0ff' },
  kerbstonehouse:                    { type: 'hf_converted', pal: 'ty_hft_glass', neon: '#9fe0ff' },
  // The sheared ones — what else a tower can do to its own plan as it rises.
  meadowsweettower:                   { type: 'hf_vault',      pal: 'ty_hft_glass', neon: '#7fd8ff' },
  rowantower:                  { type: 'hf_prow',       pal: 'ty_hft_glass', neon: '#7fd8ff' },
  tansytower:                 { type: 'hf_hammerhead', pal: 'ty_hft_glass', neon: '#7fd8ff' },
  // The cut ones. ★ `halcyonpoint` is the quarter's hero — the tallest plot in Halcyon Fields and
  // the only one of the forty-two that letters its own name.
  cinderpoint:                      { type: 'hf_shard',   pal: 'ty_hft_glass', neon: '#bfe8ff' },
  halcyonpoint:                   { type: 'hf_ceiling', pal: 'ty_hft_glass', neon: '#bfe8ff' },
  // …and one each for the five remaining types with two plots on them.
  theeastlens:                      { type: 'hf_sunkdrum',  pal: 'ty_hft_glass', neon: '#c8efff' },
  thefernhouse:                  { type: 'hf_palmhouse', pal: 'ty_hfp_glass', neon: '#7fe6b4' },
  cinderlanefarm:                      { type: 'hf_rootfarm',  pal: 'ty_hfv_glass', neon: '#e07ad8' },
  buriedroadhalt:                  { type: 'hf_stophalt',  pal: 'ty_hf_chrome', neon: '#5ac8ff' },
  // The two rooms the Outer Lock's hall swallows (old-coldwater.js). Named, so the `weigh_station`
  // and `police` arms stay as they are for the plazas on the void highway and Precinct 9.
  theglacisweigh:                 { type: 'glacis_booth', pal: 'ty_hf_mirror' },
  southgatepolicepost:                    { type: 'gate_post',    pal: 'ty_hf_mirror' },
};
export function namedModel(name) { return NAMED_MODELS[bldgSlug(name)] || null; }

// Per-type default model, so a building that carries only a building_type (no bespoke
// NAMED_MODELS entry yet — a freshly-authored one) still renders a type-appropriate
// dedicated model instead of a borrowed biome archetype. modelFor() prefers the named
// model, then the type default; a tile with neither (a plain street/park tile) returns
// null and keeps its biome archetype.
export const TYPE_MODEL = {
  corporate_office: { type: 'office',    pal: 'ty_office' },
  // No building carries building_type 'archive' today. The row is here rather than as a dead
  // NAMED_MODELS key (which is what it was) so the classical civic temple stays in the shape bake,
  // stays covered by shapes:smoke, and is one authored flag away from being used again.
  archive:          { type: 'archive',   pal: 'ty_archive' },
  // Two Coldwater types that had NO row at all, so their buildings baked no shape and drew as
  // lights with no mass — the Sentinel bug, twice, sitting unnoticed.
  forwarder:        { type: 'freight_forwarder', pal: 'ty_fwd_metal' },
  store:            { type: 'shop',      pal: 'ty_shop_b', neon: '#7dff6a' },
  // Terminus' glasshouses (docs/proposals/terminus.md). REGISTERED, not merely `case`d: a new arm
  // in drawTypeModel that never lands in this table bakes NO shape, gets NO distance LOD, casts no
  // ground shadow, and is invisible to shapes:smoke — which is to say it has exactly the coverage
  // the roaster bug had. Adding the case and adding the row are one job.
  greenhouse:       { type: 'greenhouse', pal: 'ty_shop_a', neon: '#7dffb0' },
  // Bare aliases for authored types that never got their own model. Without an
  // entry here a building bakes NO shape at all and draws as lights with no mass
  // — which is what made the Sentinel a floating grid of windows in the intro.
  office:           { type: 'office',    pal: 'ty_office' },
  civic:            { type: 'police',    pal: 'ty_police' },
  grocery:          { type: 'shop',      pal: 'ty_shop_a', neon: '#5fd0ff' },
  hotel:            { type: 'hotel',     pal: 'ty_hotel',  neon: '#ff4a9a' },
  apartment:        { type: 'apartment', pal: 'ty_apt_a' },
  residential:      { type: 'apartment', pal: 'ty_apt_b' },
  shop:             { type: 'shop',      pal: 'ty_shop_a', neon: '#5fd0ff' },
  diner:            { type: 'diner',     pal: 'ty_diner',  neon: '#ffcf3e' },
  bar:              { type: 'bar',       pal: 'ty_bar_a',  neon: '#7dff6a' },
  honkytonk:        { type: 'honkytonk', pal: 'ty_honky', neon: '#ff5fa8' },
  club:             { type: 'club',      pal: 'ty_club',   neon: '#ff4a9a' },
  nightclub:        { type: 'nightclub', pal: 'ty_voltage', neon: '#5cd6ff' },
  boutique:         { type: 'boutique',  pal: 'ty_boutique', neon: '#ff4a9a' },
  studio:           { type: 'studio',    pal: 'ty_studio' },
  police:           { type: 'police',    pal: 'ty_police' },
  clinic:           { type: 'clinic',    pal: 'ty_clinic' },
  power:            { type: 'power',     pal: 'ty_power' },
  hangar:           { type: 'hangar',    pal: 'ty_hangar_a' },
  control_tower:    { type: 'atc',       pal: 'ty_arrivals', noKit: true },   // the airfield's buildings are authored whole; see UNSIGNED_TRADE
  arrivals:         { type: 'arrivals',  pal: 'ty_arrivals', noKit: true },
  departures:       { type: 'departures', pal: 'ty_arrivals', noKit: true },   // the terminal's south half; see the arrivals arm
  gun_shop:         { type: 'armory',    pal: 'ty_armory', neon: '#ff6a4a' },
  blade_shop:       { type: 'armory',    pal: 'ty_forge',  neon: '#ff8a2a' },
  casino:           { type: 'casino',    pal: 'ty_casino', neon: '#ff3e8a' },
  fence:            { type: 'pawn',      pal: 'ty_pawn',   neon: '#ffcf3e' },
  chem_supply:      { type: 'chemsupply', pal: 'ty_chem',  neon: '#7dff6a' },
  // Reuses the shop mesh with its own iron-toned palette + warm sign, the same
  // "nearest existing model, bespoke colour" call the Ascendant campus makes.
  kitchenware:      { type: 'shop',      pal: 'ty_kitchen', neon: '#ff9a3e' },
  // Ironside Gym is authored and binds by name; this is the fallback for any other gym.
  gym:              { type: 'shop',      pal: 'ty_unit_brick', neon: '#ff6a3a' },
  butcher:          { type: 'butcher',   pal: 'ty_butcher', neon: '#ff3e4a' },
  // St Garneau's. NO NEON, and that is the point: it is the one building on the
  // street with nothing lit on it except the thing that was bolted on afterwards — which is also
  // why the trade is in UNSIGNED_TRADE and declines half the derived kit.
  church:           { type: 'church',    pal: 'ty_church' },
  bank:             { type: 'bank',      pal: 'ty_marble' },
  // The Reach's Main Street trades. Registered by TYPE as well as by name so a second
  // frontier town gets a false-front mercantile for free rather than a borrowed biome box.
  mercantile:       { type: 'mercantile', pal: 'ty_reach_merc',  neon: '#ffd07a' },
  assay:            { type: 'assay',      pal: 'ty_reach_assay', neon: '#9fe8ff' },
  undertaker:       { type: 'undertaker', pal: 'ty_reach_grey' },
  bathhouse:        { type: 'bathhouse',  pal: 'ty_reach_bath',  neon: '#7affd6' },
  // The Yards — semi-industrial freight district (see docs/proposals/yards.md).
  warehouse:         { type: 'warehouse',         pal: 'ty_wh_metal' },
  // THE LONG HAUL — the depot you walk into. Registered as well as `case`d, per the note above.
  truck_depot:       { type: 'truck_depot',       pal: 'ty_wh_metal' },
  container_yard:    { type: 'container_yard',    pal: 'ty_cont_b' },
  fuel_yard:         { type: 'fuel_yard',         pal: 'ty_pallet' },
  cold_storage:      { type: 'cold_storage',      pal: 'ty_cold' },
  fabrication:       { type: 'fabrication',       pal: 'ty_fab_metal' },
  wharf:             { type: 'wharf',             pal: 'ty_wharf' },
  // ── THE BASIN JETTY ────────────────────────────────────────────────────
  // Four types for one place, because a run of deck, the yard you leave the truck in, the quay
  // beside it and the thing on the head are four different buildings that happen to be in a line.
  // The deck repeats along the run, so it obeys the wall rule (symmetric masses only — see the ⚠ on
  // trm_wall) and is in NO_TILE_FIT for the reason a rampart is: a pier trimmed back to its own
  // plot line is a pier with a hole at every joint.
  pier:              { type: 'pier',              pal: 'ty_quay_deck' },
  harbour_yard:      { type: 'harbour_yard',      pal: 'ty_yard_tarmac', neon: '#ffc24a' },
  // The working half of the basin, east of the jetty: hardstanding with a compact harbour crane on
  // it. Its own type rather than a variant of `wharf`, because the two are opposite answers to one
  // job — a lattice mast with a jib on a wire, against one sealed shell that does all of it.
  quay_crane:        { type: 'quay_crane',        pal: 'ty_quay_deck' },
  // ── FAIRWEATHER MARINA, on the west shore ───────────────────────────────────────────────────────
  // The Ascendant answer to the jetty above, and deliberately not a paler version of it: a deck
  // that FLOATS rather than one held clear on columns, and a glass hall rather than a steel hut.
  // `ty_hf_ice` is the pale clad panel the rest of the quarter's podiums are in; `ty_aur_frost` is
  // FROST_WALL, the etched glass whose light comes from inside, which is the one thing that makes
  // a building lit at every hour read as intentional instead of as a missing night palette.
  pontoon:           { type: 'pontoon',           pal: 'ty_hf_ice',   neon: '#7fe4ff' },
  boathouse:         { type: 'boathouse',         pal: 'ty_asc_chrome', neon: '#a8e6f2' },
  // The fuel berth moored to its north face: the pontoon's float in the slab's own materials.
  fuel_dock:         { type: 'fuel_dock',         pal: 'ty_hf_ice',   neon: '#7fe4ff' },
  // ⚠ PEARL RATHER THAN `ty_aur_frost`, WHICH WAS THE FIRST CHOICE AND MEASURED WRONG. Both are
  // FROST_WALL, so both are "etched glass" by family — but `ty_aur_frost` is [74,52,92], a dark
  // aubergine, and a dark wall under daylight shading resolves to a grey-lavender that reads as
  // painted render. Sampled off a real preview it came back 88,88,96 and 112,104,120 across the
  // flank, which is stone. `ty_aur_pearl` is [198,186,208], the pale half of the same family.
  // ⚠ AND THE MATERIAL RESPONSE IS NO HELP HERE: the frost BRDF is a GLASS 2 feature (`glMat`), so
  // on the 2-D painter a palette key is a colour and a texture generator and nothing else. What
  // carries "glazed" on the canvas is the colour and the mullions, never the family it is filed in.
  // ⚠ THE BEACON'S COLOUR IS THIS ONE FIELD AND NOTHING ELSE READS A COLOUR. Every light on the
  // tower — the eye, the sweep, the runs up the ribs, the wash on the water — derives from
  // `m.neon`, so changing the character of the whole thing is a one-word edit here and cannot leave
  // half the tower burning last week's hue.
  lighthouse:        { type: 'lighthouse',        pal: 'ty_lh_shell', neon: '#4ff0ff' },
  freight_office:    { type: 'freight_office',    pal: 'ty_freight_office', neon: '#ffb43a' },
  freight_forwarder: { type: 'freight_forwarder', pal: 'ty_fwd_metal' },
  // The scrapyard on the wasteland edge — crushed-car bales, a grabber crane, a shack.
  junkyard:          { type: 'junkyard',          pal: 'ty_junk_shack', neon: '#ffb43a' },
  // The only warm-lit window on Ironside — a wide glazed front and a cold-blue sign.
  laundromat:        { type: 'laundromat',        pal: 'ty_asc_clinic', neon: '#7fe3ff' },
  // Marrow Street — the workaday downtown strip either side of the Sentinel. Each type
  // has exactly one building and each gets its OWN silhouette, not a recoloured shop box:
  // the strip has to read as a high street from the air, which it can't do if four of the
  // six are the same mesh.
  dept_store:        { type: 'deptstore',         pal: 'ty_adequate',   neon: '#ff8a2e' },
  hardware:          { type: 'hardware',          pal: 'ty_bolt',       neon: '#ffcf3e' },
  noodle_bar:        { type: 'noodlebar',         pal: 'ty_broth',      neon: '#ff5a3e' },
  outfitter:         { type: 'outfitter',         pal: 'ty_secondskin', neon: '#ffb43a' },
  bodega:            { type: 'bodega',            pal: 'ty_kessel',     neon: '#ffe08a' },
  // Ironside, one corner south of the casino — a narrow deep shopfront under a gold-on-black
  // blade sign, its whole street face given over to one lit and barred display window.
  comic_shop:        { type: 'comicshop',         pal: 'ty_mintcond',   neon: '#ffd24a' },
  // ── THE INFILL TRADES (docs/proposals/coldwater-infill.md) ─────────────────
  // Buildings the city had no analogue for, dropped into open tiles inside the built grid. Each
  // gets its OWN arm rather than a recoloured `shop` box, which is the whole test the roster was
  // picked on: a type that would render as the default storefront was cut from it.
  cinema:            { type: 'cinema',            pal: 'ty_reel',       neon: '#ff4a7a' },
  bookmaker:         { type: 'bookmaker',         pal: 'ty_pfin',       neon: '#ffc94a' },
  taxidermist:       { type: 'taxidermist',       pal: 'ty_stuff',      neon: '#e8d6a8' },
  lending_library:   { type: 'lending_library',   pal: 'ty_fprint',     neon: '#d8d2bc' },
  pool_hall:         { type: 'pool_hall',         pal: 'ty_pocket',     neon: '#6effa8' },
  amusements:        { type: 'amusements',        pal: 'ty_penny',      neon: '#ffb03a' },
  fishmonger:        { type: 'fishmonger',        pal: 'ty_cod',        neon: '#8fd8ff' },
  cobbler:           { type: 'cobbler',           pal: 'ty_sole',       neon: '#ffc87a' },
  photographer:      { type: 'photographer',      pal: 'ty_negeq',      neon: '#cfe0ff' },
  locksmith:         { type: 'locksmith',         pal: 'ty_skel',       neon: '#d8c88a' },
  tattooist:         { type: 'tattooist',         pal: 'ty_regerts',    neon: '#ff5ac8' },
  vet:               { type: 'vet',               pal: 'ty_paws',       neon: '#ffd9a0' },
  off_licence:       { type: 'off_licence',       pal: 'ty_spirit',     neon: '#ffd27a' },
  museum:            { type: 'museum',            pal: 'ty_past',       neon: '#e2dcc4' },
  // ── HALCYON FIELDS ────────────────────────────────────────────────────────
  // The quarter the Glasshouse is building south into. `neon` here is the colour a LAMP
  // washes cut stone with rather than the colour of a tube: nothing in this quarter
  // advertises, because the money that built it does not need to.
  concert_hall:      { type: 'concert_hall',      pal: 'ty_sound',      neon: '#bfe8ff' },
  members_club:      { type: 'members_club',      pal: 'ty_vested',     neon: '#e6dcc2' },
  auction_house:     { type: 'auction_house',     pal: 'ty_going',      neon: '#a8d8f0' },
  institute:         { type: 'institute',         pal: 'ty_course',     neon: '#dff0ff' },
  land_office:       { type: 'land_office',       pal: 'ty_plot',       neon: '#7fd8ff' },
  hydro:             { type: 'hydro',             pal: 'ty_wind',       neon: '#9fe4ff' },
  winter_garden:     { type: 'winter_garden',     pal: 'ty_glass_plinth', neon: '#7fe6b4' },
  // The plant half. Every `neon` here is a WARNING or a WORK light rather than signage:
  // nothing on this side of the quarter is advertising anything to anybody.
  pumping_station:   { type: 'pumping_station',   pal: 'ty_mains',        neon: '#5ac8ff' },
  cooling_plant:     { type: 'cooling_plant',     pal: 'ty_cold_slab',    neon: '#8fd8ff' },
  gasholder:         { type: 'gasholder',         pal: 'ty_holder',       neon: '#6fbcff' },
  substation:        { type: 'substation',        pal: 'ty_current',      neon: '#ffd24a' },
  exchange:          { type: 'exchange',          pal: 'ty_wires',        neon: '#6fa8cc' },
  fire_station:      { type: 'fire_station',      pal: 'ty_engine_brick', neon: '#ff5a4a' },
  // The two sited by their subject rather than by the quarter — an incinerator beside the
  // clone facility, a water tower at the centre of the city it holds a day for.
  incinerator:       { type: 'incinerator',       pal: 'ty_ash',          neon: '#74a8ff' },
  water_tower:       { type: 'water_tower',       pal: 'ty_hwm',          neon: '#8fd0ff' },
  chrome_tower:      { type: 'chrome_tower',      pal: 'ty_hft_glass',    neon: '#7fd8ff' },
  chrome_slab:       { type: 'chrome_slab',       pal: 'ty_hft_glass',    neon: '#9fe0ff' },
  pavilion:          { type: 'pavilion',          pal: 'ty_hfp_glass',    neon: '#7fe6b4' },
  sky_court:         { type: 'sky_court',         pal: 'ty_hft_glass',    neon: '#bfe8ff' },
  vertical_farm:     { type: 'vertical_farm',     pal: 'ty_hfv_glass',    neon: '#e07ad8' },
  transit_halt:      { type: 'transit_halt',      pal: 'ty_hf_chrome',    neon: '#5ac8ff' },
  // Halcyon Fields, the third campaign. Eight silhouettes on the same two glass tones the six
  // above use — see the ⚠ over the arms: in an estate the developer is the constant and the
  // shape is the variable, so a new type here is a new outline and never a new colour.
  torque_tower:      { type: 'torque_tower',      pal: 'ty_hft_glass',    neon: '#7fd8ff' },
  bead_tower:        { type: 'bead_tower',        pal: 'ty_hft_glass',    neon: '#9fe0ff' },
  cascade_block:     { type: 'cascade_block',     pal: 'ty_hft_glass',    neon: '#8ce4c0' },
  glass_prism:       { type: 'glass_prism',       pal: 'ty_hft_glass',    neon: '#bfe8ff' },
  atrium_court:      { type: 'atrium_court',      pal: 'ty_hft_glass',    neon: '#a8e2ff' },
  lens_hall:         { type: 'lens_hall',         pal: 'ty_hft_glass',    neon: '#c8efff' },
  chrome_arch:       { type: 'chrome_arch',       pal: 'ty_hft_glass',    neon: '#7fd8ff' },
  shell_tower:       { type: 'shell_tower',       pal: 'ty_hft_glass',    neon: '#6fa8c8' },
  // ── OLD COLDWATER (docs/proposals/old-coldwater.md) ────────────────────────
  // The Shingles. Five trades and a ruin, and the district's whole visual argument is that NOT ONE
  // OF THEM CARRIES A NEON. Every other entry in this table names a colour for a blade, a fascia or
  // a marquee; these name none, so `neon` is deliberately absent and `accentOf` falls through to
  // the material. What lights this district after dark is five small windows and a brazier.
  ruin:              { type: 'ruin',              pal: 'ty_oc_brick' },
  water_seller:      { type: 'water_seller',      pal: 'ty_oc_board' },
  flophouse:         { type: 'flophouse',         pal: 'ty_oc_board' },
  soup_kitchen:      { type: 'soup_kitchen',      pal: 'ty_oc_brick' },
  bonesetter:        { type: 'bonesetter',        pal: 'ty_oc_brick' },
  shebeen:           { type: 'shebeen',           pal: 'ty_oc_board' },
  // ── THE SOUTH GATE INSPECTION STATION ──────────────────────────────────────
  // The booth inside the wall and the lot a seized rig is taken to. Neither names a neon, for Old
  // Coldwater's reason rather than a new one: a weighbridge and a pound are municipal, and the only
  // light on either is there so somebody can read a windscreen or watch a fence.
  weigh_station:     { type: 'weigh_station',     pal: 'ty_guard' },
  vehicle_pound:     { type: 'vehicle_pound',     pal: 'ty_bond_fence' },
  // The Ascendant Stronghold (docs/proposals/ascendant-stronghold.md).
  asc_spire:  { type: 'asc_spire',  pal: 'ty_asc_spire' },
  asc_gate:   { type: 'asc_gate',   pal: 'ty_asc_gate' },
  asc_clinic: { type: 'asc_clinic', pal: 'ty_asc_clinic' },
  asc_weave:  { type: 'asc_weave',  pal: 'ty_asc_weave' },
  asc_vats:   { type: 'asc_vats',   pal: 'ty_asc_vats' },
  asc_shrine: { type: 'asc_shrine', pal: 'ty_asc_shrine' },
};
