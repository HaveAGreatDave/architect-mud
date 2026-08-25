/**
 * Long Watch dialogue.
 *
 * Writes only `text`, `first`, `text_by_relation` and option labels. Node keys,
 * option order, `next` targets, conditions and actions are asserted unchanged.
 *
 * The trees held two registers: an older one with contractions and a generic
 * gruff mentor ("Green line'll walk you there"), and a newer one that sounds
 * like this order ("I do not much care what. I care that it came out of your
 * hands"). This unifies on the second.
 *
 * ⚠ Five em dashes had crept in, roughly one per NPC. The script fails the run
 * rather than writing one.
 *
 * ⚠ Action `reason` strings are exempt from the dash sweep. They are relations
 * bookkeeping written to player_npc_relations and never rendered. Cyrelle's
 * ret_report carries one.
 *
 * The Watch's case against the Ascendants is two things, and every rung says
 * one of them: your hands are the last thing you own outright, and taking the
 * offer makes you a row in a file that somebody who never met you can close.
 * Halcyon's answer is that this is already true of everybody, and that they at
 * least say so. Neither side is written to lose.
 *
 *   node scripts/content/rewrite-order-dialogue-lw.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const NPCS = path.join(process.cwd(), 'content', 'npcs');
const CHECK = process.argv.includes('--check');

// npc -> node -> { text?, first?, rel?: {tier: str}, labels?: {index: str} }
const D = {

  // ═══ HALLORAN · the door. Reads hands before faces. ═══════════════════════
  npc_lw_halloran: {
    root: {
      text: 'A bell rattles as you come in. The lean man looks up from a gutted motor, and his eyes go to your hands before your face.\n\n"If it is broken, set it on the bench. If it is not," and he tips his head at the racked tools, "I have likely got what you need anyway. Halloran."',
      labels: { 0: 'Anything moving tonight?', 1: 'Nobody came.', 2: 'Something is broken. Can you fix it?', 3: 'Show me what you have got.', 5: 'About that package.', 6: 'What is the next job?', 7: 'I have the eye.', 8: 'Give me the real work.', 9: 'The drone is scrap.', 10: 'Anything I should know, Halloran?', 11: 'Need a pair of hands at the bench?', 12: 'I made you something.' },
    },
    repair_talk: {
      text: '"Bring it here." He clears a space on the bench with his forearm.\n\n"I fix what the city has given up on. Radios, motors, pumps, the honest machines that do not need the grid holding their hand. Costs less than a new one and it will outlive you."\n\nHe sets the iron down.\n\n"That is not nostalgia. That is engineering."',
    },
    lw_reveal: {
      text: 'The easy craftsman\'s manner goes out of him like a switch thrown. For a long moment he looks at your hands, and then at your eyes.\n\n"Somebody sent you. And you lean the right way, or you would never have got hold of the words."\n\nHe sets down the iron.\n\n"This shop is a door and you have knocked on it. The Watch do not open a door on a stranger\'s say so. You want in, you earn it. Small first. Then real."\n\n"Still listening?"',
      labels: { 0: 'I am listening.', 1: 'Forget I said anything.' },
    },
    lw_offer_1: {
      text: '"Simple thing. There is a package waiting at a drop by the Hall of Records. You go, you collect it, you bring it back here. You do not open it, you do not let anybody see it, and you are not seen doing any of it."\n\nA thin smile that does not last.\n\n"It is not what is in the parcel that matters. It is whether your hands can be trusted holding it. That is the only question this shop has ever asked anybody."',
      labels: { 0: 'I will carry it.', 1: 'Not yet.' },
    },
    lw_accept_1: {
      text: '"Green line will walk you there. Quiet in, quiet out." He turns back to the bench. "Come and see me when you have got it."',
      labels: { 0: 'On it.' },
    },
    lw_report_1: {
      text: 'He takes the package, feels its weight without looking at it, and nods once.\n\n"Clean. No tail, no fuss. That is rarer than you would think."\n\nHe tucks it away under the bench, where it will sit until somebody else takes it somewhere else.\n\n"You will do. There is realer work when you want it. Ask me."',
      labels: { 0: 'What is next?' },
    },
    lw_offer_2: {
      text: '"Now we find out whether you will put your hands on the machine itself."\n\nHe unrolls a scrap of paper, a street corner sketched from memory and corrected twice.\n\n"There is a camera on the Precinct 9 approach the Watch have wanted dark for months. I do not want it smashed. Smashed gets noticed, and replaced, and somebody writes a report about vandals. I want the memory core pulled, clean, so that it simply stops seeing and everybody spends a month arguing about why."\n\n"Bring me the eye."',
      labels: { 0: 'Tell me.', 1: 'Later.' },
    },
    lw_accept_2: {
      text: '"The housing pops if you know where to press. Green line will take you." He holds your eye. "Do not be seen doing it. The whole point is that nobody ever knows it went dark on purpose."',
      labels: { 0: 'Consider it blind.' },
    },
    lw_report_2: {
      text: 'He turns the dead core over in his fingers, and for the first time he actually smiles.\n\n"One less eye. You have no idea how good that feels."\n\nHe puts it in his pocket rather than on the bench, which is not where things go.\n\n"One more, and it is the real thing. When you are ready, ask."',
      labels: { 0: 'There is more, is there not.' },
    },
    lw_offer_3: {
      text: '"The Architect runs a maintenance drone through the deep east tunnels. Eleven years it has run the same loop and nobody minded it. Lately it has started logging things it did not use to log. Our marks. Our door."\n\nHis voice drops, not for effect. It is just where his voice goes.\n\n"Nobody is coming for us tomorrow. That is not the worry. The worry is the record sitting there being patient, and somebody reading it in five years who does mean it."\n\n"Go down into the deep, all the way down, and put it in the water for good. Do that and you are not a stranger who knew the words. You are one of ours."',
      labels: { 0: 'Give me the real work.', 1: 'Not today.' },
    },
    lw_accept_3: {
      text: '"It is deep, and it is mean, and the tunnels between here and it are worse. Go lit. Go careful." He grips your shoulder once, hard. "Come back and I will open the real door for you."',
      labels: { 0: 'It is already scrap.' },
    },
    lw_report_3: {
      text: '"It is done, then." He says it quietly, the way a man says a thing that mattered.\n\n"The machine is down an eye and a hand, and the Watch are up a good one."\n\nHe wipes his hands on the cloth and offers you one, which is the first honest gesture he has made you.\n\n"The blast door in the deep knows you now. Walk in whenever you like. Welcome to the Long Watch."',
      labels: { 0: 'So what am I now?' },
    },
    lw_member: {
      text: '"One of ours. Took your time, but they all do."\n\nHe nods toward the back of the shop.\n\n"Two ways home now. The long crawl from the old drain, or straight down through my back room and you are on the doorstep. The Quartermaster will see you kitted. Cyrelle runs operations and she will have work for you."\n\nA dry look.\n\n"Keep the lights on. Take back the switch."',
      labels: { 0: 'I will go down.' },
    },
    meet_offer: {
      text: 'He does not look up from the bench.\n\n"There is a runner coming in from the east with something I would rather have in my hand than on a wire. Sit in the Den and take it off her."\n\n"She will know you. You will not know her, and you are not to ask, and if she is not alone you are a man waiting for a bus."\n\nHe turns the thing in the vice a quarter turn.\n\n"Wait for her. That is the job. Wait for her."',
      labels: { 0: 'I will sit it.', 1: 'Not tonight.' },
    },
    meet_accept: { text: '"Good." The vice turns again. "Take a book."' },
    meet_report: {
      text: 'Halloran puts down what he is holding, which he did not do for either of the other two jobs.\n\n"Go on, then."',
      labels: { 0: 'Nobody came. I sat the whole night.', 1: 'She came. Handed it over, went straight back out.' },
    },
    meet_truth: {
      text: '"Right," he says, and goes back to the bench, and that is all he says for a while.\n\nThen: "How long did you give her?"\n\nYou tell him. He does something with his mouth that is not quite a smile.\n\n"That is longer than I would have."',
      labels: { 0: 'There was no runner, was there.' },
    },
    meet_truth2: {
      text: '"No."\n\nHe does not dress it up and he does not apologise for it.\n\n"Everybody who comes through that door can carry a box. What I cannot see from here is what a man does with two hours and nobody watching him, and there is no way to ask that turns up a true answer. So I do not ask."\n\nHe picks the thing back up.\n\n"You will be asked to hold a room one day with something in it that matters. I know what you are now. Go and eat."',
    },
    meet_lie: {
      text: '"Did she." He nods slowly, and goes back to the bench, and does not ask you what she looked like, which you notice about four seconds too late.\n\n"Right you are."\n\nThe vice turns. He does not look up again, and the conversation is over, and nothing whatsoever appears to have gone wrong.',
    },
    bench_offer: {
      text: '"I do not need the help." He says it while clearing a space at the bench, and then says it again, and keeps clearing.\n\n"The Watch run on things that were made rather than bought. That is not a philosophy. It is a supply problem. Nobody sells to us, and the ones who would want paying in a currency we do not keep. So the making gets done by whoever is standing there."\n\nHe pushes a stool out with his foot without turning round.\n\n"Today that is you."',
      labels: { 1: 'Another day.' },
    },
    bench_accept: {
      text: '"Make me something. I do not much care what. I care that it came out of your hands."',
      labels: { 0: 'Out of my hands.' },
    },
    bench_report: {
      text: 'Halloran turns it over twice, the way he turns everything over, and puts it on the shelf with the rest instead of handing it back.\n\nWhich is the review.',
    },
    bye: { text: '"Mind the step." He has already turned back to the bench, and the shop is a shop again.' },
  },

  // ═══ PIKE · eleven years on a stool. The discipline is not doing things. ═══
  npc_lw_pike: {
    root: {
      text: 'The big man lifts his mug in greeting without getting up.\n\n"Welcome in. Pike." He tips his head at the sealed door behind you. "You got past that, so you are one of ours, which means you can finally put your back to a wall and mean it."\n\n"Warm stove through in the commons."',
      labels: { 0: 'How safe is safe?', 1: 'Can you teach me anything?', 2: 'Anything need sitting?', 3: 'I sat the Blind.', 4: 'I want to stand the watch.', 5: 'Nothing happened. All night.' },
    },
    door: {
      text: '"That door opens for people the Watch have squared with. You are standing inside it, so that is you now."\n\nHe nods at the dark beyond.\n\n"Out there the machine has eyes in every wire. In here it has nothing. No cameras, no police, no record you were ever in this room. Heat on you? Sit a while. It cools faster down here than anywhere in the Basin."\n\n"That is the whole point of the place."\n\nThen he tips the mug at the wall behind the stove, where somebody has scratched a column of names into the brick. It is not a short column, and there is a great deal of brick left under it.\n\n"And that is the cost of the place. We do not keep them on a screen. A screen can be switched off by somebody who never met them."',
    },
    teach: {
      text: '"Teach." Pike considers the mug rather than you.\n\n"I can show you two things and they are the same thing twice. How to stand for a long time without it costing you anything, and how to breathe while you do it."\n\nHe shifts on the stool, which is the most he has moved since you came in.\n\n"That is not modesty. Everybody who has ever lasted down here started with those two, and most of what comes after is people dressing them up. `train body`, or `train breath`. Bring the rest of it to somebody who has seen more than a door."',
      labels: { 0: 'I will come and stand, then.' },
    },
    sit_offer: {
      text: '"Somebody has to sit the Blind while somebody else sleeps." He says it the way you would mention weather.\n\n"Mirror looks down the wash. Shortwave talks to itself. The whole of the job is that you are there, and you are awake."\n\n"I have sat it about ten thousand times. I will not thank you for it, and neither will anybody else, and that is not rudeness. It is that somebody sitting there is the ordinary state of things, and you do not thank the ordinary state of things."',
      labels: { 0: 'I will take a turn.', 1: 'Another time.' },
    },
    sit_accept: {
      text: '"Do not open the door. If something comes down the wash you watch it come, and you write the time, and you do not open the door."',
    },
    sit_report: {
      text: 'He takes the stool back without ceremony. "Anything?"\n\nYou say no.\n\n"Good," says Pike, and means it.',
    },
    rite_offer: {
      text: '"Right." Pike puts the mug down, which you have not seen before.\n\n"Everyone thinks the rite is the sitting. It is not. Anybody can sit. I have sat for eleven years and it has never once been difficult. It has only ever been long."\n\n"The rite is that you have been sat here long enough to know exactly where to put your hands. And then you go and put them there."\n\nHe tells you the rest of it flatly, the way you would read out a list.\n\n"The vats. Not the Spire, not the man at the top, not the money. The vats, because that is where they keep the thing they are actually selling, and every single person who has ever said yes to them said yes to that room. Bring the colonnade down."\n\n"And the woman at the gate. Ives. She has spent six years putting a price on our people and she is very good at it, and she is the reason two of the names on that wall are on that wall. On your way out."\n\nHe looks at you properly for the first time in all of this.\n\n"Then come home. That is not decoration. Three of us have done this and one came back."',
      labels: { 0: 'Where do I get a charge?', 1: 'Understood.', 2: 'Not tonight.' },
    },
    rite_charge: {
      text: '"The Quartermaster has one on the counter. She has had one on the counter since the day you walked in, and she will not look at you while you pick it up, and you are not to hold that against her."\n\n"You wire it, and you set the fuse yourself, and the fuse is the only part of this that is nobody\'s business but yours. Short and you are running. Long and somebody finds it."',
      labels: { 0: 'All right.', 1: 'I need to think about it.' },
    },
    rite_accept: {
      text: 'He stands, stretches something that clicks, and takes the mug off you rather than handing it over.\n\n"I will keep this warm."',
    },
    rite_report: {
      text: 'Pike is on the stool when you come down the stair, which means he has been on it the whole time, which means he did not sleep either.\n\nHe looks at the state of you. He looks at the door behind you. Then he looks back down the wash, out of habit, and asks the only question the Watch has ever asked anybody.\n\n"Anything?"\n\nAnd you tell him: no. Nothing behind you. Nothing following.\n\nHe nods once and moves along the bench to make room, and that is the whole of it, and it is a great deal more than it looks.',
      labels: { 0: 'Nothing. Nothing at all.' },
    },
    kept: { text: 'Pike nods at the stool as you pass, which he does now, and did not before.' },
    bye: { text: '"Go on in. You are safe here." He settles back onto his stool.' },
  },

  // ═══ CYRELLE · runs operations. Decides what the Architect gets to see. ═══
  npc_lw_cyrelle: {
    root: {
      text: 'She does not turn from the map at first.\n\n"New blood. Halloran vouches for you, and Halloran is not generous with that."\n\nNow she looks.\n\n"I am Cyrelle. I run operations down here, which is to say I decide, most days, what the Architect gets to see next. Sit with that a moment, and then tell me what you want to know."',
      labels: { 1: 'Tell me about the map.', 2: 'What does the Watch actually want?', 3: 'I am here to work.', 4: 'Something about Halcyon has been bothering me.', 5: 'About that Halcyon money.', 6: 'I climbed the Spire. Halcyon is them.', 7: 'She is here. She is standing right there.' },
    },
    map: {
      text: '"Every red mark is one of the Architect\'s eyes." She sweeps a hand across the east of the Basin. "Every one struck through is an eye we have closed."\n\n"It looks like a small thing, one camera. It is not. A blind spot is a place people can breathe, and meet, and move, and a place the machine has to guess about. String enough of them together and you have something it cannot see at all."\n\n"You have a city with rooms of its own again."',
      labels: { 0: 'And the blind spots?' },
    },
    blind: {
      text: '"That is the long game. It is slow, and it is the only one worth playing."\n\nShe does not smile yet.\n\n"Do the arithmetic before you decide you are impressed. There are sixty-one of us. On the other side there is a machine that owns every wire in the Basin, and a chrome city out west that can print a new body faster than we can bury an old one. Nobody sensible takes that bet. I want you to know that I know it."\n\nNow the smile, and it is thin, and it is real.\n\n"But a machine has to be told where to look. That is the one thing it has never been able to do for itself. So we do not win this with a bomb. We win it one dark corner at a time, until the map is more ours than his, and one morning it goes looking for us and finds a city with rooms of its own again."',
      labels: { 0: 'I will take the work.' },
    },
    work: {
      text: '"There will be operations for you soon enough. Cameras to close. People to move out from under the machine\'s eye. Its little servants to inconvenience."\n\nShe taps the map.\n\n"For now, get the lie of the place. Talk to the Quartermaster. Rest while you can. When there is a run with your name on it you will hear about it."',
      labels: { 0: 'Understood.' },
    },
    asc_reveal: {
      text: 'Cyrelle sets down the grease pencil, which is rare.\n\n"Bothering me too. Halcyon settles its biggest claims by moving money west, past the grass, off every map we keep. Insurance does not work like that. Insurance argues. Insurance delays. Something out there is wearing Halcyon\'s face and it has never once argued a claim."\n\nShe studies you.\n\n"You have earned enough rope to go and pull on it. Quietly. Find out what is west, and do not let them learn you are Watch."',
      labels: { 0: 'Go on.', 1: 'Forget it.' },
    },
    asc_offer: {
      text: '"Start at the source. The claims hall in Halcyon Towers. Watch where the payouts route, and then follow the track west until it stops being grass."\n\nA beat.\n\n"I do not know what is out there. That is exactly why I want eyes that will come back."',
      labels: { 0: 'I will go west.', 1: 'Not yet.' },
    },
    asc_accept: {
      text: '"Green line will start you at Halcyon. Eyes open, mouth shut." She picks the pencil back up. "Come and tell me what breathes out there."',
      labels: { 0: 'Consider it done.' },
    },
    asc_report: {
      text: 'She listens to all of it without moving, which is how you know it has landed hard.\n\n"A chrome city. Turrets. A Gate that turns you away."\n\nShe exhales slowly.\n\n"So that is where the money has been going. Whatever that place is, it is the machine\'s friend and not ours."\n\nA long look, and she does not soften it.\n\n"Learn what it is, if you are going back. But Halcyon. Do not ever trust a payout from them again."',
      labels: { 0: 'There is a whole complex out there.' },
    },
    asc_after: {
      text: '"Dig carefully. A door that opens for you out there opens for a reason, and the reason is not you."\n\nShe is already marking the western edge of the map, a shape she does not have a symbol for yet.',
      labels: { 0: 'I will keep digging.' },
    },
    ret_reveal: {
      text: 'She sets the grease pencil down and this time she does not pick it back up.\n\n"Say the last part again."\n\nYou do. Cyrelle stands very still in front of a map covered in eyes she has spent her life closing.\n\n"So the payouts were not going west to somebody. They were going west to themselves."\n\nA flat sound that is not a laugh.\n\n"An insurance company that owns the afterlife it is underwriting. No wonder they never argue a claim."',
      labels: { 0: 'There is more. They keep the ones who lapse.', 1: 'That is all I have.' },
    },
    ret_offer: {
      text: '"I told you the first day there would be work. Cameras to close. Its little servants to inconvenience."\n\nShe finally turns all the way round.\n\n"And people to move out from under the machine\'s eye. That is the one I have never been able to hand anybody, because we have never had somebody inside worth moving."\n\n"Now we do. And she found us."',
      labels: { 0: 'Who is she?', 1: 'Not this one.' },
    },
    ret_offer2: {
      text: '"A sub-registrar in the Vats. Nine years filing the accounts they stopped paying to run."\n\nA short breath.\n\n"She is not a defector. She is a clerk who read her own filing cabinet and could not stop reading it. She will hand us the whole archive. She will not do it from inside that building, and she cannot get out of it on her own."',
      labels: { 0: 'I will walk her out.', 1: 'Let me think about it.' },
    },
    ret_accept: {
      text: '"Then go and get her."\n\nShe marks the Vats on the wall, and for once it is not a red eye. It is a circle.\n\n"Two rules and I am not flexible on either. You do not put a floor supervisor in the ground. Kill one of Halcyon\'s middle managers and by morning we did not rescue a witness, we murdered a man in a polo shirt, and every name on that slate turns into paperwork nobody will ever read. Cosh them, lock them in a cupboard, walk around them. I do not care which."\n\nShe looks up.\n\n"And you come back at her pace. Not yours. She is carrying everything she is and she cannot run with it. If you get here without her, do not get here."',
      labels: { 0: 'At her pace.' },
    },
    ret_report: {
      text: 'Cyrelle looks at the woman sitting on a crate in her bunker, and then at the slate, and then at the woman again, and she takes the slate second.\n\n"Nine years." She does not say it to you. "Nine years of writing down who they were never going to bring back, and filing it, and coming in the next day."\n\nShe thumbs the archive open, reads for a while, and her face does something Halloran would not believe if you told him.\n\n"You understand what this is. It is not proof they are a cult. Nobody cares about a cult. It is proof an insurer is selling a resurrection it has already decided not to perform."',
      labels: { 0: 'Eleven thousand and forty.' },
    },
    ret_after: {
      text: '"Eleven thousand and forty." She says the number the way you would test a weight. "Every one of them a policy somebody\'s mother is still paying into. That is not a cult out there. That is a debt collector with a chapel."\n\nShe looks past you at the woman on the crate.\n\n"She keeps the room. She keeps the name. Anybody asks, she is Watch now, and the Watch do not file people."',
      labels: { 0: 'I will be around.' },
    },
    cross_meet: {
      text: 'She does not put a light on. She is on the stool by the type cases with her coat still buttoned, and she has clearly been there a while, and she is not surprised.\n\n"Six nights," she says. "Halloran said four. I said seven. It was six."\n\nShe does not get up.\n\n"Sit down. You have had a long walk and you are going to have a longer one back."',
      labels: { 0: 'How long have you been sitting here?', 1: 'Say what you came to say.' },
    },
    cross_meet2: {
      text: '"Here is what I am not going to do. I am not going to tell you that you have made a terrible mistake, because you know, and being told is what makes a person dig in."\n\nShe nods at the press behind her.\n\n"Take the address. Genuinely, take it. It is a machine and we have two more, and the day they come for it is the day we find out how many of them are prepared to be seen carrying a crate out of a basement."\n\nA long pause, and she is not performing it.\n\n"But you are still on the rota. Nobody has crossed you off. That is not sentiment. Crossing somebody off is a decision, and I am not making it while there is any version of this where you come back."',
      labels: { 0: 'They are going to win, Cyrelle.', 1: 'What would it take?', 2: '(take the address and go)' },
    },
    cross_open: {
      text: '"Nothing you would have to do tonight." She says it carefully, the way you say a thing you have rehearsed and do not want to sound rehearsed.\n\n"You would have to still be a person we could reach. That is all it is at this stage, and I am aware of exactly how much I am asking for and how little I am offering back."\n\nShe stands, finally, and pulls her coat straight.\n\n"Go on. He will want it before morning, and you should not be the last one out of this building."',
      labels: { 0: 'I will think about it.' },
    },
    cross_refuse: {
      text: 'She takes it better than you were braced for, which is worse.\n\n"All right."\n\nShe moves off the stool to let you past the type cases, and she is careful not to touch you doing it, and that is the part you will remember.\n\n"For what it is worth, and it is worth nothing: I do not think you are a coward and I do not think you were bought. I think you did the arithmetic and got the right answer."\n\nShe sits back down in the dark.\n\n"I have done it too. I just could not make myself live in it."',
    },
    bye: { text: '"Stay sharp." She turns back to the map, already somewhere else.' },
  },

  // ═══ THE QUARTERMASTER · two ledgers. Can recite the shorter one. ═════════
  npc_lw_quartermaster: {
    root: {
      text: 'She looks up and marks her place in the ledger with one finger.\n\n"So they let you in. Good for you."\n\nA measuring glance, head to boots, and it takes about four seconds.\n\n"I am the quartermaster. What the Watch trusts you with depends on what you have done for the Watch. But you are inside the door, so let us see what fits."',
      labels: { 0: 'What is the philosophy of the shelf?', 1: 'Let me see what I can draw.', 2: 'Will you teach me?', 3: 'Anything missing from the books?', 4: 'Your cache is on the counter.', 5: 'Is there something harder?', 6: 'Parts, and the change.' },
    },
    creed: {
      text: '"Everything here works without the grid, without an augment, without a wire running back to the machine. That is the whole idea."\n\nShe taps a rifle\'s iron sights.\n\n"The chromed will tell you flesh and steel is obsolete, and they will be pleasant about it, and they will have a figure ready for what your hands are costing you. Then a storm rolls through, and their optics die, and it is us still standing and still shooting straight over plain iron."\n\n"Master the simple thing and nobody can take it off you. That is not a slogan. It is an inventory."',
      labels: { 0: 'Show me the shelves.' },
    },
    teach: {
      text: '"I fit gear to people," she says, without looking up from the ledger. "Which means most of my job is looking at somebody for four seconds and knowing what they will do under load. You can learn that. It is not a gift. It is a habit with a very long run up."\n\nShe closes the ledger.\n\n"Senses, and will. Noticing, and not giving in. `train senses` or `train will`, and bring me your hands clean."',
    },
    carry_offer: {
      text: 'She turns a page.\n\n"I keep two ledgers. One is everything the Watch owns. The other is everything it has lost, and it is shorter, and I take it personally."\n\n"There is a cache under the Fisherman\'s Green that has been in the second book for a month. It is not dangerous and it is not clever. I would simply like it back where it belongs."',
      labels: { 0: 'I will fetch it.', 1: 'Not today.' },
    },
    carry_accept: {
      text: '"Both books balance by the end of the week, or I will be unpleasant about it, and I am very good at that."',
    },
    carry_report: {
      text: 'She takes it, checks it against the page without any visible pleasure, and strikes a line through the entry.\n\nThen she looks at the line for a second longer than the line needs.',
    },
    loyalty_offer: {
      text: 'The Quartermaster puts a purse on the counter. It is heavier than the errand needs to be and both of you can see that.\n\n"Parts we cannot make. All of it sells on Halcyon Boulevard, and the last of it is behind the clinic counter, and you will be waiting there a while."\n\nShe slides the list across.\n\n"They will offer you things while you wait. They are very good at it, they will be kind about it, and there is a discount for anybody who looks like they are thinking it over."\n\nA beat.\n\n"I am not telling you not to. I am telling you I will be here when you get back, and so will the ledger."',
      labels: { 0: 'I know what this is.', 1: 'Ask somebody else.' },
    },
    loyalty_accept: {
      text: '"Bring the parts back. And bring yourself back." She does not look away as you go, and does not pretend she is doing anything else.',
    },
    loyalty_report: {
      text: 'She counts the parts, and then the change, and then she looks at you. At your hands. At the sides of your throat. At the way you are standing.\n\nIt goes on a good deal longer than four seconds.\n\n"Right," says the Quartermaster, and writes something in the first ledger.',
    },
    bye: { text: '"Keep it clean." She is already back to her ledger.' },
  },

  // ═══ TEAGUE · the deep tunnels. Does not leave bodies, and says why. ══════
  npc_lw_teague: {
    root: {
      first: 'She has been standing in the dark long enough to have watched you arrive. When she finally speaks it is from somewhere off to your left. "Middle of the tunnel," she says. "Nothing good stands where you are standing." She steps into your light: oilskins, carbine, no particular hurry.',
      text: 'She stops a comfortable distance off, carbine still slung, and looks at you with the patience of somebody who has all night.\n\n"You are a long way in," she says. "Most people do not get this deep and stay this healthy."',
      labels: { 0: 'What are you doing down here?', 1: 'Why is this stretch so clean?', 2: 'They said you could teach me.', 3: 'Anything down here need doing?' },
    },
    clean: {
      text: 'Something almost like approval crosses her face.\n\n"Noticed that, did you." She adjusts the sling. "Things that breed down here breed toward the warm. Somebody decided a while back that they were not going to breed toward this particular warm."\n\nShe starts walking.\n\n"That is all you get from me tonight."',
    },
    teach: {
      text: 'Teague looks at you for long enough that the lantern on her belt stops swinging.\n\n"Somebody sent you all the way down here, so somebody thinks you are worth the walk."\n\nShe unslings the carbine and leans it against the wall, muzzle down, which is not a small thing.\n\n"Moving. Pain. Keeping your head. Fighting, when it comes to that, and it does."',
    },
    quiet_offer: {
      text: '"There is a man on Foundry Way counting doorways." Teague says it flatly. "Municipal. Damp. Harmless as a person and not harmless as a ledger, because in six weeks somebody upstairs will have a list of every door in the quarter that opens."\n\n"Stop the counting. Leave the counter."\n\nHer eyes come up.\n\n"I want to be understood on the second half. We do not leave bodies. Not because we are gentle. Because a body is a reason for somebody to come and look, and looking is the only thing that has ever hurt us."',
      labels: { 0: 'Alive. Understood.', 1: 'Find somebody with fewer scruples.' },
    },
    quiet_accept: {
      text: '"Across the back of the head, and walk away, and let him wake up cold and confused and alive."',
    },
    quiet_report: {
      text: '"And he is breathing." She does not make you say it twice. "Good. In a month he will tell it as the night he got mugged on Foundry Way, which is a story nobody investigates."',
    },
    bye: { text: 'She nods once and carries on up the tunnel, and the dark takes her a lot faster than it should.' },
  },

  // ═══ NYALL · the chalk. The list is a wall and the wall is the only copy. ══
  npc_lw_nyall: {
    root: {
      first: 'The old man hears you before he sees you, and he does not startle, which tells you something. He raises a hand-cranked lamp and holds it up until he is satisfied. "Well," he says. "You are not a rat and you are not a corpse, so that is two things."',
      text: 'The old man raises his lamp, considers you, and lowers it again.\n\n"You are not one of the ones I am looking for," he says, "so we will get along fine."',
      labels: { 0: 'Who are you looking for?', 1: 'What are the chalk marks?', 2: 'What is on the wall today?', 3: 'That eye is closed.' },
    },
    looking: {
      text: '"Things with lenses in them," he says, and does not elaborate, and clearly is not going to.',
    },
    chalk: {
      text: 'He looks at the wall, then back at you, weighing something.\n\n"Marks are for them as can read them," he says, not unkindly. "You read them, you would know why you have not been eaten yet. You do not, so walk in the middle and do not touch the wires."',
      labels: { 0: 'Wires?' },
    },
    wires: {
      text: '"Ankle high, mostly." He cranks the lamp twice. "They do not hurt you. They just tell me you came."',
    },
    eye_offer: {
      text: 'The old man taps the chalk stub against the wall twice before he uses it.\n\n"Meltwater side. There is an eye over a doorway that people need, and it has been there four months, and folk have started going the long way round." He writes something on the brick that you cannot read. "That is it on the list. It has been on the list a while."\n\n"Go and close it. And do not be a story afterwards. A blind spot everybody has heard about is just a place people get arrested."',
      labels: { 0: 'I will close it.', 1: 'Not my sort of work.' },
    },
    eye_accept: {
      text: '"Mind the angles going in. The eye is not the only thing on that street with an opinion."',
    },
    eye_report: {
      text: 'Nyall licks the chalk stub, finds the mark on the wall, and draws a line through it with what is unmistakably satisfaction.\n\n"That doorway is a doorway again," he says.',
    },
    bye: { text: 'He cranks his lamp, shoulders the pole, and goes on down the run at a pace that eats distance.' },
  },
};

// ── apply ───────────────────────────────────────────────────────────────────
// Skeleton = the tree with every text field nulled. Compared before/after so a
// mistyped node key or a dropped option fails the run instead of the world.
const skeleton = (tree) => JSON.stringify(Object.fromEntries(
  Object.entries(tree).map(([k, n]) => [k, {
    ...n, text: null, first: null, text_by_relation: n.text_by_relation ? Object.keys(n.text_by_relation).sort() : null,
    options: (n.options || []).map((o) => ({ ...o, label: null })),
  }])
));

const EM = /—/;
const FAKE = / - | -- |–/;

let npcs = 0, nodes = 0, labels = 0;
const problems = [];

for (const [npcId, patch] of Object.entries(D)) {
  const file = path.join(NPCS, `${npcId}.json`);
  if (!fs.existsSync(file)) { problems.push(`${npcId}: no such NPC`); continue; }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tree = data.dialogue_tree || {};
  const before = skeleton(tree);

  for (const [key, p] of Object.entries(patch)) {
    const node = tree[key];
    if (!node) { problems.push(`${npcId}: no node "${key}"`); continue; }
    const vet = (s, w) => {
      if (EM.test(s)) problems.push(`${npcId}/${key} ${w}: em dash, and the Watch get none`);
      if (FAKE.test(s)) problems.push(`${npcId}/${key} ${w}: substitute dash`);
    };
    if (p.text !== undefined) { vet(p.text, 'text'); node.text = p.text; nodes++; }
    if (p.first !== undefined) { vet(p.first, 'first'); node.first = p.first; }
    if (p.rel) for (const [tier, v] of Object.entries(p.rel)) {
      if (!node.text_by_relation || !(tier in node.text_by_relation)) { problems.push(`${npcId}/${key}: no relation tier "${tier}"`); continue; }
      vet(v, `rel:${tier}`); node.text_by_relation[tier] = v;
    }
    if (p.labels) for (const [idx, v] of Object.entries(p.labels)) {
      const opt = (node.options || [])[Number(idx)];
      if (!opt) { problems.push(`${npcId}/${key}: no option at index ${idx}`); continue; }
      vet(v, `label[${idx}]`); opt.label = v; labels++;
    }
  }

  const after = skeleton(tree);
  if (before !== after) { problems.push(`${npcId}: STRUCTURE CHANGED, refusing`); continue; }

  // Whole-tree sweep: nothing we left behind may carry a dash either. Action
  // `reason` strings are exempt because they are relations bookkeeping, written
  // to player_npc_relations to record WHY warmth moved, and never rendered to
  // anybody. The dash rule is about prose the player reads. (Cyrelle's
  // ret_report carries one: "Retention — extracted to the Watch".)
  const prose = JSON.stringify(tree, (k, v) => (k === 'reason' ? undefined : v));
  const leftover = (prose.match(/—/g) || []).length;
  if (leftover) problems.push(`${npcId}: ${leftover} em dash(es) still in player-facing text`);

  if (!CHECK) fs.writeFileSync(file, canonicalJson(data), 'utf8');
  npcs++;
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Long Watch dialogue: ${npcs} NPC(s), ${nodes} node(s), ${labels} option label(s).`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
