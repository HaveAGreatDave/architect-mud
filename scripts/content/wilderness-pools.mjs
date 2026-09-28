/**
 * Variant pools for the wilderness descriptions that used to be one text on
 * hundreds or thousands of tiles. Keyed by the ORIGINAL text (as it stood in
 * content/ after the 2026-08-25 prose pass). Each variant keeps the terrain
 * facts of the original and adds nothing the region would contradict.
 *
 * pickVariant(original, x, y) is deterministic in the grid coordinates and
 * steps off whatever the west and north neighbours would get, so two adjacent
 * tiles in one pool never share a text.
 *
 * Applied by scripts/content/wilderness-variety.mjs.
 */

const WALL = "Off toward the middle of the country there's a wall, and above the wall, catching the light, a long row of glass roofs. Something is growing in there. Not for you.";

export const POOLS = {
  "Grey ash to the horizon, level and going nowhere. Nothing grows in it, and there's nothing out here that could make a noise.": [
    "Grey ash in every direction, flat as a table and soft underfoot. A boot sinks to the laces and comes up powdered to the ankle.",
    "Level ash, grey going on white where the wind has sorted the fine stuff to the top. It runs out to the horizon without a single rise in it.",
    "The ash lies flat and deep here. Each step sends up a small grey puff that hangs a moment and settles back where it came from.",
    "Ash, and more ash. The ground is the colour of a cold grate and just as level, and the horizon is a pencil line a long way off.",
    "A grey flat with no feature on it. The ash has a thin crust that breaks under a boot and shows the looser stuff underneath.",
    "Grey ash out to the edge of sight. There's no sound out here except your own feet, and the ash takes most of that.",
    "The ground is pale grey ash, packed at the surface and powder below. Nothing stands up out of it for miles.",
    "Flat grey country, all ash. The wind has combed it into faint ripples that run the same way as far as you can see.",
    "Ash underfoot, ash to the horizon, and a low grey sky sitting on top of it. The line where one stops and the other starts is hard to find.",
    "A wide grey level. The ash drifts a little in the wind and fills your tracks behind you within the hour.",
    "Grey ash lying in a flat sheet. It's fine enough to get into cuffs and seams and dry enough that it never quite settles.",
    "Nothing but level grey ash here, and it's quiet enough to hear the grit shift when the wind moves it.",
  ],
  "Red rock to the horizon, pitted with pale rings a hair deep where the rain has stood and eaten. The wind never stops. There's a great deal of sky and none of it's reassuring.": [
    "Red rock, flat and bare, marked all over with pale rings where rainwater stood and ate into the surface. The wind comes steadily from one quarter.",
    "Bare red stone to the horizon. The pale pitting of old rain covers it like pockmarks, each ring a hair deep and bleached at the edge.",
    "The rock is red and the rings in it are white, shallow pans where the rain sat and burned. The wind drags grit across all of it.",
    "Open red rock under a very large sky. Pale etched circles show where puddles lay after the last rain. The wind doesn't let up.",
    "Red stone runs out level in every direction, scarred with small pale rings. Grit hisses across it in the wind.",
    "A flat of red rock, pitted pale where rain has pooled and eaten in. There's nowhere out here to get out of the wind.",
    "Red rock and wind. The surface is spotted with pale rings, some no bigger than a coin, some the width of a cart.",
    "The ground is one sheet of red stone, etched with the pale marks of standing rain. The wind moans across it and never drops.",
    "Pale rings freckle the red rock here, the marks of rain that sat too long. Beyond them the red goes on to the horizon.",
    "Red rock, wind-scoured and bare. Where the rain has stood it has left shallow white rings with crisp edges, and there are a lot of them.",
    "A hard red plain of stone. The wind pushes at your back and the rain rings underfoot crunch faintly where the crust has lifted.",
    "Red rock to every horizon, pitted pale by the rain. The sky is enormous and there's nothing in it but wind.",
  ],
  "Cracked red hardpan runs out flat to a rust-colored horizon. Wind-scoured rock, grit, and nothing that grows.": [
    "Red hardpan, cracked into plates the size of dinner tables, runs flat to a rust-colored horizon.",
    "The ground is baked red clay split into a web of cracks. Grit collects in the seams and the wind lifts it again.",
    "Flat red hardpan with a crazed surface. It rings faintly under a boot and gives nothing back but dust.",
    "Cracked hardpan stretches off in every direction, the color of old rust. The wind has scoured it bare of anything loose.",
    "A red flat of dried clay, the cracks between the plates deep enough to turn an ankle. The horizon is a smudge of rust.",
    "Hardpan, red and hard and split into polygons. A skin of grit slides over it whenever the wind picks up.",
    "The clay here dried a long time ago and cracked as it went. The plates curl slightly at the edges and crumble when stepped on.",
    "Rust-red hardpan, dead level. The cracks run in long lines and short ones, and the wind whistles through the deeper ones.",
    "Baked red ground, cracked and flat to the edge of sight. Wind-polished rock breaks through the clay here and there.",
    "A dry red pan. Every surface is cracked, every crack is full of grit, and the wind keeps the grit moving.",
    "Red hardpan under a bleached sky. It's so flat that the horizon seems closer than it is.",
    "The hardpan here is split into thousands of red tiles. Nothing grows in the cracks, and the wind keeps them swept.",
  ],
  "A vast rust-stained plain, hammered flat and hard, printed here and there with the tracks of things that crossed it once.": [
    "A wide plain the color of rust, hard as a road. Old tracks cross it here and there, baked in where the ground was soft once.",
    "Flat, hard, rust-stained ground runs off in every direction. A line of old prints crosses it and fades out a short way on.",
    "The plain is packed hard and stained red-brown. Tracks from some long-ago crossing are set into it like fossils.",
    "Rust-stained flats, beaten hard. A few scattered prints show something walked this way once, when the ground would still take them.",
    "A broad plain hammered flat by weather. The rust color deepens in the low spots, and old tracks wander across it with no clear purpose.",
    "Hard flat ground stained the color of old iron. Here and there a set of prints, dried and cracked, heads off toward nothing.",
    "The plain goes on a long way, rust-red and hard as brick. Old tracks show in the crust where the light is low.",
    "Level ground, packed and stained. Someone's prints cross it at an angle, and further off another set crosses those.",
    "A rust-colored plain with a surface like fired clay. Faint tracks run across it, left by things that crossed when it was wet.",
    "Hard red-brown flats. The prints set into them are old enough that the edges have worn soft.",
    "The ground here is flat and hard and the color of rust. A few old trails cross it and none of them go anywhere obvious.",
    "A vast stained plain, hard underfoot. Every so often there's a track pressed into it, sharp-edged and long dry.",
  ],
  "Broken mesa shelves step away in ochre and iron-red, cut by dry washes where the wind funnels grit against your teeth.": [
    "Mesa shelves drop away in broken steps of ochre and iron-red. Dry washes cut between them, and the wind comes down the washes full of grit.",
    "Stepped red rock, broken into ledges. A dry wash runs between two shelves and the wind blows straight down it.",
    "The ground climbs and falls in broken shelves of ochre stone. Grit gathers in the dry channels between them.",
    "Ledges of iron-red rock step off toward the horizon. The washes between them are dry and full of sand the wind keeps moving.",
    "Broken mesa country, all shelves and drops. The rock is ochre on top and darker red where it's split.",
    "A tumble of flat-topped ledges in red and ochre. The dry washes between them act like chimneys for the wind.",
    "Shelves of banded rock step down toward a dry wash. Grit blows along the bottom of it in low, fast streams.",
    "The mesa edge breaks up here into steps and ledges. Ochre stone, iron-red stone, and wind-driven grit in every crack.",
    "Broken red shelves, some knee-high, some taller than a man. A dry wash winds between them and the wind whistles down it.",
    "Terraces of ochre rock step away into the distance. Where the washes cut through, the grit comes at you sideways.",
    "Red and ochre ledges, flat on top and ragged at the edges. The dry washes between them are floored with sand.",
    "Iron-red rock stands in broken shelves, cut through by washes that haven't carried water in a long while. Grit gets in your teeth.",
  ],
  "Scrubland, and after a day of bare rock the colour of it's a shock: grey-green thorn to knee height in every direction, growing out of ground that's more grit than soil. It isn't soft country. Every plant in it's armed, and the pale rings of the rain sit on the leaves as burn scars.": [
    "Grey-green thorn to knee height in every direction, rooted in grit. Every stem carries spines, and the leaves are spotted with the pale burn scars of the rain.",
    "Scrubland. Knee-high thorn grows out of gritty ground as far as you can see, grey-green and armed, the leaves ringed pale where the rain has touched them.",
    "The thorn here stands to the knee and covers everything. It's grey-green, which after the bare rock looks almost lush, and every plant in it will draw blood.",
    "A spread of low scrub on ground that's mostly grit. The thorns catch at your trousers with every step, and the leaves carry pale rain scars.",
    "Grey-green thorn, thick and knee-high, growing out of stony grit. The rain has marked the leaves with small pale rings like old burns.",
    "Scrub country. The thorn is low and dense and grey-green, and there's no way through it that doesn't cost you a few scratches.",
    "Knee-high scrub runs off in every direction, a dull grey-green over gritty ground. The leaves are pocked with pale rain burns.",
  ],
  "Chest-high brush, tough as wire, with runs beaten through it at knee height by something that lives here and goes the same way every day. The wind through it makes a dry sound with no rest in it at all.": [
    "Brush to the chest, stiff as wire. Low runs have been beaten through it by some animal that uses the same path every day.",
    "Wiry brush stands chest-high here. A narrow run goes through it at knee height, trodden bare and used often.",
    "The brush is tough and dense and comes up to your chest. The wind rattles through it with a dry, endless sound.",
    "Chest-high brush with stems like wire. Something has worn a low tunnel through it, and the tunnel is well kept.",
    "Stiff brush on every side, higher than your waist. A beaten run crosses it at knee height, the ground in it packed smooth.",
    "Dense wiry brush, chest-high, hissing in the wind. There are runs through it too low and narrow for a person.",
    "Tough brush crowds in to chest height. The only easy way through is a knee-high run some animal has kept open for a long time.",
  ],
  "Low thicket over a shallow pan where whatever rain falls runs to and stays a while. The scrub grows thickest along the channels and you can read the drainage off it from any small rise, like a map somebody drew in a hurry.": [
    "A shallow pan where the rain collects, grown over with low thicket. The scrub is densest along the drainage channels.",
    "Low scrub fills a dip in the ground where runoff gathers. From any small rise you can trace the channels by where the growth is thickest.",
    "The ground sinks into a shallow basin and the thicket thickens with it. Lines of heavier scrub mark where the water runs after rain.",
    "A low thicket over a shallow pan. The soil is damper here than anywhere nearby, and the scrub shows it.",
    "Scrub grows thick over a shallow drainage pan. The channels are dry now, but the plants along them are greener than the rest.",
    "A dip in the land, overgrown with low thicket. The brush follows the water channels in dark, branching lines.",
    "Shallow pan, low thicket. The water that runs in here after rain stays long enough for the scrub to grow thick along its path.",
  ],
  "Dead timber, standing. Whatever killed them did it to all of them in the same season, because they're all the same shade of grey and every one of them still has its shape. The ground between is packed ash and it takes a print.": [
    "A stand of dead trees, all the same shade of grey, all still holding their shape. The ground between them is packed ash.",
    "Grey trunks standing in rows, dead together. The ash between them is packed firm and holds every footprint.",
    "Dead timber, still upright. Every tree is the same weathered grey, and the ash underfoot takes a clear print.",
    "The trees here died at the same time and never fell. They stand grey and bare over a floor of packed ash.",
    "Standing dead wood, grey from root to tip. The branches are all still there. Your boots leave sharp prints in the ash.",
    "A grey forest of dead trees, every one of them intact. The packed ash between them shows the tracks of anything that passes.",
    "Dead trunks, all one colour, all still standing. The ash between them is firm enough to walk on and soft enough to mark.",
  ],
  "Red rock under a sky that goes on being enormous about it. Nothing grows here that anybody planted, and nothing has needed to.": [
    "Red rock under a huge, empty sky. The stone is bare and warm and runs off flat in every direction.",
    "Bare red rock, and a sky big enough to make you feel small standing on it.",
    "The rock is red and the sky is enormous. The ground is flat enough here that you can see weather coming for hours.",
    "Red stone underfoot, open sky overhead, and not much of anything in between. The wind moves a little grit across the rock.",
    "A red rock flat under a sky that fills most of the view. The stone is cracked in places and swept clean.",
    "Flat red rock, wind-swept and bare. The sky is wide and pale and goes all the way down to the horizon.",
    "Red rock, and a lot of sky above it. Nothing grows here that anybody planted.",
  ],
  ["Red rock under a sky that goes on being enormous about it. Nothing grows here that anybody planted, and nothing has needed to. " + WALL]: [
    "Red rock under a huge, empty sky. " + WALL,
    "Bare red rock, and a sky big enough to make you feel small. Off toward the middle of the country there's a wall, and above it a long row of glass roofs catching the light. Something is growing in there. Not for you.",
    "Flat red stone, swept clean by the wind. " + WALL,
    "Red rock runs out flat in every direction. Toward the middle of the country there's a wall, with a long row of glass roofs above it catching the light. Something is growing in there. Not for you.",
    "The rock here is red and cracked and bare. " + WALL,
    "Open red rock under a pale sky, grit shifting across it in the wind. " + WALL,
    "Red rock, and a lot of sky above it. Nothing grows here that anybody planted. " + WALL,
  ],
};


