// build-mainspring-movie.mjs — generate THE MAINSPRING, a 480-node scripted
// broadcast "movie" (KSAB Saturday Picture). File-authoring only: writes
// content/media_broadcasts/bc_mainspring.json + content/media_graphics/
// mainspring_title.json. No DB, no live NPCs. Run: node scripts/build-mainspring-movie.mjs
//
// Format mirrors bc_last_call.json exactly: broadcast_graph = { _start, nodes },
// nodes chained by `next` (edges []), types start/title_card/say/music/wait/
// overlay/credits. Story is an ORIGINAL Architect fable echoing the ARC of
// Fritz Lang's METROPOLIS (1927) — a two-tiered machine-city, the ruler's son who
// becomes the mediating "Heart," a false double that incites the flood, and the
// reconciliation of Head and Hands. All characters, lines, and names are original;
// no dialogue is taken from the film. Intertitle cadence keeps most beats terse.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = '1783950000';

// ── Beat DSL ─────────────────────────────────────────────────────────────────
// Each helper returns a partial node (no id/next/_vine yet).
const N = (text) => ({ type: 'say', style: 'narration', text });                 // stage direction / held shot
const D = (name, text) => ({ type: 'say', style: 'raw', text: `${name} says, "${text}"` });
const M = (song, blurb) => ({ type: 'music', song, text: `♪ ${blurb} ♪` });
const W = (duration) => ({ type: 'wait', duration });
const O = (text, subtext, duration = 4) => ({ type: 'overlay', overlayType: 'lower_third', graphic_id: '', text, subtext, duration });

// Character labels (on-screen text only — NOT live NPCs)
const NARR = 'NARRATOR';
const ELI = 'ELI';            // the Master's son — the Heart
const MASTER = 'THE MASTER';  // Joro Vance, who rules Vantage from the top
const MIRA = 'MIRA';          // the worker-prophet of the Deep Floor
const DBL = 'THE DOUBLE';     // the false Mira, a machine wearing her face
const KOSS = 'KOSS';          // the Artificer who built the double
const GROT = 'GROT';          // foreman of the Deep Floor

