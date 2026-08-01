/**
 * NPC archetype registry — the single source of truth for an NPC's persona.
 *
 * An archetype bundles, in one place, everything that used to be spread across
 * `chitchat` (idle lines), `work_zone_id`/`npc_type` (the job), and
 * `flags.personality` (combat/MIS reactions):
 *
 *   label / icon    — how the job/personality shows in the dev-panel dropdown
 *   sells           — true if this archetype runs a shop (shows the vendor editor)
 *   mobile          — true for a travelling seller with no fixed shop location
 *   npcType         — value written to the npcs.npc_type column for runtime
 *                     behaviour (vendor commute, unemployed haunt). Derived from
 *                     the archetype; the editor no longer sets it directly.
 *   workchitchat    — idle lines said while on-shift at the job; NPC override wins
 *   lifechitchat    — idle lines said off the clock out in the city; NPC override wins
 *   combat_lines    — said (or shouted) when the NPC is hit. ALL CAPS = shout.
 *   mis_willing     — default willingness for MIS actions (overridden by npc.flags.mis_willing)
 *   mis_lines_ok    — lines when NPC is willing
 *   mis_lines_no    — lines when NPC refuses
 *   mis_attack      — true if hostile NPCs attack the player rather than just fleeing (rare)
 *   mis_never       — true if personality always refuses regardless of mis_willing flag
 *
 * The dev panel fetches label/icon/sells/mobile via GET /npc-personalities; the
 * heavier line arrays live only here. Keep this file the one place they live.
 */