// Second batch, 2026-09-27.
Object.assign(POOLS, {
  "A stand of trees that died where they stood and never fell: bark long gone, trunks silver-grey and sanded smooth on the windward side, every branch bare and none of them broken off. There's no undergrowth at all. They aren't close enough together to be a wood and there are far too many of them to be anything else.": [
    "Dead trees stand where they died, bark long gone, trunks silver-grey and sanded smooth on the windward side. There's no undergrowth between them.",
    "Silver-grey trunks, bare of bark, every branch still in place. The wind has sanded the windward side of each one smooth.",
    "A spread of standing dead trees, spaced too far apart to call a wood. No undergrowth, no fallen limbs, just grey trunks and bare branches.",
    "The trees here died on their feet and stayed there. The trunks are pale grey and polished smooth on one side by the wind.",
    "Bare grey trunks stand at intervals across the ground, their branches whole and leafless. Nothing grows at their feet.",
    "Dead trees, a great many of them, all standing. The bark went long ago and the wood underneath has weathered to silver.",
    "Grey dead timber on every side, smooth where the wind hits it and rough in the lee. Not one branch lies on the ground.",
    "The trunks are silver-grey and stripped bare, spaced out over open ground with no scrub between them."
  ],
  "Black rock, and it went off in ropes: the whole surface is a set of frozen coils and folds lying over each other in the direction it was going. It rings under a boot and it takes the skin off a hand that goes down on it. Nothing has grown in it and there's no soil in it to grow in.": [
    "Black rock in frozen coils and folds, lying over one another in the direction the flow was going. It rings under a boot.",
    "Ropy black lava, twisted into cords and ridges. The edges are sharp enough to take the skin off a hand.",
    "The ground is black rock set hard in coils, like rope laid down in heaps. There's no soil anywhere in it.",
    "Folded black rock, each fold lying over the last. A boot rings on it and slides where the surface is glassy.",
    "Coiled black stone runs off in the direction the flow went. The ridges are sharp and the gaps between them are bare rock.",
    "Black lava in ropes and wrinkles, all of it pointing the same way. It's hard going and hard on the hands.",
    "The rock here set in twisted cords and folds. It's black, bare and sharp, and it rings when you walk on it.",
    "Rope-textured black rock underfoot, coil on coil. Nothing has found a place to grow in it."
  ],
  "Lava rock, gone matt and grey-black with age, standing a foot or two proud of the ash flat it stopped on. The edge of it's as clean as a tide line: this far, and then it cooled.": [
    "Old lava rock, matt grey-black, standing a foot or two above the ash flat. The edge where it stopped is clean and sharp.",
    "A low shelf of grey-black lava rock rises out of the ash. The edge is as clean as a tide line.",
    "The lava stopped here and cooled. Its edge stands a foot or two proud of the ash, weathered to a dull grey-black.",
    "Matt dark rock, a foot or two higher than the ash around it. You can step from one to the other in a single stride.",
    "Weathered lava rock, grey-black and dull. Ash has drifted up against its edge but hasn't covered it.",
    "The ash flat ends at a low step of old lava rock, dark and rough, where the flow cooled and stopped.",
    "Grey-black rock sits on the ash in a low, flat-topped sheet. Its edge runs in a clean line.",
    "Old lava, dulled with age, standing just clear of the ash. The line where it ends is sharp enough to follow by eye."
  ],
  "A field of broken black glass and clinker, sharp all over, with the pale ash blown into the hollows between the lobes so the ground reads as a dark map with light rivers in it.": [
    "Broken black glass and clinker, sharp all over. Pale ash has blown into the hollows between the lobes.",
    "A field of black clinker with pale ash lying in the low places, dark ground with light seams running through it.",
    "Sharp black glass underfoot, broken into lumps and plates. The ash between them is pale and fine.",
    "Clinker and black glass in a jumble of lobes. Every hollow between them has a drift of grey ash in it.",
    "The ground is broken volcanic glass, black and sharp. Pale ash runs between the lumps like water in channels.",
    "Black clinker, rough enough to cut a boot, with pale ash filling every dip.",
    "A dark field of broken glassy rock. The wind has laid ash into the hollows in pale ribbons.",
    "Sharp black clinker as far as you can see, streaked with pale ash where it settles between the lobes."
  ],
  "Cold water closes around your legs at the shoreline, the bottom shelving away fast into lightless murk. This is as far as you go on foot: the channel beyond is deep, and impassable without a boat.": [
    "The water at the shoreline is cold and the bottom drops away fast into dark. Beyond this the channel is too deep to wade without a boat.",
    "Cold water to the knees, then the bottom shelves steeply into murk. The channel beyond can't be crossed on foot.",
    "You're at the edge of deep water. It's cold, the bottom falls away quickly, and there's no going further without a boat.",
    "The shoreline drops off fast. A step out and the water is cold around your legs, and the channel ahead is deep and dark.",
    "Dark, cold water at the shore, shelving away steeply. This is as far as walking goes: the channel needs a boat.",
    "The bottom slopes away from the shore into lightless water. It's cold, and the channel beyond is too deep to wade.",
    "Cold water laps at the shoreline over a bottom that drops fast. Past here the channel is deep and impassable on foot.",
    "The water closes cold around your shins and the ground under it falls away. The deep channel ahead needs a boat."
  ],
  "Packed ash, and it holds a print the way nothing else does: the flat is crossed with tracks, most of them feet and one set of wheels, all going the same two ways, and none of them washed out. Off north a grey wall goes across the whole horizon with water standing behind it.": [
    "Packed ash crossed with tracks, most of them feet and one set of wheels, all going the same two ways. Off north a grey wall spans the horizon with water standing behind it.",
    "The ash here is packed hard and full of prints, feet and a single set of wheels, running two ways. North, a grey wall crosses the whole horizon, water behind it.",
    "Firm ash, marked all over with tracks going back and forth along two lines. A grey wall runs across the northern horizon and water stands behind it.",
    "Tracks cross the packed ash: feet mostly, one set of wheels, none washed out. To the north a grey wall holds back standing water across the whole horizon.",
    "The ground is packed ash and it keeps every print. The tracks run two ways. Off north there's a grey wall the width of the horizon, with water behind.",
    "A flat of packed ash, heavily tracked by feet and one set of wheels. North of here a grey wall cuts across the horizon with water standing behind it.",
    "Ash packed firm enough to hold a clear print, and plenty of prints in it, all going two ways. A grey wall lies across the northern horizon, water behind it.",
    "Footprints and one set of wheel ruts cross the packed ash, none of them blurred. On the northern horizon a long grey wall holds back water."
  ],
  "A level of hard black rock standing above the flats, cracked into slabs the size of doors by nothing but time. Where the slabs have parted the crack goes down further than you can see and lets no light in.": [
    "Hard black rock, raised above the flats and cracked into slabs the size of doors. The cracks go down further than you can see.",
    "A level of black rock split into door-sized slabs. Where they've parted, the gaps drop into darkness.",
    "Black slabs, flat and hard, fitted together with deep cracks between them. The flats lie lower on every side.",
    "The rock stands above the flats here, black and broken into slabs. Mind the cracks: they go down a long way.",
    "Flat black rock cracked into big slabs by time. The gaps between are narrow and let no light in.",
    "A raised shelf of hard black rock, broken into rough rectangles. Some of the cracks are wide enough to lose a foot in.",
    "Black slab rock above the surrounding flats, split into door-sized pieces with deep dark seams between."
  ],
  "The top of the old flow, flat as a poured floor and black as a stove, with the ash drifted into every low place in it. From up here the whole grey basin lies out below with the water standing in the middle of it and the steam going up off it in a line.": [
    "The top of the old flow, flat and black, ash drifted into every low place. Below, the grey basin spreads out with the water in the middle and steam rising off it.",
    "Flat black rock at the top of the flow. From here you can see the whole grey basin, and the steaming water at its centre.",
    "The old flow's top is level as a floor and black as a stove. The basin lies below, grey, with a line of steam over the water.",
    "Up on the flow, black rock with ash in the dips. The grey basin is spread out below, the water in the middle giving off steam.",
    "A flat black top, ash lying in its hollows. Out over the grey basin, steam goes up off the water in a long line.",
    "The flow top is black and flat, and it gives a view of the whole basin: grey ground, standing water in the middle, steam above it.",
    "Black rock flat as a poured floor, drifted with ash. Below, the grey basin, and steam lifting off the water at its heart."
  ],
  "Still water, and a great deal of it, and it's warm. The surface holds the sky without altering it in any way and gives off steam in slow sheets that lean away downwind and come apart about head height. It smells of minerals and old eggs. Nothing about it moves unless something makes it move, and whatever is heating it's a long way underneath.": [
    "Warm, still water, a great deal of it. Steam comes off the surface in slow sheets that lean downwind and break up about head height.",
    "The water is still and warm and smells of minerals and old eggs. Steam lifts off it and drifts downwind.",
    "A wide sheet of warm water, not moving. It reflects the sky exactly, and steam rises from it in slow sheets.",
    "Still water, warm to the touch. The smell is sulphur and minerals. Something far below is keeping it hot.",
    "The water lies flat and warm, giving off steam that leans with the wind. It smells of eggs gone off.",
    "Warm standing water with steam lifting off it. Nothing on the surface moves unless something disturbs it.",
    "A great deal of warm, motionless water. Steam rises in sheets and comes apart at head height, and the air smells of minerals."
  ],
  "The top of a mesa, flat as a floor and red as an old brick, with the whole region laid out under it in bands of colour going away to nothing. The caprock rings under a boot. At the edge the ground simply stops and the drop is a long one, and the wind comes up it hard enough to lean on.": [
    "The top of a mesa, flat and brick-red, with the region laid out below in bands of colour. At the edge the ground stops and the wind comes up the drop hard.",
    "Flat red caprock. From up here the country runs away in coloured bands. The drop at the edge is long, and the wind comes up it strongly.",
    "The mesa top is level and red, and it rings under a boot. The view goes on for miles. The edge is sheer.",
    "Red caprock, flat as a floor, with the whole region spread out below. The wind rising off the cliff is strong enough to lean on.",
    "On top of the mesa. The rock is old-brick red and level, and it ends abruptly in a long drop.",
    "A flat red summit. Bands of colour run away below to the horizon, and the wind pushes up hard over the edge.",
    "The mesa top: red, flat, ringing underfoot. Walk to the edge and there's nothing beneath you for a long way."
  ],
  "The skirt of a mesa, a long slope of broken rock shed off the face above over a very long time, everything from fist-sized to the size of a truck. Nothing here is stable. Everything you put a foot on shifts a little and then decides not to.": [
    "A long slope of broken rock shed off the mesa face, from fist-sized to the size of a truck. Everything shifts a little underfoot.",
    "Loose rock piled against the foot of the mesa, big and small together. None of it is quite stable.",
    "The mesa's skirt: a steep fan of fallen rock, some of it as big as a truck. Every step moves something.",
    "Broken stone slopes down from the cliff above, shed over a very long time. It settles under your weight and then holds.",
    "A slope of talus below the mesa face, fist-sized chunks mixed with boulders. Pick your footing carefully.",
    "Rubble from the mesa lies in a long apron, loose and shifting. The larger blocks are the size of trucks.",
    "Fallen rock covers the slope below the face, all sizes and all a little unsteady."
  ],
  "A shelf of red stone standing a hundred feet clear of the flats, its face banded in every shade the country has, laid down and then eaten back until only this much was left. From up here the dark line of the thorn is visible a long way off, a black seam laid across the red.": [
    "A shelf of red stone a hundred feet above the flats, its face banded in every colour the country has. The dark line of the thorn shows a long way off.",
    "Up on a red shelf, well clear of the flats. The face below is banded. Far off, the thorn lies across the red like a black seam.",
    "Banded red stone, a hundred feet up. From here the black line of the thorn is visible across the red country.",
    "The shelf stands high above the flats, its face striped in reds and browns. In the distance a dark seam of thorn crosses the land.",
    "A high red ledge with a banded face. Looking out, the thorn makes a black line across the red a long way off.",
    "Red stone, raised well above the flats and eroded back to this shelf. The dark line of the thorn is plain from up here.",
    "From this red shelf the flats lie a hundred feet below, and beyond them a black seam of thorn runs across the red."
  ],
  "Swept hardpan between the buildings, pale and hard and rung flat by feet. There's nothing lying on it. Not a tool, not a rag, not a stone out of place.": [
    "Pale hardpan between the buildings, swept and packed flat by feet. Nothing is lying on it.",
    "The ground between the buildings is swept clean, pale and hard. There isn't a stone out of place.",
    "Hard pale ground, rung flat by feet and swept bare. Not a tool or a rag anywhere.",
    "Swept hardpan runs between the buildings, pale and level. Someone keeps it this way on purpose.",
    "The hardpan here is packed smooth and swept. Nothing lies on it at all.",
    "Pale, hard, swept ground between the walls. You won't find so much as a loose stone.",
    "Between the buildings the hardpan is beaten flat and kept clean. Nothing has been left lying about."
  ],
  "Bare table rock, scoured clean, cut across by shallow channels the rain has worn and then worn deeper. Nothing grows up here at all. There's a cairn on the high point that somebody built a long time ago and nobody has knocked over.": [
    "Bare table rock, scoured clean and cut by shallow rain channels. On the high point stands an old cairn nobody has knocked over.",
    "Flat rock with nothing growing on it, crossed by channels the rain has worn. A cairn stands on the highest point.",
    "The table rock is bare and clean, grooved by rain. Somebody built a cairn on the high point a long time ago.",
    "Scoured rock, level and empty. Shallow channels run across it, and there's an old cairn standing on the rise.",
    "Wind and rain have cleaned this rock to the bone. Channels wander across it toward the edge, past an old cairn.",
    "Bare flat rock, worn into shallow runnels. The cairn on the high point is old and still standing.",
    "A table of clean rock, no soil and no plants, cut with rain channels. There's a cairn on top."
  ],
  "Loose ground at the foot of the wall of rock, walking on it a matter of picking the flat pieces. There are bones down among the stones and there's no telling how they got there or from how high.": [
    "Loose ground at the foot of the rock wall. Walking means picking out the flat pieces. There are bones down among the stones.",
    "Broken stone piles up at the base of the cliff. Bones lie between the rocks, and there's no telling where they came from.",
    "The ground under the rock wall is loose rubble. Old bones show between the stones.",
    "Rubble at the cliff foot, hard going unless you find the flat stones. There are bones in it.",
    "Stones of all sizes at the base of the wall of rock, and bones mixed in among them.",
    "Loose rock underfoot, the cliff rising straight up beside you. Bones lie scattered in the gaps.",
    "At the foot of the rock face the ground is loose and uneven. Bones are wedged among the stones."
  ],
  "The front of the old flow, where it stopped: a wall of black rock standing clear of the ash, rubbly at the top and sheer in the middle, undercut at the foot where the weather has been at the softer bed under it. There's no way up it here. It runs off in both directions along the same line.": [
    "The front of the old flow: a wall of black rock above the ash, rubbly at the top, sheer in the middle and undercut at the foot. There's no way up here.",
    "The flow stopped here in a black wall. It's sheer and undercut, and it runs off in both directions along the same line.",
    "A wall of black rock marks where the lava halted. The top is rubble, the face is sheer, and the base is eaten away.",
    "Black rock stands clear of the ash in a steep wall. The softer bed at its foot has weathered back, leaving an overhang.",
    "The edge of the old flow rises out of the ash, black and sheer. It stretches away both ways with no break in it.",
    "A sheer black front where the flow cooled. Nothing here offers a way up.",
    "The old flow ends in a black cliff, rubbly on top and undercut below, running off along one line in both directions."
  ],
  "A fan of scree run out from a notch in the cliff above, sorted by nothing but weight: the big pieces at the bottom, the grit at the top, and a channel down the middle of it where the water goes when there's water.": [
    "A fan of scree below a notch in the cliff, sorted by weight: big pieces at the bottom, grit at the top, and a channel down the middle.",
    "Scree spills out of a gap in the cliff. The heavy rocks have rolled furthest and the fine grit sits near the top.",
    "A fan of loose stone runs down from a notch above. A dry channel cuts through the middle of it.",
    "The scree is graded by size, boulders at the foot and grit higher up. Water runs down the centre when there's any.",
    "Loose stone fanned out below a cleft in the cliff, with a channel down its middle where rain runs off.",
    "A slope of scree under a notch in the rock. The biggest pieces lie at the bottom.",
    "Broken rock fans out from the cliff, coarse at the bottom and fine at the top, split by a dry runnel."
  ],
  "A face of frozen rock, columnar where it cooled slowly, so the whole wall is a rank of black pillars standing shoulder to shoulder. Broken stuff piled at the foot of it. It's one piece and it doesn't offer a hold.": [
    "A wall of black rock that cooled into columns, pillars standing shoulder to shoulder. Broken pieces pile at the foot.",
    "Columnar rock, black and close-set, like a rank of pillars. There's no hold on it anywhere.",
    "The face is made of tall black columns packed together. Fallen sections lie heaped below.",
    "Black basalt columns rise in a sheer wall. Some have broken off and lie in pieces at the base.",
    "A cliff of six-sided black pillars, all one piece. Rubble collects along its foot.",
    "Rock that cooled slowly into columns, standing in a solid black wall. It offers no way up.",
    "Black columns, tight together, make up the whole face here. Broken stone is piled beneath them."
  ],
  "Caprock. Flat as a table and a very long way up, with the whole country laid out under it going brown into the haze. The wind up here has nothing at all to break it.": [
    "Caprock, flat as a table and very high up. The country below goes brown into the haze. The wind has nothing to break it.",
    "Flat caprock a long way up. The land spreads out below and fades into haze.",
    "The top is level caprock with nothing on it. The wind comes across unbroken.",
    "Caprock, bare and flat. Below, the whole country goes brown and then hazy.",
    "High, flat caprock. The view runs to the haze in every direction, and the wind never lets up.",
    "Table-flat rock at the summit. The land below lies brown and faint.",
    "Level caprock, very high. The wind crosses it with nothing in its way."
  ],
  "A wall of caprock standing out of the flats, undercut at the base where the weather has got in and eaten the softer bed away, so the top overhangs slightly and the shade under it's deep and cold.": [
    "A wall of caprock rises from the flats, undercut at the base so the top overhangs a little. The shade underneath is deep and cold.",
    "The caprock stands out of the flats in a steep wall. The softer rock at its foot has been eaten away.",
    "An undercut caprock wall. The overhang throws a band of cold shade along its base.",
    "Caprock rises sheer from the flats, its base weathered back. The shade beneath is cold.",
    "A caprock face with an overhanging top where the softer bed below has eroded.",
    "The wall of caprock leans slightly out over the flats. Under the lip it's shaded and cool.",
    "Caprock, standing tall above the flats. Weather has hollowed the base, and the shade in there is deep."
  ],
  "Open water, grey to the horizon, moving in long slow swells that never quite commit to being waves. The cold comes off it in a steady breath. There's nothing to fix your eye on and no way to guess how deep it goes.": [
    "Grey open water to the horizon, moving in long slow swells. The cold comes off it steadily.",
    "The water is grey and wide and goes all the way to the horizon. The swells are long and low.",
    "Open water in every direction, grey and cold, heaving slowly. There's nothing to fix your eye on.",
    "Long grey swells, slow and even. The water gives off a steady cold.",
    "Grey water to the edge of sight. No way to guess how deep it is.",
    "Open water, rising and falling in slow swells that never quite break.",
    "The water is grey, cold and open, moving in long swells toward nowhere in particular."
  ],
  "Open red country, and something has been through it: the ground is cut with a great many tracks, most of them feet, some of them dogs, all of them heading the same two ways. Off south the horizon has a dark line across it that doesn't behave like a ridge.": [
    "Open red country cut with tracks, feet and dogs, all going the same two ways. Off south a dark line crosses the horizon that doesn't look like a ridge.",
    "The red ground here is heavily tracked by people and dogs, back and forth along two lines. A dark line lies across the southern horizon.",
    "Tracks everywhere in the red earth, most of them feet, some of them dogs. To the south the horizon carries a dark line that isn't a ridge.",
    "Open red country, trampled along two directions. Far south there's a dark band on the horizon.",
    "Something has crossed this red ground many times: feet, dogs, all going two ways. South, a dark line runs along the horizon.",
    "The red country is scored with tracks. Off to the south the horizon has a dark line on it that doesn't behave like rock.",
    "Footprints and dog prints cross the red ground in two directions. There's a dark line across the horizon to the south."
  ],
  "Deep water, and it feels deep: a heaviness under the swell, a temperature that finds its way through whatever you're wearing. Far out, something breaks the surface and is gone before you've finished turning your head.": [
    "Deep water. There's a heaviness under the swell and a cold that gets through whatever you're wearing.",
    "The water here is deep, and the cold comes up from below. Far out, something breaks the surface and is gone.",
    "Heavy, cold, deep water under a slow swell. Something surfaces in the distance and vanishes.",
    "Deep water with a weight to it. The cold finds its way through clothing quickly.",
    "The swell rides over a lot of water here. It's cold. Something breaks the surface far off.",
    "Deep, cold water. Now and then something shows on the surface further out and goes under again.",
    "This water is deep and it's cold, a cold that comes up from underneath."
  ],
  "Out where the bottom stops meaning anything. The surface lies flat and lightless and takes the sky's colour without improving on it. Somewhere below you the water goes on being cold, in the dark, at length.": [
    "Far out, where the bottom is too deep to matter. The surface lies flat and dark, taking its colour from the sky.",
    "Deep water, flat and lightless. Somewhere below it goes on being cold in the dark.",
    "The surface here is flat and dark and the bottom is a long way down.",
    "Open deep water, still and colourless except for what the sky lends it.",
    "No bottom to speak of out here. Flat, dark water in every direction.",
    "The water is flat and dark over great depth. It holds the sky's colour and nothing else.",
    "Deep water with a flat, lightless surface. Below, cold and dark for a long way down."
  ],
  "Loose broken rock in a long skirt off the high ground, sorted by size the way water sorts things, moving a little underfoot the whole time. Off toward the middle of the country there's a wall, and above the wall, catching the light, a long row of glass roofs. Something is growing in there. Not for you.": [
    "Loose broken rock in a long skirt off the high ground, shifting underfoot. Off toward the middle of the country there's a wall, and above the wall, catching the light, a long row of glass roofs. Something is growing in there. Not for you.",
    "A slope of loose rock sorted by size, the big pieces lowest. Off toward the middle of the country there's a wall, and above the wall, catching the light, a long row of glass roofs. Something is growing in there. Not for you.",
    "Broken rock runs down from the high ground and moves a little with each step. Toward the middle of the country there's a wall, with a long row of glass roofs above it catching the light. Something is growing in there. Not for you.",
    "Talus underfoot, graded the way water grades things. Off toward the middle of the country there's a wall, and above the wall, catching the light, a long row of glass roofs. Something is growing in there. Not for you.",
    "A long apron of loose stone below the high ground. Off toward the middle of the country there's a wall, and above the wall, catching the light, a long row of glass roofs. Something is growing in there. Not for you.",
    "The rock here is loose and shifts under a boot. Toward the middle of the country there's a wall, and a long row of glass roofs above it catching the light. Something is growing in there. Not for you.",
    "Loose stone, big at the bottom and small at the top, sliding a little as you cross it. Off toward the middle of the country there's a wall, and above the wall, catching the light, a long row of glass roofs. Something is growing in there. Not for you."
  ],
  "The face of the tableland: a hundred feet of banded rock with nothing on it but the marks of the rain, and a fan of fallen stone piled at the foot where pieces of it have given up over the years.": [
    "The face of the tableland: a hundred feet of banded rock marked only by rain, with a fan of fallen stone at its foot.",
    "A banded rock face a hundred feet high. Pieces that have fallen over the years lie in a fan at the bottom.",
    "The tableland's face rises sheer and striped. Rubble spreads out at its base.",
    "A hundred feet of layered rock, streaked by rain. Fallen stone piles below it.",
    "Banded rock goes straight up to the tableland. At the foot, a fan of stone that has come off it.",
    "The cliff face of the tableland, layer on layer, with a spill of broken rock at its base.",
    "A tall banded face with nothing growing on it, and loose stone heaped where it meets the ground."
  ],
  "Red rock, and the rock here is wrong: banded through with a colour that isn't mineral, and warm to the back of the hand from a foot away. Nothing grows. The few bones lying about have gone the same colour as the ground.": [
    "Red rock banded with a colour that isn't mineral, warm to the back of the hand from a foot away. The few bones lying about are the same colour as the ground.",
    "The rock here is streaked with an unnatural colour and gives off warmth. Bones on the ground have taken on its colour.",
    "Red rock with bands of a wrong colour through it. Hold a hand near and you can feel the heat.",
    "Warm red rock, banded strangely. Nothing grows. Scattered bones have gone red like the ground.",
    "The red here has something else running through it in bands, and it's warm from a foot away.",
    "Red stone, too warm, streaked with a colour that doesn't belong in rock. A few bones lie about, stained to match.",
    "Banded, warm red rock. The bones lying on it are the same colour as the stone."
  ],
  "Loose broken rock in a long skirt off the high ground, sorted by size the way water sorts things, moving a little underfoot the whole time.": [
    "Loose broken rock in a long skirt off the high ground, shifting a little under every step.",
    "A slope of loose rock sorted by size, the big pieces lowest.",
    "Broken rock runs down from the high ground and moves a little with each step.",
    "Talus underfoot, graded the way water grades things, big stones at the bottom and small ones above.",
    "A long apron of loose stone below the high ground. None of it sits quite still.",
    "Loose stone, big at the bottom and small at the top, sliding a little as you cross it.",
    "The rock here is loose and graded by size, and it settles under a boot."
  ],
  "The pale shelf the water has been laying down around itself for a very long time: mineral crust in flat terraces, off-white and faintly yellow, ringed and lipped like something poured. It's hollow in places and it says so underfoot, so you keep to the trodden line.": [
    "Mineral crust in flat pale terraces, off-white and faintly yellow, ringed and lipped like something poured. It's hollow in places, so you keep to the trodden line.",
    "Pale terraces of crust built up by the water over a long time. Some of it sounds hollow underfoot.",
    "Off-white mineral shelves step down in rings and lips. A trodden line runs across the solid parts.",
    "The water has laid down pale crust here in flat terraces. Keep to the path: the crust is thin in places.",
    "Yellowish-white terraces of mineral, lipped like poured wax. It rings hollow in spots.",
    "A pale mineral shelf, terraced and ringed. A worn line marks where it's safe to walk.",
    "Crusted terraces, pale and faintly yellow. Stray from the trodden line and it sounds hollow."
  ],
  "Crust, bone-pale, crazed all over into plates and stained sulphur-yellow along every crack. Warm through the sole. Somebody has laid a run of planks across the worst of it and pegged them down, and the planks are recent.": [
    "Bone-pale crust, crazed into plates and stained sulphur-yellow along the cracks. It's warm through your soles. A line of recent planks is pegged across the worst of it.",
    "Pale crust cracked into plates, yellow in the seams, warm underfoot. Someone has laid planks across it lately.",
    "The ground is a warm, pale crust, crazed all over. A pegged plank walk crosses the worst stretch.",
    "Cracked white crust stained yellow with sulphur. Fresh planks have been pegged down to walk on.",
    "Warm, bone-coloured crust in plates, yellow along every crack. The planks laid over it are new.",
    "Crazed pale crust, sulphur-yellow at the edges and warm through a boot. There's a plank path pegged across it.",
    "The crust here is pale, cracked and warm. Somebody recently laid planks across it and pegged them in."
  ],
  "The rock goes up in one piece, banded red on red, too high to see the top of from underneath and too sheer to argue with. It runs away in both directions along the same line and doesn't offer anything that could be called a way up.": [
    "The rock goes straight up, banded red on red, too high to see the top from below and too sheer to climb.",
    "A single sheer face of red banded rock, running off both ways along one line. There's no way up.",
    "Banded red rock rises out of sight. It stretches away in both directions without a break.",
    "The cliff is one piece, red on red, and much too steep. It runs on in both directions.",
    "Sheer red rock, layered in bands. From the bottom you can't see the top.",
    "A wall of banded red stone, straight up. Nothing on it would do as a handhold.",
    "Red rock in one unbroken face, too high and too steep to climb, running along the same line both ways."
  ],
  "Brackish shallows, warmer than the channel and a great deal less clean, sheeted with a film that turns colours where the light catches it. Reeds have got a foothold. The bank is a slurry of grit and old plastic.": [
    "Brackish shallows, warmer than the channel and dirty, with a film on the surface that turns colours. Reeds grow here. The bank is grit and old plastic.",
    "Warm, murky shallows with an oily sheen. Reeds have taken hold, and the bank is slurry and plastic.",
    "Shallow brackish water with a rainbow film on it. Reeds stand in the muck along a bank of grit and plastic.",
    "The shallows here are warm and far from clean. A film catches the light in colours. Reeds grow along the edge.",
    "Brackish water, shallow and warm. The bank is a mess of grit and old plastic, with reeds pushing through.",
    "Dirty shallows with a coloured film on top. Reeds have got a hold in the silt.",
    "Warm brackish water over a soft bottom. The reeds are thick, and the bank is mostly grit and plastic waste."
  ],
  "Shoreline water, shallow enough to watch the bottom go from gravel to silt as it deepens, then a slow shelf away into nothing. Something has been rooting along the waterline in the mud, and not recently.": [
    "Shallow shoreline water. The bottom runs from gravel to silt as it deepens, then shelves away. Something has been rooting in the mud along the waterline, though not recently.",
    "Clear shallows where you can watch gravel turn to silt underfoot before the bottom drops away.",
    "The water at the shore is shallow and the bottom is visible, gravel then silt. The mud at the edge has been dug over.",
    "Shallow water along the shore, the bottom shelving slowly into deeper dark. There are old marks of rooting in the mud.",
    "Gravel under clear shallow water, going to silt, then falling away. Something turned over the mud here a while ago.",
    "At the shoreline the water is shallow and clear. Further out the bottom slopes off into nothing.",
    "The shallows run gravel to silt before the shelf drops. Old rooting marks show in the mud at the waterline."
  ],
  "The rim of the tableland, a clean red face of it going up out of reach. There's no way up here. There's a way up somewhere, and this isn't it. Off toward the middle of the country there's a wall, and above the wall, catching the light, a long row of glass roofs. Something is growing in there. Not for you.": [
    "The rim of the tableland rises out of reach in a clean red face. There's no way up here. Off toward the middle of the country there's a wall, and above the wall, catching the light, a long row of glass roofs. Something is growing in there. Not for you.",
    "A sheer red face, the edge of the tableland, with no route up. Off toward the middle of the country there's a wall, and above the wall, catching the light, a long row of glass roofs. Something is growing in there. Not for you.",
    "The tableland ends above you in a clean red cliff. It can't be climbed here. Toward the middle of the country there's a wall, with a long row of glass roofs above it catching the light. Something is growing in there. Not for you.",
    "Red rock goes straight up to the tableland rim. The way up is somewhere else. Off toward the middle of the country there's a wall, and above the wall, catching the light, a long row of glass roofs. Something is growing in there. Not for you.",
    "A clean red face, out of reach. Off toward the middle of the country there's a wall, and above the wall, catching the light, a long row of glass roofs. Something is growing in there. Not for you.",
    "The rim of the tableland stands overhead, smooth and red, no holds on it. Off toward the middle of the country there's a wall, and above the wall, catching the light, a long row of glass roofs. Something is growing in there. Not for you.",
    "Sheer red rock at the tableland's edge, with no way up from here. Toward the middle of the country there's a wall, and a long row of glass roofs above it catching the light. Something is growing in there. Not for you."
  ],
  "Grey-green thorn, waist high, following a line of damp that isn't visible any other way. It's the only thing out here that's any colour at all.": [
    "Waist-high grey-green thorn following a line of damp you can't otherwise see. It's the only colour out here.",
    "A strip of thorn, grey-green and waist high, tracing hidden damp across the ground.",
    "Thorn grows here to the waist along a line where there must be water underground.",
    "Grey-green thorn in a long line, waist high. Everything around it is bare.",
    "The thorn follows the damp. It's grey-green and grows to your waist, and nothing else nearby has any colour.",
    "A band of waist-high thorn marks where moisture runs under the surface.",
    "Grey-green thorn, dense and waist high, strung out along a line of damp ground."
  ],
  "Rammed earth between shuttering, faced with salvaged plate and capped with a walk. Twice the height of a man and going on out of sight both ways. There are no windows in it, and there's no graffiti on it, in a world that has written on absolutely everything else.": [
    "Rammed earth faced with salvaged plate and capped with a walk, twice a man's height and running out of sight both ways. No windows, and no graffiti.",
    "A high wall of rammed earth, plated with salvage, a walk along the top. It has no windows and nobody has written on it.",
    "The wall is packed earth faced in salvaged plate, twice head height. It runs off both ways with no windows in it.",
    "Salvage plate over rammed earth, a walkway along the top. The surface is blank: no windows, no graffiti.",
    "A long wall of rammed earth and plate, taller than two men. Not a mark on it.",
    "Rammed earth, shuttered and plated, with a walk along its cap. It goes on out of sight in both directions.",
    "The wall is earth rammed hard and faced with scrap plate. There are no windows, and the face is clean of graffiti."
  ],
  "Open water, a red-brown sheet of it lying in the bottom of the basin with the rock going up all round in steps. It isn't clean and it doesn't pretend to be: a scum of pale crust rings the whole margin and the deep of it's the colour of stewed tea. It's also the only standing water for sixty miles that has anything alive in it, which is why there are ruts coming down to it from the east.": [
    "Red-brown water lying in the bottom of the basin, the rock stepping up all round. Pale crust rings the margin. It's the only water for sixty miles with anything alive in it, and ruts come down to it from the east.",
    "A sheet of murky red-brown water in the basin floor, ringed with pale scum. Ruts lead down to it from the east.",
    "The basin holds a stretch of tea-coloured water, crusted pale at the edges. Life in it makes it worth the trip, judging by the ruts from the east.",
    "Standing water the colour of stewed tea, rock rising in steps around it. The margin is ringed with pale crust.",
    "Red-brown water, not clean, lying in the bottom of the basin. It's the only living water for sixty miles. Ruts come in from the east.",
    "A pool of murky water in the basin, pale crust along its edge. Wheel ruts lead to it from the east.",
    "Brown water with pale scum around the rim. Stepped rock rises on every side, and ruts approach from the east."
  ],
  "The rim of the tableland, a clean red face of it going up out of reach. There's no way up here. There's a way up somewhere, and this isn't it.": [
    "The rim of the tableland rises out of reach in a clean red face. There's no way up here.",
    "A sheer red face at the edge of the tableland, with no route up.",
    "The tableland ends above you in a clean red cliff. It can't be climbed here.",
    "Red rock goes straight up to the tableland rim. The way up is somewhere else.",
    "The rim of the tableland stands overhead, smooth and red, with no holds on it.",
    "Sheer red rock at the tableland's edge. You'll need to find another place to get up.",
    "A clean red face, too high to reach and too smooth to climb."
  ],
  "Low grey brush claws up through broken ground: brittle, half-dead stuff that shivers when there's no wind behind it.": [
    "Low grey brush pushes up through broken ground, brittle and half dead. It shivers even when there's no wind.",
    "Brittle grey brush grows low over cracked ground, most of it more dead than alive.",
    "Half-dead grey scrub, low and stiff, rooted in broken ground.",
    "The ground is broken and the brush on it is grey and brittle. It trembles with no wind to move it.",
    "Low grey brush, dry and snapping, poking up through the rubble.",
    "Broken ground with a cover of low, brittle grey brush.",
    "Grey brush claws up from the cracks, low and dry and barely alive."
  ],
  "Thorn, grown thick as a man is broad and twice his height, trained for years through a lattice of salvage plate and rail. The stems are finger-thick and grey and set with spines the length of your hand. Where somebody has cut into it at some point the cut has closed over, knotted and ugly and entirely shut. Nothing about it was manufactured. All of it was decided.": [
    "Thorn grown thicker than a man is broad and twice his height, trained through a lattice of salvage plate and rail. The spines are as long as your hand. Old cuts in it have closed over, knotted and shut.",
    "A wall of thorn woven through salvaged rail and plate, twice head height. Grey stems, finger-thick, with hand-length spines.",
    "The thorn here has been grown and trained into a barrier, thick and high. Where someone once cut it, it has healed shut.",
    "Grey thorn twice a man's height, grown through a frame of scrap rail. The spines are long and the cuts in it have knotted closed.",
    "Trained thorn, dense and tall, with salvage plate buried in it. Nothing about it was built. All of it was grown on purpose.",
    "A hedge of thorn over a skeleton of rail and plate, finger-thick stems bristling with spines.",
    "Thick thorn, twice head height, laced through salvage. A place where it was cut has grown back closed and ugly."
  ],
  "Cracked pale hardpan, flat to the horizon and ringing slightly underfoot, the mud of a lake that dried before anybody was counting.": [
    "Cracked pale hardpan to the horizon, ringing slightly underfoot. It's the mud of a lake that dried a very long time ago.",
    "Pale dried lake bed, cracked into plates and flat all the way out.",
    "The hardpan is pale and hard and split into polygons. It rings under a boot.",
    "A dry lake bottom, pale and cracked, level to the horizon.",
    "Flat pale hardpan, crazed with cracks. Whatever lake was here dried before anyone kept count.",
    "Pale cracked mud, baked hard, stretching out flat in every direction.",
    "The ground is old lake mud, dried pale and cracked, ringing faintly as you walk."
  ],
  "The way round the inside of the wall, close under it, in its shade for most of the day. A stair goes up to the walk every so often and the treads are worn in the middle.": [
    "The path along the inside of the wall, in its shade most of the day. Stairs go up to the walk at intervals, the treads worn in the middle.",
    "Close under the wall on the inside. It's shaded, and every so often a worn stair leads up to the walk.",
    "A path running round inside the wall. The stairs to the walk are hollowed in the middle from use.",
    "In the wall's shadow, following it round. Stairs rise to the walk now and then.",
    "The way round the inside of the wall, cool and shaded. The stair treads are worn down in the middle.",
    "A shaded path tight against the inner wall, with steps up to the walk every so often.",
    "The path hugs the inside of the wall. Worn stairs lead up at intervals."
  ],
  "The water goes wide and slow here, the current losing its grip and setting down whatever it was carrying. Sandbars break the surface in low grey backs. Birds you can't name work the shallows and leave when you get close.": [
    "The water spreads wide and slows, setting down what it carried. Grey sandbars break the surface. Birds work the shallows and leave when you get close.",
    "A wide, slow reach of water with low grey sandbars showing. Birds feed in the shallows.",
    "The current loses its grip here and the water goes broad and shallow. Sandbars lie in grey humps.",
    "Slow, wide water depositing silt. Birds you can't name pick at the shallows and take off as you approach.",
    "The river slows and widens. Grey sandbars show above the surface.",
    "Broad slow water over sandbars. Birds work the edges and move off when disturbed.",
    "The water is wide and lazy here, dropping its load in grey bars."
  ],
});

