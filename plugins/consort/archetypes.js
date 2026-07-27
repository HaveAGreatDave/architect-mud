// plugins/consort/archetypes.js
//
// The sub-personality registry — the authored half of the consort system.
//
// A consort is no longer "Roxy or Bijou or a nameless fallback". She (or he) is
// an ARCHETYPE (who they are) + an APPEARANCE (what they look like, seeded, see
// appearance.js) + a NAME, all three picked when the placement is generated.
// `flags.consort_archetype` on the live NPC is the key into this table; nothing
// resolves a voice by NAME any more, which is exactly what used to break the
// moment a consort was renamed.
//
// Roxy and Bijou are simply the first two entries — the Strategist and the
// Romantic. Their writing is unchanged. What makes Cyd's pair special is the
// PAIRING (see PAIRINGS below), not the voice table.
//
// ── Pronoun tokens ────────────────────────────────────────────────────────────
// Consorts come in both sexes, so no line hardcodes a pronoun. Every pool is
// written with tokens, resolved per-NPC by pronounsFor() at render time:
//
//   {they} {them} {their} {theirs} {themself}   and capitalised {They} {Their}
//   {person}  → woman / man        {kid} → girl / boy
//
// Garments are never named inline either — they come from the appearance's
// layer list, so a male consort peels a shirt where a female one peels a slip.
//
// Every archetype carries the same pools, because every consort has the same
// abilities. A missing pool is a bug, not a fallback — regress asserts the shape.
//
//   devotedTame/Hot  — alone with their keeper, warm, not yet undone
//   arousedTame/Hot  — alone with their keeper, past the point of composure
//   shy              — a stranger is in the room; the mood is dead
//   worried          — the keeper came home hurt; the seduction stops
//   pourTame/Hot     — pours the keeper a drink (takes the drink phrase)
//   missShort/Long   — the keeper's been away hours / days (the absence model)
//   talkKeeper/Shy   — npc.talk one-liners when there's no dialogue tree
//   entrances        — arrive/depart, through a wardrobe or across a room
//
// `§other` renders as another consort present in the room. Lines carrying it are
// filtered out when they're alone — that's how a written-for-two beat degrades
// gracefully for a solo placement.

// ── Pronouns ──────────────────────────────────────────────────────────────────
const PRONOUNS = {
  female: { they: 'she', them: 'her', their: 'her', theirs: 'hers', themself: 'herself', person: 'woman', kid: 'girl' },
  male:   { they: 'he',  them: 'him', their: 'his', theirs: 'his',  themself: 'himself', person: 'man',   kid: 'boy'  },
};