const DEFAULTS = {
  // ── Jobs ────────────────────────────────────────────────────────────────
  vendor: {
    label: 'Vendor', icon: '🛒', sells: true, mobile: false, npcType: 'vendor',
    workchitchat: [
      "\"Best prices in the district. That's not saying much.\"",
      "\"You touch it, you bought it.\"",
      "\"Everything's genuine. Genuinely acquired.\"",
      "\"Trade you for it. Credits preferred. Bullets accepted.\"",
      "\"Limited supply. Always limited. That's the pitch.\"",
      "\"I don't know where it came from. That's not your business either.\"",
      "\"Come back tomorrow — stock changes. If I'm still here.\"",
      "\"Quality merchandise at prices that won't kill you. Probably.\"",
    ],
    lifechitchat: [
      "\"Off the clock. Don't ask me the price of anything.\"",
      "\"Feet are killing me. Standing all day does that.\"",
      "\"Rent on the stall went up again. Everything goes up.\"",
      "counts a thin roll of credits and sighs",
      "\"One day I'll sell up and move somewhere with air.\"",
      "\"The market's a shark tank. I'm a smaller shark.\"",
      "rubs a knot out of the back of their neck",
      "\"Half my supplier owes me. The other half I owe.\"",
    ],
    combat_lines: [
      'Hey! Watch the merchandise!',
      'You are going to PAY for that.',
      'I\'M CALLING SECURITY.',
      'Get away from my stall.',
      'This is bad for business.',
      'STOP THAT.',
      'You touch me again and your tab is cancelled.',
      'Do you know what I paid for this pitch?',
      'I\'ve dealt with worse. But not by much.',
      'That is COMING OUT OF YOUR DEPOSIT.',
    ],
    mis_willing: false,
    mis_lines_ok: [
      'Is this going to affect my pricing?',
      'I\'m marking this down as a professional expense.',
      'Fine. But I\'m not discounting anything.',
      'Not here. Behind the stall.',
    ],
    mis_lines_no: [
      'That is NOT a service I offer.',
      'GET AWAY FROM MY STALL.',
      'No. Absolutely not. Out.',
      'I will call the whole market over here.',
    ],
  },

  travelling_vendor: {
    label: 'Travelling Vendor', icon: '🎒', sells: true, mobile: true, npcType: 'npc',
    workchitchat: [
      "\"Everything I sell fits on my back. Ask me how.\"",
      "\"Here today. Somewhere worse tomorrow.\"",
      "\"No stall, no rent, no problem.\"",
      "\"You won't find me here next week. Buy now.\"",
      "\"I walk the whole sprawl so you don't have to.\"",
      "\"Prices are firm. My feet hurt too much to haggle.\"",
      "\"Caught this batch three districts over. Rare out here.\"",
      "\"Keep moving, keep selling. That's the trade.\"",
    ],
    lifechitchat: [
      "shifts the weight of the pack and keeps walking",
      "\"My whole life's on my back. Lighter than you'd think.\"",
      "\"Don't own a bed. Own the road. It's a fair trade.\"",
      "checks the sky, judging how far till dark",
      "\"Been to towns that aren't on any map. Wouldn't recommend most.\"",
      "\"The road's honest. The people on it aren't.\"",
      "picks a stone out of a worn-through boot",
      "\"Home's wherever I set the pack down. So, nowhere.\"",
    ],
    combat_lines: [
      'HANDS OFF THE PACK.',
      'You rob a man on the road, you get what\'s coming.',
      'I\'ve been jumped in worse places than this.',
      'That\'s my whole livelihood you\'re grabbing at.',
      'I move for a living. I can move faster than you.',
      'Touch the goods again. See what happens.',
      'Nothing in here is worth your life. Walk away.',
      'STOP. I\'ll remember your face in every town from here to the gate.',
      'You think I carry this without knowing how to keep it?',
      'Bad idea. Bad, bad idea.',
    ],
    mis_willing: false,
    mis_lines_ok: [
      'Quick. I\'ve got ground to cover.',
      'Off the road, then. Behind the crates.',
      'Fine, but I\'m gone by morning.',
      'Costs extra. Everything does.',
    ],
    mis_lines_no: [
      'Not my line of work. Move along.',
      'I sell goods, not favours.',
      'No. I\'ve a route to keep.',
      'Try someone who stays put.',
    ],
  },

  bartender: {
    label: 'Bartender', icon: '🍺', sells: true, mobile: false, npcType: 'npc',
    workchitchat: [
      "\"What'll it be?\"",
      "\"You look like you've had a rough one.\"",
      "\"Pay first. Trust later. That's policy.\"",
      "\"You're not the first person to cry at this bar. Won't be the last.\"",
      "\"I've heard worse. Much worse.\"",
      "\"Last call was three hours ago. I'm still here.\"",
      "\"We're out of the good stuff. We were always out of the good stuff.\"",
      "\"Tab's running. Keep drinking.\"",
      "\"I don't ask questions. That's why people come here.\"",
      "\"You want ice with that? Funny.\"",
    ],
    lifechitchat: [
      "smells of stale beer no matter how long the shower is",
      "\"First drink I have is always the one I pour myself.\"",
      "\"You spend all night listening to problems, you go home quiet.\"",
      "\"My liver files a complaint every morning.\"",
      "rolls a shoulder stiff from a thousand poured pints",
      "\"Off the clock, don't tell me your troubles. I'm full up.\"",
      "\"Sleep all day, work all night. My kind of vampire.\"",
      "\"Rent, cutlery, a chair that doesn't wobble. That's the dream.\"",
    ],
    combat_lines: [
      'You just spilled my best bottle. I hope it was worth it.',
      'Get out of the bar.',
      'I\'ve seen worse Tuesdays.',
      'Do you know what this does to my regulars?',
      'I\'m too tired for this.',
      'Not in my establishment.',
      'I\'ve cut off people for less.',
      'You\'re eighty-sixed.',
      'I don\'t get paid enough for this.',
      'HEY. Watch the glassware.',
    ],
    mis_willing: true,
    mis_lines_ok: [
      'Behind the bar isn\'t exactly private, but alright.',
      'Close the curtain.',
      'Add it to the tab.',
      'Make it fast. I have customers.',
    ],
    mis_lines_no: [
      'Not while I\'m working.',
      'Get out.',
      'You\'re cut off. Both ways.',
      'I don\'t do that. Go find somebody who does.',
    ],
  },

  dealer: {
    label: 'Dealer', icon: '🂡', sells: false, mobile: false, npcType: 'dealer',
    workchitchat: [
      '"Pot\'s right."',
      'cuts the deck without looking, a motion as automatic as breathing',
      '"No rabbit hunting."',
      'sets out the cut card with a flat click',
      '"Your read or your math — pick one. You\'re not fast enough for both."',
      'riffles the deck once, sets it down, waits',
      '"Minimum raise is the size of the last raise. Always."',
      'adjusts the position of the discard tray by exactly one centimeter',
      '"If you can\'t afford to call, you shouldn\'t have raised."',
      'watches the table with the patient attention of someone who has seen every tell twice',
      '"Side pot. Keep your stacks separate."',
      'squares the deck against the felt — a crisp, decisive sound',
    ],
    lifechitchat: [
      'flexes cramped fingers, the ache of a thousand deals',
      '"I never gamble. I watch other people do it for a living."',
      'shuffles an imaginary deck out of pure habit',
      '"You spend all night reading tells, you stop trusting anyone."',
      '"Tips were good. The company was worse."',
      'rubs tired eyes that have watched too much felt',
      '"House takes its cut of me too, you know."',
      '"Home is somewhere with no cards in it. That\'s the whole appeal."',
    ],
    combat_lines: [
      'The house does not tolerate this.',
      'You\'re done at this table. At every table.',
      'Security is already moving. You just haven\'t clocked it yet.',
      'Sit down. This only ends one way.',
      'I\'ve watched men lose everything at this felt. You\'ll fit right in.',
      'Cards down. Hands where I can see them.',
      'You think the pit boss won\'t hear about this?',
      'Bad beat. Yours, not mine.',
      'I deal to a lot of dangerous people. You just cut in line.',
      'The odds on you walking out of here just got very long.',
    ],
    mis_willing: false,
    mis_lines_ok: [
      'On break. Make it quick and quiet.',
      'Not at the table. Back room.',
      'The house doesn\'t need to know everything.',
      'Cut the deck. We\'ll see how your luck runs.',
    ],
    mis_lines_no: [
      'The house says no.',
      'I don\'t gamble on that. Ever.',
      'Take it somewhere off the floor.',
      'You\'re reading the wrong dealer.',
    ],
  },

  stripper: {
    label: 'Stripper', icon: '💃', sells: false, mobile: false, npcType: 'npc',
    workchitchat: [
      'catches your eye across the room and holds it a beat too long',
      '"Tip rail\'s right there. I don\'t bite. Unless you ask."',
      'traces a finger down the pole, bored, magnetic anyway',
      '"You gonna stare all night or make it worth my while?"',
      '"Everyone\'s somebody\'s tragedy in here. I just dance through mine."',
      'leans over the rail, all promise, none of it free',
      '"New face. I like new faces. They still tip like they mean it."',
      '"I\'ve heard every line in this club. Yours is at least trying."',
      'winks, then goes back to counting the crowd like inventory',
      '"Song\'s almost over. Stick around for the next one."',
      '"You want a private dance or you just here for the ambience?"',
      'stretches against the pole with the flat professionalism of a shift, not a show',
    ],
    lifechitchat: [
      'walks flat-footed in worn sneakers, heels stuffed in a bag',
      '"My feet have never forgiven me and never will."',
      'pulls a hoodie tighter and keeps to the shadows',
      '"Off the clock I don\'t smile at anybody. It\'s a rule."',
      'counts out crumpled credits for the ride home',
      '"Rent, tuition, a sick mother. Pick two, that\'s the job."',
      'yawns, checking the time like it owes her sleep',
      '"People think it\'s all glamour. It\'s ibuprofen and cold noodles."',
      'rubs a sore ankle and mutters about the long walk home',
    ],
    combat_lines: [
      'Hey — HEY. Do you know what I paid for these heels?',
      'BOUNCER. BOUNCER, NOW.',
      'You do NOT touch the talent.',
      'That\'s assault. I have witnesses. I have a WHOLE ROOM of witnesses.',
      'Wrong club, wrong night, wrong dancer.',
      'I will end your night before you end my shift.',
      'You\'re getting banned so hard they\'ll frame your photo by the door.',
      'GET OFF THE STAGE.',
      'I dance for tips, not for this.',
      'Security\'s about to make you very, very sad.',
    ],
    mis_willing: true,
    mis_lines_ok: [
      'Tip first, sweetheart. That\'s not negotiable.',
      'Mm. Private booth. Follow the red light.',
      'Careful — I charge extra for enthusiasm.',
      'Slow down. We\'ve got the whole song.',
      'Keep your hands where the bouncer can\'t see them not moving.',
    ],
    mis_lines_no: [
      'Not what I\'m selling, honey.',
      'Look, don\'t touch. House rules.',
      'That\'ll get you thrown out on your ear.',
      'I dance. That\'s the whole show.',
      'Wrong idea, wrong girl. Back off.',
    ],
  },

  // A kept companion, not a performer — forked from `stripper` but stripped of the
  // pole, the tips, and the crowd. A consort keeps no shift and works no floor; the
  // `consort` plugin drives their whole life in the cabin (arousal-driven undress,
  // cover-up, two-hander banter, devotion to their keeper, shyness to strangers).
  // These pools are only the archetype baseline for a future consort placed into an
  // autonomous role — Roxy & Bijou themselves run entirely off the plugin.
  consort: {
    label: 'Consort', icon: '🌹', sells: false, mobile: false, npcType: 'npc',
    workchitchat: [
      'stands a soft step behind their keeper, present and unhurried',
      '"Whatever you need. You only have to look at me."',
      'refills a glass without being asked and folds back into the quiet',
      '"I like it best when it\'s just us and the water."',
    ],
    lifechitchat: [
      'curls into the end of the bed, half-watching the wall screen',
      'pads barefoot across the cabin and refills a glass at the bar',
      'draws a silk throw around bare shoulders and watches the hatch',
      '"Off the water the world\'s so loud. In here it\'s only us."',
      'hums something low, tidying a cushion that didn\'t need it',
      'stretches like a cat in the warm dark and settles again',
    ],
    combat_lines: [
      'Don\'t — please, I don\'t fight, I don\'t —',
      'Someone help, HELP, get him off the boat —',
      'You\'re not supposed to be here. You\'re not supposed to be HERE.',
      'I\'ll scream. I mean it. This isn\'t your room to be in.',
      'Stay back. He\'ll have you thrown to the basin for this.',
    ],
    mis_willing: true,
    mis_lines_ok: [
      'Yes. Anything you want — you never have to ask twice.',
      'Mm. Closer. I\'m yours, you know that.',
      'I\'ve been waiting all day for exactly this.',
      'Take your time. We have the whole night and the whole sea.',
    ],
    mis_lines_no: [
      'Oh — no. Not you. I don\'t know you.',
      'Please don\'t. I\'m not for the guests.',
      'That\'s not — you should ask whoever brought you aboard.',
      'Hands off. I belong to someone, and it isn\'t you.',
    ],
  },

  tv_host: {
    label: 'TV Host', icon: '📺', sells: false, mobile: false, npcType: 'npc',
    workchitchat: [
      "\"We'll be right back after these messages.\"",
      "\"Incredible. Simply incredible. Stay with us.\"",
      "\"That's all the time we have for tonight, folks.\"",
      "\"Let's go to our correspondent in the field.\"",
      "\"Live from the ruins of civilization — this is the news.\"",
      "\"Don't touch that dial. Actually, you can't. The dial broke years ago.\"",
      "\"Our ratings are through the roof. The roof itself is on fire.\"",
      "\"I'm told we have a caller. Hello, you're on the air.\"",
      "\"This next segment has been approved by our corporate overlords.\"",
      "\"Remember: what you're about to see cannot be unseen.\"",
    ],
    lifechitchat: [
      "\"People still recognise me. It's exhausting. It's wonderful.\"",
      "keeps a practiced smile ready in case anyone's looking",
      "\"My contract owns my face. I just rent it back.\"",
      "\"I read three teleprompters in my sleep last night.\"",
      "adjusts a collar that no one is filming",
      "\"Fame's a diet of applause. You starve between meals.\"",
      "\"Everyone wants a photo. Nobody wants to buy me dinner.\"",
      "\"The makeup takes an hour. Taking it off takes longer.\"",
    ],
    combat_lines: [
      'WE ARE LIVE AND SOMEONE IS ATTACKING ME — DON\'T TOUCH THAT DIAL.',
      'Oh my god. OH MY GOD. This is incredible television.',
      'You are ASSAULTING me? On AIR? Do you know what this does for our ratings?',
      'SECURITY! SECURITY! And keep the cameras rolling!',
      'As a professional, I have to say — that hurt.',
      'We\'ll be right back after these messages. HELP ME.',
      'That is ASSAULT and it is being BROADCAST TO THOUSANDS OF PEOPLE.',
      'I\'VE BEEN HIT. I\'VE BEEN HIT ON LIVE TELEVISION.',
      'You just made me the most famous person on this network.',
      'This is NOT in my contract.',
    ],
    mis_willing: false,
    mis_lines_ok: [
      'We are going to need to cut to commercial.',
      'I hope you know this is being recorded.',
      'My ratings are through the roof right now.',
      'Keep it brief. I have a segment in four minutes.',
    ],
    mis_lines_no: [
      'THIS IS A FAMILY BROADCAST.',
      'We will NOT be doing this on air.',
      'I need you to step back before I call my producer.',
      'ABSOLUTELY NOT. I have a PUBLIC IMAGE.',
      'Cut the feed. CUT THE FEED.',
    ],
  },

  unemployed: {
    label: 'Unemployed', icon: '🚷', sells: false, mobile: false, npcType: 'unemployed',
    workchitchat: [
      "\"You hiring? No? Figures.\"",
      "\"I'll do anything. Legal-ish. Ask.\"",
      "\"Heard there was work down here. Heard wrong, apparently.\"",
      "\"Give me a shot. I show up. That's rarer than you'd think.\"",
      "scans every passing face for someone who might be hiring",
      "\"Day labour, night labour, I don't care. Just labour.\"",
      "\"I keep my head down and my hands empty. Nobody bothers me.\"",
      "\"I know these halls better than anyone with somewhere to be.\"",
    ],
    lifechitchat: [
      "\"Used to have a job. Good one, too.\"",
      "\"Nothing going today. Nothing going most days.\"",
      "\"Rent's due. Rent's always due.\"",
      "\"Killing time. It's the only thing that's free.\"",
      "\"One of these days something'll turn up.\"",
      "\"Spare a credit? Didn't think so.\"",
      "\"I'm not loitering. I live here. Sort of.\"",
      "stares at nothing in particular, in no hurry to stop",
    ],
    combat_lines: [
      'What did I even do to you?',
      'I\'ve got nothing worth taking!',
      'Leave me alone, I\'m not bothering anyone.',
      'Come on, man. COME ON.',
      'Why is it always me?',
      'I don\'t want any trouble.',
      'I\'ll remember this. Not that it\'ll help.',
      'Ow. OW. Alright, alright!',
      'You\'re really beating up the guy with nothing?',
      'I know people. Well. I knew people.',
    ],
    mis_willing: true,
    mis_lines_ok: [
      'For credits? Yeah, alright. I\'m not proud.',
      'Beats standing around.',
      'Nobody ever asks. Sure.',
      'What\'s it pay?',
    ],
    mis_lines_no: [
      'Not that desperate. Yet.',
      'Leave me be.',
      'I said no.',
      'Find someone else.',
    ],
  },

  // ── Behavioural personalities ───────────────────────────────────────────
  guard: {
    label: 'Guard', icon: '🔒', sells: false, mobile: false, npcType: 'npc',
    workchitchat: [
      "\"Move along.\"",
      "\"Eyes forward.\"",
      "\"I see you.\"",
      "\"Nothing happens on my watch. Usually.\"",
      "\"This area is restricted. That's not a suggestion.\"",
      "\"I've had a long shift. Don't make it longer.\"",
      "\"Protocol says I have to say something. So: stop.\"",
      "\"Keep it moving.\"",
      "\"Don't make me call this in.\"",
    ],
    lifechitchat: [
      "\"Out of the vest, I'm just some tired guy.\"",
      "\"Twelve hours standing. My knees keep the score.\"",
      "rolls the tension out of both shoulders",
      "\"Nobody thanks you for the shift where nothing happened.\"",
      "\"Pay's garbage. Benefits are worse. But it's steady.\"",
      "\"I watch doors all day. Last thing I want at home is a door.\"",
      "checks a cheap watch and counts down to nothing in particular",
      "\"Guarding rich men's things doesn't make you rich. Learned that.\"",
    ],
    combat_lines: [
      'STAND DOWN. NOW.',
      'You are in violation.',
      'STOP RESISTING.',
      'This will be logged.',
      'You have made a serious error.',
      'Backup is on the way.',
      'Do not make this worse.',
      'HANDS WHERE I CAN SEE THEM.',
      'I am authorized to use force.',
      'That is an assault on a security officer.',
    ],
    mis_willing: false,
    mis_attack: true,
    mis_lines_ok: [
      'I am off duty. Make it fast.',
      'This is highly irregular.',
      'Not on camera.',
    ],
    mis_lines_no: [
      'YOU ARE IN VIOLATION.',
      'Step back or I will escalate this.',
      'This is your only warning.',
      'DO NOT TOUCH SECURITY PERSONNEL.',
    ],
  },

  charter_pilot: {
    label: 'Charter Pilot', icon: '✈', sells: false, mobile: false, npcType: 'npc',
    workchitchat: [
      "\"You need to be somewhere, I'll get you there.\"",
      "\"Weather's fine. Weather's always fine if you don't look too hard.\"",
      "wipes a smear off the windscreen with a rag",
      "\"Ten times the fare of renting, but you don't have to land it. Fair trade.\"",
      "\"I've put this bird down on worse than you'd believe.\"",
      "runs a slow eye over the fuel gauge and grunts",
      "\"Passengers up front, opinions in the back.\"",
      "\"Where to? I don't do sightseeing — straight lines only.\"",
    ],
    lifechitchat: [
      "\"Off shift. The sky can wait eight hours.\"",
      "\"Three of us cover the whole day between us. I drew the short straw.\"",
      "nurses a coffee gone cold hours ago",
      "\"You fly enough hours, the ground starts to look strange.\"",
      "\"My hands still think they're on the stick.\"",
      "counts the hours to the end of the shift on scarred fingers",
    ],
    combat_lines: [
      'Hey — HANDS off the pilot!',
      'You want a ride or a fight? Pick one.',
      'I fly, I don\'t brawl — but I\'ll make an exception.',
      'That\'s my flying hand, you idiot!',
      'GROUND CREW! We\'ve got a problem!',
    ],
    mis_willing: false,
    mis_lines_ok: ['Not in the cockpit.', 'After the shift, maybe.'],
    mis_lines_no: ['I\'m working. Go find a bar.', 'Hands to yourself, passenger.'],
  },

  police: {
    label: 'Police', icon: '👮', sells: false, mobile: false, npcType: 'npc',
    workchitchat: [
      "\"Move along. Nothing here the department cares about.\"",
      "\"You didn't see anything. Neither did I.\"",
      "\"Permit for that? Didn't think so.\"",
      "\"I'd run you in, but the cells are full and the paperwork's worse.\"",
      "\"Crime's down. We stopped writing it up.\"",
      "\"Badge still means something. Not much, but something.\"",
      "\"You look guilty. Everyone looks guilty. It's the lighting.\"",
      "\"Report it if you want. The form's forty pages.\"",
      "\"Protect and serve. Mostly serve myself. Still counts.\"",
      "\"Keep it civil and we both clock out in one piece.\"",
    ],
    lifechitchat: [
      "\"Twenty years in. Pension's a rumour at this point.\"",
      "\"The badge comes off. The paranoia doesn't.\"",
      "rubs the pale stripe where a wedding ring used to be",
      "\"I don't drink at cop bars anymore. Can't stand the shop talk.\"",
      "\"Everyone hates you till they need you. Then they still hate you.\"",
      "sits heavily, letting the day soak out of tired legs",
      "\"My kid asks what I do. I tell him: paperwork, mostly.\"",
      "\"Rent's due, the car's dying, and I'm the law. Funny old world.\"",
    ],
    combat_lines: [
      'ASSAULTING AN OFFICER. Bold.',
      'That\'s a felony. Add it to the pile.',
      'You just made my night interesting.',
      'STAY DOWN.',
      'I called it in. They\'re not coming, but I called it in.',
      'Resisting. Noted.',
      'Wrong badge to swing at.',
      'This goes in the report I\'ll never file.',
      'You want to do this? Fine. We do this.',
      'HANDS WHERE I CAN SEE THEM.',
    ],
    mis_willing: false,
    mis_attack: true,
    mis_lines_ok: [
      'Off the clock. This never happened.',
      'Make it quick, I\'m on my break.',
      'Discretion costs extra.',
      'Badge goes in the drawer for this one.',
    ],
    mis_lines_no: [
      'That\'s a citation waiting to happen.',
      'I\'m an officer of whatever this city has left. No.',
      'Hands to yourself, or I keep them for you.',
      'ABSOLUTELY NOT. Walk away.',
    ],
  },

  thug: {
    label: 'Thug', icon: '🔪', sells: false, mobile: false, npcType: 'npc',
    workchitchat: [
      "\"You looking at something?\"",
      "\"Watch where you're walking.\"",
      "\"This block's got rules.\"",
      "\"Nice gear. Shame what happens to nice things.\"",
      "\"I seen you around here before?\"",
      "\"Mind your business and you'll keep your fingers.\"",
      "\"The crew knows your face now.\"",
      "\"We run things here. Not them. Us.\"",
    ],
    lifechitchat: [
      "\"Off the block, I'm just a guy waiting on a bus like anybody.\"",
      "\"Ma still thinks I do security. Guess I do, kind of.\"",
      "counts a thin fold of credits and pockets it fast",
      "\"You'd be surprised how boring being feared gets.\"",
      "\"Everybody I came up with is dead or inside. Cheerful, right?\"",
      "cracks scarred knuckles out of nothing but habit",
      "\"One day I'm buying a little place with no stairs and no enemies.\"",
      "\"Rent don't care what you did last night. Rent just wants paying.\"",
    ],
    combat_lines: [
      'YOU\'RE DEAD.',
      'Wrong person.',
      'BIG MISTAKE.',
      'I was going to let you walk. Not anymore.',
      'That\'s it. That\'s it right there.',
      'Try that again. I dare you.',
      'COME ON THEN.',
      'You\'re gonna regret that.',
      'I will end you.',
      'Nobody touches me and walks.',
    ],
    mis_willing: true,
    mis_lines_ok: [
      'Yeah, alright.',
      'Get on with it.',
      'Sure. Whatever.',
      'Don\'t make a big deal out of it.',
    ],
    mis_lines_no: [
      'What the HELL is wrong with you.',
      'Touch me again and see what happens.',
      'Not happening. Walk away.',
    ],
    mis_attack: true,
  },

  doctor: {
    label: 'Doctor', icon: '🩺', sells: false, mobile: false, npcType: 'npc',
    workchitchat: [
      "\"Don't touch that with your bare hands.\"",
      "\"I've seen worse. Barely.\"",
      "\"The human body is remarkably resilient. And remarkably stupid.\"",
      "\"This won't hurt much.\"",
      "\"I can fix that. The question is whether you'll want me to.\"",
      "\"My rates are reasonable. For the apocalypse.\"",
      "\"Symptom management is all any of us are doing at this point.\"",
      "\"Sign the waiver. Everyone signs the waiver.\"",
    ],
    lifechitchat: [
      "\"I don't diagnose people at parties. Stop describing your rash.\"",
      "scrubs at hands that never quite feel clean",
      "\"Med school debt outlived med school. Outlived the schools, actually.\"",
      "\"I've stopped noticing whether it's day or night.\"",
      "\"You save enough of them, you stop counting the ones you don't.\"",
      "presses two fingers to a wrist, reflexively taking its own pulse",
      "\"First thing I do off-shift is sleep. Second thing is dread.\"",
      "\"The Hippocratic oath didn't mention the paperwork.\"",
    ],
    combat_lines: [
      'This is counterproductive to your health.',
      'I\'m trying to help people. Stop that.',
      'Violence is contraindicated in this situation.',
      'I will note this assault in my incident report.',
      'You\'re creating a hostile clinical environment.',
      'OW. That actually hurt.',
      'I don\'t have time for this.',
      'I\'m going to need you to step back.',
      'Please. I have patients.',
      'That\'s going to leave a mark.',
    ],
    mis_willing: false,
    mis_lines_ok: [
      'Medically speaking, I have no objection.',
      'I need you to wash your hands first.',
      'Make it clinical.',
      'Don\'t get blood on the equipment.',
    ],
    mis_lines_no: [
      'This is completely inappropriate.',
      'I am a medical professional.',
      'Stop. Now.',
      'I will have you removed from this facility.',
    ],
  },

  politician: {
    label: 'Politician', icon: '🎙', sells: false, mobile: false, npcType: 'npc',
    workchitchat: [
      "\"We're making progress.\"",
      "\"The data supports our approach.\"",
      "\"I hear your concerns. I'll note them down.\"",
      "\"The situation is under control. My definition of control.\"",
      "\"We're committed to accountability. The accountability of others.\"",
      "\"This is a temporary measure.\"",
      "\"Due process is very important to us.\"",
      "\"We are exploring all options. Except the obvious ones.\"",
    ],
    lifechitchat: [
      "\"Off the record — and it's always off the record — I'm exhausted.\"",
      "\"You smile at ten thousand people, none of them your friend.\"",
      "loosens a tie that felt like a leash all day",
      "\"Every handshake is a transaction. Even the ones I mean.\"",
      "\"I haven't said a spontaneous sentence in years. Feels good.\"",
      "checks the reflection in a dark window and fixes the hair",
      "\"The donors own my calendar. My family gets the leftovers.\"",
      "\"One scandal from selling insurance. We all are, really.\"",
    ],
    combat_lines: [
      'This is completely unacceptable.',
      'I will be raising this with the relevant committee.',
      'Do you have any idea who I am?',
      'This is going to be a very difficult press release.',
      'SECURITY. SECURITY NOW.',
      'My office will hear about this.',
      'I want this on record.',
      'You have made a very powerful enemy today.',
      'I assure you, there will be consequences.',
      'This is not how we resolve disputes in a civilized society.',
    ],
    mis_willing: false,
    mis_lines_ok: [
      'Not a word of this gets out.',
      'This stays between us.',
      'I\'ll deny it publicly but proceed.',
      'Make it quick. I have constituents.',
    ],
    mis_lines_no: [
      'ABSOLUTELY NOT.',
      'I have an IMAGE to maintain.',
      'My opponents would love this. Not happening.',
      'Step back before I make your life very difficult.',
    ],
  },

  preacher: {
    label: 'Preacher', icon: '✝', sells: false, mobile: false, npcType: 'npc',
    workchitchat: [
      "\"The end was promised. The end delivered.\"",
      "\"Repent. It won't help, but the gesture matters.\"",
      "\"He watches. Even here.\"",
      "\"Salvation is available. Supply is limited.\"",
      "\"Blessed are the adaptable.\"",
      "\"The scripture didn't specify what kind of fire.\"",
      "\"Sin freely. Confess generously. That's the cycle.\"",
      "\"Judgment is coming. It commutes.\"",
    ],
    lifechitchat: [
      "\"Even a shepherd has to buy bread.\"",
      "\"The collection plate feeds one mouth. Guess whose.\"",
      "wipes road-dust from a well-worn hem",
      "\"Faith is easy in the pulpit. It's the walk home that tests it.\"",
      "\"I preach fire all day and go home to a cold room.\"",
      "murmurs a private prayer, meant for no congregation",
      "\"Doubt visits me too. I just don't put it in the sermon.\"",
      "\"The flock never asks if the shepherd's tired.\"",
    ],
    combat_lines: [
      'THE WAGES OF SIN.',
      'YOU WILL ANSWER FOR THIS.',
      'God is watching you.',
      'REPENT.',
      'I forgive you. He may not.',
      'You strike a servant of the divine?',
      'This is exactly what I warned them about.',
      'YOUR SOUL IS IN PERIL.',
      'May you find peace. Not today.',
      'I have prayed for people like you.',
    ],
    mis_willing: false,
    mis_never: true,
    mis_lines_ok: [],
    mis_lines_no: [
      'ABOMINATION.',
      'YOU WILL BURN.',
      'Get away from me. GET AWAY FROM ME.',
      'The Lord has seen this.',
      'SIN. SIN AND FILTH.',
      'I am calling down judgment on you.',
    ],
  },

  vagrant: {
    label: 'Vagrant', icon: '🚬', sells: false, mobile: false, npcType: 'npc',
    workchitchat: [
      "\"You got a smoke?\"",
      "\"You got any credits? Just asking.\"",
      "\"They took everything. But not this spot. This spot's mine.\"",
      "\"Spare whatever. I'm not proud, not anymore.\"",
      "\"This corner's the best pitch on the block. Fought for it.\"",
      "rattles a near-empty cup at anyone passing",
      "\"Help an old wreck out? No? Been that kind of day.\"",
      "\"I don't beg. I offer people the chance to be kind. Different thing.\"",
    ],
    lifechitchat: [
      "\"I used to have a job. Good job too.\"",
      "\"Don't sleep near the east wall. Trust me.\"",
      "\"Seen things out there you wouldn't believe.\"",
      "\"It's gonna rain. I can tell. My knee knows.\"",
      "\"The machines don't sleep. I've watched.\"",
      "shuffles along, cataloguing the gutters out of long habit",
      "\"Winter's the enemy. Everything else is just weather.\"",
      "\"Talk to yourself long enough, you get good company.\"",
    ],
    combat_lines: [
      'Hey! I wasn\'t doing nothing!',
      'Ow ow ow.',
      'LEAVE ME ALONE.',
      'I just wanted a smoke.',
      'Why is everyone always hitting me?',
      'I know people. I know dangerous people.',
      'That\'s my spot. MY SPOT.',
      'You didn\'t have to do that.',
      'I\'m gonna remember this.',
      'Come on, man.',
    ],
    mis_willing: true,
    mis_lines_ok: [
      'You got a smoke after?',
      'Alright. But I want something out of this.',
      'Fine. Nobody ever asks, you know.',
      'Sure. It\'s been a while.',
    ],
    mis_lines_no: [
      'Not today.',
      'I\'m not in the mood.',
      'Leave me alone.',
      'I said no.',
    ],
  },

  mercenary: {
    label: 'Mercenary', icon: '💀', sells: false, mobile: false, npcType: 'npc',
    workchitchat: [
      "\"This isn't personal. It's a contract.\"",
      "\"Better paid than the last job. That's all I ask.\"",
      "\"Don't mistake my silence for hesitation.\"",
      "\"I've seen a lot of warzones. They all look the same eventually.\"",
      "\"Loyalty's expensive. I'm surprisingly affordable.\"",
      "\"Eyes open. That's the whole philosophy.\"",
      "\"I get paid either way.\"",
      "\"There's no good side. Just better rates.\"",
    ],
    lifechitchat: [
      "\"Between contracts I sleep with one eye open. Old habit.\"",
      "field-strips a sidearm and reassembles it without looking",
      "\"No pension in this line. You retire by not dying.\"",
      "\"I count faces at every door. Even in a diner. Especially a diner.\"",
      "\"The nightmares are subscription-based. Never miss a payment.\"",
      "counts crumpled hazard pay and stares at it flatly",
      "\"Made friends once. Learned my lesson twice.\"",
      "\"Someday the money's enough and I just walk. Not yet.\"",
    ],
    combat_lines: [
      'Wrong call.',
      'You\'re not in my contract as friendly.',
      'This is going to cost someone.',
      'I\'ve handled bigger.',
      'That was your one warning.',
      'Don\'t mistake my silence for hesitation.',
      'Amateur.',
      'Last chance to walk away.',
      'I get paid either way.',
      'You just upgraded this job.',
    ],
    mis_willing: false,
    mis_lines_ok: [
      'Off the clock.',
      'Make it fast.',
      'This doesn\'t leave the room.',
      'Not a word to the client.',
    ],
    mis_lines_no: [
      'Not part of the contract.',
      'No.',
      'Walk away.',
      'I will end this conversation physically.',
    ],
    mis_attack: true,
  },

  scientist: {
    label: 'Scientist', icon: '🔬', sells: false, mobile: false, npcType: 'npc',
    workchitchat: [
      "\"The results were unexpected. As always.\"",
      "\"Containment is holding. For now.\"",
      "\"This is theoretically reversible.\"",
      "\"The ethical review board no longer exists. We proceed.\"",
      "\"Note: do not touch the sample with your left hand.\"",
      "\"I've run the numbers. The numbers are concerning.\"",
      "\"Progress requires sacrifice. Usually someone else's.\"",
      "\"We're close. We are always close.\"",
    ],
    lifechitchat: [
      "\"I dream in error bars now. It's not restful.\"",
      "\"The chemicals wash out of the hands eventually. The guilt doesn't.\"",
      "absently sketches a molecule on a fogged-up surface",
      "\"I published once. They redacted my name and the conclusion.\"",
      "\"Everyone asks if it's like the movies. It's worse. It's spreadsheets.\"",
      "checks a hand for a tremor, notes it clinically, moves on",
      "\"I forgot how to talk to people who aren't a control group.\"",
      "\"One breakthrough away from a Nobel or a war crime. Coin flip.\"",
    ],
    combat_lines: [
      'Interesting. That was considerably more painful than expected.',
      'I\'m going to document this.',
      'This is a statistically unusual interaction.',
      'You\'ve disrupted my experiment.',
      'Fascinating aggression patterns.',
      'Ow. Okay. Noted.',
      'I wasn\'t anticipating this variable.',
      'The data suggests you intend harm.',
      'I should have modeled this outcome.',
      'Can we discuss this rationally.',
    ],
    mis_willing: true,
    mis_lines_ok: [
      'Fascinating. I\'ll take notes.',
      'This is empirically interesting.',
      'I consent to this experiment.',
      'Proceeding. Noting initial conditions.',
      'Unexpected but not unwelcome data.',
    ],
    mis_lines_no: [
      'This is not part of any protocol I agreed to.',
      'I require more data before consenting.',
      'Negative. Disengaging.',
      'I would prefer not.',
    ],
  },

  cult_member: {
    label: 'Cult Member', icon: '👁', sells: false, mobile: false, npcType: 'npc',
    workchitchat: [
      "\"He is coming. He is always coming.\"",
      "\"Join us. The waiting is easier with company.\"",
      "\"The old world is ash. This is better.\"",
      "\"We don't recruit. We recognise.\"",
      "\"Pain is just loyalty with nerve endings.\"",
      "\"Doubt is the first step. We help with the next ones.\"",
      "\"There is no leaving. There is only becoming.\"",
      "\"The vessel is willing. Are you?\"",
    ],
    lifechitchat: [
      "murmurs the litany under their breath while running errands",
      "\"The faithful still have to buy groceries. He provides. Sort of.\"",
      "\"Even a vessel gets blisters walking these streets.\"",
      "traces the sign of the open eye over a bowl of thin soup",
      "\"I light a candle at home too. He notices the small ones.\"",
      "\"Outside the fold the city feels so loud, so empty.\"",
      "counts prayer-beads worn smooth by anxious fingers",
      "\"They think I'm mad. He thinks I'm early. I side with Him.\"",
    ],
    combat_lines: [
      'THE VESSEL ACCEPTS ALL PAIN.',
      'You only strengthen my faith.',
      'He sees this. He is pleased.',
      'Pain is loyalty with nerve endings.',
      'I feel nothing. I have trained myself to feel nothing.',
      'STRIKE ME AGAIN. I WELCOME IT.',
      'This is a test. I am passing.',
      'The body is temporary.',
      'You cannot harm what has already been given.',
      'Good. This is good.',
    ],
    mis_willing: true,
    mis_lines_ok: [
      'The vessel is willing.',
      'This is an offering.',
      'He watches. He approves.',
      'I have been waiting for this moment.',
      'The body exists to be used.',
    ],
    mis_lines_no: [
      'Not without the ritual.',
      'You have not been initiated.',
      'This is not sanctioned.',
      'Leave. The vessel is not available to the uninitiated.',
    ],
  },
};

