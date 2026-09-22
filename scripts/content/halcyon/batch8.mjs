/**
 * Halcyon Fields, batch 8 — the thirty with no door.
 *
 * Run after batch6 (the streets) and batch7 (the twelve you can walk into). This fills every
 * remaining plot the new grid opened, with buildings that are mass on the skyline and nothing on
 * the walk graph.
 *
 * ⚠ WHY THIRTY BUILDINGS WITH NO WAY IN, IN A CITY WHERE 196 OF 196 FACADES ARE ENTERABLE.
 * Because the alternative is thirty invented rooms. Every enterable building in Coldwater is
 * enterable because somebody wrote an inside for it; a residential tower in a quarter that is
 * four hundred people short of being occupied does not have a public room, and a lobby authored
 * for one would be a corridor with a lift in it, thirty times over. The quarter's own fiction
 * already says what these are — the district blurb has read "half-built frontage" and "behind
 * the hoardings a generator runs, and nothing it powers is finished" since batch0 — so eleven of
 * them are shells with the crane still up and the other nineteen are clad, topped out, and let to
 * people who have never been here.
 *
 * ⚠ THE ELEVEN SHELLS ARE THE ELEVEN AMBER TACKS on Pardoe's plan in Ground Rent (batch7). That
 * is not decoration: he says out loud that there are eleven plots with cranes on them and that he
 * marks them because he cannot answer for them, and if this file ever grows a twelfth
 * `shell_tower` his line becomes wrong. The assertion at the bottom is what stops that happening
 * quietly.
 *
 * ⚠ THEY CARRY `is_building` WITHOUT `facade`, which is the ruin pattern from
 * build-old-coldwater.mjs — mass out the canopy, a footprint on the map, and no revolving door.
 * They keep `entrance` and `floors`, which a ruin deliberately does not: both reach the flight
 * cell through `deriveSurfaceCell` (the model's facing and its height) and NEITHER reaches the
 * engine, because `buildingEntranceDir` and `isEnterableFacade` are both gated on `facade`.
 * ⚠ AND EVERY NEIGHBOUR'S EXIT INTO THEM HAS TO GO WITH THEIRS, or you walk into a solid.
 *
 * Converting one of these into a real building later is additive: author it through
 * `authorBuilding` in a new batch and it will overwrite the tile, add the `facade` tag and the
 * interior map, and re-strip the neighbours itself.
 *
 * ⚠ Run `node scripts/content/mint-connections.mjs --write` afterwards. Turning a tile into a
 * building leaves an edge that geometry still projects and exits no longer declare, and that gap
 * has to land as a `blocked: true` connection or content:lint reports it forever.
 *
 *   node scripts/content/halcyon/batch8.mjs [--dry-run]
 */
import { loadContentStore } from '../../../tools/lib/content-store.mjs';

const DRY = process.argv.includes('--dry-run');
const store = loadContentStore();

const REGION = 'region_coldwater';
const HF = 'halcyon_fields';
const idFor = (x, y) => `zone_district_${x}_${y}`;