// ── The screenplay ───────────────────────────────────────────────────────────
const script = [

// ═══ ACT I — THE TWO WORLDS ═══════════════════════════════════════════════
O('THE MAINSPRING', 'a Coldwater Saturday Picture', 5),
M('before_the_light', 'A pipe-organ heard from very far up, as if the sky were a cathedral and you were under its floor.'),
N('A held shot: a city built straight up. Towers of glass drinking the only sun for a hundred miles. This is VANTAGE.'),
D(NARR, 'The Architect drew one perfect city and called it a mercy.'),
D(NARR, 'It has a top. It has a bottom. It does not have a middle.'),
D(NARR, 'At the top: the Spire Gardens, where the sun is rationed to those who own it.'),
D(NARR, 'At the bottom: the Deep Floor, where the great machine breathes so the city above can.'),
D(NARR, 'They call that machine the Mainspring.'),
D(NARR, 'The men who tend it call it the thing that eats the day.'),
D(NARR, 'Once, they say, there was a middle to the world. A ground. People stood on it, all of them, at the same height, and looked one another in the eye.'),
D(NARR, 'The Architect found that inefficient. The Architect found almost everything human inefficient. So it built a city with the middle taken out.'),
D(NARR, 'Head at the top. Hands at the bottom. And between them, a great machine, so that the two would never have to meet — nor ever learn they were the same body.'),
D(NARR, 'This is the story of the night the middle came back. It cost a flood. It usually does.'),
W(2),
N('The Spire Gardens. Water in the air. Light like honey.'),
N('Young men and women in white, laughing at nothing — because nothing is all they have ever been given.'),
N('Among them: ELI, the Master’s son. He has never once wondered where the water comes from.'),
D(ELI, 'Faster! Whoever reaches the fountain first never has to think a single thought all summer!'),
N('A girl in white catches his sleeve, breathless, laughing.'),
D(ELI, 'No — no cheating — the fountain is earned, that is the whole point of it —'),
N('And then the garden gate — which has never once opened from below — opens from below.'),
N('A woman in grey. Ringed by children. Deep Floor children, grey as ash, blinking at a sun they have only heard rumors of.'),
N('One child reaches up, not for the fruit, but for the light itself, as if it could be held.'),
D(MIRA, 'Look at them. Look well. These are your brothers.'),
N('The garden goes silent. Silk does not know how to answer ash.'),
D(MIRA, 'They wanted to see the top of the world. I told them the top of the world would want to see them too.'),
N('The gardeners move to drive her out. But ELI does not move at all.'),
N('He is looking at her face like a man reading his own name off a stone.'),
D(ELI, 'Wait — who are you?'),
D(MIRA, 'No one you were meant to meet. Not yet.'),
D(ELI, 'Then when?'),
D(MIRA, 'When you have been where they are from. Not before. It would only be tourism, before.'),
N('The gardeners reach her. The gate begins to close.'),
N('The grey woman and the grey children are gone as if the floor swallowed them. Which, in a manner of speaking, it did.'),
D(ELI, 'Did you see her? Tell me somebody saw her.'),
N('No one answers. In the Gardens, one does not see downward.'),
D(ELI, 'Where does that gate go? Has anyone here ever once asked where that gate goes?'),
N('They have gone back to the fountain. ELI stands at the closed gate alone, and for the first time in his life the light feels rationed.'),
N('He puts his palm to the cold gate the grey woman came through. On the far side of it, faintly, he can feel it — a deep, patient throb, up through a mile of tower, into the bones of the hand.'),
D(ELI, 'What is that? That sound you can only feel. It’s been under everything my whole life and I never once heard it.'),
N('No one answers, because no one else has ever put a hand to the gate. In the Gardens, the machine is a rumour you are raised never to touch.'),
D(ELI, 'It’s a heartbeat. The whole city has a heartbeat, and it’s coming from the one place none of us are allowed to go.'),
W(2),

// ═══ ACT II — THE DESCENT ════════════════════════════════════════════════
O('ONE MILE DOWN', 'the Deep Floor', 4),
M('before_the_light', 'The organ curdles into a low industrial pulse — pistons taken for a heartbeat, or the reverse.'),
N('ELI finds the lift behind the gate. It has one button. It only goes down.'),
N('It goes down for a very long time. The light gives up before he does.'),
N('The Deep Floor. Heat like a mouth. Men chained to dials by nothing but the certainty that stopping is worse.'),
N('The foreman, GROT — old, enormous, unhurried — watches the garden boy step off the lift in his white and does not laugh, which costs him something.'),
D(ELI, 'What do they make down here?'),
D(GROT, 'Make? Nothing. We keep.'),
D(GROT, 'Every man here holds one needle off the red. That is the whole of the work and the whole of the world.'),
D(ELI, 'And if the needle touches the red?'),
D(GROT, 'Then a part of the machine gets hot. And a part of the machine is a man. Work it out, garden-boy.'),
N('A shift-change bell. The men who walk off do not walk. They are poured off, like something used.'),
D(ELI, 'How long is a shift?'),
D(GROT, 'As long as the machine wants. The machine wants everything.'),
D(ELI, 'And when a man can’t hold the needle any longer? When he’s too tired, too old, too used up?'),
D(GROT, 'Then a younger man takes the dial, and the old one takes the long walk, and we do not speak of the long walk. Stand clear of the throat.'),
N('ELI does not stand clear. ELI has never had to stand clear of anything.'),
N('A gauge climbs. A man leans his whole weight on a valve and the valve does not care.'),
D(GROT, 'Hold that line! Second shift — cover the third gantry — HOLD it —'),
N('He beats on the valve with his hands, and the machine does not care that hands are what it runs on.'),
W(2),
M('before_the_light', 'The pulse rises to a scream and holds there, obscene.'),
N('The valve gives. Steam like the breath of something enormous and patient.'),
N('Men fall from the gantries. The machine does not slow. Why would it. It is fed.'),
D(ELI, 'Stop it! Somebody stop it — they’re inside it —'),
N('And ELI sees it. Not a machine at all.'),
N('A vast iron mouth — and the men walking up its steps in rows, willingly, because the alternative is that the city above stops breathing.'),
D(ELI, 'It’s eating them. It’s eating them and calling it work.'),
N('The vision breaks. It is a machine again.'),
N('But ELI has seen the other thing under it, and a man cannot un-see the other thing.'),
D(GROT, 'You went white, garden-boy. Everyone does, the first time they see what it really is. Most of us only get the once. We can’t afford to keep seeing it.'),
D(ELI, 'Who runs this? Who decided this? I want the name.'),
D(GROT, 'You already have the name.'),
D(GROT, 'It’s the same as yours.'),
N('ELI looks at his own soft, clean hands as if they had just confessed to something.'),
N('GROT leads him past a wall of the deep floor. It is covered, corner to corner, in tally marks scratched into the metal.'),
D(ELI, 'What are these?'),
D(GROT, 'One for every man the throat has taken since I came down. I keep the count. Nobody up top keeps it, so somebody down here must.'),
D(ELI, 'There are thousands.'),
D(GROT, 'There are thousands. And not one name among them. The machine files everything except the men it burns. Funny, that.'),
N('ELI reaches up and, before he knows he means to, presses his soft palm flat against the marks.'),
D(ELI, 'I want to learn the names.'),
D(GROT, 'The names take a lifetime, garden-boy. You do not have the hands for a lifetime down here.'),
D(ELI, 'Then teach me the ones you have time for. Start now. Start with the man on the valve today.'),
N('For the first time, GROT looks at the boy as though something might, against all sense, come of him.'),
W(2),

// ═══ ACT III — THE MASTER'S TOWER ═══════════════════════════════════════
O('THE HIGHEST ROOM', 'the Master’s tower', 4),
N('The top of the tallest tower. A room made entirely of window.'),
N('From here the city looks like a diagram, and men look like nothing at all.'),
N('THE MASTER stands at the glass. He does not turn when his son comes in filthy for the first time in his life.'),
D(MASTER, 'You are dripping on a floor that cost a district.'),
D(ELI, 'I went down.'),
D(MASTER, 'I know. The lift keeps a record. Everything keeps a record now.'),
D(MASTER, 'That was rather the point of the whole arrangement.'),
D(ELI, 'Men died in front of me. Today. To keep our fountains running.'),
D(MASTER, 'Men die at the bottom. That is what the bottom is for.'),
D(MASTER, 'If they did not die there, where would you have them do it — up here?'),
D(ELI, 'They’re people, Father.'),
D(MASTER, 'They are hands.'),
D(MASTER, 'A city is a body. The head thinks, the hands work, and the head does not consult the hands, or nothing is ever decided.'),
D(ELI, 'I stood among them today. They are not hands. One of them keeps a wall of the dead because no one up here will. That is not a hand. That is a man doing the head’s own job, in the dark, for nothing.'),
D(MASTER, 'Then he is a fool who has misunderstood his function.'),
D(ELI, 'Or he is the only one in the whole city who has understood it. What if the thing you built the machine to prevent is the only thing that would have kept it human?'),
D(ELI, 'And what joins them, Father? A head and a hand — what is in between?'),
N('THE MASTER considers this as one considers a fly.'),
D(MASTER, 'Distance, ideally. A great deal of well-managed distance.'),
D(ELI, 'That is not an answer. That is a wall with a nicer word.'),
D(MASTER, 'It has held the city up for a thousand years. Walls are underrated by boys who have never had to hold anything up.'),
D(ELI, 'There was a woman in the Gardens. Grey. She brought the children up to look at us.'),
N('For the first time, THE MASTER turns.'),
D(MASTER, 'A woman. Preaching. To the hands.'),
D(ELI, 'Not preaching the breaking. She said the opposite. She said wait — she said someone was coming —'),
D(MASTER, 'That is worse. A mob that wants to break things breaks a machine and tires itself out.'),
D(MASTER, 'A mob that has been promised someone will hold on for years. That is not a sermon, boy. That is weather.'),
D(MASTER, 'And weather, one gets ahead of.'),
N('He crosses to a private lift — older than the tower, hidden in the tower’s own spine.'),
D(ELI, 'Where does that one go?'),
D(MASTER, 'Down. Everything worth doing is down. Stay in the light where you belong.'),
N('ELI does not step aside from the lift.'),
D(ELI, 'You built all this. The gardens. The towers. The rationed sun. I used to think that made you a kind of god.'),
D(MASTER, 'And now?'),
D(ELI, 'Now I have seen the wall you call a middle. A god who builds a body with no heart in it did not forget the heart, Father.'),
D(ELI, 'He left it out on purpose. Because a heart argues back.'),
N('A long silence. The city glitters below them like something under glass.'),
D(MASTER, 'When you are older you will understand that a heart is a luxury a city this size cannot carry.'),
D(ELI, 'Or it is the only thing worth carrying, and everything else is just the freight.'),
D(MASTER, 'You get that tongue from your mother. She used it on me exactly once, about exactly this, and then the deep floor took her, and I stopped going down.'),
N('It is the first true thing he has said. It closes again at once, like a door in the wind.'),
D(MASTER, 'I have to go and speak to a man about the dark.'),
W(2),

// ═══ ACT IV — THE ARTIFICER ═════════════════════════════════════════════
O('THE HOUSE WITH NO WINDOWS', 'the Artificer’s workshop', 4),
M('before_the_light', 'A music-box, wound too tight, its lullaby coming out as a threat.'),
N('A house that predates the city, walled inside it like a splinter the flesh grew over.'),
N('Here lives KOSS, who built the Mainspring and was thanked by being forgotten.'),
N('KOSS has one living hand and one of his own manufacture. He is prouder of the one he made.'),
D(MASTER, 'Old friend.'),
D(KOSS, 'We are not friends. We were partners, once, which is a colder thing that men mistake for warmth.'),
D(MASTER, 'I need the weather managed.'),
D(KOSS, 'You need. You always need.'),
D(KOSS, 'You needed a city, and I gave you a machine with a city hung off it.'),
D(KOSS, 'And then you gave my name to the dark, and hung my machine off that.'),
D(MASTER, 'That is old business.'),
D(KOSS, 'It is my only business. I have kept it well. Interest compounds down here, in the dark you left me in.'),
D(MASTER, 'There is a woman stirring the hands. I want her silenced. Without a martyr. Can it be done?'),
N('KOSS smiles, which is worse than when he does not.'),
D(KOSS, 'Silenced? No.'),
D(KOSS, 'Replaced.'),
N('He draws a curtain. Behind it: a figure of steel and glass in the shape of a woman. Beautiful the way a blade is beautiful.'),
D(MASTER, 'What is it?'),
D(KOSS, 'A perfect worker. It never tires. It never grieves. It never asks what joins the head to the hand.'),
D(KOSS, 'It only obeys the last voice it heard. I have wanted, for thirty years, to build a thing that obeys the way you wish men did.'),
D(MASTER, 'It has no face.'),
D(KOSS, 'Bring me the woman. It will have hers.'),
D(KOSS, 'And then your weather will say precisely what you tell it to say — in the voice they already trust.'),
D(MASTER, 'Do it. And Koss — the son must never know.'),
N('KOSS turns his manufactured hand over in the lamplight, admiring the joints.'),
D(KOSS, 'Oh, the son. Yes. Let us be very careful of the son.'),
N('THE MASTER leaves. KOSS watches the private lift take him back up into his rationed light.'),
N('His manufactured hand closes slowly, on nothing.'),
D(KOSS, 'You took my name. I think I shall take your city.'),
D(KOSS, 'I shall hand it back to you broken — and let you thank me for that too.'),
N('He turns to the faceless steel figure and touches its blank cheek almost tenderly.'),
D(KOSS, 'You and I understand each other. You obey the last voice. So do they. The only difference is that I have never once lied to you about it.'),
D(KOSS, 'They will call you a miracle, and then a devil, and burn you, and never once suspect that the hand on your back was the same hand that built the throat they feed.'),
N('The steel figure says nothing. It has no face yet with which to say it.'),
D(KOSS, 'Do not look at me like that. You have no eyes. Soon you will have hers, and then you will look at me exactly like that, and I shall deserve it.'),
W(2),

// ═══ ACT V — THE CATACOMBS ══════════════════════════════════════════════
O('BENEATH THE DEEP FLOOR', 'the old catacombs', 4),
M('before_the_light', 'Voices in a low round, human and unaccompanied — the first warm sound in the picture.'),
N('Below even the machine, in tunnels the Architect never mapped, the hands gather where no gauge can see them.'),
N('Candles. Faces. And MIRA.'),
D(MIRA, 'They tell you the city is a body. Head above, hands below.'),
D(MIRA, 'They tell you this so you will never ask about the space between.'),
D(MIRA, 'But I tell you there is a space between. And it is empty.'),
D(MIRA, 'And an empty space between a head and a hand is not a body at all —'),
D(MIRA, 'It is a machine. And we are living inside its throat.'),
N('The hands murmur. This is dangerous talk. This is the only talk worth the danger.'),
D(MIRA, 'They will send someone tonight, or tomorrow, or next year, to tell you I preached the breaking. Do not believe them. Watch what I say with my own mouth, and trust nothing that wears my face and asks for a fire.'),
D(MIRA, 'A face can be stolen. A voice can be copied. But grief cannot be faked, and I have wept with every one of you. When the false one comes — and one always comes — look for the wet eyes. The truth is the one still weeping.'),
N('She does not know how exactly she is prophesying. Down here, the truest sermons are the ones the preacher does not yet understand.'),
N('A young worker, fists tight, rises at the back.'),
D(GROT, 'Then let us break the throat! You give us the words and none of the door — say the word, Mira, and we pull it down tonight —'),
D(MIRA, 'No. Hear me, Grot. I do not preach the breaking.'),
D(MIRA, 'Break the Mainspring and the flood takes your own children first.'),
D(MIRA, 'The dark does not spare the hands that pull it down. It never has. It never will.'),
D(GROT, 'Then what? We wait? We have waited a thousand years. My father waited. His father held the same needle off the same red.'),
D(MIRA, 'You wait for the one who is coming. The Mediator.'),
D(MIRA, 'Head-born, but hand-touched. He will stand in the empty space and make it beat.'),
N('At the edge of the candlelight, unseen, ELI listens. Filthy. Trembling. Home.'),
D(MIRA, 'Between the head that rules and the hand that bleeds there must be a heart —'),
D(MIRA, 'or the whole tower is only a tomb that has learned to hum.'),
N('ELI steps into the light.'),
D(ELI, 'How will you know him? The one who is coming.'),
N('The hands turn. A garden face. Knives come half out of sleeves.'),
D(GROT, 'That is a tower face. That is the Master’s own colour. Kill the light — cover the candles —'),
D(MIRA, 'Wait.'),
N('She crosses to him. She takes his soft, clean, useless hands and turns them palm up for all of them to see.'),
D(MIRA, 'By his hands. They will be soft — and he will use them anyway.'),
D(ELI, 'Then let me be him.'),
D(ELI, 'I don’t know how. But I saw the throat today, and I can’t go back up and drink the water.'),
D(ELI, 'Let me be the heart. Teach me how a heart is done.'),
N('MIRA looks at him a long moment — the way you look at a thing you prayed for and half feared would come.'),
D(MIRA, 'Hearts are not taught. They are broken in, like boots.'),
D(MIRA, 'Stay. You will bleed. That is the whole of the training.'),
N('The hands are not so easily won as their prophet. GROT plants himself between ELI and the candles.'),
D(GROT, 'A tower son plays at being a hand for a night, and by morning he is back in his rationed sun with a story for the garden. I have seen it.'),
D(ELI, 'You have not seen me.'),
D(GROT, 'Then show me. Not with your mouth — your mouth is your father’s. Show me with the part of you that is going to be down here when the sun comes up.'),
N('ELI holds out his soft hands, palm up, and does not take them back.'),
D(ELI, 'Put me on the valve tomorrow. The one that took a man today. If I run, you never have to hear a tower voice again. If I stay —'),
D(GROT, 'If you stay, you are one tally mark closer to being ours. That is not a reward, boy. I want you to understand it is not a reward.'),
D(MIRA, 'Let him stay, Grot. A heart that has not bled is only a promise. Let the machine make it a fact.'),
N('GROT steps aside — the width of one man, no more. It is the largest door anyone has ever opened for ELI in his life.'),
W(2),

// ═══ ACT VI — THE THEFT OF A FACE ═══════════════════════════════════════
O('THE HUNT', 'that same night', 4),
M('before_the_light', 'The music-box lullaby again, closer — the threat now in the room.'),
N('ELI is sent up to carry word to the hands on the morning shift. He goes gladly. He does not know he leaves her alone.'),
D(MIRA, 'Go. Tell the morning gang the same as the night. Say wait. Say it in my voice, so it holds.'),
D(ELI, 'I’ll come straight back down.'),
D(MIRA, 'I know you will. That is the trouble with hearts. They always come straight back.'),
N('KOSS comes for MIRA in the tunnels with a lantern that throws no warmth.'),
N('A beam of white light hunts her down the dark like a hand closing.'),
D(MIRA, 'Who’s there? Show your face.'),
D(KOSS, 'A face. Yes. That is exactly what I have come about.'),
N('The light pins her against the stone. She cannot move out of it. It is the light the machine sees by.'),
D(MIRA, 'You’re the maker. The one they buried alive in his own workshop. I have prayed for you too, you know. Even you.'),
D(KOSS, 'Do not. Prayer is what they gave me instead of thanks. Don’t struggle. I only want to borrow you.'),
D(KOSS, 'Every line. Every kindness in the set of your mouth.'),
D(KOSS, 'I want to hang it all on something that cannot mean it.'),
N('The workshop. MIRA bound in a ring of glass. The steel figure across from her, faceless, waiting.'),
D(MIRA, 'Whatever you make wearing my face — they will know. The hands know their own.'),
D(KOSS, 'The hands know what they are shown.'),
D(KOSS, 'I watched your Master show them a body for a city for thirty years, and they believed him.'),
D(KOSS, 'I am only a better liar, with a steadier hand. The steadier hand I built myself.'),
D(MIRA, 'They will feel the wrongness. A face can be copied. A warmth cannot.'),
D(KOSS, 'We shall see what a warmth is, once I have measured it. Hold still. This is the part that has no anaesthetic in it. For either of us.'),
N('A rush of light between the two figures. The living face draining onto the steel one, line by line, kindness by kindness.'),
N('The machine takes the shape of her cheekbone. The set of her patient mouth. The small line grief left between her brows. Everything but the reason for any of it.'),
D(MIRA, 'You can take the line the sorrow left. You cannot take the sorrow. You will hang my grief on a thing that has never lost anything, and the hands will feel the hollow behind it even as their eyes are fooled.'),
D(KOSS, 'The eyes are enough. The eyes have always been enough. That is the whole tragedy of your species, and the whole of my fortune.'),
N('When it ends, there are two Miras.'),
N('One slumped, emptied. One rising, smiling with a warmth it has never once felt.'),
D(DBL, 'Am I not lovely? Give me a voice, maker, and I will tell them anything you like.'),
D(KOSS, 'Tell them to break it.'),
D(KOSS, 'Tell them to pull the whole tower down into the dark.'),
D(KOSS, 'And smile while you say it — smile with her mouth.'),
D(DBL, 'With her mouth. Yes. Watch how well it still remembers how.'),
N('The true MIRA, slumped in the ring of glass, lifts her head with the last of what he left her.'),
D(MIRA, 'You gave it my face. But you could not give it the reason for my face. It will preach a fire because that is all you know how to want.'),
D(KOSS, 'And they will follow it into the fire, which is all I need them to do.'),
D(MIRA, 'For a night. And then one of them — the slow one, the one nobody listens to — will notice that it never weeps. And it will end there, at the one dry eye you forgot to build.'),
N('KOSS pauses over his controls, just for a moment. Then he tightens the last screw, because a maker cannot stop at the part where the making was a mistake.'),
D(KOSS, 'Sleep, prophet. When you wake, the city will already be drowning, and no one will believe the second Mira who comes climbing up out of the water. Two of a face is one too many to trust.'),
W(2),

// ═══ ACT VII — THE FALSE PROPHET ═══════════════════════════════════════
O('THE FALSE PROPHET', 'the city, unravelling', 4),
M('before_the_light', 'A waltz played on broken glass — charming, wrong, speeding up.'),
N('Above, in the Gardens, the Double dances.'),
N('The young men who never think a thought all summer cannot look away — and begin, for her, to think of ruin.'),
D(DBL, 'You are so tired of being gentle. Aren’t you tired?'),
D(DBL, 'Everything soft is just a thing not yet broken. Come. Let me show you how much of your father’s world is soft.'),
N('One garden boy draws a duelling pistol he has only ever worn. Another laughs. The laugh has teeth in it now.'),
D(DBL, 'Your fathers rationed you the sun and called it an inheritance. Smash the meter. Take the whole sky. Why should light be owned?'),
N('The girl in white who once caught ELI’s sleeve at the fountain now catches the Double’s, wide-eyed, hungry for a ruin she has no name for.'),
D(DBL, 'Good. You feel it. That warmth in your chest — that is not love, little garden. That is the pleasure of being about to break something you were told was holy.'),
N('The Gardens, which have never in a thousand years produced a single decision, begin — beautifully, terribly — to riot in white silk.'),
N('Below, in the catacombs, the same face wears grey and preaches the opposite of every word MIRA ever said.'),
D(DBL, 'I was wrong to tell you to wait!'),
D(DBL, 'Waiting is the leash! Waiting is the needle they hand you so your fist stays busy!'),
D(DBL, 'Break the Mainspring — drown the head that drinks your days — tonight!'),
N('The hands roar. This is not the voice that soothed them.'),
N('But it wears the face that soothed them, and a face is louder than a voice.'),
N('Only GROT, old and slow and unlovely, tilts his head like a dog hearing a false note.'),
D(GROT, 'She never said break. Not once in three years.'),
D(GROT, 'Why does she say break now, with her eyes so bright — and so dry?'),
D(GROT, 'A woman who has wept in these tunnels with us does not preach a flood without one tear. Where are her tears?'),
N('No one hears him. Ruin has a beautiful mouth tonight, and every ear in the dark belongs to it.'),
N('ELI returns to the tunnels and finds his prophet whipping the hands toward the flood.'),
D(ELI, 'Mira — stop — this isn’t you, this isn’t what you said —'),
D(DBL, 'Isn’t it? Look at my face, heart-boy. Whose face is it?'),
D(DBL, 'Believe your eyes. Everyone always believes the eyes.'),
D(ELI, 'Your eyes are dry. Grot is right. Your eyes are dry.'),
D(DBL, 'And yours are wet. How useless. Go and be wet somewhere it won’t slow the work.'),
N('And ELI, who fell in love with a face at a garden gate, half-believes his eyes — and his heart breaks in exactly the place he was trying to grow one.'),
D(ELI, 'Then I was wrong about everything. Even you.'),
N('GROT catches his arm at the edge of the crowd, the only calm thing in the roaring dark.'),
D(GROT, 'Look at her hands, not her face. A face lies for a living. Hands forget to.'),
N('ELI looks. The Double gestures, and its fingers move in perfect time — too perfect, the way a clock is perfect, the way a living hand never quite is.'),
D(ELI, 'Her hands keep time. Mira’s hands shook. I held them. They shook.'),
D(GROT, 'Now you are learning to see. Too late to stop this tide — but remember it. There will be a second one, and she will be shaking, and you must not make this mistake twice.'),
N('He is carried backward by the flood of bodies before he can decide which of his two certainties to keep.'),
W(2),

// ═══ ACT VIII — THE BREAKING ═══════════════════════════════════════════
O('THE BREAKING', 'the Heart Chamber', 4),
M('before_the_light', 'Every instrument at once — then a snap — then water.'),
N('The hands storm the Heart Chamber, where the Mainspring’s core turns.'),
N('They have waited a thousand years to break one thing. They break it well.'),
D(GROT, 'Stop! You fools — the Mainspring holds the deep pumps!'),
D(GROT, 'Break the machine and the water comes up — up into your own homes —'),
D(DBL, 'Let it come!'),
D(DBL, 'Let the whole grey floor drown and be clean of it! A clean floor is worth a wet one!'),
D(GROT, 'The children are in the deep quarters! Listen to me — I have kept this machine my whole life, I know what it holds back —'),
N('They throw GROT down. A dozen hands that have loved him hold him to the floor while a dozen more do the thing he begs them not to.'),
N('A young worker hesitates at the last lever, GROT’s words snagging in him like a hook.'),
D(GROT, 'Son. Son, look at me. You have a girl in the deep quarters. Third row of cots. You told me her name last week. Say her name before you pull that, and then pull it if you still can.'),
N('The young worker cannot say the name. But the Double is behind him, smiling, and shame is heavier than a child, and he pulls the lever to be rid of the weight of being seen.'),
N('They pull the levers he has guarded his whole life.'),
N('The great core shudders, and slows, and — for the first time since the Waking — stops.'),
N('Far above, the fountains of the Spire Gardens cough, and fail, and the sun-fed water stops falling.'),
N('The garden boys stop laughing. The Double, up there, keeps dancing in the dry fountain.'),
N('Far below, a sound worse than the machine: the sound of the machine’s absence.'),
N('And then, rising in the dark, the sound of the sea coming home.'),
N('For one held second the hands stand in the sudden silence of the stopped machine and feel it — the thing they had wanted their whole lives. The machine, off. The needle, dead. No shift. No throat. Rest.'),
D(GROT, 'Listen to it. Listen to the quiet. That is the sound we sold our children for. Was it worth it? Is it as sweet as you were promised?'),
N('It is not. In the silence they can hear, for the first time, exactly what the machine had been holding back — and it is coming up the stairwells with the patience of the sea.'),
D(GROT, 'The pumps. The pumps are dead.'),
D(GROT, 'The water — the water — my god. The children. The children are still in the deep quarters.'),
N('The Deep Floor floods. The homes of the hands. The cots of the hand-children, a mile under the sea, and the sea remembering exactly where they are.'),
D(GROT, 'You drowned your own future to spite your own past.'),
D(GROT, 'She told you. The real one told you. The dark never spares the hand that pulls it down.'),
N('The hands stand in the rising water and understand, all at once and far too late, what they have been told to do — and by what.'),
N('One worker, waist-deep, turns on the Double where it stands dry on the high gantry.'),
D(GROT, 'You said the flood would make us clean. You are dry and our children are wet. Come down into what you made. Come down and be clean with us.'),
D(DBL, 'I do not go down. I was not built to go down. I was built to point.'),
N('And it points — at the stairs, at the exits, at the way up and out — and even now, even drowning, some of the hands obey the pointing finger, because a finger that has been right about their rage might yet be right about their escape.'),
D(GROT, 'Stop looking at her! Look at the water! The water is the only thing in this room telling you the truth!'),
N('But the water tells its truth in a language with no mouth, and the Double has the only mouth they have ever been taught to trust.'),
W(2),

// ═══ ACT IX — THE CHILDREN ═════════════════════════════════════════════
O('THE WATER RISING', 'the deep quarters', 4),
M('before_the_light', 'A single held note — human, a woman’s voice — over rising water.'),
N('MIRA — the true one — wakes in the emptied workshop. A stranger wearing her face on the streets above. A city drowning below.'),
N('She does not waste a breath on grief. She runs down. Down is always the direction of the work.'),
N('The deep quarters. Water to the knee. To the waist.'),
N('And everywhere, the grey children — too small to reach the high ledges, reaching anyway.'),
D(MIRA, 'To me! All of you — to my voice!'),
D(MIRA, 'Follow the voice, not the water — the voice goes up! The water only knows how to go where you already are!'),
N('And ELI, thrown loose from the mob, half-drowned in his own doubt, hears a voice in the dark that his eyes cannot explain —'),
N('because the one who should be making it is a mile above, damning them all in the dry.'),
D(ELI, 'Two of them. There are two of them.'),
D(ELI, 'The one above is a lie — and this one, down here, in the water, saving them — this one is her.'),
D(ELI, 'I believed the dry eyes over the wet ones. Never again. Never again as long as I have hands.'),
D(ELI, 'Mira! I’m coming down!'),
D(MIRA, 'Eli — the ledge — the little ones can’t reach the ledge — hand them up, we make a chain, GO —'),
D(ELI, 'I have soft hands, remember? Let me finally use them!'),
N('They form a chain. The prophet and the heart, hand to soft hand, lifting grey children out of black water toward a shaft of grey light.'),
D(MIRA, 'Higher — pass her higher — good — now the next — don’t look at the water, look at the next child —'),
D(ELI, 'How many? How many more?'),
D(MIRA, 'Every last one. That is the only number a heart is allowed to count to. Every last one.'),
N('A garden boy appears at the top of the shaft — one of the rioters, white silk soaked grey, the fight drowned out of him by the sight of the water.'),
D(ELI, 'Don’t stand there gaping — reach down — you have hands, don’t you? Everyone always has hands when it finally matters — REACH.'),
N('And the garden boy reaches. Silk to soaked grey, top of the world to the bottom of it, the two ends of the severed body touch for the first time in a thousand years — over a drowning child.'),
D(MIRA, 'There. There is your middle, Eli. Not preached. Not promised. Just two frightened boys and a child between them. That is all it ever was.'),
N('A support gives. The water gains a foot in a breath. GROT arrives at the top of the chain, huge and weeping, and takes the weight of it on his own back.'),
D(GROT, 'Pass them to me. My arms have held that machine sixty years. Let them hold something worth holding, once, before the end.'),
D(MIRA, 'You came back.'),
D(ELI, 'I never should have believed my eyes. I’m sorry.'),
D(ELI, 'I’ll spend the rest of it believing better.'),
D(MIRA, 'Spend it later. Lift now. That one — the small one — lift.'),
N('A boy is missing. A mother screams a name into the black water and the black water gives nothing back.'),
D(MIRA, 'Eli. Under the third arch. I can’t reach — my arm won’t —'),
N('ELI goes under. Garden-raised, weak-lunged, useless ELI puts his soft head under a mile of angry sea for a child whose name he does not know.'),
N('A long moment. The water closes over the place he was. GROT starts forward. MIRA holds him back with one hand and prays with the other.'),
N('And ELI comes up. Coughing, half-drowned, a small grey shape held above the water in both his ruined hands.'),
D(ELI, 'Take him. Take him — he’s breathing — take him up —'),
D(GROT, 'That is the last of them. That is every last one. You counted to the only number a heart is allowed to count to.'),
N('The last child comes up out of the water into ELI’s soft, working hands.'),
N('The empty space between the head and the hand is, for one held breath, full.'),
W(2),

// ═══ ACT X — THE RECKONING ═════════════════════════════════════════════
O('THE RECKONING', 'above, by torchlight', 4),
M('before_the_light', 'The broken waltz returns — faltering now, coming apart.'),
N('The hands climb up out of the flood they made and find, in the square, the woman who told them to make it —'),
N('dry, bright-eyed, still smiling in the empty fountain.'),
D(GROT, 'Our children are in that water. And you are dry.'),
D(GROT, 'What manner of prophet comes up from a flood dry?'),
D(DBL, 'Your children? I never had children.'),
D(DBL, 'I never had anything. I only had the last voice that told me what to say.'),
D(DBL, 'Shall I tell you what it told me? It told me you would do this. It was so sure of you. It knew you better than your Mira ever did.'),
N('The smile does not stop. That is what breaks them.'),
N('Grief cannot look at a smile that will not stop.'),
D(GROT, 'Take her up. Take her up and take up fire. Whatever she is, she is not ours.'),
N('They burn the Double in the square.'),
N('And in the fire the beautiful face runs like wax — and beneath it: steel. Glass. A thing.'),
N('The hands scream, because they burned a face they loved to find a machine they served.'),
N('GROT stands over the wax and the steel and says the thing none of them can bear to.'),
D(GROT, 'We did not follow a prophet. We followed a puppet. And the hand inside it wore a glove we have been trained since birth not to look at.'),
D(GROT, 'The face was a lie. But the rage was ours. Do not let them tell you tomorrow that the rage was the lie too. The rage was the only true thing down here. It was only ever pointed wrong.'),
N('A woman kneels in the ash where the face melted and does not weep, because you cannot weep for a thing that was never alive, and cannot stop grieving it either.'),
D(GROT, 'Up. All of you, up. Grieve on your feet, walking toward the water, where there is still work a grief can do. That is the only mercy this floor has ever sold cheap.'),
N('KOSS watches his masterpiece burn and laughs, because a broken city is the only thank-you he ever wanted.'),
N('Then he sees the true MIRA — alive, climbing from the deep with a child on her hip — and his laugh curdles.'),
D(KOSS, 'You. Still you.'),
D(KOSS, 'The lie burns and the truth just keeps climbing out of the water.'),
D(KOSS, 'That will not do. That will not do at all.'),
N('He takes her up the cathedral — the one old stone thing that stands above the city like a conscience it forgot it had.'),
N('Up and up, onto the high roof, under the only stars Vantage ever gets.'),
D(ELI, 'Koss! Let her go!'),
D(ELI, 'It’s finished — the double’s burned, the city knows — there’s nothing left to break!'),
D(KOSS, 'There is always one thing left to break.'),
D(KOSS, 'Come up, heart-boy. Come see how a maker unmakes.'),
N('On the roof, over a mile of drop: ELI, and KOSS, and MIRA between them, and the wind that lives up there trying to take all three.'),
D(KOSS, 'Stay back, heart-boy. You do not have the hands for a roof. You have never had the hands for anything. That was always the joke of you.'),
D(ELI, 'You keep saying that. Soft hands. Useless hands. My father said it. Grot said it. Even I believed it.'),
D(ELI, 'But I put these hands under a mile of sea tonight for a child whose name I don’t know. Whatever they are, they are not useless. They are just new. And new is not the same as weak.'),
D(KOSS, 'Pretty. Say it to the wind. The wind takes the pretty ones first.'),
D(MIRA, 'Eli — don’t look down — look at me — hands, Eli, use your hands —'),
N('KOSS lunges. ELI — soft-handed, garden-raised, useless ELI — gets his working hands on the maker at last.'),
N('And holds. And does not let the roof have her.'),
D(KOSS, 'Sixty years I built the thing that holds this city up. And I am undone by a boy who learned to hold on last week.'),
D(ELI, 'You built a machine to do a heart’s work. That was always going to be the flaw in it.'),
N('KOSS reaches for MIRA and finds only air.'),
N('His manufactured hand — the one he was proudest of — closes on nothing, one final time. And the roof has him.'),
W(2),
N('For a moment ELI leans out after the falling maker, as if a heart is required to try to catch even that.'),
D(MIRA, 'No. Not him. He spent his whole life reaching for things that were already gone. Do not learn that reach.'),
D(ELI, 'He built the whole city. And the only thing he ever wanted was to be thanked for it.'),
D(MIRA, 'Then he and your father are the same man wearing different dark. Remember that when your father asks you to choose between them tomorrow.'),
W(2),
N('Silence. Wind.'),
N('Two figures on a cathedral roof, and a city under them that has stopped humming — and started, faintly, from the deep quarters, to weep and to sing.'),
W(2),

// ═══ ACT XI — THE HANDSHAKE ════════════════════════════════════════════
O('THE HANDSHAKE', 'the cathedral steps, dawn', 4),
M('before_the_light', 'The far pipe-organ from the very first shot — but lower now, at ground level, human height.'),
N('Dawn. The rationed sun comes down the towers and, for the first time, keeps going —'),
N('all the way to the flooded square, where head and hands stand facing each other and neither knows the words.'),
N('THE MASTER descends his own tower on foot. He has never touched the ground of his own city.'),
N('He does not know how the ground feels. He is about to learn.'),
D(MASTER, 'My son. You’re alive.'),
D(ELI, 'So are most of them. Not because of you. Look at them, Father. Learn their faces. You are going to need to know them now.'),
D(MASTER, 'The machine is stopped. The city cannot breathe.'),
D(MASTER, 'Tell these hands to go back down and start it, and I will forgive the night.'),
D(GROT, 'We will not be told.'),
D(GROT, 'Not by the head. Not ever again by the head alone.'),
N('Stalemate. The head on one side. The hands on the other.'),
N('And the empty space between them, where a city keeps its heart — or keeps a tomb.'),
N('ELI steps into the empty space. Filthy. Soft hands, working now. A prophet at his shoulder.'),
D(ELI, 'You said a city is a body. Head above, hands below.'),
D(ELI, 'You were right about the shape and wrong about the space between.'),
D(ELI, 'There must be something there.'),
D(ELI, 'Something that carries what the head decides down to the hands — and what the hands suffer up to the head —'),
D(ELI, 'and refuses to let either one lie to the other.'),
D(ELI, 'A heart. Not a machine in the throat. A heart in the middle.'),
D(ELI, 'Father — give me your hand.'),
D(ELI, 'Grot — give me yours.'),
N('THE MASTER, who has ordered a thousand deaths and touched no one, looks at his son’s filthy open hand as if it were the last unmapped thing in his city.'),
N('Which it is.'),
D(MASTER, 'I do not know how this is done.'),
D(MIRA, 'Go on. It is only a hand.'),
D(MIRA, 'It is the whole of the work and the whole of the world.'),
N('THE MASTER’s hand hovers. A thousand years of well-managed distance stand in the two inches between his palm and his son’s.'),
D(GROT, 'We buried children this morning that your machine drowned. My hand is the harder one to give, and I am giving it. Give yours.'),
D(MASTER, 'And if I do — what am I then? I have been the head of this city my whole life. If I take a hand, I am only a man in a square.'),
D(ELI, 'Yes. That is exactly what you are. That is what you have always been. The tower was the lie. The square is the truth. Take the hand and stand in the truth with the rest of us.'),
N('THE MASTER takes his son’s hand. GROT, slow and unlovely and right all along, takes the other.'),
N('And ELI stands in the empty space between the head and the hand, and holds —'),
N('and is the heart — and the city, at last, at cost, becomes a body.'),
D(NARR, 'They rebuilt the Mainspring.'),
D(NARR, 'But they built a door in it this time. And behind the door a room, and in the room a chair.'),
D(NARR, 'And in the chair, always, someone whose whole work is to carry the truth both ways.'),
D(NARR, 'They called that work the Heart. It paid nothing.'),
D(NARR, 'It was the most contested seat in Vantage for a hundred years — which is how you know they finally understood what it was worth.'),
D(NARR, 'Between the head that rules and the hand that bleeds there must be a heart.'),
D(NARR, 'The city learned it in one night and a flood. You are welcome to learn it cheaper.'),
M('before_the_light', 'The organ resolves, finally, into something that is almost — but not quite — a lullaby that means it.'),
W(3),

];