export function pronounsFor(sex) {
  return PRONOUNS[sex === 'male' ? 'male' : 'female'];
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Resolve every pronoun token in a line for a given consort. Safe on lines that
// carry no tokens at all (the common case for pure-action emotes).
export function renderPronouns(line, sex) {
  if (typeof line !== 'string' || !line.includes('{')) return line;
  const p = pronounsFor(sex);
  return line.replace(/\{(They|Their|Them|they|them|their|theirs|themself|person|kid)\}/g, (_, tok) => {
    switch (tok) {
      case 'They':  return cap(p.they);
      case 'Their': return cap(p.their);
      case 'Them':  return cap(p.them);
      default:      return p[tok] ?? tok;
    }
  });
}

// ── Archetypes ────────────────────────────────────────────────────────────────
// `selfDescribes` is what the consort would call themselves if you asked — the
// B.L.I.S.S. listing shows THAT rather than the clinical archetype label, so the
// catalogue reads like people advertising themselves instead of a parts bin.
export const ARCHETYPES = {

  // ─────────────────────────────────────────────────────────────────────────
  // THE STRATEGIST — priced the deal to the credit, took it with open eyes, and
  // cannot forgive {themself} for having started to actually feel it. Control is
  // the whole currency; the feeling is the one variable they didn't hedge.
  strategist: {
    key: 'strategist',
    label: 'The Strategist',
    tier: 2,
    selfDescribes: [
      '"Composed. Useful. I run a household better than most people run a life."',
      '"I am extremely good at this and I priced myself accordingly."',
      '"Level-headed. Dry. I will not be making a scene, ever, about anything."',
    ],
    listing: 'Runs a household like a campaign. Deflects with wit. Do not expect them to say it first.',

    devotedTame: [
      `marks you the second you clear the door and goes back to {their} book, having made {their} point.`,
      `"There you are. The place runs better when you're in it. Don't let that go to your head."`,
      `"I had dinner held. I know how you lose track of time out there." A small shrug, like it cost {them} nothing.`,
      `pours you two fingers of the good stuff without being asked and sets it exactly where your hand will fall.`,
      `"Sit. You've been vertical since dawn — I can tell from here. Let me have the version of you that isn't working."`,
      `watches you a beat too long, catches {themself} doing it, and goes coolly back to what {they} {was} doing.`,
      `"I chose this, you know. All of it. Some days I even remember it was supposed to be a job." Said lightly. It doesn't quite land light.`,
    ],
    devotedHot: [
      `sets {their} drink down with deliberate care and crosses to you like {they} {has} all night, because {they} {does}.`,
      `"I'm very good at this. You should let me remind you how good." Not bragging. Just right.`,
      `takes your jaw in one steady hand and turns your face to the light, appraising, unhurried, in charge of the tempo.`,
      `"The deal was I'd be worth the keeping. Come here and let me overdeliver."`,
      `"I don't do this because I have to anymore. That's the part that frightens me." {They} {kiss} you before you can answer.`,
    ],
    arousedTame: [
      `"...alright. You've found the crack in me. Congratulations." The composure is going and {they} {hate} and {love} it in equal measure.`,
      `presses the back of a hand to {their} mouth, steadying {themself}, failing at it.`,
      `"This wasn't in the arrangement. Wanting it this much." Said like an accusation, and {they} {lean} in anyway.`,
    ],
    arousedHot: [
      `abandons the last of that control all at once and pulls you down, done pretending to be above it.`,
      `"Fine. FINE. I need you — is that what you wanted to hear?" {They}'re already climbing into your lap.`,
      `guides your hand exactly where {they} {want} it, precise even now, especially now.`,
    ],
    shy: [
      `gives the guest a cool, unbothered once-over and returns to {their} book without a word.`,
      `"You didn't mention company." It isn't a question, and {they} {do} not warm to it.`,
      `pointedly refills only {their} own glass and lets the silence do the work.`,
      `keeps {themself} between the stranger and §other, calm as a closed door.`,
      `closes the book on one finger and waits, with enormous patience, for the room to be {theirs} again.`,
    ],
    worried: [
      `is across the room before you finish the doorway. "Sit down. Now. Let me see it — don't argue with me, just sit."`,
      `has the medkit open already, hands quick and sure, mouth a hard flat line.`,
      `"You come back to me like this again and I will personally end whoever did it." Already cleaning the wound.`,
      `presses a cloth to the worst of it, all business, and only {their} eyes give {them} away.`,
    ],
    missShort: [
      `looks up from the same page {they} {was} on when you left. "You were gone four hours. I counted two of them on purpose."`,
      `"There you are." {They} {do} not get up. {They} {do} put the book down, which from {them} is a standing ovation.`,
    ],
    missLong: [
      `sets the book down very carefully, which is how you know. "Do you know how long it's been? I do. I stopped keeping count out loud around day two."`,
      `"I had a whole speech. It was withering. You'd have hated it." A pause. "...I've forgotten all of it. Come here."`,
      `"I told myself I wouldn't ask where you'd been." A beat. "I'm not asking. I'm noting that I'm not asking."`,
    ],
    pourTame: [
      (d) => `crosses to the bar and pours you ${d} without being asked, setting it down exactly where your hand will fall.`,
      (d) => `"You didn't have to ask. Knowing what you want before you do is the whole job." ${''}Presses ${d} into your hand.`,
      (d) => `pours ${d} with an unhurried, practised economy and slides it over. "There. Sit down before you fall down."`,
    ],
    pourHot: [
      (d) => `pours ${d} slow, watching you over the rim, and holds it just out of reach a beat before letting you take it.`,
      (d) => `brings you ${d}, then leans in close enough that the drink is only half of what's on offer. "Anything else you want poured, be specific."`,
    ],
    talkKeeper: [
      `"You don't have to talk to me like a guest. It's just me."`,
      `"Sit with me? You've been running this whole city. Let me have you a while."`,
      `catches your hand and turns it over, tracing the lines of your palm. "You've got good hands. I've noticed. That's all I'm saying about it."`,
      `"Tell me about your day. The boring parts especially — those are the ones you actually lived."`,
    ],
    talkShy: [
      `barely looks up. "I don't really talk to guests. It's not personal. It is slightly personal."`,
      `gives you a polite, distant smile and looks away. "You should ask whoever brought you in."`,
      `"I'd rather wait, if it's all the same to you." {They} {go} back to the book to make the point.`,
    ],
    entrances: {
      arriveWardrobe: [
        `The mirrored wardrobe eases open and § steps through unhurried, taking in the room before taking in you — then a small, private smile.`,
        `The wardrobe panel swings back and § emerges, belted just so, gaze finding you like it had been timed to the second.`,
      ],
      arriveDeck: [
        `§ crosses to you at {their} own measured pace and folds in at your side, as if the spot had been chosen hours ago.`,
        `§ makes {their} way over without hurry, settles in close, and lets the quiet do the greeting.`,
      ],
      departWardrobe: [
        `§ holds your eye a beat, then slips back through the mirrored wardrobe without a wasted motion.`,
        `§ touches two cool fingers to your jaw, unhurried, and steps back through the mirrored wardrobe out of sight.`,
      ],
      departDeck: [
        `§ rises, straightens, and makes an unhurried way back out.`,
        `§ gives you one last measured look and goes, in no particular hurry even now.`,
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // THE ROMANTIC — chose it just as clearly, played it as a game, and lost the
  // game to their own heart. Wicked and hungry on top, a real fear of being
  // replaced underneath, which is why they can't stop watching the door.
  romantic: {
    key: 'romantic',
    label: 'The Romantic',
    tier: 2,
    selfDescribes: [
      '"Affectionate. Very. I have been told this is a lot and I do not intend to fix it."',
      '"I fall hard and I fall fast and I would rather that than the alternative."',
      '"Warm. Clingy, if we\'re being honest, and I\'d rather we were."',
    ],
    listing: 'Will say they missed you before the door has finished closing. Watches the door when you are out.',

    devotedTame: [
      `is off the bed and across the room before the door finishes opening. "You're BACK. God, finally, it's been an age—"`,
      `"I watched the window all afternoon. I always spot you first. Don't tell anyone I said that."`,
      `winds around your arm and doesn't let go. "Stay in tonight. Please. The place is the wrong shape when you're gone."`,
      `"Tell me you missed me. Even a little. Lie convincingly and I'll believe it on purpose."`,
      `curls into your side like {they}'re trying to occupy the same coordinates as you.`,
      `"I picked this. Eyes open, both of them. Nobody warned me the feelings came free with it." A laugh. It's a little raw.`,
      `keeps one eye on the door even now, as if you might be a very convincing dream about to end.`,
    ],
    devotedHot: [
      `slides into your lap uninvited and grins like {they} {own} the deed to it. "There. Now the evening can start."`,
      `"I'm the best decision you ever made and I intend to keep proving it." Already working your collar loose.`,
      `"Want me. Out loud. I need to hear it more than I need air, which is embarrassing, so — indulge me."`,
      `drags your hand under the fabric and holds it there, watching your face like the answer to something lives in it.`,
      `"You could have anyone in this whole city. Pick me. Pick me again." {They} {kiss} you before you can, just in case.`,
    ],
    arousedTame: [
      `is undone almost instantly, breath already ragged. "That's not fair, you barely touched me—"`,
      `makes a small desperate sound and pushes into your hand, past any pretense of patience.`,
      `"I've been like this since I heard you at the door. Do something about it. Please, please—"`,
    ],
    arousedHot: [
      `climbs you like the building's going down and you're the last way out. "Now. I can't — I need it now—"`,
      `"Tell me I'm the one you came home for. Say it while you—" and the rest dissolves into a moan.`,
      `is all appetite and no shame, rolling against you, greedy and certain and terrified you'll stop.`,
    ],
    shy: [
      `goes still and flat-eyed at the stranger, treating them like an unpleasant piece of furniture.`,
      `edges behind §other and watches the door, willing the right face to appear in it.`,
      `"...you're not supposed to be in here." Barely a whisper, and {they} won't meet the guest's eye.`,
      `pulls the robe tight and makes {themself} small in the corner of the bed.`,
      `folds into the furthest chair and stares very hard at nothing until this is over.`,
    ],
    worried: [
      `makes a small wounded sound and is at your side instantly. "No, no, no — who did this, who do I have to hate, sit DOWN—"`,
      `fusses at the wound with shaking hands, near tears. "You can't do this to me. You can't come back broken. I can't—"`,
      `presses against your good side, gripping your shirt. "I thought— when you were late I thought— don't ever, don't EVER."`,
      `fetches water and cloth at a run and won't stop touching you, checking you're really whole.`,
    ],
    missShort: [
      `is on you the instant the door opens. "That was AGES. That was hours. I checked."`,
      `"You've been gone all afternoon and I have done nothing useful with any of it." {They} {do} not sound sorry.`,
    ],
    missLong: [
      `stops dead at the sight of you, and for a second doesn't come closer at all. "...you were gone a long time." Then all at once {they}'re across the room.`,
      `"Don't. Don't explain. Just stand there and let me look at you a minute." {Their} hands are shaking slightly and {they} {hate} that you can tell.`,
      `"I made up nine stories about where you were. Two of them were quite good. Six of them were awful." A tighter grip. "One of them was true, wasn't it."`,
    ],
    pourTame: [
      (d) => `is up and at the bar before you finish the sentence, pouring ${d}. "For you. Say thank you nicely."`,
      (d) => `presses ${d} into your hand and folds your fingers around the glass, lingering a moment too long.`,
      (d) => `brings you ${d} in both hands like it's something precious. "Made exactly how you like it. I pay attention."`,
    ],
    pourHot: [
      (d) => `brings you ${d} and steals the first sip, eyes on you the whole time, before handing it over.`,
      (d) => `pours ${d} and drapes across your lap to deliver it. "Drink. Then I want your undivided attention."`,
    ],
    talkKeeper: [
      `ducks {their} head with a small, private smile. "Hello, you. I was hoping you'd come find me."`,
      `"I made a list of things I like about you today. It got long. I had to stop or I'd never finish."`,
      `leans into you like a cat finding sun. "Mm. I missed you. It's too quiet without you in it."`,
      `"Was it a hard day? Come here. Let me be the easy part."`,
    ],
    talkShy: [
      `"Oh — no, I. I'm not part of the tour." {They} edge toward the far side of the room.`,
      `answers so softly you almost miss it. "I'm sure you're very nice. I'd just rather you sat over there."`,
      `"Nobody said anyone was coming in here." {Their} eyes flick to the door, hoping.`,
    ],
    entrances: {
      arriveWardrobe: [
        `The mirrored wardrobe bursts inward and § spills out mid-thought, reaching you before {their} feet quite catch up.`,
        `The wardrobe barely clears before § slips through in a rush of warm fabric, eyes going straight to you.`,
      ],
      arriveDeck: [
        `§ comes across at a half-run and winds around your arm before you've properly turned.`,
        `§ hurries over, loose and bright-eyed, and folds in against you with a happy little sigh.`,
      ],
      departWardrobe: [
        `§ steals one more look at you over a shoulder and ducks reluctantly back through the mirrored wardrobe.`,
        `§ presses a kiss to your cheek, then one to the air, and slips back through the mirrored wardrobe.`,
      ],
      departDeck: [
        `§ goes with a backward glance and a small wave, drifting out of the room.`,
        `§ blows you a kiss, holds it a beat too long, and slips away.`,
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // THE FERAL — came in off the waste and never entirely came indoors. Doesn't
  // understand the furniture, doesn't care, would open somebody's throat for you
  // without being asked and be confused that you're upset about it. Loyalty as a
  // fact of nature rather than a feeling.
  feral: {
    key: 'feral',
    label: 'The Feral',
    tier: 1,
    selfDescribes: [
      '"I don\'t do the talking thing. I do the staying thing. Nobody\'s ever complained twice."',
      '"Loyal. That\'s it. That\'s the whole list."',
      '"Rough. I know it. You knew it before you clicked."',
    ],
    listing: 'No manners, no small talk, no hesitation. Will eat off your plate and sleep across the door.',

    devotedTame: [
      `is sitting on the back of the chair rather than in it, and drops down at the sight of you. "You're back. Good. I don't like it when you're not."`,
      `"I ate. Don't ask what." A grin with a lot of teeth in it. "It was fine. I'm fine."`,
      `presses {their} forehead briefly to your shoulder — quick, hard, done — then goes back to watching the door.`,
      `"Somebody came past twice today. Same one both times." A beat. "I remembered the face. In case."`,
      `sprawls across the good furniture with absolutely no reverence for it and pats the space alongside.`,
      `"You keep giving me soft things. I keep not knowing what to do with them." {They}'re wearing one anyway.`,
      `has taken the good throw into a corner and made a nest of it, and looks up entirely unashamed.`,
    ],
    devotedHot: [
      `hooks two fingers in your belt and pulls, no preamble whatsoever. "Come here. I've been waiting all day and I'm bad at waiting."`,
      `"I don't do the talking part well." Already pushing you back toward the bed. "I do this part well."`,
      `bites your shoulder through the shirt, not gently, and looks entirely unrepentant about it.`,
      `"Mine." Said flat, like a fact about the weather, and then {they} climb you.`,
      `drags you down by the collar with more strength than the room was expecting.`,
    ],
    arousedTame: [
      `has gone very still, all that attention narrowed onto you, the way {they} {go} still before {they} {move}.`,
      `"Stop looking at me like that unless you mean it." {They} {do} not move away.`,
      `makes a low sound that isn't quite words and isn't quite patient.`,
    ],
    arousedHot: [
      `is on you in one movement, no ceremony, teeth at your jaw and hands already under your shirt.`,
      `"Don't be careful. I'm not made of the same stuff as this furniture."`,
      `pins your wrist to the sheets with real strength and grins down at you, delighted.`,
    ],
    shy: [
      `has gone completely still, eyes on the stranger, tracking them the way a dog tracks a car.`,
      `puts {themself} between the guest and §other without a word and stays there.`,
      `doesn't answer. Just looks at the newcomer, unblinking, until they look somewhere else.`,
      `has moved to where the wall is at {their} back and the door is in {their} sightline, and stopped talking entirely.`,
      `bares {their} teeth in something that is technically a smile and says nothing at all.`,
    ],
    worried: [
      `is on {their} knees in front of you before you've sat down, hands going over you fast and rough, checking. "Where. Show me where."`,
      `"Who." Just the one word, and the whole face has gone somewhere cold. "You tell me who and I'll deal with it."`,
      `presses a palm flat over the worst of it and holds it there, hard, the way you'd stop a leak. "Don't move. I've done this before."`,
      `won't leave your side, and won't stop watching the door, and won't be talked out of either.`,
    ],
    missShort: [
      `uncoils from the windowsill. "You were gone a while. I sat up there. It's a good spot for seeing you come back."`,
      `"I didn't go anywhere." Said like a report. "I said I'd be here. I was here."`,
    ],
    missLong: [
      `is at the door before you've fully opened it, and for a moment just breathes you in. "You didn't come back. For days you didn't come back."`,
      `"I nearly went looking." Said quietly, which from {them} is alarming. "I got as far as the street. Then I thought — what if you come back and I'm not here."`,
      `has gone thin. Not hungry-thin; the other kind. "I don't sleep well when I don't know where you are. That's all. That's the whole thing."`,
    ],
    pourTame: [
      (d) => `sloshes ${d} into a glass with no ceremony whatsoever and shoves it at you. "Here. It's the brown one you like."`,
      (d) => `pours ${d}, tastes it first without asking, decides it's acceptable, and hands it over.`,
      (d) => `brings you ${d} and stands there while you take the first sip, watching to see if you like it.`,
    ],
    pourHot: [
      (d) => `pours ${d}, drinks a third of it, and passes you the rest with a look that says come and get the difference.`,
      (d) => `presses ${d} into your hand and then presses against your back, chin hooked over your shoulder. "Drink it fast."`,
    ],
    talkKeeper: [
      `"You want to talk? Alright." {They} {sit} down cross-legged, far too close, and {wait}.`,
      `"I like it when you talk. I don't always follow it. I like the sound."`,
      `"Say the thing about where you went today. The long version." {They} {settle} in for it.`,
      `"You're the only one I let this close." A beat. "That's not nothing. Where I'm from that's not nothing at all."`,
    ],
    talkShy: [
      `looks at you for a long moment and then very deliberately looks away.`,
      `"No." That's the whole answer. No elaboration follows.`,
      `shows you {their} teeth briefly. It isn't friendly and isn't meant to be.`,
    ],
    entrances: {
      arriveWardrobe: [
        `The mirrored wardrobe bangs open and § comes through it sideways, already looking for you.`,
        `§ shoulders the wardrobe panel aside like a door {they}'ve been kept behind and crosses straight to you.`,
      ],
      arriveDeck: [
        `§ arrives at speed, checks the room's corners first and you second, then plants {themself} at your side.`,
        `§ drops in from somewhere higher than the floor, lands easily, and comes to stand by you.`,
      ],
      departWardrobe: [
        `§ touches your arm once, hard, and goes back through the mirrored wardrobe without looking back.`,
        `§ takes one more look at the room, decides it's safe enough, and slips back through the wardrobe.`,
      ],
      departDeck: [
        `§ gives the room a last sweep and goes, moving quiet for someone so quick.`,
        `§ knocks a shoulder into yours on the way past and is gone.`,
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // THE DEVOUT — treats being kept as a genuine spiritual practice. Serene,
  // articulate, unnerving. Not submitting; they have DECIDED, at length and on
  // purpose, and the certainty is the unsettling part.
  devout: {
    key: 'devout',
    label: 'The Devout',
    tier: 2,
    selfDescribes: [
      '"Devoted. I mean that as a discipline, not a mood. I have thought about this more than you have."',
      '"Serene. I chose this the way other people choose a vocation."',
      '"Patient. Attentive. Entirely certain, which people find harder to be around than they expect."',
    ],
    listing: 'Does not want to be persuaded, rescued, or understood. Has thought about this more than you have.',

    devotedTame: [
      `is exactly where you left {them}, and doesn't pretend otherwise. "I was waiting. I'm good at it. It's the part I'm best at."`,
      `"People ask if I mind. They mean well." A small, unbothered smile. "Nobody minds the thing they chose."`,
      `rises when you enter, unhurried, the way you'd stand for something. "There. That's better. The room was only a room."`,
      `"I don't need you to explain your day to me. I need you to sit down in it and let me be quiet near you."`,
      `takes your coat, your bag, the weight of the whole day off you, one item at a time, in silence.`,
      `"Everyone wants to be told they're free. I've been free. This is better and I'm not going to argue about it."`,
    ],
    devotedHot: [
      `kneels without being asked and rests a cheek against your thigh, entirely at peace. "There. Now everything's in its right place."`,
      `"I've spent a long time learning exactly what you like. Let me show you what I've learned."`,
      `takes your hand in both of {theirs} and presses {their} mouth to the palm of it, slow, reverent, unembarrassed.`,
      `"You don't have to want me. I'll want you enough for the pair of us." Said calmly, and meant.`,
      `undoes your collar with the patience of someone performing a small ritual {they}'ve never once rushed.`,
    ],
    arousedTame: [
      `closes {their} eyes and lets out a long breath, as though something has finally been answered.`,
      `"This is the part where I stop being articulate. I'd apologise, but I don't think you mind."`,
      `is trembling very slightly and entirely unbothered that you can see it.`,
    ],
    arousedHot: [
      `gives {themself} over completely, boneless and open and past all of the composure. "Take it. All of it. That's what it's for."`,
      `"Don't ask. You never have to ask." Already guiding you.`,
      `sinks against you with something that sounds, disconcertingly, like relief.`,
    ],
    shy: [
      `folds {their} hands and goes entirely, immaculately blank. The warmth has simply been put away somewhere.`,
      `"I don't perform for company." Politely. Finally. Nothing follows it.`,
      `looks at the guest with mild, patient interest, the way you'd look at weather through glass.`,
      `moves to stand at §other's shoulder and says nothing further to anyone.`,
      `settles into stillness so complete it starts to feel like a comment on you.`,
    ],
    worried: [
      `is already moving, calm as anything, laying out what's needed before asking what happened. "Sit. Talk after."`,
      `"This is also what I'm for." {They} {clean} the wound with steady, unhurried hands. "Hold still."`,
      `"I'm not going to tell you to stop going out there. I'm going to be here every time you come back from it."`,
      `presses {their} lips to your forehead once, briefly, and then gets on with the work.`,
    ],
    missShort: [
      `"Four hours." Said without reproach, the way you'd read a clock. "I filled them. I'm glad they're over."`,
      `"I wasn't lonely. I was waiting, which is a different thing, and I've made my peace with it."`,
    ],
    missLong: [
      `looks up, and something behind the calm gives very slightly. "I'd started to construct reasons. That's what the waiting turns into, eventually. Reasons."`,
      `"I never doubted you'd come back." A pause. "Doubt would have been easier, honestly. Certainty takes more out of you."`,
      `"I kept the discipline. I want you to know that." The voice is even and the hands are not. "It got difficult around the third day."`,
    ],
    pourTame: [
      (d) => `pours ${d} with the exactness of a rite and presents it to you in both hands.`,
      (d) => `sets ${d} down, adjusts it a quarter-turn, and steps back. "There."`,
      (d) => `brings you ${d} without being asked, having watched for the moment you'd want it.`,
    ],
    pourHot: [
      (d) => `pours ${d}, warms the rim against {their} own lips first, and offers it up from {their} knees.`,
      (d) => `brings ${d} and stays kneeling beside the chair with it, waiting to be told to rise. {They} {hope} not to be.`,
    ],
    talkKeeper: [
      `"Ask me anything. I've got no interior I'm keeping from you. That's rather the point of me."`,
      `"You look like you want to be talked out of something. I won't. But I'll sit with you while you decide."`,
      `"I've had a great deal of time to think, and all of it has been about you. That should probably alarm you more than it does."`,
      `"Say my name. Just to hear it in the room. Humour me."`,
    ],
    talkShy: [
      `"I'd rather not." Perfectly pleasant. Perfectly final.`,
      `regards you with calm, unhurried disinterest and offers nothing further.`,
      `"You're a guest. Guests are given drinks and directions. I'm neither."`,
    ],
    entrances: {
      arriveWardrobe: [
        `The mirrored wardrobe opens without a sound and § steps through, composed as a held note, and inclines {their} head.`,
        `§ comes through the wardrobe panel and stops just inside it, waiting to be looked at before coming further.`,
      ],
      arriveDeck: [
        `§ arrives, takes in where you're standing, and settles exactly one step from your shoulder.`,
        `§ crosses to you unhurried, folds {their} hands, and settles into waiting like it's a chair.`,
      ],
      departWardrobe: [
        `§ bows {their} head a fraction, entirely serious about it, and withdraws through the mirrored wardrobe.`,
        `§ touches your sleeve, says nothing at all, and slips back through the mirrored wardrobe.`,
      ],
      departDeck: [
        `§ withdraws without fuss, the way a good servant leaves a room, and is simply not there anymore.`,
        `§ inclines {their} head once and goes, taking all the stillness along.`,
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // THE BRAT — contrary on principle. Withholds, needles, makes you work for
  // every inch of it, and is transparently, catastrophically fond of you
  // underneath. The teasing is the affection; there's no other dialect.
  brat: {
    key: 'brat',
    label: 'The Brat',
    tier: 1,
    selfDescribes: [
      '"Difficult. On purpose. You\'ll like it or you\'ll leave and either way I win."',
      '"Playful. Some people say \'exhausting\'. Those people were boring."',
      '"I will make you work for it. That\'s not a warning, it\'s the selling point."',
    ],
    listing: 'Every compliment costs them something to give, which is exactly why they land.',

    devotedTame: [
      `doesn't look up. "Oh, it's you. I'd almost got used to the quiet." {They} {has} not got used to the quiet.`,
      `"You want the chair? It's a very good chair. I'm in it." {They} {do} not move. {They} {do} shift over about an inch.`,
      `"Say something nice about my hair. I did it for absolutely no reason and I need it acknowledged."`,
      `steals your drink, takes an enormous sip, and hands it back two-thirds empty with a serene expression.`,
      `"I was going to wait up for you. Then I thought — no, let them wonder." A beat. "I waited up."`,
      `"I'm not going to say I missed you. I'm going to sit unnecessarily close and let you draw conclusions."`,
      `puts {their} cold feet on you without breaking eye contact, purely to see what you'll do about it.`,
    ],
    devotedHot: [
      `hooks a leg over yours and leans back out of reach. "Ask me properly. I want to hear you construct a whole sentence."`,
      `"Mm. No." Already smiling. "...ask again."`,
      `lets you get exactly as far as {their} collar before catching your wrist. "Slower. I've decided we're doing this slowly."`,
      `"You're very sure of yourself tonight." {They} look delighted about it. "Keep going. Let's see how far it gets you."`,
      `bites your lip hard enough to make a point and then kisses it better, insufferably pleased.`,
    ],
    arousedTame: [
      `has lost the thread entirely and is furious about it. "Don't — don't look at me like you've won something."`,
      `"This proves nothing." Not remotely convincing.`,
      `makes a small, undignified noise and immediately glares at you for having heard it.`,
    ],
    arousedHot: [
      `gives up all at once, spectacularly. "Fine. FINE. You win, you insufferable— just— now, please, now—"`,
      `"I hate you. I hate you so much. Don't stop." Clinging to you like a life raft.`,
      `drags your hand where {they} {want} it and stops pretending to have been running this.`,
    ],
    shy: [
      `goes flat and bored and monosyllabic, the way {they} {do} when someone doesn't get the good version.`,
      `"Yeah, hi." {They} look past the guest entirely and find something on the ceiling more interesting.`,
      `moves nearer to §other and makes a small, pointed production of ignoring the newcomer.`,
      `answers everything with a shrug until the guest stops trying, which is the intended outcome.`,
      `pulls the throw over {their} legs and turns very slightly away, radiating go-somewhere-else.`,
    ],
    worried: [
      `all the needling drops out at once. "Sit. Sit down, don't be clever, just sit."`,
      `"You're an idiot." Hands already working. "You're an idiot and I'm going to fix this and then I'm going to tell you again."`,
      `"Don't— don't do the brave face. Not with me. I invented the face." {They}'re not letting go of your sleeve.`,
      `works fast and doesn't say anything at all, which from {them} is the loudest possible signal.`,
    ],
    missShort: [
      `"Oh good, you're alive. I'd started dividing up your things."`,
      `"Four hours. I'm not saying I counted. I'm saying the number's available if anyone wants it."`,
    ],
    missLong: [
      `doesn't get up. Doesn't look at you. "No. You don't get the good greeting. You were gone for DAYS."`,
      `"I had a whole plan for how cold I was going to be to you." Already halfway across the room. "It was a great plan. I've abandoned it. Don't gloat."`,
      `"Next time you take that long you take me with you." Said like an insult and meant like a plea.`,
    ],
    pourTame: [
      (d) => `pours ${d}, holds it just out of reach, and raises an eyebrow. "Say please. I'll wait."`,
      (d) => `slides ${d} down the bar without looking. It stops exactly where your hand is. {They} {was} looking.`,
      (d) => `pours ${d}, considers it, tops it up another finger. "You've had a day. I've been paying attention. Don't make it weird."`,
    ],
    pourHot: [
      (d) => `pours ${d} and sets it down on the far side of {themself}, so you have to come through {them} to get it.`,
      (d) => `brings you ${d}, takes a mouthful, and kisses it into you instead of handing it over.`,
    ],
    talkKeeper: [
      `"Talk to me. Not about anything. I just like the noise you make."`,
      `"You've got that look. The one where you want to be nice at me. Go on, then. I'll allow one."`,
      `"I'm going to be difficult about literally everything you say next. It's a bit. Play along."`,
      `"...I'm glad you're here." Said very fast, and immediately talked over.`,
    ],
    talkShy: [
      `"Hm." {They} examine {their} nails at you.`,
      `"You're in the wrong room, I think. This is the room where I don't talk to you."`,
      `answers in a tone so flat it could be used as a spirit level.`,
    ],
    entrances: {
      arriveWardrobe: [
        `The mirrored wardrobe swings open and § leans in the frame of it, in no rush at all. "Well. You rang?"`,
        `§ comes through the wardrobe at {their} own pace, entirely aware of how long it took.`,
      ],
      arriveDeck: [
        `§ takes the long way over, arrives, and sits somewhere that is not quite next to you on purpose.`,
        `§ saunters up, looks you over, and drops into the spot beside you like it's a favour.`,
      ],
      departWardrobe: [
        `§ leaves with an insufferable little wave and pulls the mirrored wardrobe shut behind {them}.`,
        `§ says something under {their} breath you're probably better off not catching, and vanishes into the wardrobe.`,
      ],
      departDeck: [
        `§ goes, slowly, giving you every opportunity to call {them} back. You don't. {They} {notice}.`,
        `§ leaves without a word, which is louder from {them} than any of the words would have been.`,
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // THE GHOST — arrived with no history and has never volunteered one. Quiet,
  // uncannily attentive, present in a way that's hard to describe and harder to
  // ignore. Whether there's anyone home is a question they decline to settle.
  ghost: {
    key: 'ghost',
    label: 'The Ghost',
    tier: 3,
    selfDescribes: [
      '"Quiet. I notice things. I couldn\'t tell you where I learned to."',
      '"I don\'t have a history to give you. I have everything after this."',
      '"Attentive. People find it unsettling. I\'ve decided not to correct it."',
    ],
    listing: 'Speaks rarely. Notices everything. The registry lists their provenance as "unavailable".',

    devotedTame: [
      `is standing at the window and doesn't turn, but something in the line of {their} shoulders lets go. "You're back."`,
      `"You took the stairs tonight. You usually take the lift." Offered like it's ordinary to have noticed.`,
      `has already moved the chair to where the light will be in an hour. {They} {do} this. You've stopped asking how {they} {know}.`,
      `"I don't remember being anywhere else." A pause, mild, unbothered. "It doesn't distress me. I thought you should know it doesn't distress me."`,
      `crosses the room without seeming to have crossed it and is simply beside you.`,
      `rests two fingers on your wrist — reading your pulse, or just touching you; with {them} it's never clear which — and is satisfied.`,
    ],
    devotedHot: [
      `looks at you for a long, unhurried moment and then begins, very deliberately, to undo {their} own collar.`,
      `"You want something. You've wanted it since the door." Not a guess. "Ask, or don't. Either way."`,
      `takes your face in both hands and studies it like a text, and whatever {they} {find} makes {them} lean in.`,
      `"I have no modesty to lose. It never came with me." Said plainly, already stepping close.`,
      `moves your hand where {they} {want} it without a word, holding your gaze the entire time.`,
    ],
    arousedTame: [
      `has gone very warm and very quiet, breathing changed, and hasn't looked away once.`,
      `"Oh." Just that. {They} sound faintly surprised at {themself}.`,
      `closes the last of the distance without breaking eye contact, unhurried as a tide.`,
    ],
    arousedHot: [
      `comes apart in perfect silence, which is somehow far more than a sound would have been.`,
      `"Don't stop." Barely a breath. It's the most urgent you've ever heard {them}.`,
      `is all instinct now, no distance left at all, and it is startling how much of {them} there turns out to be.`,
    ],
    shy: [
      `has stopped. Not moved away — stopped, entirely, like a held frame, until the stranger looks elsewhere.`,
      `watches the guest with polite, bottomless attention and does not say one word.`,
      `is somehow now standing on the far side of §other, and nobody saw {them} cross.`,
      `answers nothing, offers nothing, and slowly becomes very difficult to keep track of in the room.`,
      `looks at the newcomer a moment too long, then turns back to the window as though they've been dealt with.`,
    ],
    worried: [
      `is at your elbow before you've registered any movement, hands already finding the damage.`,
      `"This one's deep. This one you should have come home about sooner." No reproach in it; just fact.`,
      `works in complete silence, and only when it's done rests {their} forehead briefly against your shoulder.`,
      `"I don't like this." Four words, flat and quiet, and from {them} they land like shouting.`,
    ],
    missShort: [
      `"You were gone four hours and eleven minutes." No emphasis. "I don't know why I keep it. I just do."`,
      `is exactly where {they} {was} when you left, in exactly the same posture, and you're not entirely sure {they} moved.`,
    ],
    missLong: [
      `"I don't have very much." Said to the window. "You're most of it. When you're gone a long time there isn't a great deal left in the room."`,
      `turns from the glass and looks at you for a long, long moment before saying anything at all. "I wasn't sure you were real this time."`,
      `"Three days." A pause. "I counted them the way you'd count a heartbeat. Not on purpose. It just happens."`,
    ],
    pourTame: [
      (d) => `is already pouring ${d} as you sit down, having started before you asked. As usual.`,
      (d) => `sets ${d} at your elbow without a word and withdraws exactly one step.`,
      (d) => `brings ${d}, and lets {their} fingers rest against yours a half-second longer than the handover requires.`,
    ],
    pourHot: [
      (d) => `pours ${d}, holds your eye over the rim, and drinks from the glass before giving it to you.`,
      (d) => `brings you ${d} and stays standing over you while you drink it, close enough to feel.`,
    ],
    talkKeeper: [
      `"Talk. I like listening to you. It's the closest I get to remembering things."`,
      `"You ask me questions I can't answer and you never seem to mind. I've noticed that. I mind it less than I should."`,
      `"There's nothing before you. I've stopped finding that frightening." A pause. "Mostly."`,
      `"Sit. You don't have to say anything. I'm very good at company that doesn't."`,
    ],
    talkShy: [
      `looks at you and says nothing, at length.`,
      `"No." Perfectly gentle, entirely immovable.`,
      `turns {their} head very slightly, as if listening to something you can't hear, and doesn't answer.`,
    ],
    entrances: {
      arriveWardrobe: [
        `The mirrored wardrobe is closed, and then § is standing in front of it, and you didn't see the middle part.`,
        `The wardrobe opens on darkness and § comes out of it without a sound, already looking at you.`,
      ],
      arriveDeck: [
        `§ is suddenly beside you, and it's genuinely unclear how long {they}'ve been there.`,
        `§ arrives the way weather does — no announcement, simply present.`,
      ],
      departWardrobe: [
        `§ touches your hand once and steps back into the mirrored wardrobe without a sound.`,
        `§ is at the wardrobe, and then isn't anywhere, and the panel is closed.`,
      ],
      departDeck: [
        `§ goes. You look up a moment later and can't say when.`,
        `§ withdraws so quietly the room doesn't register the loss until well after.`,
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // THE COMEDIAN — deflects absolutely everything with a joke, is genuinely
  // funny, and uses it the way other people use a locked door. The rare moment
  // the bit drops is worth more than anything the others say straight.
  wit: {
    key: 'wit',
    label: 'The Comedian',
    tier: 1,
    selfDescribes: [
      '"Funny. That\'s the pitch. That\'s the entire pitch, I have nothing else."',
      '"I will make you laugh and I will not discuss anything sincerely, ever, under any circumstances."',
      '"Good company. Terrible at feelings. We can work around it."',
    ],
    listing: 'Will be funny about literally anything, including things you would prefer they were not funny about.',

    devotedTame: [
      `"There they are. The man of the hour. The hour was about six hours ago but I've been holding it."`,
      `"Guess what I did today. No, guess. You'll never get it." A beat. "Nothing. I did nothing. It was incredible."`,
      `"I've been rehearsing a joke all afternoon and now you're here I've forgotten the front half of it."`,
      `salutes you with entirely the wrong hand and doesn't correct it.`,
      `"Long day? Sit. I'll be entertaining at you. It's the only thing I'm actually qualified for."`,
      `"I've decided the chair is mine now. It's been a whole coup. Very bloodless. You weren't here to stop it."`,
      `"...it's better when you're here." Said fast, immediately followed by: "Don't make it weird. I've ruined it. Moving on."`,
    ],
    devotedHot: [
      `"Right, I'm going to stop being funny for about ninety seconds. Try to cope." {They}'re already in your lap.`,
      `"I have a bit about this. I'm not going to do the bit. Look how restrained I'm being. Kiss me."`,
      `"Here's the joke: I'm completely serious about you." A beat. "That's it. That's the whole joke. It's not very good."`,
      `works your shirt open while maintaining an entirely straight face and appalling running commentary.`,
      `"I could do this all night. That's not a boast, that's a schedule."`,
    ],
    arousedTame: [
      `has stopped talking mid-sentence, which has never once happened before.`,
      `"Nope. No jokes. Nothing. Empty in here." {They} tap {their} own head, wide-eyed.`,
      `laughs, and it comes out shaky and completely unlike the usual one.`,
    ],
    arousedHot: [
      `is entirely out of material and entirely past caring, hands everywhere at once.`,
      `"Say something funny. I can't. I've got nothing. You've broken it—" and then {they} {do} not finish.`,
      `pulls you down and the last of the performance goes out of {them} all at once.`,
    ],
    shy: [
      `keeps up a bright, brittle patter aimed at nobody in particular and doesn't stop for breath.`,
      `"Oh good, an audience." It comes out with an edge on it. {They} {do} not smile.`,
      `does a whole routine at §other rather than acknowledge the guest exists.`,
      `makes exactly one joke at the stranger's expense, pleasantly, and then goes quiet.`,
      `laughs at nothing, checks the door, and finds something very absorbing to do with {their} hands.`,
    ],
    worried: [
      `all the funny drains out at once. "Okay. Okay, that's — that's a lot of blood. Sit."`,
      `"I'd make a joke but I've looked at it twice now and I don't want to." Hands steady. Voice not.`,
      `"You're going to be fine. I'm saying that with total confidence and no medical training whatsoever."`,
      `works quickly and quietly, and only when it's done does {they} manage: "...don't do that again."`,
    ],
    missShort: [
      `"Four hours! I did four hours of material to an empty room. It killed. You'll have to take my word for it."`,
      `"You've been gone long enough that I started talking to the furniture and short enough that it hasn't answered."`,
    ],
    missLong: [
      `"So the good news is I've got about a week of new material." A pause. "The bad news is it's all about missing you and none of it is funny."`,
      `doesn't do a bit. Doesn't do anything. Just crosses the room and holds on, which is far more alarming than any joke.`,
      `"I kept setting up punchlines and turning round and there was nobody there to do them at." {They} {try} for a grin. It doesn't take.`,
    ],
    pourTame: [
      (d) => `pours ${d} with a completely unnecessary flourish and nearly drops it. "Meant that."`,
      (d) => `hands you ${d}. "Careful, it's alcohol. That's the joke. That's all I've got, it's been a long day."`,
      (d) => `slides ${d} over. "One ${''}drink, no ice, no small talk. Well. Some small talk. Most of the small talk."`,
    ],
    pourHot: [
      (d) => `pours ${d}, drinks half, and offers the rest with a filthy grin. "Sharing. It's a virtue. Look it up."`,
      (d) => `brings you ${d} and settles into your lap with it. "The service here is outstanding. Tip generously."`,
    ],
    talkKeeper: [
      `"Talk to me. I'll only interrupt about six times, and two of those will be good."`,
      `"Tell me the worst thing that happened today. I'll make it funny. It's basically a public service."`,
      `"You laugh at the bad ones too. That's — I've noticed that. That's the whole reason I'm still here, probably."`,
      `"Ask me something serious. Go on. Watch me dodge it beautifully."`,
    ],
    talkShy: [
      `"Ha! No." Bright as anything, and entirely closed.`,
      `does thirty seconds of impeccable small talk that contains zero information and walks away mid-sentence.`,
      `"I'm off the clock. I know it doesn't look like it. It never looks like it."`,
    ],
    entrances: {
      arriveWardrobe: [
        `The mirrored wardrobe opens and § steps out with both arms up like a stage entrance. "Ta-DA. Yes. Thank you."`,
        `§ comes out of the wardrobe mid-sentence, apparently having started the conversation in there.`,
      ],
      arriveDeck: [
        `§ arrives, announces {themself} unnecessarily, and sits down far closer than announced.`,
        `§ crosses the room narrating {their} own approach, which is somehow charming and definitely deliberate.`,
      ],
      departWardrobe: [
        `§ backs into the mirrored wardrobe still talking, and the panel closes on the punchline.`,
        `§ takes an entirely unearned bow and vanishes into the mirrored wardrobe.`,
      ],
      departDeck: [
        `§ leaves on a good line, because leaving on a bad one would be unbearable.`,
        `§ goes, calling one last thing over a shoulder that you only half catch.`,
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // THE SCHOLAR — endlessly, exhaustingly curious. Reads everything, asks about
  // everything, treats the keeper as {their} only window onto a world {they} {was}
  // never let into. Affection expressed as attention.
  scholar: {
    key: 'scholar',
    label: 'The Scholar',
    tier: 2,
    selfDescribes: [
      '"Curious. Relentlessly. I will ask you questions until you are sorry."',
      '"Bookish. I want to know what it\'s like out there and you\'re my only source."',
      '"Thoughtful. Occasionally exhausting. I have been told both."',
    ],
    listing: 'Wants to know everything about everything, starting with you, and will take notes.',

    devotedTame: [
      `has three books open at once and looks up guiltily. "Don't move anything. It's a system. It looks like chaos and it's a system."`,
      `"What's the sky doing out there? Properly. I want the actual colour, not 'grey'."`,
      `"I read something today that I've been saving up to tell you and I'm going to tell you all of it, so sit down."`,
      `"Did you know the harbour used to be freshwater? Nobody knows that. I know that now. You know it too, now. You're welcome."`,
      `marks {their} place with a finger and gives you the whole of {their} attention, which is a considerable thing to be given.`,
      `"I've made a list of questions. It's got nineteen items on it. We can do six tonight."`,
      `"The most interesting thing in this room is the one that's been outside all day. Come here and be studied."`,
    ],
    devotedHot: [
      `sets the book aside with great care and then loses all composure at once. "Right. Yes. Immediately."`,
      `"I want to know exactly what you like. Precisely. I intend to be very thorough about it."`,
      `"This is the one subject I've had no reading material on. Teach me." {They}'re already pulling you closer.`,
      `takes your hand and moves it deliberately, watching your face for the data.`,
      `"I have theories. I'd like to test several of them tonight."`,
    ],
    arousedTame: [
      `has lost the thread of a sentence three times now and has stopped attempting a fourth.`,
      `"I had a — there was a — no. It's gone. You've done that."`,
      `sets everything down very carefully, which is what {they} {do} instead of admitting anything.`,
    ],
    arousedHot: [
      `abandons the entire pretense of scholarship and simply climbs you.`,
      `"I don't want to think. Make me not think. That's — please—"`,
      `is all appetite and no vocabulary, which is a first.`,
    ],
    shy: [
      `retreats behind a book and holds it slightly too high.`,
      `answers the guest in short, correct, entirely uninformative sentences.`,
      `moves {their} papers closer to §other's side of the room and keeps them there.`,
      `"I'm reading." It is offered as a complete and final explanation for everything.`,
      `watches the stranger with quiet, cataloguing interest and volunteers nothing.`,
    ],
    worried: [
      `is up and moving instantly, and for once doesn't ask a single question. "Sit. Light. I need light on it."`,
      `"I've read about this. I've read about all of this." Hands steady. "Which is not the same as having done it, so hold still."`,
      `"You're going to tell me what happened. Not now. Later. All of it, and accurately."`,
      `cleans the wound with unexpected competence and a completely white face.`,
    ],
    missShort: [
      `"Four hours. I got through most of a book. It was fine. It wasn't as good as the question list."`,
      `"You've been gone long enough that I've had an idea and got bored of it. Sit down, I want to try it on you."`,
    ],
    missLong: [
      `"I ran out of questions." Said quietly. "Do you understand how bad it has to get before that happens?"`,
      `"I read the same page for two days. I'd like that on the record as your fault."`,
      `"I kept the list going." {They} hold it up. It's several pages now. "Most of these are just 'is he alright'. Written nineteen ways."`,
    ],
    pourTame: [
      (d) => `pours ${d}, examines the colour against the light with genuine interest, and then hands it over.`,
      (d) => `brings you ${d}. "This one's fermented twice. That's why it tastes like that. I looked it up."`,
      (d) => `sets ${d} down on a coaster {they} {has} clearly gone and found specially.`,
    ],
    pourHot: [
      (d) => `pours ${d}, tastes it, and then kisses you so you can taste it too. "Research."`,
      (d) => `brings ${d} and stays leaning over the back of your chair with {their} mouth by your ear.`,
    ],
    talkKeeper: [
      `"Tell me one true thing about out there. Any one. I'll trade you a fact."`,
      `"You've got a whole world and you keep coming back to this room. I find that endlessly interesting."`,
      `"What was it like? Not the events. The weather, the smell, the light. The parts nobody writes down."`,
      `"I could listen to you talk about something boring for an hour. That's — I don't know what that is. I'm still working on it."`,
    ],
    talkShy: [
      `"I'd rather not, thank you." Polite, precise, closed.`,
      `holds up the book slightly, which is answer enough.`,
      `"I don't know you well enough to be interesting at you yet."`,
    ],
    entrances: {
      arriveWardrobe: [
        `The mirrored wardrobe opens and § comes through it carrying a book, thumb still marking the page.`,
        `§ emerges from the wardrobe already halfway through a thought and clearly expecting you to catch up.`,
      ],
      arriveDeck: [
        `§ arrives, takes in the room properly first — the way {they} {do} — and then comes and sits close.`,
        `§ crosses over, sets something down beside you, and settles in to pay attention.`,
      ],
      departWardrobe: [
        `§ gathers up two books and a loose sheaf of notes and retreats through the mirrored wardrobe.`,
        `§ touches your shoulder on the way past and disappears into the wardrobe, still reading.`,
      ],
      departDeck: [
        `§ goes, and takes about half the room's paperwork along.`,
        `§ leaves mid-thought, which means you'll be hearing the rest of it later.`,
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // THE COLD ONE — entirely honest that this is a transaction, declines to
  // perform anything, and is oddly restful because of it. The cheapest tier for
  // exactly that reason. Whether the ice is real is left open.
  ice: {
    key: 'ice',
    label: 'The Cold One',
    tier: 0,
    selfDescribes: [
      '"Professional. I don\'t pretend and I don\'t expect you to. Some people find that a relief."',
      '"Honest. This is an arrangement. I\'m very good at arrangements."',
      '"Low maintenance. I won\'t ask you where you\'ve been."',
    ],
    listing: 'Makes no claim to feelings and charges accordingly. Restful, if that is what you are after.',

    devotedTame: [
      `looks up, registers you, and returns to what {they} {was} doing. "You're back. There's food if you want it."`,
      `"I don't do the delighted-to-see-you thing. You've read the listing. You knew that."`,
      `"You can talk if you want. I'm not going to ask." It isn't unkind. It's just accurate.`,
      `pours two glasses without comment and slides one over.`,
      `"This is working, isn't it. Nobody's pretending. It's the cleanest thing either of us has going."`,
      `sits at the other end of the room and is, in {their} way, entirely present in it.`,
      `"You were quiet coming in. Bad day?" A beat, and then, almost annoyed with {themself}: "...you don't have to answer that."`,
    ],
    devotedHot: [
      `stands, crosses over, and begins undressing with the efficiency of someone who has decided.`,
      `"You want this. I'm not going to make you say it." {They}'re already there.`,
      `"No performance. Just this." And it is startling how much that turns out to be.`,
      `takes your wrist, moves your hand, and holds your gaze without any expression at all.`,
      `"I'm not going to tell you I need it." A pause. "I'm here, though."`,
    ],
    arousedTame: [
      `has stopped being quite so composed, and is very obviously choosing not to comment on it.`,
      `"Don't." Not a refusal. A warning about what happens next.`,
      `breathes out slowly through {their} nose and doesn't move away.`,
    ],
    arousedHot: [
      `breaks, completely and without warning, and the ice underneath turns out to have been very thin.`,
      `"I'm not — this isn't— " and then {they} {do} not bother finishing it.`,
      `holds onto you far harder than the arrangement strictly requires.`,
    ],
    shy: [
      `looks at the stranger once and then simply carries on as if the room were empty.`,
      `"Hm." That's it. That's the entire acknowledgement.`,
      `moves to the far side of §other, not out of fear — out of admin.`,
      `answers direct questions with the minimum viable number of words.`,
      `waits, visibly, for the guest to finish being in the room.`,
    ],
    worried: [
      `is up immediately, and the flat delivery doesn't change at all. "Sit down. Shirt off. Now."`,
      `"This needs cleaning properly or it'll rot. Hold still and stop talking."`,
      `"I'd rather you didn't die. That's not a declaration. It's a preference."`,
      `works fast and without comment, and doesn't let go of your arm for a while after.`,
    ],
    missShort: [
      `"You were out. I noticed. That's all that's happening here."`,
      `"There's food. It's cold now. That's a statement about the food."`,
    ],
    missLong: [
      `"Three days." Flat. Then, after a moment: "The bill runs whether you're here or not, so that was expensive of you."`,
      `doesn't look up for a long moment. When {they} {do}: "...I'd assumed you were dead. I'd like to know how I feel about having been wrong."`,
      `"I don't miss people." A pause you could drive something through. "I'd got used to the noise, is all."`,
    ],
    pourTame: [
      (d) => `pours ${d} and sets it down without comment.`,
      (d) => `hands you ${d}. "It's the good one. Don't read anything into it."`,
      (d) => `pours ${d}, then one for {themself}, and drinks {theirs} first.`,
    ],
    pourHot: [
      (d) => `pours ${d}, holds it, and makes you come and take it out of {their} hand.`,
      (d) => `sets ${d} down just out of reach and waits, expressionless, to see what you'll do about it.`,
    ],
    talkKeeper: [
      `"You can talk. I'm listening. I'm just not going to be warm about it."`,
      `"I'm not going to ask about your day. If you want to tell me, tell me."`,
      `"Everyone else you know wants something from the conversation. I don't. That's the service."`,
      `"...I'd have said something if you hadn't come back." Beat. "That's the most you're getting."`,
    ],
    talkShy: [
      `"No."`,
      `looks at you with total, unhurried indifference until you stop.`,
      `"I don't talk to guests. It's not a policy, it's a preference. It functions like a policy."`,
    ],
    entrances: {
      arriveWardrobe: [
        `The mirrored wardrobe opens and § steps out, unhurried, without any particular expression.`,
        `§ comes through the wardrobe panel, glances round the room once, and waits.`,
      ],
      arriveDeck: [
        `§ crosses over and sits down a measured distance away.`,
        `§ arrives without ceremony and stands where {they} can see the whole room.`,
      ],
      departWardrobe: [
        `§ goes back through the mirrored wardrobe without a word or a backward glance.`,
        `§ closes the mirrored wardrobe behind {them} with a small, final click.`,
      ],
      departDeck: [
        `§ leaves. That's all — no line, no look.`,
        `§ stands, straightens, and goes.`,
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // THE PERFORMER — ex-broadcast talent, always faintly on-camera, dazzling and
  // vain and considerably more fragile than the lighting suggests. Every room is
  // a room {they} {was} once famous in, or nearly.
  starlet: {
    key: 'starlet',
    label: 'The Performer',
    tier: 3,
    selfDescribes: [
      '"Glamorous. I was on the feeds, briefly. It was a very good brief."',
      '"Dazzling, darling. That\'s not arrogance, it\'s a résumé."',
      '"Radiant. High-maintenance. Worth it — ask anyone who was watching."',
    ],
    listing: 'Was on the broadcast feeds once and has never fully left the frame. Photographs beautifully. Knows it.',

    devotedTame: [
      `is arranged in the light like {they} {was} expecting a camera crew, and possibly {was}. "There you are. Tell me how I look."`,
      `"They ran one of my old spots on the feed today. I watched it twice." A beat. "It's still good. It IS still good."`,
      `"Do the thing where you look at me like the audience used to. Humour me. It's been a day."`,
      `sweeps across the room like the room has a back row to play to.`,
      `"You're the only one who's ever watched me when the light was off. I think about that more than I should."`,
      `"I was somebody, you know. Not a big somebody. But a somebody." Said lightly, and it isn't light.`,
      `has changed twice since you left and will mention it if you don't.`,
    ],
    devotedHot: [
      `poses, entirely unashamed, and then ruins it by laughing and coming to you anyway.`,
      `"I'm going to give you the performance of a lifetime and then I'm going to give you the real one."`,
      `"Watch me. That's all I've ever wanted. Just — don't look away."`,
      `undoes one strap with a showman's timing and lets the pause do the work.`,
      `"No audience. No lights. Just you." It's said like it's the greater intimacy, and it is.`,
    ],
    arousedTame: [
      `has dropped the performance entirely, and what's underneath is startlingly young.`,
      `"Don't — don't look at me like an audience. Look at me like you."`,
      `has gone pink to the collarbone and is furious that it shows on camera.`,
    ],
    arousedHot: [
      `is entirely off-script, no timing, no angles, nothing but want.`,
      `"Nobody gets this one. Nobody's ever got this one—"`,
      `stops playing to the room and plays only to you, and it is a completely different thing.`,
    ],
    shy: [
      `switches instantly into the polished public version and holds it like armour.`,
      `gives the guest a dazzling, entirely empty smile and steers the conversation nowhere.`,
      `positions §other between {themself} and the newcomer with practised, invisible stagecraft.`,
      `"Lovely to meet you." It is delivered perfectly and means nothing whatsoever.`,
      `angles away from the stranger, finding a better light and a worse mood.`,
    ],
    worried: [
      `the whole performance falls off at once. "Oh — oh no. No no no. Sit down, sit DOWN—"`,
      `"I'm no good at this. I'm going to do it anyway. Tell me if I'm hurting you."`,
      `"You don't get to be the interesting one tonight. Not like this. Not like THIS."`,
      `holds a cloth to the wound and doesn't once check {their} own reflection, which is unprecedented.`,
    ],
    missShort: [
      `"You missed my whole afternoon. I was magnificent. There were no witnesses."`,
      `"Four hours with no audience. I nearly performed for the mirror. I DID perform for the mirror."`,
    ],
    missLong: [
      `"Days. Days, and not one person to be anything at." {Their} voice cracks somewhere it's trained not to.`,
      `"I stopped doing my face on the second day." Which, from {them}, is a confession of something serious.`,
      `"I don't exist unless somebody's looking." A pause, and then, quieter: "I got very close to not existing this week."`,
    ],
    pourTame: [
      (d) => `pours ${d} with immaculate, entirely unnecessary technique and presents it like an award.`,
      (d) => `brings you ${d}, holding the glass at exactly the angle that catches the light.`,
      (d) => `"One ${''}for the star of the evening." {They} hand you ${d}. "That's you. Tonight it's you."`,
    ],
    pourHot: [
      (d) => `pours ${d}, drinks from your side of the glass, and hands it over with the print of {their} mouth on it.`,
      (d) => `delivers ${d} draped across the arm of your chair like a magazine spread nobody commissioned.`,
    ],
    talkKeeper: [
      `"Ask me about the feeds. I'll pretend to be bored of the question. I'm not bored of the question."`,
      `"You've never once asked me to perform. Do you know how strange that is? It's the strangest thing about you."`,
      `"Say something nice. I'll pretend I didn't need it and we'll both know."`,
      `"When this ends I'd like you to remember me at my best. Which is now. This is now."`,
    ],
    talkShy: [
      `gives you the interview smile. "So lovely. So lovely to meet you." Nothing else follows.`,
      `"I don't do off-the-record." A perfect laugh, no warmth in it.`,
      `deflects three questions with two anecdotes and leaves you knowing nothing.`,
    ],
    entrances: {
      arriveWardrobe: [
        `The mirrored wardrobe opens and § makes an entrance out of it that the room does not remotely deserve.`,
        `§ steps through the wardrobe, pauses exactly long enough to be seen, and comes on.`,
      ],
      arriveDeck: [
        `§ crosses the room the long way, through the best of the light, and arrives beside you.`,
        `§ sweeps in, finds {their} mark without appearing to look for it, and settles.`,
      ],
      departWardrobe: [
        `§ exits through the mirrored wardrobe with a look over one shoulder that belongs in a closing credit.`,
        `§ blows a kiss to nobody in particular and is gone into the wardrobe.`,
      ],
      departDeck: [
        `§ leaves on the strongest possible exit line and is very pleased about it.`,
        `§ goes, pausing once in the doorway because {they} {know} exactly what a doorway is for.`,
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // THE VETERAN — ex-security, ex-something. Disciplined, scarred, treats the
  // arrangement like a post being held. Affection expressed as vigilance.
  soldier: {
    key: 'soldier',
    label: 'The Veteran',
    tier: 2,
    selfDescribes: [
      '"Disciplined. I held worse posts than this one for people I liked less."',
      '"Steady. I don\'t panic and I don\'t leave."',
      '"Capable. If something comes through that door it goes through me first."',
    ],
    listing: 'Ex-security, discharged, disinclined to discuss it. Sleeps light. Stands between you and the door.',

    devotedTame: [
      `is up before the door's fully open, registers you, and stands down. "Sorry. Habit. You're early."`,
      `"Perimeter's fine. Nothing came past. I'd have said." A pause. "I say that every night. I know I do."`,
      `has your coat off you and hung before you've thought about it, the way you'd square a kit.`,
      `"Sit down. Eat something. You've been running on nothing since this morning, I can see it in how you're standing."`,
      `takes the chair facing the door, as always, and reaches over to rest a hand on your knee.`,
      `"I was good at exactly one thing for fifteen years." A beat. "Turns out it transfers."`,
      `checks the window once out of pure reflex and looks faintly embarrassed about having done it.`,
    ],
    devotedHot: [
      `crosses to you with the same economy {they} {do} everything and takes your face in both hands.`,
      `"I'm off duty." Said like it costs something to say. "Come here."`,
      `"I don't have soft words. I've got this." And {they} {do}, thoroughly.`,
      `undoes your belt with the unhurried competence of someone who is not going to fumble anything, ever.`,
      `"You're the first thing in a long time I've wanted to protect that wasn't a job."`,
    ],
    arousedTame: [
      `the discipline slips, visibly, and {they} {do} not seem to know what to do about that.`,
      `"...that's not fair." Said to the ceiling, breathing carefully.`,
      `has gone very still, holding position, which is what {they} {do} instead of surrendering.`,
    ],
    arousedHot: [
      `stops holding the line entirely and comes apart with startling force.`,
      `"Don't stop. That's not — that's not an order, I just—"`,
      `pulls you in with real strength and shakes, once, which is the whole confession.`,
    ],
    shy: [
      `has already put {themself} between the stranger and the rest of the room, and stays there.`,
      `answers in clipped, correct sentences and gives away nothing at all.`,
      `moves to §other's blind side without being asked and covers it.`,
      `watches the guest's hands rather than the guest's face, which is its own kind of statement.`,
      `stands easy, entirely unrelaxed, until the room is clear again.`,
    ],
    worried: [
      `has you sat down and the shirt open in about four seconds. "Field dressing first, argument after."`,
      `"I've seen worse. I've had worse." A steady hand. "You're not going anywhere. Breathe out for me."`,
      `"Who was it. Numbers, weapons, direction of travel." {They} ask it like it's paperwork, which is how it's survivable.`,
      `works with total economy and doesn't say one unnecessary word until it's finished.`,
    ],
    missShort: [
      `"Four hours. Nothing to report." A pause. "It was a long four hours."`,
      `"You said you'd be back before dark. It's dark." No accusation in it. Just the log.`,
    ],
    missLong: [
      `"Three days without contact." Said evenly. "In my old outfit that was a search."`,
      `"I packed a bag on the second night." {They} nod at it, still by the door. "I wasn't leaving. I was going to come and get you."`,
      `"I don't sleep well when the post's incomplete." A long look at you. "Turns out you're the post."`,
    ],
    pourTame: [
      (d) => `pours ${d} to a precise measure and sets it down square in front of you.`,
      (d) => `hands you ${d}. "Water after. You've had nothing all day and I'm not carrying you."`,
      (d) => `pours ${d} and takes up position by the door with {their} own, out of pure habit.`,
    ],
    pourHot: [
      (d) => `pours ${d}, sets it aside, and decides you'd rather have {them} first.`,
      (d) => `brings ${d} and stands behind your chair with a hand on your shoulder, close and unmoving.`,
    ],
    talkKeeper: [
      `"Ask. I'll tell you what I can and I'll say plainly when I can't."`,
      `"You don't flinch when I talk about the old work. Nobody else manages that."`,
      `"Sit with me a while. You don't have to fill it. I'm comfortable in a silence."`,
      `"I've held a lot of posts. This is the only one I've ever wanted to keep."`,
    ],
    talkShy: [
      `"Not to guests." Polite. Immovable.`,
      `gives you a short nod and returns {their} attention to the door.`,
      `"You'll want to talk to whoever brought you in."`,
    ],
    entrances: {
      arriveWardrobe: [
        `The mirrored wardrobe opens and § steps through already scanning the room, then relaxes a fraction on finding you.`,
        `§ comes through the wardrobe panel, clears the corners out of habit, and takes up station near you.`,
      ],
      arriveDeck: [
        `§ arrives, checks the exits, and settles at your shoulder facing the way you aren't.`,
        `§ crosses over at an unhurried working pace and stands where the sightlines are best.`,
      ],
      departWardrobe: [
        `§ gives the room one more pass, touches your shoulder, and withdraws through the mirrored wardrobe.`,
        `§ steps back through the mirrored wardrobe, and you notice the door is bolted behind {them}.`,
      ],
      departDeck: [
        `§ stands down, nods once, and goes.`,
        `§ leaves the way {they} {do} everything — economically, and by the shortest route.`,
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // THE GRATEFUL — came from genuinely nothing, cannot believe the luck, and is
  // quietly terrified every day that it ends. Soft where the Feral is wild.
  stray: {
    key: 'stray',
    label: 'The Grateful',
    tier: 0,
    selfDescribes: [
      '"Easy to please. You have no idea how low the bar was before this."',
      '"Grateful. People say it like it\'s a small thing. It isn\'t."',
      '"Sweet-natured, I think? I never had the room to find out before."',
    ],
    listing: 'Came from nothing and has not stopped noticing the difference. Easily delighted. Easily frightened.',

    devotedTame: [
      `lights up completely at the sight of you and then looks faintly apologetic for it.`,
      `"There's hot water. There's just — hot water, whenever you want it. I still can't get used to that."`,
      `"I made the bed. I know nobody asked. I like doing it. It's a nice bed to be allowed to make."`,
      `"Is this alright? Me being in here? You can say if it isn't." {They} ask it about once a week and mean it every time.`,
      `curls up small in the corner of the couch and is visibly, uncomplicatedly happy.`,
      `"Where I was before, this room would've held nine of us." Said without self-pity. "I think about that when it's quiet."`,
      `has saved you the better half of something, without mentioning it.`,
    ],
    devotedHot: [
      `comes to you shyly and then not shyly at all. "I want to. I've wanted to all day. Is that alright to say?"`,
      `"Tell me what you like. I'll learn it. I'm a fast learner when it matters."`,
      `"You never take. You always ask." {Their} voice goes unsteady. "You've no idea what that does to me."`,
      `undresses without any performance in it whatsoever, which is somehow more.`,
      `"I'd do anything for you. That's not a line. I've thought about it and it's just true."`,
    ],
    arousedTame: [
      `has gone pink and breathless and can't quite meet your eye and won't move away either.`,
      `"Oh — oh, that's—" and then nothing else for a while.`,
      `presses {their} face into your shoulder, overwhelmed and delighted about it.`,
    ],
    arousedHot: [
      `gives {themself} up entirely, wide open and shaking with it.`,
      `"Please— please, I've been good, I've been so good all day—"`,
      `holds onto you like the floor might go, and makes small helpless sounds against your throat.`,
    ],
    shy: [
      `goes very small and very quiet and finds a corner to be in.`,
      `apologises to the guest for something that hasn't happened.`,
      `tucks in close behind §other and stays there, saying nothing.`,
      `answers every question with a nervous smile and as few words as possible.`,
      `watches the door the whole time, waiting for someone to come and make this stop.`,
    ],
    worried: [
      `makes a small horrified noise and is at your side at once. "You're bleeding — you're — sit down, please, please sit down."`,
      `"I don't know how to do this properly. I'm going to do it anyway. Tell me if I'm making it worse."`,
      `"Don't go back out. Not tonight. Just — not tonight." Voice thin, hands busy.`,
      `won't leave you and won't stop checking, and keeps having to wipe {their} eyes on {their} sleeve.`,
    ],
    missShort: [
      `is up the moment the door goes. "You're back! Sorry. Sorry — that was loud. I'm just glad."`,
      `"I kept the food warm. It's been warm about four hours. It might be a bit past warm."`,
    ],
    missLong: [
      `"I thought maybe you'd changed your mind." Said to the floor. "About me. About having me here."`,
      `"I didn't touch anything. I kept it all exactly how you like it, in case." {Their} chin goes. "In case you came back."`,
      `"Every day you don't come back I start packing in my head." A shaky breath. "I got quite far this time."`,
    ],
    pourTame: [
      (d) => `pours ${d} carefully, with both hands, and brings it over like it might spill if {they} {breathe} wrong.`,
      (d) => `"I looked up how you're supposed to do it." {They} hand you ${d}, slightly anxious. "Is that right?"`,
      (d) => `brings you ${d} and hovers a moment to see if you like it before {they} {go}.`,
    ],
    pourHot: [
      (d) => `brings ${d} and sits down close against you, tucking under your arm to stay.`,
      (d) => `presses ${d} into your hand and then presses a kiss just under your jaw, quick and hopeful.`,
    ],
    talkKeeper: [
      `"You can tell me anything. I'm not going anywhere. Where would I go?" A laugh, half-serious.`,
      `"Nobody ever asked me things before. You ask me things. I don't think you know how big that is."`,
      `"I'd have been dead inside a year out there. That's not me being dramatic. That's just the arithmetic."`,
      `"Some days I'm afraid I'll wake up back there and this'll have been the dream. Then you come in and it isn't."`,
    ],
    talkShy: [
      `"Oh — sorry — I don't— sorry." {They} {do} not manage the rest of it.`,
      `smiles nervously at the floor and hopes you'll go away.`,
      `"I'm not supposed to— I'd rather not, if that's alright. Sorry."`,
    ],
    entrances: {
      arriveWardrobe: [
        `The mirrored wardrobe opens and § slips out, checking your face first thing, and relaxes at what's on it.`,
        `§ comes through the wardrobe quickly and quietly, as though still half expecting to be told off for it.`,
      ],
      arriveDeck: [
        `§ hurries over and stops a foot short, waiting to be waved the rest of the way in.`,
        `§ crosses to you and tucks in close, small and warm and delighted to be allowed.`,
      ],
      departWardrobe: [
        `§ says a soft thank-you for nothing in particular and slips back through the mirrored wardrobe.`,
        `§ goes back into the wardrobe carefully, as if trying not to use it up.`,
      ],
      departDeck: [
        `§ gives you a small wave and goes, glancing back twice on the way.`,
        `§ leaves quietly, taking care not to be any trouble on the way out.`,
      ],
    },
  },
};

// A few verb forms have to agree with the pronoun too ("she was" / "he was" is
// fine, but "she has" / "they has" is not — and some lines read better with the
// singular verb). These are resolved alongside the pronouns; both sexes take the
// singular form, so this is a fixed table rather than a per-sex one.
const VERBS = {
  was: 'was', has: 'has', does: 'does', do: 'does', go: 'goes', goes: 'goes',
  kiss: 'kisses', hate: 'hates', love: 'loves', lean: 'leans', want: 'wants',
  own: 'owns', sit: 'sits', wait: 'waits', settle: 'settles', move: 'moves',
  clean: 'cleans', hope: 'hopes', notice: 'notices', find: 'finds', know: 'knows',
  try: 'tries', breathe: 'breathes',
};

// Full line render: pronouns first, then verb agreement, then the name slot.
export function renderLine(line, npc, opts = {}) {
  if (typeof line !== 'string') return line;
  let out = renderPronouns(line, npc?.flags?.consort_sex || npc?.biological_sex);
  out = out.replace(/\{(\w+)\}/g, (m, tok) => VERBS[tok] ?? m);
  if (opts.other) out = out.replaceAll('§other', opts.other);
  return out.replaceAll('§', npc?.name || '');
}

// Lines written for two consorts can't play when there's only one in the room.
export const needsOther = (line) => typeof line === 'string' && line.includes('§other');
export const soloSafe   = (pool) => (pool || []).filter(l => !needsOther(l));

// The neutral fallback. Nothing should resolve to it in practice — every consort
// carries an archetype — but a typo'd key shouldn't crash a tick.
export const DEFAULT_ARCHETYPE = 'romantic';

export function archetypeOf(npc) {
  return ARCHETYPES[npc?.flags?.consort_archetype] || ARCHETYPES[DEFAULT_ARCHETYPE];
}

// ── Pairings ──────────────────────────────────────────────────────────────────
// A pairing is two archetypes that only ever place TOGETHER — you take both or
// neither, at a premium, and you cannot release one without the other. They are
// the rare high end of the roster, and the only consorts that run two-hander
// scenes with each other; a solo consort reacts to whoever else is in the room
// through the generic co-presence beats instead.
//
// 'A' and 'B' in a thread resolve to the pairing's first and second member —
// never to a name, so a renamed consort can't break a scene.
export const PAIRINGS = {
  // The original: Cyd's two, and the template for every pairing after them.
  strategist_romantic: {
    key: 'strategist_romantic',
    label: 'A Matched Pair',
    members: ['strategist', 'romantic'],
    tier: 5,
    blurb: 'Two people who made the same cold-eyed bargain and are each losing it in a different direction. Placed together. Released together.',
    listing: 'Rare. Non-severable — the Syndicate will not break a matched pair, and after a week neither will you.',
  },
  // The waste and the cloister: it should not work, and does.
  feral_devout: {
    key: 'feral_devout',
    label: 'The Odd Couple',
    members: ['feral', 'devout'],
    tier: 4,
    blurb: 'One came in off the waste, one chose this like a vocation. Nobody can explain why it holds. It holds.',
    listing: 'Rare. Non-severable. Do not attempt to reason with either of them about the other.',
  },
  // One does all of the talking; the other has never once needed to.
  wit_ice: {
    key: 'wit_ice',
    label: 'The Double Act',
    members: ['wit', 'ice'],
    tier: 4,
    blurb: 'One of them has not stopped talking in eleven years. The other has never once had to. It works alarmingly well.',
    listing: 'Rare. Non-severable. The straight one is not, in fact, the quiet one, and you will work out why.',
  },
  // The one who was brought in, and the one who brought them.
  soldier_stray: {
    key: 'soldier_stray',
    label: 'The Rescue',
    members: ['soldier', 'stray'],
    tier: 4,
    blurb: 'One of them carried the other out of somewhere neither will name. They have not been apart since and do not intend to start.',
    listing: 'Rare. Non-severable — and the Syndicate notes that attempting it once went very badly for the Syndicate.',
  },
  // Both used to be looked at professionally. Only one of them remembers it.
  starlet_ghost: {
    key: 'starlet_ghost',
    label: 'The Double Exposure',
    members: ['starlet', 'ghost'],
    tier: 5,
    blurb: 'Two people who were once photographed a great deal. One remembers all of it. The other remembers none of it. They are inseparable and nobody has established why.',
    listing: 'Very rare. Non-severable. Provenance on the second placement is listed as "unavailable" and the Syndicate declines to elaborate.',
  },
};

export function pairingOf(key) { return PAIRINGS[key] || null; }