// [x, y, name, building_type, floors, entrance, marker, description]
//
// ⚠ THE HEIGHTS ARE A PROFILE, NOT A ROLL. The estate was built north to south and the money ran
// with it, so the tall end is the boulevard end and the last phase along the Curtain is six to
// twelve storeys. A skyline that steps says which way a quarter grew; a skyline of random heights
// says nothing at all, and from a cockpit that is the only thing about it you can read.
const PLOTS = [
  // ── Block A: behind the boulevard frontage, on Vetch Mews and Sorrel Way ────
  [892, 912, 'Rising Damp', 'shell_tower', 18, 'east', 'RB',
    'Eighteen storeys of it, clad to about the tenth and bare floor plates above that, with the crane still standing off the north-west corner and tied in at three levels. The hoarding round the base is printed with the finished building, at dusk, from an angle that would put you in mid-air over the mews. Somebody has added the name in marker across the bottom of the hoarding and it has been scrubbed at rather than removed.'],
  [892, 914, 'Long Lease', 'bead_tower', 15, 'east', 'LC',
    'Six glazed bulges threaded on a chrome spine, pinched to a collar between each one, so the tower reads as a stack of rooms rather than a stack of floors. Every flat in it went on a hundred and twenty-five year lease to a single purchaser before the steel was up. The entrance hood is polished and the mat under it has never been walked on enough to wear.'],
  [894, 912, 'Terms Agreed', 'cascade_block', 8, 'west', 'TA',
    'Four steps of falling height coming down toward the mews, each terrace planted and each one behind a glass balustrade with the protective film still on it. The film has been on long enough to have gone milky and to have started lifting at the corners. From the green you can see the irrigation running on a timer into beds that nobody has yet put anything in.'],
  [895, 915, 'Deposit Taken', 'atrium_court', 4, 'north', 'DT',
    'Two short curved wings round a glazed drum, low enough that the towers behind it clear it on both sides. It was marketed as workspace, sold as workspace and is used as storage: through the drum glazing you can see racking, pallets and about four hundred identical chrome-fronted kitchen units still in their wrapping.'],

  // ── Block B: between Kettle Lane and Cinder Lane ────────────────────────────
  [900, 911, 'Above Board', 'torque_tower', 17, 'west', 'AB',
    'A tower that shears as it rises, each floor turned a few degrees on the one below, so walking up Kettle Lane you watch a corner of it travel slowly round the building. The turn is a quarter of a revolution over seventeen storeys and it costs about nine per cent of the floor area, which was argued about for a year and won by whoever wanted it.'],
  [900, 912, 'Under Offer', 'shell_tower', 16, 'west', 'UO',
    'Clad to the eighth and open above it, with the floor plates stacked on the core like a set of plates on a spindle. The crane has been slewed and parked in the same position for long enough that the gulls have an arrangement with it. The hoarding advertises a completion that was last summer and nobody has taken it down, because taking it down would be a statement.'],
  [900, 914, 'Chain Free', 'bead_tower', 13, 'west', 'CE',
    'Thirteen floors in five bulges, the top one noticeably smaller than the bottom one, with a chrome collar at every pinch. The board by the door still lists the launch terms: no chain, no onward purchase, completion in twenty-eight days. Every one of those was true and the building is a third occupied anyway.'],
  [901, 912, 'Fixed Rate', 'glass_prism', 16, 'east', 'FR',
    'Six sides of tinted glass drawn to a point, with a chrome fin up each arris and nothing on the top at all. From Cinder Lane it reads as a wedge; from the boulevard it reads as a blade; from directly underneath it reads as almost nothing, which is a trick the architect has not been able to repeat since.'],
  [901, 913, 'Break Clause', 'shell_tower', 14, 'east', 'BC',
    'Fourteen storeys, clad to the seventh, and the only shell in the quarter where nothing at all moves. The crane is up, inspected and rigged, and nobody has been on it since spring. The frame is sheeted at the top against the weather and the sheeting has been renewed at least twice, which somebody is paying for and nobody is talking about.'],

  // ── Block C: Cinder Lane, Cowslip Rise and the Kerbstone Row frontage ───────
  [903, 912, 'Prime Location', 'torque_tower', 19, 'west', 'PL',
    'The tallest thing in Halcyon Fields that is not the Spire, nineteen floors of shearing glass on a chrome podium, with a lit collar at every fifth level. It was named before the streets round it were laid, which means it has spent four years being the prime location in a field.'],
  [903, 913, 'Vacant Possession', 'shell_tower', 17, 'west', 'VA',
    'Clad on the north and west elevations and bare on the other two, which is what happens when the cladding is bought in lots and a lot does not arrive. The exposed floor plates go up eleven levels with the services already run on them, capped and labelled. At night the whole east face is nothing at all and the building has a hole in the skyline.'],
  [903, 914, 'Mod Cons', 'cascade_block', 7, 'west', 'MB',
    'Seven floors in four steps down to Cinder Lane, terraced, planted, and fitted to a specification that is listed on a chrome plate beside the door in eleven lines. The eleventh line is the only one anybody reads and it says: CONNECTED TO THE ESTATE NETWORK. What that means in practice is a topic the whole quarter has an opinion about.'],
  [903, 915, 'Aspect Ratio', 'bead_tower', 12, 'west', 'AA',
    'Twelve floors in five bulges, and sold entirely on which way its windows face: every flat is a corner in the sense that a cylinder is all corners, and the brochure made a great deal of that. The pinches between the bulges are where the lift lobbies are, so every landing in the building is the narrowest part of it.'],
  [904, 911, 'Glass Ceiling', 'glass_prism', 20, 'east', 'GX',
    'Twenty storeys of six-sided glass tapering to an actual point, the tallest building in the quarter and the only one with no plant on the roof — because there is no roof, only the place where the six faces run out. The top four floors are a single unit that has never been let and has no internal walls in it whatsoever.'],
  [904, 912, 'Subject to Contract', 'shell_tower', 18, 'east', 'SJ',
    'Eighteen floors topped out, clad to about half, and the crane above it working a cycle that starts at six and is the reason four people at Quiet Enjoyment now sleep on the mews side. The hoarding at the base carries the estate crest, a completion date, and a strip of newer board over the part where a tenant name used to be.'],
  [904, 913, 'Peppercorn', 'atrium_court', 3, 'east', 'PA',
    'A low glazed drum between two curved wings, three floors, and the ground rent on it is one credit a year for a hundred and fifty years — which is a joke the developer made in a contract and will be honouring until long after everyone involved is dead. It is let to the estate\'s own security contractor.'],
  [904, 914, 'Completion Date', 'shell_tower', 15, 'east', 'CJ',
    'Fifteen floors, clad to the eleventh, and the crane came down in the spring — which normally means a building is nearly finished and here means the hire ran out. A large chrome board on the hoarding still gives the completion date. It is designed to take a slot-in numeral for the year and the numeral has been changed twice, which you can tell because the board behind the current one is a slightly different shade of chrome in two rectangles.'],
  [906, 914, 'Dual Aspect', 'cascade_block', 9, 'west', 'DA',
    'Nine floors stepping down to Cowslip Rise in four terraces, with the planting on the top two established well enough to hang over the edge and the bottom two still gravel. The rear elevation, which faces the backs of Meltwater Row, has exactly the same terraces and exactly the same glass, and that is where the name comes from and it is not a boast.'],
  [907, 915, 'New to Market', 'chrome_tower', 14, 'south', 'NM',
    'A glass cylinder on a chrome podium with a collar at every fifth floor and a mast on top, which is the estate\'s standard tower and the fourth one of it. It has been new to market for two years. The hoarding came down last spring and the banner that replaced it says the same thing in a better typeface.'],
  [908, 915, 'Priced to Sell', 'shell_tower', 13, 'south', 'PS',
    'Thirteen floors, clad to the fifth, and visibly slower than the others: the crane works three days in seven and the site below it is tidy in the way a site is tidy when nothing is happening on it. The hoarding has been re-printed once, at a lower price, in the same layout, which is a thing you can only see if you photographed the first one.'],

  // ── The Kerbstone Row south frontage, backing onto Windrow Lane ─────────────
  [892, 917, 'Party Wall', 'cascade_block', 6, 'north', 'PW',
    'Six floors in three steps, standing against the Curtain end of the row with its west flank blank all the way up — because the plot beyond it is the wall, and the estate went to the trouble of getting a party wall award for a boundary with nothing on the other side of it. The paperwork for that is framed in the estate office and is regarded there as a masterpiece.'],
  [894, 917, 'Right of Way', 'atrium_court', 4, 'north', 'RW',
    'A low drum between two wings with a covered passage cut straight through the middle of it at ground level, from Kerbstone Row to the lane behind. The passage is not a courtesy: it is an ancient footpath the estate could not extinguish, and the building was designed round it after a year of trying not to.'],
  [895, 917, 'Scope for Improvement', 'shell_tower', 12, 'north', 'SX',
    'Twelve floors, clad to the ninth, crane down, and from Kerbstone Row it is three storeys off being a building. It is also the only shell in the quarter where the hoarding is blank — plain chrome board, no printing, no crest and no date. That was a decision made after the third completion date slipped, and it has done more for the estate\'s reputation than any of the printed ones ever did.'],
  [896, 917, 'Well Appointed', 'bead_tower', 11, 'north', 'WB',
    'Eleven floors in four bulges with the collars picked out in a brighter chrome than the estate standard, which is the one place in Halcyon Fields where somebody was allowed to spend money on something that is purely how it looks. From Kerbstone Row at dusk it is the building people point at without knowing why.'],
  [897, 917, 'Change of Use', 'chrome_slab', 6, 'north', 'CK',
    'A crescent of chrome and glass bending along the row, consented as offices, built as offices, and let floor by floor to a dance studio, a company that stores paper for other companies, a clinic, and two floors of nothing. The application to regularise all that is at the land office and has been for eleven months.'],
  [898, 917, 'Rent Review', 'shell_tower', 11, 'north', 'RR',
    'Eleven floors, clad to the sixth, and the crane on it belongs to a different contractor from all the others — a different colour, a different profile, and a jib noticeably shorter. The first contractor left. What everybody on this street knows and the estate office will not confirm is the reason, and it is on a page of the defects book with a line ruled through it.'],
  [900, 917, 'Sunk Costs', 'shell_tower', 10, 'north', 'SZ',
    'Ten floors, clad to the eighth, and the shell that has been standing longest — near enough finished to look like a building until you notice there is no glass in the top two storeys and never has been. The crane went back to the hire yard two winters ago. Grass has got into the hoarding line at the base and somebody mows it, which is the only work anybody has done on this plot since.'],
  [901, 917, 'Blue Chip', 'chrome_tower', 12, 'north', 'BB',
    'The estate\'s standard glass cylinder, twelve floors, with the collars and the mast, standing on the corner where Cinder Lane comes down to the row. Every flat in it is owned by one institution and every flat in it is empty, which is not a failure of the building in any sense the institution recognises.'],
  [902, 917, 'Stamp Duty', 'lens_hall', 4, 'north', 'DU',
    'A glazed disc on six chrome legs with the whole ground floor given over to the space underneath it, paved, lit from the soffit, and used by everybody on the row to get out of the rain. It is the second lens in the quarter and the smaller of the two. The floor above is a records office and nobody has ever been up there.'],
  [909, 917, 'Best Offer', 'shell_tower', 9, 'north', 'BG',
    'Nine floors, clad to the sixth, and the nearest thing in Halcyon Fields to a finished shell: the glass is on, the plant is in, the crane comes down next month and the hoarding already has a strip pasted across it reading LET. Whether it is let is a question the estate office answers by looking at the plan and not at you.'],
];