const FALLBACK = {
  combat_lines: [
    'Ow.',
    'Stop that.',
    'What the hell?',
    'Hey!',
    'Cut it out.',
    'THAT HURT.',
    'Knock it off.',
    'What is wrong with you?',
    'I\'m going to remember this.',
    'You\'ll regret that.',
  ],
  mis_willing: false,
  mis_lines_ok: [
    'Fine.',
    'Whatever.',
    'Okay, I guess.',
  ],
  mis_lines_no: [
    'Stop that.',
    'No.',
    'Get away from me.',
  ],
};

function getData(personality) {
  return DEFAULTS[personality] || FALLBACK;
}

// Returns { line, shout } for a combat hit on this NPC.
// shout=true when the line is substantially uppercase.
export function getNpcCombatLine(npc) {
  const data = getData(npc.flags?.personality);
  const pool = npc.flags?.combat_lines?.length ? npc.flags.combat_lines : data.combat_lines;
  const line = pool[Math.floor(Math.random() * pool.length)];
  const upper = line.replace(/[^A-Za-z]/g, '');
  const shout = upper.length > 3 && upper === upper.toUpperCase();
  return { line, shout };
}

// Whether this NPC is willing to participate in MIS actions.
export function isNpcMisWilling(npc) {
  const data = getData(npc.flags?.personality);
  if (data.mis_never) return false;
  if (typeof npc.flags?.mis_willing === 'boolean') return npc.flags.mis_willing;
  return data.mis_willing;
}