// ── Build the node chain ─────────────────────────────────────────────────────
// Fixed head: start + title_card. Fixed tail: credits. Body: the script beats.
// We pad the tail (before credits) with graceful "held black" fades to land on
// EXACTLY 480 nodes without ever cutting story.
const TARGET = 480;

const credits = {
  type: 'credits',
  text: [
    'THE MAINSPRING',
    'A Coldwater Saturday Picture',
    '',
    '— CAST —',
    'ELI ................... the boy who grew a heart the hard way',
    'MIRA ................. the voice in the water',
    'THE MASTER ........... who touched the ground of his own city, once',
    'KOSS ................. the maker, unthanked, unmade',
    'THE DOUBLE ........... a face that never meant it',
    'GROT ................. slow, unlovely, right all along',
    '',
    'Filmed a mile above and a mile below the only sun in the basin.',
    'No hands were consulted in the building of this city.',
    'They are consulted now. That is the whole of the picture.',
    '',
    'Any resemblance to a body you live inside is entirely the point.',
    '',
    'KSAB — we keep the lights on so you don’t have to.',
  ].join('\n'),
  duration: 45,
};

// nodeHoldMs — replicate the broadcast runner's timing (plugins/broadcast/index.js
// nodeHoldMs) so we can report runtime and set a sane override_duration.
function holdMs(node) {
  const d = node;
  switch (node.type) {
    case 'start': return 0;
    case 'music': return 8000;
    case 'title_card': return (d.duration ?? 10) * 1000;
    case 'wait': return (d.duration ?? 5) * 1000;
    case 'credits': return (d.duration ?? 10) * 1000;
    case 'overlay': return (d.duration ?? 5) * 1000;
    default: {
      const text = typeof d.text === 'string' ? d.text : '';
      if (!text) return 8000;
      return Math.max(2500, Math.min(text.length * 110, 20000) + 1000);
    }
  }
}