// ── the plots ────────────────────────────────────────────────────────────────
let sealed = 0, built = 0;
const markers = new Map();
for (const [x, y, name, type, floors, entrance, marker, description] of PLOTS) {
  const id = idFor(x, y);
  const prev = store.get('zones', id);
  if (!prev) throw new Error(`${id} does not exist`);
  // ⚠ REFUSE SOMEBODY ELSE'S BUILDING, NOT THIS ONE. A plot that already carries THIS building is
  // a re-run, which the whole file is written to be; a plot that carries a different one means the
  // plan has drifted from the ground and paving over it would be the mistake this guard is for.
  if (prev.flags?.is_building && prev.flags.building_name !== name) {
    throw new Error(`${id} is already ${prev.name} — the plot list is wrong`);
  }
  // ⚠ AND REFUSE A PLOT THAT HAS SINCE BEEN GIVEN A DOOR. batch9 converted nineteen of these
  // thirty into real buildings with interiors, keepers and power; this file would strip the
  // `facade` tag straight back off and re-seal every neighbour, silently orphaning the interior
  // maps and the NPCs standing in them. Re-running batch8 after batch9 is a reasonable thing to
  // want to do — it is idempotent for the eleven shells — so it names the file to run instead
  // rather than quietly undoing it.
  if (prev.flags?.facade) {
    throw new Error(`${id} (${prev.name}) has been given a door since this file ran — batch9 owns it now; re-run batch9 rather than this`);
  }
  markers.set(marker, name);

  const flags = { ...(prev.flags || {}) };
  delete flags.terrain;              // a building footprint is not ground
  delete flags.street_life;
  delete flags.scavenging_table_id;  // you cannot forage a building you cannot enter
  delete flags.park_feature;
  delete flags.artery;
  flags.district = HF;
  flags.region_id = REGION;
  flags.is_building = true;
  flags.building_type = type;
  flags.building_name = name;
  flags.floors = floors;
  flags.entrance = entrance;         // the model's facing — see the ⚠ in the header
  // NO `facade`, NO `world_exit_zone`: there is no way in and nothing to point at.
  delete flags.facade;
  delete flags.world_exit_zone;

  const next = { ...prev, name, description, flags, exits: {}, ambient_theme: 'urban' };
  delete next.color;
  delete next.bg_color;
  next.marker = marker;
  store.put('zones', next);
  built++;

  // Every neighbour that pointed at it stops pointing at it. Without this the tile is a solid
  // you can walk into, which looks exactly like the building not being there.
  for (const z of store.all('zones')) {
    if (z.id === id) continue;
    const links = Object.entries(z.exits || {}).filter(([, t]) => t === id);
    if (!links.length) continue;
    const exits = { ...z.exits };
    for (const [dir] of links) delete exits[dir];
    store.patch('zones', z.id, { exits });
    sealed += links.length;
  }
}

// ── the two things that are silent when wrong ────────────────────────────────
// MARK-4: a marker has to be unique across the world or the map draws two tiles with one code.
const dupes = [];
for (const z of store.all('zones')) {
  if (!z.marker || !markers.has(z.marker)) continue;
  if (markers.get(z.marker) !== z.name) dupes.push(`${z.marker}: ${z.name} vs ${markers.get(z.marker)}`);
}
if (dupes.length) throw new Error(`marker collision(s):\n  ${dupes.join('\n  ')}`);

// …and the eleven. See the ⚠ in the header: Pardoe says the number out loud in batch7.
const shells = PLOTS.filter((p) => p[3] === 'shell_tower').length;
if (shells !== 11) throw new Error(`${shells} shell_tower plot(s) — Ground Rent's dialogue says eleven amber tacks, so change the dialogue or change the plan`);

const written = store.flush({ dryRun: DRY });
console.log(`${DRY ? 'would write' : 'wrote'} ${written.length} file(s)`);
console.log(`  plots     ${built} (${shells} shells, ${built - shells} clad and let)`);
console.log(`  sealed    ${sealed} neighbour exit(s)`);
console.log(`\nnext:\n  node scripts/content/mint-connections.mjs --write\n  npm run content:lint`);
