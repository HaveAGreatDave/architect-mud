/**
 * Four more rooms for each of the eight drug dreamzones, and a presence for the
 * five that never had one.
 *
 * THE ARITHMETIC THAT MAKES THIS WORTH DOING. A trip builds `3 + rand(2)` rooms
 * (plugins/trip/index.js) out of a pool of 6. So every single trip on a given
 * drug showed you more than half of everything that drug had, and a second trip
 * was mostly a re-run. Ten rooms turns that into a bit over a third, which is
 * the difference between a place you visit and a place you have finished.
 *
 * ⚠ THE POOLS ARE NOT INTERCHANGEABLE, AND THAT IS THE POINT. Each drug already
 * had a rule its six rooms obeyed, and the four below obey the same one rather
 * than being general weirdness filed under a drug id. The rules, read off the
 * shipped rooms rather than invented here:
 *
 *   DMT        everything was BUILT, recently, by somebody proud of it, and it
 *              paused politely when you arrived
 *   k-hole     you are at the wrong end of every distance, including to your
 *              own body, and nothing is alarmed about it
 *   DXM        half a second behind, held with great consistency
 *   dead air   the carrier continues and there is nothing riding on it
 *   salvia     you are a LAYER in something, and the layers move separately
 *   nitrous    an enormous understanding arrives whole and does not survive
 *              being brought back
 *   ibogaine   you are being shown your own life, in order, by something that
 *              declines to comment on it
 *   threshold  this is the ENTRANCE to something and you have not been admitted
 *
 * A room that would work equally well under two of those headings is a room
 * that has not committed, and belongs in the generic `dt_default_*` set instead.
 *
 *   node scripts/content/dreams-drug-expansion.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const TDIR = path.join(process.cwd(), 'content', 'dream_templates');
const PDIR = path.join(process.cwd(), 'content', 'dream_presences');
const CHECK = process.argv.includes('--check');

const VALID_FX = ['rain', 'snow', 'ash', 'fog', 'wind', 'none',
                  'static', 'tunnel', 'tracers', 'bloom', 'crawl', 'swim'];

const ROOMS = [
  // ── DMT · built, busy, and pleased you came ────────────────────────────────
  {
    id: 'dt_dmt_the_nursery', drug: 'drug_dmt', name: 'The Nursery',
    fx: 'bloom', fx_intensity: 0.8,
    description: 'A wing of the structure given over to things that are not finished. They are being worked on with enormous care and they are going to be enormous. One of them notices you, which it was not supposed to be able to do yet, and this is treated as very good news.',
    weather: 'Bright, and close, and warm the way an incubator is warm.',
    ambient: [
      'Something incomplete does a thing it will do properly later, and the room approves.',
      'A finished section is carried away by several at once.',
      'One of the small ones follows you as far as it is allowed.',
    ],
    objects: [
      { name: 'the unfinished ones', looks: [
        'Half built and entirely willing.',
        'They have the shape of the big ones, at a size you could hold.',
        'One of them is further along than the others and is being watched closely.',
      ] },
      { name: 'the work in progress', looks: [
        'Being made to a standard. You can see the standard from here.',
        'It is going to do something that this room is too small for.',
        'It stops when you look at it, out of manners, and resumes when you stop.',
      ] },
    ],
  },
  {
    id: 'dt_dmt_the_demonstration', drug: 'drug_dmt', name: 'The Demonstration',
    fx: 'tracers', fx_intensity: 0.75,
    description: 'They are showing you how it works. The whole of it, from the beginning, at the speed they think you can take. It is going too fast and they are delighted with how you are doing, and they will run it again from the top as many times as you need.',
    weather: 'The dry, charged air of something running at full power.',
    ambient: [
      'The whole sequence runs again, faster, because you did well.',
      'A part of it is held still for you, kindly, and then released.',
      'Something checks that you are following and decides that you are.',
    ],
    objects: [
      { name: 'the demonstration', looks: [
        'Beginning, middle, end, and it is all three at once and that is the point.',
        'You understood it. You are not able to say what it was.',
        'It resolves into one motion, and the motion is obvious, and it goes.',
      ] },
      { name: 'the ones showing you', looks: [
        'Patient in the way of teachers who love the material.',
        'They have done this for others. They mention this, somehow, without saying it.',
        'They are pleased. They were pleased before you arrived.',
      ] },
    ],
  },
  {
    id: 'dt_dmt_the_index', drug: 'drug_dmt', name: 'The Index',
    fx: 'bloom', fx_intensity: 0.7,
    description: 'Everything is catalogued here, and the catalogue is a room, and it has been kept up. You are in it. Your entry is not short. It has been added to recently, by somebody with good handwriting, and the most recent line is about now.',
    weather: 'Still and lit evenly, the way a place is lit for reading.',
    ambient: [
      'An entry is amended somewhere behind you and the amendment is small.',
      'A section reorganises itself into a better order.',
      'Something finds your entry, reads a little of it, and is pleased.',
    ],
    objects: [
      { name: 'the catalogue', looks: [
        'It goes back further than the thing it catalogues.',
        'Every entry is complete. Yours is complete.',
        'It is arranged by something that is not alphabet and not date and is obvious.',
      ] },
      { name: 'your entry', looks: [
        'Longer than you would have guessed and shorter than you would like.',
        'It records things you did that nobody was present for.',
        'The last line is being written while you read it, and it keeps up.',
      ] },
    ],
  },
  {
    id: 'dt_dmt_the_lattice', drug: 'drug_dmt', name: 'The Lattice',
    fx: 'crawl', fx_intensity: 0.85,
    description: 'The structure with nothing living in it. Just the thing itself, going away in every direction, holding. It was made and it is being maintained and there is nobody in this part of it. It is the most beautiful thing you have been shown and it was not shown to you.',
    weather: 'Cool, and moving, and clean as the inside of an instrument.',
    ambient: [
      'A section adjusts, load moving across it, and settles.',
      'The pattern completes a very large figure and starts the next.',
      'Somewhere along it, something is being repaired.',
    ],
    objects: [
      { name: 'the lattice', looks: [
        'It holds. That is what it does and it is doing it everywhere at once.',
        'The joints are the interesting part. Somebody solved them.',
        'It goes on past where you can follow it and it does not thin out.',
      ] },
      { name: 'the far reaches', looks: [
        'More of it. The same standard, all the way out.',
        'Something is working out there, small with distance, and unhurried.',
        'The light changes across it, slowly, in the shape of a very long day.',
      ] },
    ],
  },

  // ── k-hole · the wrong end of every distance ───────────────────────────────
  {
    id: 'dt_khole_the_inventory', drug: 'drug_khole', name: 'The Inventory',
    fx: 'tunnel', fx_intensity: 0.8,
    description: 'The parts you are made of, laid out in a good order on a clean surface, and counted. They are all here. Somebody has done this properly and the count came out right and there is no urgency about putting them back.',
    weather: 'Cold, level, and without any direction to it.',
    ambient: [
      'A part is picked up, considered, and put down where it was.',
      'The count is done again and agrees with the first count.',
      'Something is written down at the far end of the surface.',
    ],
    objects: [
      { name: 'the parts', looks: [
        'Yours. In order. Numbered.',
        'You recognise the use of each one and cannot recall operating any of them.',
        'There is one you have no account for, and it is grouped with the others.',
      ] },
      { name: 'the surface', looks: [
        'Clean, and long, and lit from directly above.',
        'It runs away from you further than the room could hold.',
        'At the far end, more of these, belonging to other people, in the same order.',
      ] },
    ],
  },
  {
    id: 'dt_khole_the_far_end', drug: 'drug_khole', name: 'The Far End',
    fx: 'tunnel', fx_intensity: 0.9,
    description: 'A room seen from the wrong end of the length of it. Everything that is happening is happening at the other end, correctly, at the right size for where it is. Your hands are down there too, doing something competent.',
    weather: 'Thin. The air of somewhere high, where sound arrives late.',
    ambient: [
      'Something is decided at the far end and carried out.',
      'A voice reaches you at the volume of a voice across a field.',
      'Your hands finish and rest.',
    ],
    objects: [
      { name: 'the far end', looks: [
        'A room. Ordinary. Full size, from where it is standing.',
        'The people in it are managing without any input.',
        'It gets no closer and it is not going away.',
      ] },
      { name: 'your hands', looks: [
        'Down there. Doing it well.',
        'They are yours. You could describe every mark on them from here.',
        'They stop, and wait, and are not waiting on you.',
      ] },
    ],
  },
  {
    id: 'dt_khole_the_hum', drug: 'drug_khole', name: 'The Hum',
    fx: 'static', fx_intensity: 0.7,
    description: 'One note, held, that everything else is happening inside. It has been going since before this and it is not building to anything. The rest of the world is arranged around it and is quieter than it, and it is not loud.',
    weather: 'Pressure without temperature.',
    ambient: [
      'The note holds.',
      'Something happens inside the note and does not disturb it.',
      'It is joined by itself, at the same pitch, and stays one note.',
    ],
    objects: [
      { name: 'the note', looks: [
        'One pitch. No change in it anywhere.',
        'It is not coming from a direction. You have checked all of them.',
        'It has been going long enough that stopping would be the event.',
      ] },
      { name: 'everything else', looks: [
        'Arranged inside it, and getting on.',
        'Smaller than the note and going about its business.',
        'It defers to the note and does not know that it is doing so.',
      ] },
    ],
  },
  {
    id: 'dt_khole_the_smallest_room', drug: 'drug_khole', name: 'The Smallest Room',
    fx: 'tunnel', fx_intensity: 0.95,
    description: 'The last one. It is the size of the thing that is left of you and it fits exactly and it is not uncomfortable. There is nothing in here that needs doing. Everything that was going to be decided has been.',
    weather: 'Even. Exactly the temperature of a body, which removes the question.',
    ambient: [
      'Nothing happens, correctly.',
      'The walls are where the walls are.',
      'A very long time goes by and is not long.',
    ],
    objects: [
      { name: 'the room', looks: [
        'It fits. That is the whole of what can be said about it.',
        'No door, and no wall you could point to as the one without a door in it.',
        'It is the size it needs to be, which is smaller than it was.',
      ] },
      { name: 'what is left', looks: [
        'Enough to be counted as one.',
        'It is not frightened. It has not been given anything to be frightened with.',
        'It would answer to your name out of habit.',
      ] },
    ],
  },

  // ── DXM · half a second behind, held consistently ──────────────────────────
  {
    id: 'dt_dxm_the_delay_line', drug: 'drug_dxm', name: 'The Delay Line',
    fx: 'tracers', fx_intensity: 0.8,
    description: 'A corridor where everything you do arrives after you have done it, by the same amount, every time. The amount does not vary. You have learned to work with it and are working with it well, and the corridor has been built for people who have learned that.',
    weather: 'Flat, recycled air with a hum under it.',
    ambient: [
      'Your footfall arrives, on time, late.',
      'A door you opened opens.',
      'Something ahead does a thing and you understand it in a moment.',
    ],
    objects: [
      { name: 'the corridor', looks: [
        'Long, level, and lit at intervals that go on at those intervals.',
        'The far end is doing what this end did.',
        'Handrails at your height, worn, on both sides, all the way.',
      ] },
      { name: 'the lag', looks: [
        'The same every time. You could set a watch by it and have.',
        'It applies to everything, including the things you did not do on purpose.',
        'You reach for the rail. Your hand is already there.',
      ] },
    ],
  },
  {
    id: 'dt_dxm_the_second_plateau', drug: 'drug_dxm', name: 'The Second Plateau',
    fx: 'tunnel', fx_intensity: 0.65,
    description: 'A level surface at a height, reached by a climb you do not have, with another level surface above it. This one is where you are. It is broad and unremarkable and it goes to the edges, and the next one up is the same and is occupied.',
    weather: 'High and dry and still, with the cold that comes with height.',
    ambient: [
      'Somebody moves about on the level above, at the pace of somebody at home there.',
      'The edge of this plateau is where it was.',
      'A sound comes down from above and is a normal sound.',
    ],
    objects: [
      { name: 'this level', looks: [
        'Flat. Even. It goes out to a horizon that is an edge.',
        'You have been up here for some time and have not walked its width.',
        'The floor is a floor. Somebody laid it.',
      ] },
      { name: 'the level above', looks: [
        'The same as this one, from underneath.',
        'There is somebody on it. There is somebody on the one above that.',
        'No stair between them, and everyone got up there.',
      ] },
    ],
  },
  {
    id: 'dt_dxm_the_conveyor', drug: 'drug_dxm', name: 'The Conveyor',
    fx: 'swim', fx_intensity: 0.6,
    description: 'A floor that is moving at the speed you walk, in the direction you walk, so that you are making excellent progress and the walls beside you are the same walls. Nobody has done this to you. It is how the floor is.',
    weather: 'Moving air at exactly the speed of the floor, so it is still.',
    ambient: [
      'The floor carries on at the speed of you.',
      'You stop. The floor stops.',
      'A join in the floor comes up towards you and takes a long time about it.',
    ],
    objects: [
      { name: 'the floor', looks: [
        'Moving. You can see the joins go by and there is one at your feet.',
        'It has been running longer than the building it is in has been standing.',
        'You step off it, and the part you step onto is moving too.',
      ] },
      { name: 'the walls', looks: [
        'The same section of wall, keeping pace, faithfully.',
        'There is a mark on it. There is the same mark ahead.',
        'They are the walls of a place you were going to.',
      ] },
    ],
  },
  {
    id: 'dt_dxm_the_grey_stairs', drug: 'drug_dxm', name: 'The Grey Stairs',
    fx: 'static', fx_intensity: 0.55,
    description: 'A flight of stairs done in the material everything institutional is done in, going up, with a landing, and a flight going up from the landing. You are climbing at a good rate. The landings arrive at regular intervals and each has a window in it with the same weather.',
    weather: 'The cool, scoured air of a stairwell nobody has ever aired.',
    ambient: [
      'A landing arrives. Then the next flight.',
      'The window shows the same weather at a different height.',
      'Somebody a few flights up is climbing at your rate.',
    ],
    objects: [
      { name: 'the stairs', looks: [
        'Concrete, with the nosings worn pale in the middle by other people.',
        'Twelve to a flight, all the way up, checkable and checked.',
        'They go down as well. You have not been down them.',
      ] },
      { name: 'the window', looks: [
        'The same view. The same weather. A greater height.',
        'Wired glass, and the wire is a grid, and the grid is regular.',
        'Nothing outside it has moved between one landing and the next.',
      ] },
    ],
  },

  // ── dead air · the carrier continues, nothing rides it ─────────────────────
  {
    id: 'dt_deadair_the_transmitter', drug: 'drug_deadair', name: 'The Transmitter',
    fx: 'static', fx_intensity: 0.85,
    description: 'A hall of equipment doing its job at full power, correctly maintained, running the signal out to the whole region. Every meter is where it should be. Nothing has been put into the input for a very long time and the output is at full strength.',
    weather: 'Warm from the racks, dry, and smelling faintly of hot dust.',
    ambient: [
      'A meter comes up to peak on nothing at all and returns.',
      'Something switches to the reserve and back, cleanly, unnecessarily.',
      'The cooling comes on, does its work, and goes off.',
    ],
    objects: [
      { name: 'the racks', looks: [
        'Lit, warm, and running to specification.',
        'Somebody services these. There is a card on the end with dates on it.',
        'Every channel is carrying. Every channel is carrying nothing.',
      ] },
      { name: 'the input', looks: [
        'Empty. Connected, terminated, and empty.',
        'The last thing that came through it is on a log, with an hour.',
        'It is waiting. It is built to wait and this is not straining it.',
      ] },
    ],
  },
  {
    id: 'dt_deadair_the_archive', drug: 'drug_deadair', name: 'The Archive',
    fx: 'static', fx_intensity: 0.6,
    description: 'Shelves of everything that was ever put out, labelled and dated and in order. All of it is recorded. You can take any of it down and put it on, and every one of them is the sound of a room with the microphone open and nobody in it.',
    weather: 'Cold and dry, the way a place is kept when what is in it must last.',
    ambient: [
      'A reel finishes and the end of it goes round.',
      'Something is refiled, in the correct place, by nobody.',
      'A label is legible from across the room and it is a date you know.',
    ],
    objects: [
      { name: 'the shelves', looks: [
        'Full, in order, going back to before the station.',
        'Nothing is missing. There are no gaps anywhere along it.',
        'The oldest ones are at the far end and are in the same condition.',
      ] },
      { name: 'a recording', looks: [
        'An hour of an empty studio, logged as an hour of programming.',
        'You can hear the room. You can hear how big the room is.',
        'Halfway through it, a chair takes somebody’s weight, and then nothing.',
      ] },
    ],
  },
  {
    id: 'dt_deadair_the_last_bulletin', drug: 'drug_deadair', name: 'The Last Bulletin',
    fx: 'tracers', fx_intensity: 0.55,
    description: 'A newsroom kept ready. Copy on the desk, running order on the wall, the lamp on over the chair. The bulletin goes out on the hour and it has gone out on every hour, and the copy on the desk is the copy from the last time anybody wrote any.',
    weather: 'The stale warmth of a room with a lamp left on in it.',
    ambient: [
      'The hour comes round and the light over the door goes red.',
      'A page is ready on the desk and stays ready.',
      'The light goes green. The hour is over.',
    ],
    objects: [
      { name: 'the copy', looks: [
        'Typed, marked up, and timed. It is good copy.',
        'The story it covers has been over for a while.',
        'Somebody has corrected a name in pencil and initialled the correction.',
      ] },
      { name: 'the chair', looks: [
        'Pulled out at the angle of somebody who left in a hurry, or on time.',
        'The seat is worn. Somebody did a great many hours in it.',
        'It is at the correct height for the desk and the microphone.',
      ] },
    ],
  },
  {
    id: 'dt_deadair_the_silence_between', drug: 'drug_deadair', name: 'The Gap Between Stations',
    fx: 'static', fx_intensity: 0.95,
    description: 'The part of the band where there is nothing, which turns out to be a place with weather and a floor. It goes on for the width of the gap. There are stations at both ends of it, faint, and this is the middle, and the middle is wide.',
    weather: 'A dry constant rush, in every direction, at one volume.',
    ambient: [
      'The rush continues at the same level.',
      'Something comes up out of it briefly, almost a voice, and goes back down.',
      'A station at the far edge holds a note and drifts off it.',
    ],
    objects: [
      { name: 'the rush', looks: [
        'Everywhere and even. There is no louder part of it.',
        'Listen long enough and it has structure, and the structure is yours.',
        'It is not covering anything up. There is nothing underneath it.',
      ] },
      { name: 'the far stations', looks: [
        'Both edges, faint, carrying something you cannot resolve.',
        'They are closer to each other than either is to you.',
        'One of them is playing music and has been all along.',
      ] },
    ],
  },

  // ── salvia · you are a layer, and the layers move separately ───────────────
  {
    id: 'dt_salvia_the_hinge', drug: 'drug_salvia', name: 'The Hinge',
    fx: 'crawl', fx_intensity: 0.9,
    description: 'You are the join between two things that are turning against each other. On one side, a flat afternoon in a place you know. On the other, the same afternoon, from the back. You are the part that lets them move and you are being used correctly.',
    weather: 'Two temperatures, one on each face, and neither of them wrong.',
    ambient: [
      'The two sides go past each other by a small amount.',
      'Something on the far face does what the near face did.',
      'The join takes the load and holds.',
    ],
    objects: [
      { name: 'the near side', looks: [
        'An afternoon. Yours. Correct in every particular.',
        'It is going along at the speed of an afternoon.',
        'It has a back, and you are attached to it.',
      ] },
      { name: 'the far side', looks: [
        'The same afternoon, from behind, with the working showing.',
        'The people in it are the same people, seen from the wrong face.',
        'It moves when the near side moves, later, by the width of you.',
      ] },
    ],
  },
  {
    id: 'dt_salvia_the_wheel', drug: 'drug_salvia', name: 'The Wheel',
    fx: 'swim', fx_intensity: 0.85,
    description: 'Something enormous is turning and you are one of the things fixed to it. Everything you can see is fixed to it too, at its own radius, going round at its own rate, and all of it is correct. There has been no moment at which this started.',
    weather: 'A steady pull outward that has always been the direction of down.',
    ambient: [
      'Your radius comes round to where it was.',
      'Something at a larger radius takes longer and arrives anyway.',
      'The whole assembly moves through a quarter and continues.',
    ],
    objects: [
      { name: 'the wheel', looks: [
        'Turning. Not fast. It has never not been turning.',
        'Its centre is not visible and is not far.',
        'Everything is on it, at a radius, including the parts that look like ground.',
      ] },
      { name: 'your fixing', looks: [
        'Sound. Whatever holds you on is holding.',
        'You are at a radius that suits you and were put here.',
        'It has been checked. There is a mark on it from the checking.',
      ] },
    ],
  },
  {
    id: 'dt_salvia_the_edge_of_the_flat', drug: 'drug_salvia', name: 'The Edge Of The Flat',
    fx: 'crawl', fx_intensity: 0.8,
    description: 'The world here is a surface with a thickness, and you have got to the side of it. The thickness is about the width of a hand. Everything is painted on the top and it is painted well and the edge shows the layers, and you can count them, and there are more than there should be.',
    weather: 'Air on one face only.',
    ambient: [
      'A layer at the edge lifts a little and lies back down.',
      'Something crosses the surface above and does not go over the side.',
      'The edge continues away from you in both directions, at the same thickness.',
    ],
    objects: [
      { name: 'the edge', looks: [
        'Layers. Pressed. Each one a whole world done in a very thin coat.',
        'You count eleven and lose the count and it is more than eleven.',
        'The top one is the one you have been living on and it is the thinnest.',
      ] },
      { name: 'underneath', looks: [
        'Nothing. Not dark. Nothing, in the way the back of a picture is nothing.',
        'It supports the surface without touching it.',
        'You put a hand under and the hand is on the top again.',
      ] },
    ],
  },
  {
    id: 'dt_salvia_the_folding', drug: 'drug_salvia', name: 'The Folding',
    fx: 'crawl', fx_intensity: 0.95,
    description: 'The room is being folded, along lines it has, by something that knows where they are. It is done neatly. Each fold brings a far part of the room against a near part and they match, because the room was made to be folded and you have only ever seen it open.',
    weather: 'The air changes each time and is always the air of somewhere indoors.',
    ambient: [
      'A fold is made and the two halves agree along the line.',
      'Something on the far side of the room is suddenly beside you and belongs there.',
      'The room is opened out again to check, and folded back.',
    ],
    objects: [
      { name: 'the folds', looks: [
        'Along lines that were always in the floor. You had taken them for boards.',
        'Sharp, and pressed, and done many times before.',
        'They are the same lines each time, which is why it goes so neatly.',
      ] },
      { name: 'what matches up', looks: [
        'The far wall against the near wall, and the pattern runs on across the join.',
        'A door meets a door and makes a door.',
        'You meet the part of the room you were standing in.',
      ] },
    ],
  },

  // ── nitrous · an enormous understanding that does not survive ──────────────
  {
    id: 'dt_nitrous_the_one_second', drug: 'drug_nitrous', name: 'The Corridor Of One Second',
    fx: 'swim', fx_intensity: 0.9,
    description: 'One second, laid out end to end so you can walk down it. It is long. Every part of it is the same second and the parts are all different, and at the end of it is the beginning of it and you have been along here before, at this pace, several times.',
    weather: 'A pressure that rises and falls at the rate of the second.',
    ambient: [
      'The second arrives at its end and is at its beginning.',
      'Something in the middle of it happens, and happens.',
      'The walls come in and go out at the rate of a slow breath.',
    ],
    objects: [
      { name: 'the second', looks: [
        'Walkable. Long. It has a middle and you are past it.',
        'It is the second you are in. There is no other one on offer.',
        'The far end and the near end are the same end.',
      ] },
      { name: 'the repeats', looks: [
        'You have done this stretch before, at this speed, in this direction.',
        'Each one has been identical and each one has been worth it.',
        'The count is available to you and you do not take it.',
      ] },
    ],
  },
  {
    id: 'dt_nitrous_the_understanding', drug: 'drug_nitrous', name: 'The Understanding',
    fx: 'bloom', fx_intensity: 0.9,
    description: 'You have got it. All of it, at once, and it is simple, and the simplicity is the astonishing part. It will hold for as long as you are here. Everything else you have ever thought was a way of not having this and you can see exactly how that worked.',
    weather: 'Light that comes from the fact rather than from a direction.',
    ambient: [
      'It holds. It is still simple.',
      'A part of it that seemed separate turns out to be the same part.',
      'It resolves further, which you had not thought was available.',
    ],
    objects: [
      { name: 'the understanding', looks: [
        'One thing. You could say it in a sentence and the sentence is not long.',
        'It accounts for everything, including the objections.',
        'You have had it before. You have had it exactly this many times.',
      ] },
      { name: 'the words for it', looks: [
        'They are here and they are adequate.',
        'You assemble the sentence. It is a good sentence.',
        'It will not go through the door with you and you know that and it is fine.',
      ] },
    ],
  },
  {
    id: 'dt_nitrous_the_chord', drug: 'drug_nitrous', name: 'The Chord',
    fx: 'swim', fx_intensity: 0.75,
    description: 'A chord being held by something large enough to hold it, and the room is inside the chord rather than the other way round. It resolves. Then it resolves again, further, into a chord that the first one had been on the way to.',
    weather: 'The air moves with the chord and is warm at the resolution.',
    ambient: [
      'It resolves, and the resolution is better than the chord.',
      'A note is added underneath that was implied the whole time.',
      'The whole thing rises by a step and is the same chord.',
    ],
    objects: [
      { name: 'the chord', looks: [
        'Held. Big. You are somewhere in the middle of the voicing.',
        'It contains a note you would not have put in and it is the reason it works.',
        'It is going somewhere. It has been going there for a while and is not late.',
      ] },
      { name: 'the room', looks: [
        'Inside the sound, which is the correct arrangement.',
        'It is the shape the chord needs and it changes when the chord does.',
        'The walls are at the distance the sound says they are.',
      ] },
    ],
  },
  {
    id: 'dt_nitrous_the_coming_back', drug: 'drug_nitrous', name: 'The Coming Back',
    fx: 'tunnel', fx_intensity: 0.5,
    description: 'The part where it goes. It goes in the reverse of the order it came in, at the same rate, so that you can watch it. What is left at the end is a room, and a person in it, and the certainty that there had been something and that it was enormous.',
    weather: 'Ordinary air arriving, in the correct amount, at the correct temperature.',
    ambient: [
      'A part of it goes and you can name what it was as it goes.',
      'The room comes back around you at its usual size.',
      'The last of it goes, cleanly, and the going is not painful.',
    ],
    objects: [
      { name: 'what is going', looks: [
        'The big part first, then the parts that explained the big part.',
        'You are keeping hold of one word of it, and the word is an ordinary word.',
        'It goes at a rate that lets you say goodbye to it, which is a courtesy.',
      ] },
      { name: 'the room', looks: [
        'A room. This one. The one you were in the whole time.',
        'Somebody has been standing here for forty seconds.',
        'Everything in it is the size it is, and that is the disappointing part.',
      ] },
    ],
  },

  // ── ibogaine · shown your life, in order, without comment ──────────────────
  {
    id: 'dt_ibogaine_the_childhood_room', drug: 'drug_ibogaine', name: 'The Room You Were Small In',
    fx: 'bloom', fx_intensity: 0.5,
    description: 'A room you were small in, at the correct size, which is to say the size it was rather than the size it is. Everything is where it was. You are being shown it and nothing is being said about it, and you are being given as long as you want.',
    weather: 'The particular warmth of a room where somebody was looked after.',
    ambient: [
      'Downstairs, somebody who is not here moves a chair.',
      'The light comes round to the hour you were sent to bed.',
      'Something is left in its place a little longer for you.',
    ],
    objects: [
      { name: 'the room', looks: [
        'The size it was. The ceiling is at the height it was.',
        'The marks on the door frame, at your heights, with the years.',
        'It smells of the house. That is the part that gets you.',
      ] },
      { name: 'what is on the shelf', looks: [
        'Yours. You had forgotten it entirely and you have not forgotten anything about it.',
        'You know what it cost and who paid and what it was for.',
        'It is in the condition it was in on a specific day.',
      ] },
    ],
  },
  {
    id: 'dt_ibogaine_the_names', drug: 'drug_ibogaine', name: 'The List Of Names',
    fx: 'static', fx_intensity: 0.45,
    description: 'A list, being read at the pace a list is read at, of the people you have had. Everyone. In the order they arrived. It is accurate and it is longer than you would have said, and nothing is added after any of them.',
    weather: 'Quiet, with the small sounds of a room where somebody is reading.',
    ambient: [
      'A name is read and there is a pause the length of that person.',
      'The reading continues at the same pace.',
      'A name you had lost arrives, correctly placed, between two you had not.',
    ],
    objects: [
      { name: 'the list', looks: [
        'Everyone. In order. Nothing beside the names.',
        'It is written in one hand and the hand does not tire.',
        'You are on it, once, in the correct position.',
      ] },
      { name: 'the reader', looks: [
        'Reading. Not slowly, and not fast.',
        'They do not look up between names and they get every pronunciation right.',
        'They will finish. That is the arrangement.',
      ] },
    ],
  },
  {
    id: 'dt_ibogaine_the_witness', drug: 'drug_ibogaine', name: 'The Witness',
    fx: 'tunnel', fx_intensity: 0.55,
    description: 'Something is watching a thing you did, with you, from the position you were in at the time. It has no opinion. It stays for the whole of it, including the parts you have never let run to the end, and it is still there afterwards.',
    weather: 'Still, with no draught, in a space that has stopped for this.',
    ambient: [
      'It runs on past the point where you stop it.',
      'Nothing is said.',
      'The thing you did is done again, at the speed it happened.',
    ],
    objects: [
      { name: 'the thing you did', looks: [
        'From where you were standing. The angle is right.',
        'It takes as long as it took. Not longer.',
        'The part you remember is a small part of it and it is in there.',
      ] },
      { name: 'the witness', looks: [
        'Present. Watching. Not judging and not withholding judgement.',
        'It was there at the time, which is a thing you had not considered.',
        'It has no face and it is turned the same way as you.',
      ] },
    ],
  },
  {
    id: 'dt_ibogaine_the_morning', drug: 'drug_ibogaine', name: 'The Morning After The Long Night',
    fx: 'bloom', fx_intensity: 0.35,
    description: 'It gets light. That is all that happens and it takes the usual amount of time. The night is behind you and everything in it stays true, and the light comes up on a room with you in it, and there is a whole day.',
    weather: 'First light, coming up properly, in no hurry, on a cold room.',
    ambient: [
      'The light gets as far as the floor.',
      'Outside, the first of them goes past on the road.',
      'Something you were shown settles into the place it will stay.',
    ],
    objects: [
      { name: 'the light', looks: [
        'Ordinary morning. It has done this before.',
        'It reaches the wall, and then along it, at the rate it does.',
        'It is on your hands and your hands are yours.',
      ] },
      { name: 'the day', looks: [
        'A whole one. Nothing in it yet.',
        'You will be tired in it and it is still a day.',
        'It starts where you are standing, which is where you were standing.',
      ] },
    ],
  },

  // ── threshold · the entrance to something, not yet admitted ────────────────
  {
    id: 'dt_threshold_the_vestibule', drug: 'drug_threshold', name: 'The Vestibule',
    fx: 'bloom', fx_intensity: 0.55,
    description: 'The room before the room. Coats off here, wait here, and through when called. It has been furnished for waiting by somebody who took the job seriously. Through the inner door there is a great deal of light and the sound of a considerable number of people.',
    weather: 'Warm, and still, and smelling of stone that is kept clean.',
    ambient: [
      'The inner door is opened from the far side and closed again.',
      'A name is called through, and it is not called out here.',
      'Somebody else’s coat is taken and hung and it is a good coat.',
    ],
    objects: [
      { name: 'the inner door', looks: [
        'Shut. Heavy. It opens inward and it opens easily.',
        'Light comes under it in a strip the width of the door.',
        'You could push it. There is nothing about it that says not to.',
      ] },
      { name: 'the coats', looks: [
        'A great many, hung properly, and none of them yours.',
        'They belong to people who are through there now.',
        'A space has been left at the end of the rail.',
      ] },
    ],
  },
  {
    id: 'dt_threshold_the_appointed_hour', drug: 'drug_threshold', name: 'The Appointed Hour',
    fx: 'tunnel', fx_intensity: 0.5,
    description: 'You are expected. The arrangements have been made and confirmed and the hour is this one. Everybody here knows about it and is pleased for you, and there is a chair, and nobody has come to fetch you yet, and it is still the hour.',
    weather: 'The cool, ordered air of somewhere that runs to time.',
    ambient: [
      'The hour continues.',
      'Somebody passing says your name in the tone of somebody confirming an arrangement.',
      'A clock somewhere makes the small sound clocks make before they strike, and does not strike.',
    ],
    objects: [
      { name: 'the arrangements', looks: [
        'In writing. Correct. Countersigned.',
        'Your name is spelled the way you spell it.',
        'The hour is given, and the place, and both are these.',
      ] },
      { name: 'the chair', looks: [
        'Put out for you, at an angle to the door.',
        'It is a good chair. Somebody chose it.',
        'It has had a lot of use, and all of it recent.',
      ] },
    ],
  },
  {
    id: 'dt_threshold_the_far_side', drug: 'drug_threshold', name: 'What Is Through There',
    fx: 'bloom', fx_intensity: 0.75,
    description: 'A door standing open onto the place this whole building is the entrance to. It is bright and it is occupied and it is going well. Nobody in it is looking this way. The doorway is the width of a doorway and you are on this side of it.',
    weather: 'Warm air coming through the doorway, carrying the smell of somewhere lived in.',
    ambient: [
      'Somebody through there laughs at something you did not hear.',
      'The light in there changes slightly, the way light does when people move.',
      'Somebody crosses the doorway from one side to the other and does not glance out.',
    ],
    objects: [
      { name: 'the doorway', looks: [
        'Open. It has been open the whole time.',
        'No sill, no step. The floor goes straight through.',
        'You can see a good deal of the room from here and not the far end.',
      ] },
      { name: 'the people through there', looks: [
        'At ease. They have been there long enough to be at ease.',
        'You know one of them. You know two of them.',
        'None of them has looked out and none of them is avoiding it.',
      ] },
    ],
  },
  {
    id: 'dt_threshold_the_gatehouse', drug: 'drug_threshold', name: 'The Gatehouse',
    fx: 'crawl', fx_intensity: 0.5,
    description: 'A small building whose whole purpose is the larger one behind it. It has a counter and a ledger and a person’s job in it. Everything about it is in good order. What is behind it goes up out of the top of what you can see and has been there longer than the gatehouse.',
    weather: 'A draught through, from the gate side, carrying the air of the other place.',
    ambient: [
      'The ledger is turned to a fresh page.',
      'Behind the gatehouse, something very large adjusts its lights.',
      'A stamp comes down on something, twice, and is put away.',
    ],
    objects: [
      { name: 'the ledger', looks: [
        'Names, times, and a column for out that has entries in it.',
        'The hand is careful and the entries are recent.',
        'There is a line ready, and the date has been filled in.',
      ] },
      { name: 'what is behind it', looks: [
        'It goes up past the top of the gate and keeps going.',
        'Lit, all the way up, in the pattern of a place with people in it.',
        'It was here before the wall and the wall was built to reach it.',
      ] },
    ],
  },
];

// ── Presences ────────────────────────────────────────────────────────────────
// Five of the eight dreamzones fell back on the generic `the operator`. A
// presence is the only thing that follows you between rooms, so it is what makes
// a drug's world feel inhabited by that drug rather than by the system.
const PRESENCES = [
  {
    id: 'dp_dxm_the_one_behind', drug: 'drug_dxm', name: 'the one half a second behind',
    arrivals: [
      'Somebody comes in. A moment later, they come in.',
      'The door goes. Then somebody is through it.',
      'They arrive, and then they arrive, and both are them.',
    ],
    departures: [
      'They leave. They are still leaving.',
      'They go out, and the going out finishes after they are gone.',
      'They are elsewhere, and then they stop being here.',
    ],
    looks: [
      'They are doing what they did. They are keeping up well.',
      'Their face arrives after the rest of them and is the same face.',
      'They match you. The gap between you is the same gap as everything else.',
      'They speak, and the speaking is exactly as late as it should be.',
    ],
  },
  {
    id: 'dp_deadair_the_test_signal', drug: 'drug_deadair', name: 'the test signal',
    arrivals: [
      'A tone comes up somewhere and holds, and it is in the room.',
      'The room is suddenly carrying something, at full strength, and it is a tone.',
      'It arrives at the top of the hour, on time, as it does.',
    ],
    departures: [
      'It goes off at the end of its allotted time.',
      'It is faded out by nobody, professionally.',
      'It stops. The rush comes back in behind it.',
    ],
    looks: [
      'One tone at a fixed level. It is there to prove the path is good.',
      'It has been broadcast every hour for longer than anybody has listened.',
      'It carries no information and it is not silent, and that is its whole job.',
      'It is the loudest thing in the room and nothing about it is urgent.',
    ],
  },
  {
    id: 'dp_salvia_the_one_from_the_seam', drug: 'drug_salvia', name: 'the one from the seam',
    arrivals: [
      'Something comes through the join in the surface, edge first.',
      'A layer lifts and something that was between the layers is out.',
      'It is here, at the same angle as the seam, having always been in it.',
    ],
    departures: [
      'It goes back in edgeways and the surface closes over.',
      'It lies down along a line in the floor and is a line in the floor.',
      'It slides between two layers and the layers agree.',
    ],
    looks: [
      'Flat. It has a front and a back and no thickness worth mentioning.',
      'It turns edge-on and is not there, and turns back and is.',
      'It knows this place from inside the surface, which is a better view.',
      'It has been between the layers a long time and does not find that remarkable.',
    ],
  },
  {
    id: 'dp_nitrous_the_one_who_already_knows', drug: 'drug_nitrous', name: 'somebody who already knows',
    arrivals: [
      'Somebody is here who has had this thought before.',
      'They arrive at the resolution and were waiting for you at it.',
      'They come in already agreeing with you.',
    ],
    departures: [
      'They go, having got what they came for, which was to see you get it.',
      'They leave on the beat.',
      'They are gone, and the understanding is still here, briefly.',
    ],
    looks: [
      'Delighted, and not surprised. They have had this one.',
      'They are nodding. They started nodding before you began.',
      'They would tell you and it would not survive being told and they know that.',
      'They have been here for all of the repeats and have not got bored.',
    ],
  },
  {
    id: 'dp_threshold_the_doorkeeper', drug: 'drug_threshold', name: 'the one on the door',
    arrivals: [
      'Somebody comes through who is on duty here.',
      'They step out of the inner room and pull the door to behind them.',
      'They arrive from the other side, briefly, on an errand.',
    ],
    departures: [
      'They go back through and the door is closed properly.',
      'They are called from inside and answer and go.',
      'They finish what they are doing out here and return to the post.',
    ],
    looks: [
      'On duty. Doing the job. Not obstructing you and not standing aside.',
      'They know whether you are expected and it is not their place to say.',
      'They have the list. The list is turned away from you out of habit.',
      'They are kind about it, which is the part that has no answer.',
    ],
  },
];

// ── Apply ────────────────────────────────────────────────────────────────────
const DRUGS_DIR = path.join(process.cwd(), 'content', 'drugs');
let wrote = 0, same = 0;
const problems = [];

const BANNED = [
  [/—/, 'em dash (an Ascendant/Architect voice tell, never a dream)'],
  [/\b(strange|eerie|unsettling|surreal|uncanny|dreamlike|nightmarish|trippy)\b/i, 'an adjective doing the room’s work'],
  [/\byou (feel|sense|notice|realise|realize)\b/i, 'a filter verb'],
];
function vet(id, ...texts) {
  for (const t of texts.flat()) {
    for (const [re, why] of BANNED) if (re.test(t)) problems.push(`${id}: ${why} → "${t.slice(0, 60)}"`);
  }
}

for (const r of ROOMS) {
  if (!VALID_FX.includes(r.fx)) { problems.push(`${r.id}: fx "${r.fx}" is not renderable`); continue; }
  if (!(r.fx_intensity > 0 && r.fx_intensity <= 1)) { problems.push(`${r.id}: fx_intensity out of range`); continue; }
  // ⚠ A template whose drug_id has no drug file is unreachable: loadTemplates
  // scopes by drug_id and nothing would ever select it.
  if (!fs.existsSync(path.join(DRUGS_DIR, `${r.drug}.json`))) { problems.push(`${r.id}: no drug ${r.drug}`); continue; }
  for (const o of r.objects) if (o.looks.length < 3) problems.push(`${r.id}/${o.name}: needs three looks`);
  vet(r.id, r.description, r.weather, r.ambient, r.objects.map((o) => o.looks));

  const row = {
    id: r.id, name: r.name, cause: 'drug', drug_id: r.drug,
    description: r.description, weather: r.weather,
    fx: r.fx, fx_intensity: r.fx_intensity,
    ambient: r.ambient, objects: r.objects,
  };
  const file = path.join(TDIR, `${r.id}.json`);
  const next = canonicalJson(row);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === next) { same++; continue; }
  if (!CHECK) fs.writeFileSync(file, next, 'utf8');
  wrote++;
}

for (const p of PRESENCES) {
  if (!fs.existsSync(path.join(DRUGS_DIR, `${p.drug}.json`))) { problems.push(`${p.id}: no drug ${p.drug}`); continue; }
  vet(p.id, p.arrivals, p.departures, p.looks);
  const row = { id: p.id, name: p.name, cause: 'drug', drug_id: p.drug,
                arrivals: p.arrivals, departures: p.departures, looks: p.looks };
  const file = path.join(PDIR, `${p.id}.json`);
  const next = canonicalJson(row);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === next) { same++; continue; }
  if (!CHECK) fs.writeFileSync(file, next, 'utf8');
  wrote++;
}

// Report the resulting pool size per drug, because the whole justification for
// this script is a ratio and it should be checkable rather than asserted.
const byDrug = {};
for (const f of fs.readdirSync(TDIR)) {
  const d = JSON.parse(fs.readFileSync(path.join(TDIR, f), 'utf8'));
  if (d.cause === 'drug' && d.drug_id) byDrug[d.drug_id] = (byDrug[d.drug_id] || 0) + 1;
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Drug dreams: ${wrote} written, ${same} unchanged (${ROOMS.length} rooms + ${PRESENCES.length} presences).`);
console.log('  pool per drug (a trip draws 3-4): ' +
  Object.entries(byDrug).sort().map(([k, v]) => `${k.replace('drug_', '')}=${v}`).join(' '));
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