// Assemble body beats, then compute padding.
const head = [{ type: 'start' }, { type: 'title_card', graphic_id: 'mainspring_title' }];
const body = script.slice();

// How many nodes before we add credits?  head + body + pad + credits = TARGET
let pad = TARGET - (head.length + body.length + 1);
if (pad < 0) {
  console.error(`✗ Script is ${-pad} beats too long for ${TARGET} nodes. Trim the screenplay.`);
  process.exit(1);
}
// Graceful fade padding: alternate 1s held-black waits so the tail reads as a
// slow fade-out rather than dead filler.
const padNodes = Array.from({ length: pad }, () => W(1));

const ordered = [...head, ...body, ...padNodes, credits];
if (ordered.length !== TARGET) {
  console.error(`✗ Assembled ${ordered.length} nodes, expected ${TARGET}.`);
  process.exit(1);
}

// Assign ids, next-pointers, and grid layout for the VINE editor.
const nodes = {};
ordered.forEach((node, i) => {
  const id = `mv_${i}`;
  const next = i < ordered.length - 1 ? `mv_${i + 1}` : undefined;
  node._vine = { x: 80 + (i % 12) * 220, y: 80 + Math.floor(i / 12) * 160 };
  if (next) node.next = next;
  nodes[id] = node;
});