// Older wordings the build scripts still emit (from before the 2026-08-25
// prose pass). Most differ only in contractions, which norm() folds away; the
// two below were rewritten more heavily and are listed outright.
const ALIASES = {
  "A shelf of red stone standing a hundred feet clear of the flats, its face banded in every shade the country has, laid down and then eaten back until only this much was left. From up here the dark line of the thorn is visible a long way off and reads as exactly what it is.":
    "A shelf of red stone standing a hundred feet clear of the flats, its face banded in every shade the country has, laid down and then eaten back until only this much was left. From up here the dark line of the thorn is visible a long way off, a black seam laid across the red.",
  "Grey ash to the horizon, level and going nowhere in particular. Nothing grows in it worth the word and nothing has for a long time. There is a great deal of sky, and the quiet out here is not the absence of noise, it is the absence of anything that would make one.":
    "Grey ash to the horizon, level and going nowhere. Nothing grows in it, and there's nothing out here that could make a noise.",
  "Grey ash to the horizon, level and going nowhere. Nothing grows in it. The quiet is not the absence of noise. It is the absence of anything that would make one.":
    "Grey ash to the horizon, level and going nowhere. Nothing grows in it, and there's nothing out here that could make a noise.",
  "Red rock to the horizon in every direction, pitted all over with pale rings a hair deep where the rain has stood and eaten. The wind never entirely stops. There is a great deal of sky and none of it is reassuring.":
    "Red rock to the horizon, pitted with pale rings a hair deep where the rain has stood and eaten. The wind never stops. There's a great deal of sky and none of it's reassuring.",
};

