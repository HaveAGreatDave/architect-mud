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
 *   chitchat        — idle lines; used unless the NPC stores its own override
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
    chitchat: [
      "Best prices in the district. That's not saying much.",
      "You touch it, you bought it.",
      "Everything's genuine. Genuinely acquired.",
      "Trade you for it. Credits preferred. Bullets accepted.",
      "Limited supply. Always limited. That's the pitch.",
      "I don't know where it came from. That's not your business either.",
      "Come back tomorrow — stock changes. If I'm still here.",
      "Quality merchandise at prices that won't kill you. Probably.",
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
    chitchat: [
      "Everything I sell fits on my back. Ask me how.",
      "Here today. Somewhere worse tomorrow.",
      "No stall, no rent, no problem.",
      "You won't find me here next week. Buy now.",
      "I walk the whole sprawl so you don't have to.",
      "Prices are firm. My feet hurt too much to haggle.",
      "Caught this batch three districts over. Rare out here.",
      "Keep moving, keep selling. That's the trade.",
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
    chitchat: [
      "What'll it be?",
      "You look like you've had a rough one.",
      "Pay first. Trust later. That's policy.",
      "You're not the first person to cry at this bar. Won't be the last.",
      "I've heard worse. Much worse.",
      "Last call was three hours ago. I'm still here.",
      "We're out of the good stuff. We were always out of the good stuff.",
      "Tab's running. Keep drinking.",
      "I don't ask questions. That's why people come here.",
      "You want ice with that? Funny.",
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
    chitchat: [
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

  tv_host: {
    label: 'TV Host', icon: '📺', sells: false, mobile: false, npcType: 'npc',
    chitchat: [
      "We'll be right back after these messages.",
      "Incredible. Simply incredible. Stay with us.",
      "That's all the time we have for tonight, folks.",
      "Let's go to our correspondent in the field.",
      "Live from the ruins of civilization — this is the news.",
      "Don't touch that dial. Actually, you can't. The dial broke years ago.",
      "Our ratings are through the roof. The roof itself is on fire.",
      "I'm told we have a caller. Hello, you're on the air.",
      "This next segment has been approved by our corporate overlords.",
      "Remember: what you're about to see cannot be unseen.",
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
    chitchat: [
      "Used to have a job. Good one, too.",
      "Nothing going today. Nothing going most days.",
      "You hiring? No? Figures.",
      "I keep my head down and my hands empty. Nobody bothers me.",
      "Rent's due. Rent's always due.",
      "Killing time. It's the only thing that's free.",
      "I know these halls better than anyone with somewhere to be.",
      "One of these days something'll turn up.",
      "Spare a credit? Didn't think so.",
      "I'm not loitering. I live here. Sort of.",
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
    chitchat: [
      "Move along.",
      "Eyes forward.",
      "I see you.",
      "Nothing happens on my watch. Usually.",
      "This area is restricted. That's not a suggestion.",
      "I've had a long shift. Don't make it longer.",
      "Protocol says I have to say something. So: stop.",
      "Keep it moving.",
      "Don't make me call this in.",
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

  thug: {
    label: 'Thug', icon: '🔪', sells: false, mobile: false, npcType: 'npc',
    chitchat: [
      "You looking at something?",
      "Watch where you're walking.",
      "This block's got rules.",
      "Nice gear. Shame what happens to nice things.",
      "I seen you around here before?",
      "Mind your business and you'll keep your fingers.",
      "The crew knows your face now.",
      "We run things here. Not them. Us.",
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
    chitchat: [
      "Don't touch that with your bare hands.",
      "I've seen worse. Barely.",
      "The human body is remarkably resilient. And remarkably stupid.",
      "This won't hurt much.",
      "I can fix that. The question is whether you'll want me to.",
      "My rates are reasonable. For the apocalypse.",
      "Symptom management is all any of us are doing at this point.",
      "Sign the waiver. Everyone signs the waiver.",
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
    chitchat: [
      "We're making progress.",
      "The data supports our approach.",
      "I hear your concerns. I'll note them down.",
      "The situation is under control. My definition of control.",
      "We're committed to accountability. The accountability of others.",
      "This is a temporary measure.",
      "Due process is very important to us.",
      "We are exploring all options. Except the obvious ones.",
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
    chitchat: [
      "The end was promised. The end delivered.",
      "Repent. It won't help, but the gesture matters.",
      "He watches. Even here.",
      "Salvation is available. Supply is limited.",
      "Blessed are the adaptable.",
      "The scripture didn't specify what kind of fire.",
      "Sin freely. Confess generously. That's the cycle.",
      "Judgment is coming. It commutes.",
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
    chitchat: [
      "You got a smoke?",
      "I used to have a job. Good job too.",
      "Don't sleep near the east wall. Trust me.",
      "Seen things out there you wouldn't believe.",
      "It's gonna rain. I can tell. My knee knows.",
      "You got any credits? Just asking.",
      "They took everything. But not this spot. This spot's mine.",
      "The machines don't sleep. I've watched.",
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
    chitchat: [
      "This isn't personal. It's a contract.",
      "Better paid than the last job. That's all I ask.",
      "Don't mistake my silence for hesitation.",
      "I've seen a lot of warzones. They all look the same eventually.",
      "Loyalty's expensive. I'm surprisingly affordable.",
      "Eyes open. That's the whole philosophy.",
      "I get paid either way.",
      "There's no good side. Just better rates.",
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
    chitchat: [
      "The results were unexpected. As always.",
      "Containment is holding. For now.",
      "This is theoretically reversible.",
      "The ethical review board no longer exists. We proceed.",
      "Note: do not touch the sample with your left hand.",
      "I've run the numbers. The numbers are concerning.",
      "Progress requires sacrifice. Usually someone else's.",
      "We're close. We are always close.",
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
    chitchat: [
      "He is coming. He is always coming.",
      "Join us. The waiting is easier with company.",
      "The old world is ash. This is better.",
      "We don't recruit. We recognise.",
      "Pain is just loyalty with nerve endings.",
      "Doubt is the first step. We help with the next ones.",
      "There is no leaving. There is only becoming.",
      "The vessel is willing. Are you?",
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

// The idle chitchat pool for an NPC: its own stored override if any, otherwise
// the archetype default. Returns null so callers can apply their own ultimate
// fallback (DEFAULT_CHITCHAT_LINES) when neither is set.
export function getNpcChitchat(npc) {
  if (Array.isArray(npc.chitchat) && npc.chitchat.length) return npc.chitchat;
  const data = getData(npc.flags?.personality);
  return data.chitchat?.length ? data.chitchat : null;
}

// npc_type column value for a given archetype (runtime behaviour category).
// Unknown/absent archetype → null so callers keep any explicitly-provided type.
export function npcTypeForPersonality(personality) {
  return DEFAULTS[personality]?.npcType ?? null;
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