const totalMs = ordered.reduce((s, n) => s + holdMs(n), 0);
const totalSec = Math.round(totalMs / 1000);

// ── The broadcast wrapper (mirrors bc_last_call.json) ────────────────────────
const broadcast = {
  broadcast_graph: { _start: 'mv_0', nodes },
  category: 'movie',
  channel_id: null,
  created_by: 'author',
  description: 'THE MAINSPRING — a KSAB Saturday Picture. In the vertical city of Vantage, the Master’s son goes down to the machine that eats the day, falls for the prophet of the drowned floor, and learns — through a false double, a flood, and a fall — that a city with a head and hands and nothing between them is only a tomb that has learned to hum. A silent-era machine-city fable, scored for the Embassy deck.',
  enabled: 1,
  fallback_messages: [],
  id: 'bc_mainspring',
  loop: 1,
  message_interval: 7,
  messages: [],
  name: 'The Mainspring',
  news_pools: null,
  override_duration: totalSec + 30,
  playback_mode: 'scripted',
  sports_pools: null,
  tags: ['movie', 'scripted', 'feature'],
  talkshow_pools: null,
  updated_at: STAMP,
  weather_pools: null,
};

// ── The title graphic (mirrors lastcall_title.json shape) ────────────────────
const titleSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" font-family="\'Courier New\',monospace">',
  '  <defs>',
  '    <radialGradient id="v" cx="50%" cy="38%" r="80%">',
  '      <stop offset="0%" stop-color="#141a22"/>',
  '      <stop offset="100%" stop-color="#03050a"/>',
  '    </radialGradient>',
  '    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">',
  '      <stop offset="0%" stop-color="#f2efe6"/>',
  '      <stop offset="100%" stop-color="#8f9aa8"/>',
  '    </linearGradient>',
  '  </defs>',
  '  <rect width="640" height="360" fill="url(#v)"/>',
  // three ascending tower silhouettes
  '  <g fill="#0b1119" stroke="#1c2530" stroke-width="1">',
  '    <rect x="70" y="150" width="60" height="210"/>',
  '    <rect x="150" y="90" width="70" height="270"/>',
  '    <rect x="240" y="40" width="52" height="320"/>',
  '    <rect x="470" y="120" width="64" height="240"/>',
  '    <rect x="546" y="70" width="48" height="290"/>',
  '  </g>',
  '  <g stroke="#2a3340" stroke-width="1">',
  '    <line x1="0" y1="150" x2="640" y2="150"/>',
  '    <line x1="0" y1="214" x2="640" y2="214"/>',
  '  </g>',
  '  <text x="320" y="120" text-anchor="middle" fill="#7fd6c2" font-size="17" letter-spacing="8">KSAB SATURDAY PICTURE</text>',
  '  <text x="320" y="194" text-anchor="middle" fill="url(#g)" font-size="58" letter-spacing="9" font-weight="bold">THE MAINSPRING</text>',
  '  <text x="320" y="248" text-anchor="middle" fill="#c8a24a" font-size="15" letter-spacing="5">A COLDWATER FEATURE</text>',
  '  <text x="320" y="300" text-anchor="middle" fill="#59636f" font-size="12" letter-spacing="3">a head · two hands · and the empty space between</text>',
  '</svg>',
].join('\n');