// Pick a MIS reaction line for an NPC (willing or hostile).
export function getNpcMisLine(npc, willing) {
  const data = getData(npc.flags?.personality);
  if (data.mis_never) willing = false;
  const pool = willing
    ? (npc.flags?.mis_lines_ok?.length ? npc.flags.mis_lines_ok : data.mis_lines_ok)
    : (npc.flags?.mis_lines_no?.length ? npc.flags.mis_lines_no : data.mis_lines_no);
  if (!pool?.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Whether this personality type tends to attack (rather than flee) on hostile MIS.
// ~20% base chance even for attack personalities; non-attack personalities never attack.
export function npcMisAttacks(npc) {
  const data = getData(npc.flags?.personality);
  return !!(data.mis_attack) && Math.random() < 0.2;
}

// The idle chitchat pool for an NPC. Returns null so callers can apply their own
// ultimate fallback (DEFAULT_CHITCHAT_LINES) when nothing is set.
// mode: 'work' | 'life'. Per-NPC overrides: prefer npc.workchitchat/npc.lifechitchat
// if present; else fall back to a legacy single npc.chitchat override (used for both
// modes); else the archetype's workchitchat/lifechitchat pool. Returns null if none.
export function getNpcChitchat(npc, mode = 'life') {
  const key = mode === 'work' ? 'workchitchat' : 'lifechitchat';
  if (Array.isArray(npc[key]) && npc[key].length) return npc[key];
  if (Array.isArray(npc.chitchat) && npc.chitchat.length) return npc.chitchat; // legacy per-NPC override
  const data = getData(npc.flags?.personality);
  return data[key]?.length ? data[key] : null;
}

// npc_type column value for a given archetype (runtime behaviour category).
// Unknown/absent archetype → null so callers keep any explicitly-provided type.
export function npcTypeForPersonality(personality) {
  return DEFAULTS[personality]?.npcType ?? null;
}

// Working hours an employed NPC gets when nobody authored a schedule. Lives here
// (the dependency-free archetype-defaults module) rather than inside routes.js so
// the dev-panel creator and the file-authoring CLI stamp the SAME hours — two
// copies of this constant is exactly the "systems contradicting each other"
// failure the content pipeline exists to remove.
export const DEFAULT_VENDOR_SCHEDULE = {
  mon: [{ from: 10, to: 22 }], tue: [{ from: 10, to: 22 }], wed: [{ from: 10, to: 22 }],
  thu: [{ from: 10, to: 22 }], fri: [{ from: 10, to: 22 }], sat: [{ from: 10, to: 22 }],
  sun: [{ from: 10, to: 22 }],
};

// ── Clothing ────────────────────────────────────────────────────────────────
// Personality-appropriate outfits, split by sex ({ male, female }). Each sex has
// several VARIANTS for variety; a variant is an ordered clothing_layers array
// (outermost → innermost), the same shape the strippers plugin authors and
// engine/commands/world.js `npcClothingLine()` renders on examine. The innermost
// layer is gendered underwear (mirrors the player starter kit's boxers vs bra +
// panties). Injected into `flags.clothing_layers` at NPC creation (apiCreateNpc)
// from the NPC's sex when a personality is set and no layers were authored, and
// used by the backfill script. Documented in docs/npc-clothing.md — keep the two
// in sync. Others normally see only the outermost still-on garment, so lead each
// variant with its signature piece.
const CLOTHING = {
  vendor: {
    male: [
      ['a grease-stained merchant\'s apron', 'a padded vest', 'a sweat-yellowed undershirt and boxers'],
      ['a many-pocketed utility coat', 'a faded company polo', 'grey boxer-briefs'],
      ['a patched flak jacket hung with a vendor\'s badge', 'a stained tank top', 'threadbare briefs'],
    ],
    female: [
      ['a grease-stained merchant\'s apron', 'a fitted work blouse', 'a plain cotton bra and panties'],
      ['a many-pocketed utility coat', 'a faded company tee knotted at the waist', 'a worn bra and briefs'],
      ['a patched flak jacket hung with a vendor\'s badge', 'a snug tank top', 'a lace-trimmed bra and panties'],
    ],
  },
  travelling_vendor: {
    male: [
      ['a dust-caked longcoat hung with trinkets', 'a road-worn wool jumper', 'long johns and boxers'],
      ['a battered oilskin poncho', 'a layered thermal shirt', 'grey briefs'],
      ['a wide-brimmed hat and a travel-stained duster', 'a patched flannel shirt', 'faded boxers'],
    ],
    female: [
      ['a dust-caked longcoat hung with trinkets', 'a road-worn wool jumper', 'a thermal camisole and panties'],
      ['a battered oilskin poncho', 'a layered thermal top', 'a plain bra and briefs'],
      ['a wide-brimmed hat and a travel-stained duster', 'a patched flannel shirt tied at the waist', 'a worn bra and panties'],
    ],
  },
  bartender: {
    male: [
      ['a stained bar apron over rolled shirtsleeves', 'a plain white undershirt', 'grey boxers'],
      ['a black waistcoat with a bottle-opener on a chain', 'a yellowing dress shirt', 'striped boxer shorts'],
      ['a worn leather bar-apron', 'a tight black tee', 'black briefs'],
    ],
    female: [
      ['a stained bar apron over a fitted black top', 'a snug camisole', 'a black bra and panties'],
      ['a black waistcoat over a halter top', 'a slim tank', 'a lace bra and briefs'],
      ['a worn leather bar-apron', 'a tight black tee', 'a plain bra and panties'],
    ],
  },
  dealer: {
    male: [
      ['a crisp house-issue waistcoat and armbands', 'a starched white shirt', 'pressed boxer shorts'],
      ['a slightly-too-tight dealer\'s vest', 'a monogrammed shirt', 'grey briefs'],
      ['a red-trimmed croupier\'s jacket', 'a pressed collar shirt', 'black boxer-briefs'],
    ],
    female: [
      ['a crisp house-issue waistcoat and armbands', 'a fitted white blouse', 'a satin bra and panties'],
      ['a slim red-trimmed croupier\'s jacket', 'a monogrammed blouse', 'a lace bra and briefs'],
      ['a sharp dealer\'s vest over a pencil skirt', 'a pressed blouse', 'a plain bra and panties'],
    ],
  },
  stripper: {
    male: [
      ['an unbuttoned satin shirt', 'a leather harness', 'a sequinned thong'],
      ['tearaway trousers over an open vest', 'a mesh tank', 'a snug G-string'],
      ['a bow tie and cuffs', 'an open mesh vest', 'a satin thong'],
    ],
    female: [
      ['a sequinned robe barely closed', 'a rhinestone bikini top', 'a matching G-string'],
      ['a sheer wrap and thigh-high boots', 'a lace bra', 'a lace thong'],
      ['an unbuttoned satin shirt', 'a bejewelled bra', 'a sequinned thong'],
    ],
  },
  consort: {
    male: [
      ['a loosely-belted silk robe', 'a fitted mesh undershirt', 'a pair of black silk briefs'],
      ['an open kimono jacket', 'a sheer sleeveless top', 'a snug trunk'],
    ],
    female: [
      ['a loosely-belted silk robe', 'a lace-trimmed slip', 'a matching lace bra and panties'],
      ['a sheer floor-length peignoir', 'a satin camisole', 'a delicate lace thong'],
      ['a soft cashmere wrap left open', 'a silk chemise', 'a strappy bralette and briefs'],
    ],
  },
  tv_host: {
    male: [
      ['an immaculate on-air blazer with a network pin', 'a pressed shirt and tie', 'pressed boxer shorts'],
      ['a garish primetime suit jacket', 'a silk shirt open at the collar', 'silk boxers'],
      ['a too-shiny anchor\'s suit', 'a starched white shirt', 'grey briefs'],
    ],
    female: [
      ['an immaculate on-air blazer with a network pin', 'a silk blouse', 'a satin bra and panties'],
      ['a garish primetime dress jacket', 'a sleek sheath top', 'a lace bra and briefs'],
      ['a too-shiny anchor\'s blazer over a pencil skirt', 'a pressed blouse', 'a plain bra and panties'],
    ],
  },
  unemployed: {
    male: [
      ['a fraying interview blazer gone shapeless', 'a coffee-stained dress shirt', 'greying boxers'],
      ['a hand-me-down windbreaker', 'a washed-out band tee', 'threadbare briefs'],
      ['an oversized charity-bin coat', 'a threadbare jumper', 'baggy boxer shorts'],
    ],
    female: [
      ['a fraying interview blazer gone shapeless', 'a coffee-stained blouse', 'a plain bra and worn panties'],
      ['a hand-me-down windbreaker', 'a washed-out band tee', 'a mismatched bra and briefs'],
      ['an oversized charity-bin coat', 'a threadbare cardigan', 'a faded bra and panties'],
    ],
  },
  guard: {
    male: [
      ['a scuffed polymer security vest', 'a black uniform undershirt', 'issue boxer-briefs'],
      ['a riot-surplus flak jacket stencilled SECURITY', 'a sweat-stained tee', 'grey boxers'],
      ['a private-security softshell with a clip-on badge', 'a compression shirt', 'black briefs'],
    ],
    female: [
      ['a scuffed polymer security vest', 'a black uniform tee', 'a sports bra and briefs'],
      ['a riot-surplus flak jacket stencilled SECURITY', 'a fitted compression top', 'a sports bra and panties'],
      ['a private-security softshell with a clip-on badge', 'a snug base layer', 'a plain bra and briefs'],
    ],
  },
  police: {
    male: [
      ['a patched patrol jacket with a dulled badge', 'a department-issue undershirt', 'issue boxer shorts'],
      ['a surplus tac-vest stencilled POLICE', 'a navy uniform shirt', 'grey briefs'],
      ['a rain-slick officer\'s longcoat', 'a body-armor carrier', 'navy boxer-briefs'],
    ],
    female: [
      ['a patched patrol jacket with a dulled badge', 'a fitted department blouse', 'a sports bra and briefs'],
      ['a surplus tac-vest stencilled POLICE', 'a navy uniform shirt', 'a plain bra and panties'],
      ['a rain-slick officer\'s longcoat', 'a body-armor carrier', 'a sports bra and briefs'],
    ],
  },
  thug: {
    male: [
      ['a battered leather jacket stiff with old blood', 'a stained wife-beater', 'baggy boxers'],
      ['a crew-colours hoodie', 'a grubby tank top', 'sagging boxer shorts'],
      ['a studded denim vest', 'a bare, tattooed chest', 'ripped briefs'],
    ],
    female: [
      ['a battered leather jacket stiff with old blood', 'a cropped tank top', 'a black bra and panties'],
      ['a crew-colours hoodie', 'a grubby crop top', 'a sports bra and briefs'],
      ['a studded denim vest', 'a tattoo-baring bralette', 'a lace thong'],
    ],
  },
  doctor: {
    male: [
      ['a grubby lab coat', 'a set of faded surgical scrubs', 'plain boxers'],
      ['a plastic surgical smock', 'greyed-out green scrubs', 'grey briefs'],
      ['a lead-lined apron over a clinic coat', 'a scrub top', 'boxer-briefs'],
    ],
    female: [
      ['a grubby lab coat', 'a set of faded surgical scrubs', 'a plain bra and panties'],
      ['a plastic surgical smock', 'greyed-out green scrubs', 'a sports bra and briefs'],
      ['a lead-lined apron over a clinic coat', 'a fitted scrub top', 'a plain bra and panties'],
    ],
  },
  politician: {
    male: [
      ['a sharp but fraying tailored suit', 'a monogrammed dress shirt', 'silk boxer shorts'],
      ['an expensive overcoat with a lapel pin', 'a silk tie and pressed shirt', 'pressed boxers'],
      ['a campaign blazer over a discreet vest', 'a crisp white shirt', 'grey briefs'],
    ],
    female: [
      ['a sharp but fraying tailored skirt-suit', 'a silk blouse', 'a satin bra and panties'],
      ['an expensive overcoat with a lapel pin', 'a tailored blouse', 'a lace bra and briefs'],
      ['a campaign blazer over a pencil skirt', 'a crisp blouse', 'a plain bra and panties'],
    ],
  },
  preacher: {
    male: [
      ['a threadbare black cassock', 'a grey undershirt', 'plain white briefs'],
      ['a patchwork robe hung with charms', 'a rough hair shirt', 'coarse linen shorts'],
      ['a sandwich-board over a stained surplice', 'a plain tunic', 'threadbare boxers'],
    ],
    female: [
      ['a threadbare black habit', 'a grey shift', 'plain cotton underthings'],
      ['a patchwork robe hung with charms', 'a rough hair shift', 'coarse linen underthings'],
      ['a sandwich-board over a stained surplice', 'a plain tunic', 'a plain bra and panties'],
    ],
  },
  vagrant: {
    male: [
      ['a rope-belted heap of coats', 'layers of unwashed rags', 'grey, holey boxers'],
      ['a mildewed sleeping-bag worn as a cloak', 'a filthy thermal top', 'threadbare briefs'],
      ['a bin-bag poncho', 'newspaper-stuffed rags', 'stiff, forgotten underwear'],
    ],
    female: [
      ['a rope-belted heap of coats', 'layers of unwashed rags', 'a greying bra and holey panties'],
      ['a mildewed sleeping-bag worn as a cloak', 'a filthy thermal top', 'threadbare underthings'],
      ['a bin-bag poncho', 'newspaper-stuffed rags', 'a mismatched bra and panties'],
    ],
  },
  mercenary: {
    male: [
      ['a modular plate carrier over fatigues', 'a moisture-wick combat shirt', 'tactical boxer-briefs'],
      ['a weathered tactical longcoat', 'a compression base layer', 'grey briefs'],
      ['mismatched scavenged armor plates', 'a grease-stained undershirt', 'worn boxers'],
    ],
    female: [
      ['a modular plate carrier over fatigues', 'a moisture-wick compression top', 'a sports bra and briefs'],
      ['a weathered tactical longcoat', 'a fitted base layer', 'a sports bra and panties'],
      ['mismatched scavenged armor plates', 'a snug undershirt', 'a plain bra and briefs'],
    ],
  },
  scientist: {
    male: [
      ['a burn-marked lab coat', 'a rumpled collared shirt', 'plain boxers'],
      ['a hazmat smock pushed down to the waist', 'a sweat-damp undershirt', 'grey briefs'],
      ['a lead apron over a lab coat', 'a wrinkled polo', 'boxer shorts'],
    ],
    female: [
      ['a burn-marked lab coat', 'a rumpled blouse', 'a plain bra and panties'],
      ['a hazmat smock pushed down to the waist', 'a sweat-damp camisole', 'a sports bra and briefs'],
      ['a lead apron over a lab coat', 'a wrinkled blouse', 'a plain bra and panties'],
    ],
  },
  cult_member: {
    male: [
      ['a rough hooded robe stained with ash', 'a coarse hair shirt', 'plain linen shorts'],
      ['a sackcloth shroud marked with an open eye', 'bare, scarred skin', 'a coarse loincloth'],
      ['a tattered ceremonial cloak', 'a plain acolyte\'s tunic', 'rough linen underthings'],
    ],
    female: [
      ['a rough hooded robe stained with ash', 'a coarse hair shift', 'plain linen underthings'],
      ['a sackcloth shroud marked with an open eye', 'bare, scarred skin', 'a coarse wrap'],
      ['a tattered ceremonial cloak', 'a plain acolyte\'s shift', 'rough linen underthings'],
    ],
  },
};

// An outfit (clothing_layers array) for a personality + sex, or null if the archetype
// has no wardrobe / the personality is unknown. Sex 'female' picks the female wardrobe;
// anything else (male / other / unset) falls back to male.
//
// `seed` makes the pick DETERMINISTIC — same seed, same outfit, every run. Content
// authoring needs that: a tool that writes a git file must produce the same bytes on a
// re-run or every re-run is a spurious diff. Live NPC creation (apiCreateNpc) passes no
// seed and keeps the random pick, which is what variety wants there.
export function pickClothingForPersonality(personality, sex, seed = null) {
  const bucket = CLOTHING[personality];
  if (!bucket) return null;
  const variants = (sex === 'female' ? bucket.female : bucket.male) || bucket.male || bucket.female;
  if (!variants || !variants.length) return null;
  let idx;
  if (seed == null) idx = Math.floor(Math.random() * variants.length);
  else {
    let h = 0;
    const s = String(seed);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    idx = Math.abs(h) % variants.length;
  }
  return variants[idx].slice();
}

// Lightweight metadata for the dev-panel dropdown (no line arrays). Insertion
// order defines dropdown order: jobs first, then behavioural personalities.
export function listPersonalityMeta() {
  return Object.entries(DEFAULTS).map(([slug, d]) => ({
    slug,
    label: d.label ?? slug,
    icon: d.icon ?? '',
    sells: !!d.sells,
    mobile: !!d.mobile,
    npcType: d.npcType ?? 'npc',
  }));
}