const CONTRACTIONS = [[/\bit's\b/gi, 'it is'], [/\bthere's\b/gi, 'there is'], [/\bisn't\b/gi, 'is not'],
  [/\bdoesn't\b/gi, 'does not'], [/\bthat's\b/gi, 'that is'], [/\byou're\b/gi, 'you are'],
  [/\byou've\b/gi, 'you have'], [/\baren't\b/gi, 'are not'], [/\bthey're\b/gi, 'they are'],
  [/\bhasn't\b/gi, 'has not'], [/\bcan't\b/gi, 'cannot'], [/\bdon't\b/gi, 'do not']];
export function norm(t) {
  let s = t;
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  return s.toLowerCase();
}

// Any variant (or the original) -> its original key, so a re-run finds tiles
// already varied and re-picks the same text for them.
export const ORIGIN = new Map();
for (const [orig, vs] of Object.entries(POOLS)) {
  ORIGIN.set(orig, orig);
  for (const v of vs) ORIGIN.set(v, orig);
}
for (const [old, orig] of Object.entries(ALIASES)) ORIGIN.set(old, orig);
// Contraction-folded lookup, for generator output that spells words out.
const ORIGIN_NORM = new Map();
for (const orig of Object.keys(POOLS)) ORIGIN_NORM.set(norm(orig), orig);
export function originOf(text) {
  return ORIGIN.get(text) ?? ORIGIN_NORM.get(norm(text));
}

function hash(x, y) {
  let h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// Row-major greedy: take the hash pick, step past whatever the west and north
// neighbours were given. Memoised, since it recurses along x and y.
const memo = new Map();
function index(n, x, y) {
  const k = n + ':' + x + ':' + y;
  if (memo.has(k)) return memo.get(k);
  let i = hash(x, y) % n;
  // Chains restart on a fixed 32-tile lattice so the answer never depends on
  // the order tiles were asked in.
  const w = (x & 31) === 0 ? -1 : index(n, x - 1, y);
  const nn = (y & 31) === 0 ? -1 : index(n, x, y - 1);
  for (let t = 0; t < n && (i === w || i === nn); t++) i = (i + 1) % n;
  memo.set(k, i);
  return i;
}

export function pickVariant(text, x, y) {
  const orig = originOf(text);
  if (!orig) return text;
  const pool = POOLS[orig];
  return pool[index(pool.length, x, y)];
}
