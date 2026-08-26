/**
 * Twenty more rooms for an ordinary night's sleep, and three more presences.
 *
 * WHY THIS POOL AND NOT ANOTHER. Sleep was the thinnest dreamscape in the game
 * and by far the most travelled: every player sleeps, `beginDissociation` builds
 * an instance of 2 rooms and the sleep tick builds 3, and there were 14 rooms to
 * draw them from. A player who sleeps regularly had seen the whole set inside a
 * week. The eight drug dreamzones each had 6 rooms for a 3-4 room trip, which is
 * its own problem and is handled in the sibling script; this one is the pool
 * with the most eyes on it.
 *
 * HOW EACH ROOM IS BUILT. From the one page of De Quincey that is most use to
 * us (docs/reference/plain-writing.md, "Write an altered mind by what it does to
 * space, time and memory"): give the state a RULE about scale, duration or
 * recall and let it operate. The reader supplies the dread. So every room below
 * has exactly one rule, named in a comment, and the prose does nothing but obey
 * it. None of them contains the word strange, wrong, eerie or unsettling, and
 * that is a constraint rather than an accident: an adjective doing the work is
 * the author stepping in to say what the room already said.
 *
 * The second move, borrowed from the fourteen that already shipped: NOBODY EVER
 * REMARKS ON IT. The queue does not find the corner surprising. That is what
 * separates a dream from a haunted house.
 *
 * ⚠ FX. Sleep rooms stay mostly on WEATHER effects even though the canvas now
 * speaks symptoms too, because the difference between asleep and high should
 * survive being looked at. Four rooms below use a symptom, and only where the
 * room's own rule IS that symptom (a corridor that narrows is `tunnel`; it is
 * not `tunnel` because tunnels are atmospheric).
 *
 *   node scripts/content/dreams-sleep-expansion.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const TDIR = path.join(process.cwd(), 'content', 'dream_templates');
const PDIR = path.join(process.cwd(), 'content', 'dream_presences');
const CHECK = process.argv.includes('--check');

const VALID_FX = ['rain', 'snow', 'ash', 'fog', 'wind', 'none',
                  'static', 'tunnel', 'tracers', 'bloom', 'crawl', 'swim'];

// ── The rooms ────────────────────────────────────────────────────────────────
// rule: the one thing this room does. Kept in the data rather than in a comment
// so that a later editor can see what they would be breaking.
const ROOMS = [
  {
    id: 'dream_the_shift', name: 'The Shift You Never Left',
    rule: 'duration: you did not stop doing this, you only stopped noticing',
    fx: 'fog', fx_intensity: 0.4,
    description: 'A job you left, and you are still on. The tasks are in front of you in the order you always did them and your hands know all of it. Somebody has been covering the parts you were not here for, and they have kept it up beautifully, for years, and they would like a word at the end.',
    weather: 'The air of a room that has been occupied continuously and aired never.',
    ambient: [
      'Somebody puts a completed thing in the tray for you and does not look up.',
      'The clock goes round to the hour you always finished at, and continues.',
      'A voice down the room says your name in the tone of somebody confirming you are still there.',
    ],
    objects: [
      { name: 'the work', looks: [
        'The pile is the height it was on your last day and has been maintained at that height.',
        'Your handwriting on all of it, including the parts from after you left.',
        'You finish one. Underneath it is the same one.',
      ] },
      { name: 'the person covering for you', looks: [
        'They have your apron on. It fits them.',
        'They have been doing this a long time and are not owed anything and know it.',
        'They turn out to be facing away no matter which side you come round.',
      ] },
    ],
  },
  {
    id: 'dream_the_extra_rooms', name: 'The Rooms You Forgot You Had',
    rule: 'scale: your home is larger than you have been using',
    fx: 'ash', fx_intensity: 0.3,
    description: 'A door in your own place that opens onto rooms you own. They are furnished, and the furniture is yours, and it has been under sheets. The rent you have been paying was for all of this. You have been living in the corner of it.',
    weather: 'Cold in the way a room is cold when the heating has never once been on in it.',
    ambient: [
      'A door further in opens onto a further room and stays open.',
      'Dust comes up off a sheet and hangs where it is.',
      'From somewhere at the back, the sound of a tap that has been running the whole time.',
    ],
    objects: [
      { name: 'the sheets', looks: [
        'Under each one, something of yours from a year you can name.',
        'They have not been touched. The dust on them is even, and deep, and yours.',
        'You lift one. The shape underneath keeps the shape.',
      ] },
      { name: 'the far door', looks: [
        'Beyond it, another room, and in that room another door.',
        'It is the front door of the flat. From this side.',
        'It has your number on it. So did the last one.',
      ] },
    ],
  },
  {
    id: 'dream_the_walk_back', name: 'The Walk Back',
    rule: 'scale: the route home keeps adding to itself and remains the route home',
    fx: 'rain', fx_intensity: 0.5,
    description: 'The way you always go, at the hour you always go it. Every street is the correct street. There are more of them than there have ever been, and each one is where it should be, and the whole walk is the length of the whole walk plus another one.',
    weather: 'Rain that has been falling for the length of the journey and will last it.',
    ambient: [
      'You pass the corner you turn at. The corner you turn at is ahead.',
      'A light goes on in an upstairs window and it is the window you know.',
      'Your feet find a kerb before you see it, correctly.',
    ],
    objects: [
      { name: 'the street', looks: [
        'Yours. The bins are out on the right night.',
        'You have walked this in every weather and never at this length.',
        'The numbers go up, which is correct, and they do not stop, which is also correct.',
      ] },
      { name: 'your door', looks: [
        'Ahead, at the distance it was.',
        'The light is on behind it and you left it off.',
        'Your key is in your hand and has been for some time.',
      ] },
    ],
  },
  {
    id: 'dream_the_examination', name: 'The Paper',
    rule: 'recall: you knew this once and are being held to that',
    fx: 'fog', fx_intensity: 0.35,
    description: 'A hall of desks and a paper you have not prepared for, in a subject you did study, a long time ago, thoroughly. Everyone else started an hour ago. The questions are fair. You have been given the full time and the full time began before you arrived.',
    weather: 'Still, and warm at the back of the neck, and quiet enough to hear paper.',
    ambient: [
      'Somebody at the front turns a page over and the whole hall turns a page over.',
      'The invigilator walks the aisle and does not stop at you, which is worse.',
      'Chalk on a board behind you writes the time remaining and rubs it out.',
    ],
    objects: [
      { name: 'the paper', looks: [
        'Question one is one you can do. You did it. It is still question one.',
        'The questions are in your subject and in your year and in your handwriting.',
        'Turn it over and the reverse is the same side.',
      ] },
      { name: 'the other candidates', looks: [
        'All writing. None of them hurried.',
        'You know several of them. They are the ages they were then.',
        'The one beside you has finished and is waiting, politely, for you.',
      ] },
    ],
  },
  {
    id: 'dream_the_bag', name: 'What Is In The Bag',
    rule: 'withheld: the description is never given, and the dream is built to not give it',
    fx: 'none', fx_intensity: 0.2,
    description: 'You are carrying something in a bag and it is alive and it is your responsibility. It has been yours for a while. You are taking it somewhere and the somewhere is agreed. The bag is warm at the bottom and you have been told, by somebody with authority, not to open it on the way.',
    weather: 'Ordinary. A day like any other, going along at the pace of a day.',
    ambient: [
      'The bag adjusts its weight, slowly, the way something settling adjusts it.',
      'It goes quiet, which you have learned to read.',
      'Somebody passing looks at the bag and then at you and says nothing at all.',
    ],
    objects: [
      { name: 'the bag', looks: [
        'Closed. Warm along the bottom seam.',
        'You have been carrying it long enough for the handle to have made a line in your hand.',
        'It moves once, decisively, and settles.',
      ] },
      { name: 'the way ahead', looks: [
        'You know the address. You have known it since you were handed the bag.',
        'It is not far now and it has not been far for some time.',
        'Somebody will be there to take it, and they will check.',
      ] },
    ],
  },
  {
    id: 'dream_the_call', name: 'The Number',
    rule: 'process: an action that cannot complete, and each attempt is faultless',
    fx: 'static', fx_intensity: 0.4,
    description: 'A phone and a number you know without looking. You get it right every time. The dialling takes as long as the number is long, and the number is longer each time you are most of the way through it, and you have never once made a mistake.',
    weather: 'The dead flat air of a booth with the door pulled to.',
    ambient: [
      'The line opens onto a room with somebody in it, and then onto the dial tone.',
      'You get to the last digit. There is one more.',
      'Somebody breathes at the other end, briefly, and it is a recording.',
    ],
    objects: [
      { name: 'the phone', looks: [
        'Warm. You have been at this a while.',
        'The keys are worn in the pattern of this exact number.',
        'It rings while you are holding it, and it is you.',
      ] },
      { name: 'the number', looks: [
        'You have never had to write it down.',
        'It belongs to somebody you could name, and you decline to, here.',
        'Correct. Every digit of it is correct.',
      ] },
    ],
  },
  {
    id: 'dream_the_water', name: 'The Water Coming Up',
    rule: 'duration: a slow catastrophe treated as ordinary weather by everyone in it',
    fx: 'rain', fx_intensity: 0.6,
    description: 'The ground floor of somewhere domestic, with water in it, up over the skirting and rising at the speed of an afternoon. People are having their evening. Somebody steps over a floating chair to get to the kettle. Nobody has mentioned it, and to mention it now, this far in, would be making a scene.',
    weather: 'Close and damp, and smelling of a carpet that has been wet before.',
    ambient: [
      'Something that floats arrives from the next room and joins the things in this one.',
      'The water reaches a socket and the lights stay on.',
      'Somebody laughs at something on the other side of the room.',
    ],
    objects: [
      { name: 'the water', looks: [
        'Up to the third stair. It was the second.',
        'Clean, and cold, and coming from no direction.',
        'Your reflection in it is standing in a dry room.',
      ] },
      { name: 'the others', looks: [
        'Comfortable. Shoes off, feet under them, out of the wet.',
        'One of them tops up a glass and hands it across without looking down.',
        'They will go up when it is time to go up.',
      ] },
    ],
  },
  {
    id: 'dream_the_photograph', name: 'The Photograph',
    rule: 'recall: a memory arrives complete, of something that did not happen',
    fx: 'ash', fx_intensity: 0.35,
    description: 'A group photograph on a wall, of a day you were not there for, and you are in it. Second row. You remember the morning of it. You remember what you had been arguing about and who drove and the smell of the hall, and you were not there, and the photograph has been on this wall for years.',
    weather: 'The dry warmth of a corridor with radiators and no window.',
    ambient: [
      'Somebody walks past behind you and slows at the photograph, as people do.',
      'The frame is straightened by nobody and stays straightened.',
      'A name comes back to you, and then the rest of that person.',
    ],
    objects: [
      { name: 'the photograph', looks: [
        'Second row, fourth from the left, squinting. You were squinting all day.',
        'Everyone in it is the age they were. So are you.',
        'The glass has your breath on it from standing this close.',
      ] },
      { name: 'the caption', looks: [
        'A date. You can account for that date.',
        'The names, in order, and yours in the correct position.',
        'Somebody has written it out carefully, and they knew everyone.',
      ] },
    ],
  },
  {
    id: 'dream_the_rehearsal', name: 'The Rehearsal',
    rule: 'recall: everyone else has the information and assumes you were given it',
    fx: 'fog', fx_intensity: 0.5,
    description: 'A stage, mid-run, and you are on. The others are doing it well and have done it many times. Your part is substantial. They pause where your lines go and then carry on generously, covering, in a way that is becoming its own performance.',
    weather: 'Hot in a small circle and cold everywhere else.',
    ambient: [
      'A cue comes round and passes.',
      'Somebody in the wings mouths something helpful and it is not words.',
      'The audience settles the way an audience settles when it is going well.',
    ],
    objects: [
      { name: 'the others', looks: [
        'Word perfect. They have been carrying this section for a while.',
        'One of them takes your line and gives it a reading you would not have chosen.',
        'They are pleased to see you and have not broken character to be.',
      ] },
      { name: 'the script', looks: [
        'On a table at the side of the stage, open at the place.',
        'Your name down the left. The right-hand column has been left blank for you.',
        'You have annotated it. In pencil. Recently.',
      ] },
    ],
  },
  {
    id: 'dream_the_platform', name: 'The Platform',
    rule: 'duration: the wait resolves and the resolution is another wait',
    fx: 'wind', fx_intensity: 0.5,
    description: 'A platform at the hour when the boards are the brightest thing. Your train is the next one. It has been the next one for some time and the board is honest about it and updates, correctly, to say so.',
    weather: 'A cold draught along the platform from an opening at the far end.',
    ambient: [
      'The board flickers and settles on a later number.',
      'An announcement apologises and is inaudible in the middle, which is the part with the reason.',
      'A train comes through without stopping and it is going where you are going.',
    ],
    objects: [
      { name: 'the board', looks: [
        'Your service, on time, in four minutes.',
        'It has said four minutes for a while and it has never once been wrong.',
        'The destinations go up the board and off the top and are replaced from below.',
      ] },
      { name: 'the others waiting', looks: [
        'Bags down. Coats on. They have judged this correctly.',
        'One of them checks the board and then a watch and is satisfied by both.',
        'None of them are on the platform when you look directly along it.',
      ] },
    ],
  },
  {
    id: 'dream_the_search', name: 'Looking For It',
    rule: 'scale: the container is larger than the thing can be lost in, and it is lost in it',
    fx: 'fog', fx_intensity: 0.4,
    description: 'A bag on your knees and a small thing in it that you need at the counter. You are going through it properly, section by section, and there is more bag under each section. Behind you a queue has formed and is being decent about it.',
    weather: 'The overheated air of somewhere with a door that keeps opening.',
    ambient: [
      'Somebody behind you shifts their weight and does not sigh.',
      'Your hand closes on it, and it is the other thing.',
      'The counter clerk says take your time and means it and says it again.',
    ],
    objects: [
      { name: 'the bag', looks: [
        'Yours. Everything in it is yours and correctly where you put it.',
        'Your arm is in it to the elbow, which it was not built for.',
        'The bottom is where the bottom is.',
      ] },
      { name: 'the queue', looks: [
        'Patient. Genuinely patient, which makes it worse.',
        'It has doubled since you started.',
        'The person at the back came in after you and will be served before you and knows neither.',
      ] },
    ],
  },
  {
    id: 'dream_the_print', name: 'The Other Print',
    rule: 'recall: a life continued without you and kept the receipts',
    fx: 'static', fx_intensity: 0.45,
    description: 'A room with your things in it, being lived in. Not the way you live in a room. Better. The washing is done and put away, the bills are in a folder, and there is a note on the table in your handwriting reminding you about something you have no memory of agreeing to.',
    weather: 'Warm. Somebody has had the heating on since this morning.',
    ambient: [
      'The kettle clicks off in the next room, having been filled for two.',
      'A drawer closes somewhere with the confidence of somebody who knows which drawer.',
      'Your name is said, once, from the other room, in a tone that expects an answer.',
    ],
    objects: [
      { name: 'the note', looks: [
        'Your hand. Your abbreviations. A date next week.',
        'It ends with a word you use, and you have never once written it down.',
        'The pen is beside it, capped, on the side you would put it.',
      ] },
      { name: 'the folder', looks: [
        'Everything paid. Everything filed. A year of it.',
        'Your account, in good standing, and the standing is recent.',
        'A photograph at the back that you would not have kept.',
      ] },
    ],
  },
  {
    id: 'dream_the_narrow_way', name: 'The Narrow Way',
    rule: 'scale: the passage reduces at the rate you advance and remains passable',
    fx: 'tunnel', fx_intensity: 0.7,
    description: 'A way through, between two things, that you started into upright. It is still passable. It has been still passable for a while now, and each stretch of it is a stretch you could go back along, and you are going forward because the light is that way.',
    weather: 'The pressed, close warmth of stone that has had a person against it.',
    ambient: [
      'The walls take up the sound of your coat and give it back closer.',
      'Ahead, the gap you are aiming for resolves into the gap after it.',
      'Something behind you settles, and the way you came is the way you came.',
    ],
    objects: [
      { name: 'the gap ahead', looks: [
        'Wide enough. It has been wide enough every time you have checked.',
        'The light through it is daylight and it is on your face.',
        'You could get a hand through, and then a shoulder, and you have done both before.',
      ] },
      { name: 'the walls', looks: [
        'Cold on both sides at once, which they were not at the start.',
        'Marked, at your height, along the whole length, by people going through.',
        'They are the walls of a building you could name if you went up a level.',
      ] },
    ],
  },
  {
    id: 'dream_the_meal', name: 'The Table Laid',
    rule: 'duration: preparation completes and the event does not begin',
    fx: 'ash', fx_intensity: 0.25,
    description: 'A long table, laid for a number of people, and the food is at the temperature food is at when it has just gone down. Everything has been done properly and in the right order and finished at the right moment. That moment was a while ago now and the room is holding it.',
    weather: 'The good warmth of a kitchen with the oven off and the door open.',
    ambient: [
      'A candle goes down by a measurable amount.',
      'Something in the middle of the table stops steaming.',
      'A chair is pulled out at the far end by nobody and left out.',
    ],
    objects: [
      { name: 'the places', looks: [
        'Counted, and correct, and one more than you would have laid.',
        'The napkins are folded the way your family folds them.',
        'Every glass has been polished. You can see the room in all of them.',
      ] },
      { name: 'the food', looks: [
        'Good. Better than you make.',
        'It has cooled to the point where reheating it is a decision.',
        'Somebody has already had a little of it, from the end, neatly.',
      ] },
    ],
  },
  {
    id: 'dream_the_appointment', name: 'The Waiting Room',
    rule: 'recall: the name is nearly yours and the correction is never accepted',
    fx: 'fog', fx_intensity: 0.4,
    description: 'Chairs against three walls and a door that opens when a name is read out. The names are close to yours. One of them has been close enough that you half stood, and the person who went in was already standing, and they have not come back out.',
    weather: 'The mild, filtered air of a building that manages its own air.',
    ambient: [
      'The door opens. A name is read. Somebody rises without hurry.',
      'The chair beside you is taken by somebody who does not settle.',
      'A phone rings behind the desk and is answered with your surname.',
    ],
    objects: [
      { name: 'the list', looks: [
        'On a clipboard, turned away, with a page and a half gone.',
        'You are on it. You are on it twice, and one of them is crossed off.',
        'The hand that wrote it has been writing all morning and is tired near the bottom.',
      ] },
      { name: 'the door', looks: [
        'It opens outward, which means the room beyond it is small.',
        'The light under it goes off between names.',
        'Nobody who has gone through it has come back through it, and this is not remarked on.',
      ] },
    ],
  },
  {
    id: 'dream_the_tooth', name: 'The Tooth',
    rule: 'repetition: a finite thing turns out to have an unlimited supply',
    fx: 'none', fx_intensity: 0.3,
    description: 'One of your teeth comes out into your hand, cleanly, with no blood and no pain, and there is another one behind it. That one comes out too. You are somewhere public and managing this quietly and the supply is holding.',
    weather: 'Ordinary indoor air. Somebody is doing a normal thing nearby.',
    ambient: [
      'Your tongue finds the gap. The gap is filled.',
      'Somebody asks if you are all right, in passing, and accepts your answer.',
      'You put another one in your pocket with the others, which is a lot now.',
    ],
    objects: [
      { name: 'the teeth', looks: [
        'Clean. Whole. Rooted, all of them, which is the part that stays with you.',
        'A handful. More than the number of teeth.',
        'They are yours. You could match every one of them to its place.',
      ] },
      { name: 'the people nearby', looks: [
        'Not looking. Getting on with it.',
        'One of them has clocked it and has decided not to make it a thing.',
        'They are people you see most days, and this is most days.',
      ] },
    ],
  },
  {
    id: 'dream_the_party_below', name: 'The Party Downstairs',
    rule: 'scale: a short distance that the descent does not consume',
    fx: 'fog', fx_intensity: 0.55,
    description: 'One floor down, everybody you know, and the sound of it coming up the stairwell with the door open. You are on the stairs and you have been going down them for a while. The sound is the same distance below you as it was, and it is a good party, and they are waiting on you to arrive before the thing happens.',
    weather: 'The warm updraught of a room full of people, coming up past you.',
    ambient: [
      'A laugh goes up that you can put a name to.',
      'Somebody calls your name up the stairwell, cheerfully, and gets no answer.',
      'Glasses go down on a table all at once, the way they do for a toast.',
    ],
    objects: [
      { name: 'the stairs', looks: [
        'A flight, and a turn, and a flight. You have done four of those.',
        'Carpeted. The carpet is the one from the building you grew up in.',
        'Below the turn, the light of the room, on the wall, moving with people.',
      ] },
      { name: 'the sound of them', looks: [
        'Thirty people. You could name eleven from the voices.',
        'They are at the part of the evening where nobody is going home.',
        'It quiets, briefly, the way a room quiets when somebody is about to speak.',
      ] },
    ],
  },
  {
    id: 'dream_the_message', name: 'The Message',
    rule: 'process: the words are correct at the moment of writing and not after',
    fx: 'static', fx_intensity: 0.5,
    description: 'Something has to be sent and you are composing it. Each sentence is right as you write it. You read the whole thing back and it is a different message, addressed correctly, in your voice, about something else, and the thing you need to say has to be put in again.',
    weather: 'The faint warmth of a device that has been on a long time.',
    ambient: [
      'A line you did not write completes itself sensibly.',
      'The message is marked as read.',
      'Somewhere the other person begins a reply and stops.',
    ],
    objects: [
      { name: 'the message', looks: [
        'Four paragraphs. Clear. Yours. Not it.',
        'The one word that matters is in there and it is doing a different job.',
        'You have said this well. You have said this well several times.',
      ] },
      { name: 'the reply', looks: [
        'It arrives before you send.',
        'It answers the message you meant, kindly, and closes the subject.',
        'Signed off the way they always sign off, which nobody else would know.',
      ] },
    ],
  },
  {
    id: 'dream_the_ledger', name: 'The Amount Owing',
    rule: 'scale: an ordinary debt with no upper bound, presented correctly',
    fx: 'ash', fx_intensity: 0.4,
    description: 'A sum is owed and the paperwork is in order. The figure is arrived at properly, from small honest amounts you recognise, and each of them is fair. It is added up in front of you by somebody who is good at their job and does not enjoy this part, and the total goes on past the width of the page.',
    weather: 'Dry and still and lit from above, evenly, for reading by.',
    ambient: [
      'Another line is added, correctly, and initialled.',
      'A drawer opens behind the desk and a further folder comes out.',
      'The person doing the adding pauses, checks something, and is satisfied it is right.',
    ],
    objects: [
      { name: 'the ledger', looks: [
        'Every entry is a thing you did. Small. Ordinary. Yours.',
        'The dates run from a year you were happy.',
        'The column continues onto a page that is fixed in at the side, and then another.',
      ] },
      { name: 'the clerk', looks: [
        'Careful, and quick, and not unkind about it.',
        'They have done this for you before and remember which column you query.',
        'They turn the book round so you can see it, which is a courtesy.',
      ] },
    ],
  },
  {
    id: 'dream_the_long_afternoon', name: 'The Long Afternoon',
    rule: 'duration: a lifetime of it, and the light does not move',
    fx: 'bloom', fx_intensity: 0.3,
    description: 'A room in the middle of an afternoon, with the light across the floor at the angle it holds at four. Nothing needs doing. You have been here since before you can account for and the light is at four, and you have grown old in this room twice and are the age you are.',
    weather: 'The still, dust-lit warmth of a room the sun has been in all day.',
    ambient: [
      'Dust turns over in the light and does not settle.',
      'Outside, somebody goes past on the road, at four.',
      'The room is exactly as warm as it was.',
    ],
    objects: [
      { name: 'the light', looks: [
        'Across the boards, at four, where it has been.',
        'It has moved the width of a floorboard since you were young here.',
        'Your hand in it is your hand at every age you have had.',
      ] },
      { name: 'the chair', looks: [
        'Worn where you wear a chair.',
        'You have sat in it for a long time and it is not tired of you.',
        'From it, the whole room, and no reason at all to get up.',
      ] },
    ],
  },
];

// ── Presences ────────────────────────────────────────────────────────────────
// Sleep had two. A presence wanders the whole instance, so it is the only thing
// in a dream that can follow you between rooms, and two of them across every
// night's sleep is a small number for the one element that recurs.
const PRESENCES = [
  {
    id: 'dp_dream_the_one_running_late', name: 'somebody who is late',
    arrivals: [
      'Somebody comes in fast, apologising, and is already talking.',
      'A door goes somewhere behind you and then they are here.',
      'They arrive out of breath, from a long way, on your account.',
    ],
    departures: [
      'They go, still apologising, to the next thing.',
      'They check the time, and the time decides it, and they leave.',
      'They are called from another room and answer on the way out.',
    ],
    looks: [
      'Coat still on. They have come straight from something.',
      'They are sorry about the delay and have not said what they are delayed for.',
      'They keep beginning the sentence and being interrupted by their own hurry.',
      'You have been waiting for them. That was what the waiting was.',
    ],
  },
  {
    id: 'dp_dream_the_one_from_work', name: 'someone you work with',
    arrivals: [
      'Somebody from work comes through, in their work clothes, mid-task.',
      'They come in carrying something that belongs to the job and not to here.',
      'They arrive the way they arrive at work, without knocking.',
    ],
    departures: [
      'They take it through to the back and do not come out.',
      'They finish what they were doing and move on to the next of it.',
      'They go, and the door they use is not one you had noticed.',
    ],
    looks: [
      'Doing their job. Here. Correctly, and to the usual standard.',
      'You have never once seen this person outside the building.',
      'They say the thing they always say and it fits the situation.',
      'They ask you something about the work and wait properly for the answer.',
    ],
  },
  {
    id: 'dp_dream_the_one_who_knows_the_way', name: 'someone who knows the way',
    arrivals: [
      'Somebody comes past who is not lost, and slows.',
      'They step in from a direction, having come from somewhere with purpose.',
      'They are here, and they were expected, though not by you.',
    ],
    departures: [
      'They go on, at the same pace, in the direction they were going.',
      'They point once, and then they are along the way they pointed.',
      'They leave you the direction and take everything else with them.',
    ],
    looks: [
      'They have been here before and it does not impress them.',
      'They know which door. They have known which door the whole time.',
      'You could ask. They would answer. You do not.',
      'They wait, briefly, in case you are coming, and do not press it.',
    ],
  },
];

// ── Apply ────────────────────────────────────────────────────────────────────
let wrote = 0, same = 0;
const problems = [];

// ⚠ Every room is checked against the SHIPPED prose rules before it is written,
// because this file is 20 rooms of my own writing and the whole point of the
// exercise was that a rule you have not run against your own text is a
// quotation. An em dash here would be an Ascendant voice tell in a dream.
const BANNED = [
  [/—/, 'em dash (an Ascendant/Architect voice tell, never a dream)'],
  [/\b(strange|eerie|unsettling|surreal|uncanny|dreamlike|nightmarish)\b/i, 'an adjective doing the room’s work'],
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
  if (!r.rule || r.rule.length < 12) { problems.push(`${r.id}: every room states its one rule`); continue; }
  if (r.objects.length < 2) { problems.push(`${r.id}: needs at least two objects`); continue; }
  for (const o of r.objects) if (o.looks.length < 3) problems.push(`${r.id}/${o.name}: a look is picked per instance, so it needs three`);
  vet(r.id, r.description, r.weather, r.ambient, r.objects.map((o) => o.looks));

  const row = {
    id: r.id, name: r.name, cause: 'dream', drug_id: null,
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
  vet(p.id, p.arrivals, p.departures, p.looks);
  const row = { id: p.id, name: p.name, cause: 'dream', drug_id: null,
                arrivals: p.arrivals, departures: p.departures, looks: p.looks };
  const file = path.join(PDIR, `${p.id}.json`);
  const next = canonicalJson(row);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === next) { same++; continue; }
  if (!CHECK) fs.writeFileSync(file, next, 'utf8');
  wrote++;
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Sleep dreams: ${wrote} written, ${same} unchanged (${ROOMS.length} rooms + ${PRESENCES.length} presences).`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
