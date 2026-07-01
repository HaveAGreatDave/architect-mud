/**
 * NPC personality system — combat reactions and MIS responses keyed to the same
 * personality slugs as NPC_CHITCHAT_PRESETS in the devpanel (npcs.js).
 *
 * Each personality has:
 *   combat_lines    — said (or shouted) when the NPC is hit. ALL CAPS = shout.
 *   mis_willing     — default willingness for MIS actions (overridden by npc.flags.mis_willing)
 *   mis_lines_ok    — lines when NPC is willing
 *   mis_lines_no    — lines when NPC refuses
 *   mis_attack      — true if hostile NPCs attack the player rather than just fleeing (rare)
 *   mis_never       — true if personality always refuses regardless of mis_willing flag
 */

const DEFAULTS = {
  tv_host: {
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

  bartender: {
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

  vendor: {
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

  guard: {
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