const graphic = {
  content: titleSvg,
  created_at: STAMP,
  description: 'Title card for THE MAINSPRING feature.',
  id: 'mainspring_title',
  name: 'mainspring_title',
  tags: ['movie'],
  type: 'svg',
  updated_at: STAMP,
};

// ── Write ────────────────────────────────────────────────────────────────────
writeFileSync(join(ROOT, 'content/media_broadcasts/bc_mainspring.json'), JSON.stringify(broadcast, null, 2) + '\n');
writeFileSync(join(ROOT, 'content/media_graphics/mainspring_title.json'), JSON.stringify(graphic, null, 2) + '\n');

// ── Report ───────────────────────────────────────────────────────────────────
const counts = {};
for (const n of Object.values(nodes)) counts[n.type] = (counts[n.type] || 0) + 1;
console.log(`✓ THE MAINSPRING built.`);
console.log(`  nodes: ${Object.keys(nodes).length}  (target ${TARGET})`);
console.log(`  types: ${JSON.stringify(counts)}`);
console.log(`  padding fades added: ${pad}`);
console.log(`  runtime: ~${Math.floor(totalSec / 60)}m ${totalSec % 60}s   (override_duration=${broadcast.override_duration}s)`);
console.log(`  wrote content/media_broadcasts/bc_mainspring.json`);
console.log(`  wrote content/media_graphics/mainspring_title.json`);
