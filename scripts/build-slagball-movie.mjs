// build-slagball-movie.mjs — generate SLAGBALL, a 480-node scripted comedy
// "movie" (a Sub-Channel 2½ presentation). File-authoring only: writes
// content/media_broadcasts/bc_slagball.json + content/media_graphics/
// slagball_title.json. No DB, no live NPCs. Run: node scripts/build-slagball-movie.mjs
//
// Format mirrors bc_last_call.json / bc_mainspring.json exactly:
// broadcast_graph = { _start, nodes }, nodes chained by `next` (edges []),
// types start/title_card/say/music/wait/overlay/credits. The story is an ORIGINAL
// Coldwater underdog comedy that echoes the ARC of an underdog sports-tournament
// picture (a beloved dive vs. a corporate chain, a washed-up coach, a misfit team,
// a bracket, a sudden-death upset, a wager twist). All characters, names, gags, and
// dialogue are original; no line is taken from any film. Short comedic beats keep
// most nodes near the 2.5s floor; `wait` nodes are comedic pauses, not padding.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = '1783960000';

// ── Beat DSL ─────────────────────────────────────────────────────────────────
const N = (text) => ({ type: 'say', style: 'narration', text });
const D = (name, text) => ({ type: 'say', style: 'raw', text: `${name} says, "${text}"` });
const M = (song, blurb) => ({ type: 'music', song, text: `♪ ${blurb} ♪` });
const W = (duration) => ({ type: 'wait', duration });
const O = (text, subtext, duration = 4) => ({ type: 'overlay', overlayType: 'lower_third', graphic_id: '', text, subtext, duration });

// Character labels (on-screen text only — NOT live NPCs)
const NARR = 'NARRATOR';
const DUTCH = 'DUTCH';        // owner of The Sump — broke, decent, in over his head
const VESS = 'VESS';          // the liquidator’s lawyer who ends up on the wrong side (ours)
const VIGO = 'MAXIM VIGO';    // CEO of APEX — vain, optimized, deluded
const RUSK = 'COACH RUSK';    // washed-up Slagball legend on a busted hover-chair
const PIP = 'PIP';            // anxious kid, secretly deadly
const BASH = 'BARNACLE BASH'; // fully convinced he is a pirate
const MERV = 'MERV';          // deadpan giant, one word at a time
const LOTTIE = 'LOTTIE';      // the Sump’s waitress, perfect aim, no patience
const GILES = 'GILES';        // hopeless romantic, hopeless player, enormous heart
const BLURT = 'BLURT';        // Sub-Channel 2½ play-by-play
const CASS = 'CASS';          // Sub-Channel 2½ color, mid-breakdown
const REF = 'THE REF';        // arena official, deeply tired

// ── The screenplay ───────────────────────────────────────────────────────────
const script = [

// ═══ ACT I — WELCOME TO THE SUMP ═════════════════════════════════════════
O('SLAGBALL', 'a Sub-Channel 2½ presentation', 5),
M('before_the_light', 'A triumphant sports-anthem synth that is one keyboard preset away from a funeral, and knows it.'),
N('A held shot: a neon pit in a bad part of Coldwater. Two teams. A crate of foam-wrapped slag orbs. And a great deal of poor judgment.'),
D(NARR, 'This is Slagball. The rules are simple. You throw a slag. You hit the other side. They sit down.'),
D(NARR, 'If they catch it, YOU sit down, and you think about the choices that brought you here.'),
D(NARR, 'It was invented by bored dock hands who ran out of things to resent. It is the second-most popular sport in the basin.'),
D(NARR, 'The most popular sport in the basin is watching people who are worse off than you. Slagball is often both at once.'),
W(2),
N('THE SUMP. A bar with a pit in the back, held together by grease, sentiment, and one very tired support beam.'),
N('Its owner, DUTCH, is a large kind man who has never won anything, including arguments with his own suppliers.'),
D(DUTCH, 'Morning, Lottie. What’s the damage.'),
D(LOTTIE, 'The tap’s out, the drone repossessed a stool while you were asleep, and a man from a bank is standing in your pit.'),
D(DUTCH, 'We don’t have a man from a bank.'),
D(LOTTIE, 'We do now. He brought a clipboard. Nobody brings a clipboard to say something nice.'),
N('In the pit stands VESS — sharp, pressed, holding a clipboard like a weapon she is licensed to carry.'),
D(VESS, 'Are you Dutch? The Dutch who owns this — establishment?'),
D(DUTCH, 'Depends who’s asking and how much they’re asking for.'),
D(VESS, 'I’m asking for forty thousand credits, and I’m asking today, and my name is Vess.'),
D(DUTCH, 'Well, Vess, I’ve got about forty credits and a lot of what I’d call ambiance.'),
D(VESS, 'The bank calls it a fire hazard with a liquor license.'),
D(LOTTIE, 'She’s not wrong, Dutch.'),
D(DUTCH, 'Lottie, whose side are you on.'),
D(LOTTIE, 'The side that still has a roof. I’m flexible about which side that is.'),
N('Vess produces a stylus and begins itemizing the Sump the way a coroner itemizes a body.'),
D(VESS, 'One bar, structurally optimistic. One pit, purpose unclear. Fourteen stools, one recently repossessed. And a smell I’m choosing not to catalogue for legal reasons.'),
D(DUTCH, 'That smell is character.'),
D(VESS, 'Character doesn’t pay a lien, Dutch. I’ve tried. I once billed a man’s personality. It bounced.'),
D(DUTCH, 'You bill personalities?'),
D(VESS, 'I bill everything. It’s the only language the bank speaks and I’m fluent and I hate it.'),
N('A regular at the end of the bar quietly finishes his drink, sets down exactly no credits, and leaves. Dutch watches him go with the fondness of a man being robbed by family.'),
D(DUTCH, 'That’s Old Pemms. He hasn’t paid since the Waking. He’s basically furniture.'),
D(LOTTIE, 'Furniture we can’t repossess because he’s technically alive. We checked. Twice. Hopefully.'),
D(VESS, 'This is the worst-run business I have ever been sent to close, and I closed a clinic that was legally a boat.'),
D(DUTCH, 'And yet you’re still standing in my pit.'),
D(VESS, 'The exit’s behind Old Pemms and I’m not ready to have that conversation.'),
W(2),

// ═══ ACT II — APEX ════════════════════════════════════════════════════════
O('MEANWHILE, ACROSS TOWN', 'the APEX Optimization Spire', 4),
M('before_the_light', 'A chrome corporate fanfare, the kind that plays in an elevator that thinks very highly of itself.'),
N('APEX. A fitness-arena empire so glossy you can see your own inadequacy in the floor. At its summit: MAXIM VIGO.'),
N('VIGO is speaking. VIGO is always speaking. Currently he is speaking to a hologram of himself, which is the only audience that has never let him down.'),
D(VIGO, 'Look at us. Look at what we’ve optimized. There is not one soft thing left in this entire tower. Not one.'),
D(VIGO, 'Softness is just strength that gave up early. I read that. I think I said it. I’ll have someone check who said it and then I’ll have said it.'),
N('An assistant approaches, terrified in the specific way of people paid well to be terrified.'),
D(VIGO, 'Tell me something optimized.'),
D(VESS, 'Sir, the Sump acquisition. The owner can’t pay. Foreclosure clears in thirty days. The whole block is ours.'),
D(VIGO, 'The Sump. That grease-stain with a pit. I want it flattened and turned into an APEX Wellness Annex.'),
D(VIGO, 'Do you know what people need, Vess? People need to be told they are almost good enough, forever, for a monthly fee.'),
D(VESS, 'That’s — genuinely the darkest thing I’ve heard in a boardroom, and I do foreclosures.'),
D(VIGO, 'Thank you. Put it on a banner.'),
N('VIGO admires his own jaw in the window, which is a thing his jaw is very used to.'),
D(VIGO, 'Nobody has ever beaten me at anything. Do you know why? Because I only enter things I have already bought.'),
D(VIGO, 'That’s not cheating. That’s pre-winning. Legal team loves it. Put THAT on a banner too. I’m on fire today.'),
N('The hologram of Vigo nods along, because it is programmed to, and because it, too, has never been told no.'),
D(VIGO, 'You agree. Of course you agree. You’re the only one in this building with taste, and you’re me.'),
D(VESS, 'Sir, should I be worried you only take counsel from a projection of yourself?'),
D(VIGO, 'Worried? Vess, it’s the most efficient relationship I’ve ever had. He never asks for a raise and he agrees with me at the speed of light. Literally. He’s light.'),
D(VESS, 'That’s — I’m going to write "concerning" in my notes and move on.'),
D(VIGO, 'Write "visionary." Cross out "concerning." Actually, fire whoever taught you the word "concerning." It’s soft. It’s a soft word.'),
N('Vigo strides to a wall of screens showing every APEX arena in the basin, all identical, all optimized, all empty of anything a person would call joy.'),
D(VIGO, 'Look at it. A hundred arenas. Not one of them has a pit. Do you know why? Because a pit is where the poor go to feel like they matter, and mattering is not a subscription tier.'),
D(VESS, 'You could add a mattering tier.'),
D(VIGO, 'Don’t tempt me with a good idea before lunch, Vess. Flatten the Sump. I want the whole basin optimized before I have to feel anything about any of it.'),
W(2),

// ═══ ACT III — THE ULTIMATUM ══════════════════════════════════════════════
O('BACK AT THE SUMP', 'thirty days on the clock', 4),
N('Vess returns to the Sump to deliver the papers. She does not expect to feel anything. This is, professionally, the plan.'),
D(VESS, 'Thirty days, Dutch. Raise forty thousand or the block goes to APEX and this pit becomes a place where people feel bad about their cores.'),
D(DUTCH, 'Forty thousand. I could sell everything I own and get to about nine.'),
D(VESS, 'Then I’d stop at nine. Save yourself the everything.'),
N('A regular — GILES — looks up from the bar, heartbroken already, which is his natural resting state.'),
D(GILES, 'They can’t take the Sump. I met the love of my life here.'),
D(LOTTIE, 'Giles, you met the love of your life here eleven times. Three of them left through that window.'),
D(GILES, 'And I’d wait for all of them to come back. That’s what the Sump IS, Lottie. It’s a place you come back to.'),
N('It is, briefly, moving. Then a support beam groans, and everyone flinches on instinct.'),
D(DUTCH, 'Vess. Off the record. Is there any way — any way at all — a place like this beats a thing like APEX?'),
D(VESS, 'Off the record? No. On the record, also no, but with a stamp.'),
D(VESS, 'You’d need a miracle, a lawyer, and forty thousand credits, and you have a beam that’s actively quitting.'),
D(DUTCH, 'What if I told you I could get you the lawyer for free.'),
D(VESS, 'I’d say you don’t have that kind of charm.'),
D(DUTCH, 'No. But the Sump does. Everybody who works here started as a customer who couldn’t afford to leave.'),
N('Vess looks at the papers. Vess looks at the pit. Something professional in her sets down its clipboard, just for a second.'),
D(VESS, 'Get me a reason. A real one. And I’ll pretend I forgot which side I’m on for exactly as long as it’s interesting.'),
D(GILES, 'I have a reason. Her name was Marisol. Or Deb. It was one of the two and they both left through the window.'),
D(LOTTIE, 'Giles, nobody is asking about the window women right now.'),
D(GILES, 'Somebody should. Somebody always should. That’s the tragedy of the Sump, Lottie: too many windows, not enough staying.'),
D(VESS, 'Is he always like this?'),
D(DUTCH, 'Only when he’s awake. Asleep he’s worse. He narrates.'),
N('Old Pemms, still furniture, raises a finger as though to contribute, thinks better of it, and lowers it. It is the most anyone has ever heard from Old Pemms.'),
D(DUTCH, 'See that? Even Pemms cares. Pemms hasn’t cared about anything since they took the sun private.'),
D(VESS, 'That is the lowest bar for hope I have ever been asked to clear, and yet.'),
D(DUTCH, 'That’s the Sump’s whole business model, Vess. The lowest bar, cleared by people who had no business jumping.'),
W(2),

// ═══ ACT IV — THE LONG SHOT ═══════════════════════════════════════════════
O('THE IDEA', 'possibly a bad one', 4),
M('before_the_light', 'A tiny hopeful theme, played on what is clearly a broken keyboard, which somehow helps.'),
N('That night, PIP — the anxious kid who buses the tables — is watching a flyer flicker on the wall.'),
D(PIP, 'Dutch? Dutch, um. This is probably nothing. It’s definitely nothing. I’ll go.'),
D(DUTCH, 'Pip. Breathe. What is it.'),
D(PIP, 'The Coldwater Slagball Open. Grand prize is — it’s forty thousand credits. It’s exactly forty thousand credits.'),
N('The whole bar turns and looks at the flyer as if it had personally arrived to save them, which, narratively, it has.'),
D(LOTTIE, 'That’s not a coincidence. That’s a screenwriter.'),
D(DUTCH, 'We enter a Slagball tournament. We win exactly what we owe. We keep the Sump.'),
D(VESS, 'Do any of you play Slagball?'),
N('A long silence. Somewhere, the tired support beam creaks, as if to answer for them.'),
D(DUTCH, 'We own a Slagball pit.'),
D(VESS, 'Owning a pit is not playing Slagball. I own a treadmill. I am not a horse.'),
D(GILES, 'I’ve always wanted to be part of a team. A team is just a group of people who agree to be disappointed together.'),
D(LOTTIE, 'Giles, that’s a family. A team’s the one where you win sometimes.'),
D(DUTCH, 'Then we win sometimes. Starting now. Who’s in.'),
N('Hands go up. Slowly. Reluctantly. The way hands go up when they know the rest of the body disagrees.'),
D(PIP, 'I’ll — I’ll do the thing. The team thing. Please don’t make me talk to the crowd.'),
D(DUTCH, 'Pip, you’re in. Merv?'),
N('MERV, an enormous man who has said nine words this year, considers the question with great seriousness.'),
D(MERV, 'Fine.'),
D(DUTCH, 'That’s five words. He’s excited.'),
D(LOTTIE, 'I’m in. I’ve been throwing things at men in this bar for twenty years without a trophy to show for it. Time it counted.'),
D(DUTCH, 'Lottie, you throw glasses.'),
D(LOTTIE, 'And I’ve never missed. You do the math on who your best player is and then apologize to me for the wage.'),
D(GILES, 'I’m in too. If the Sump goes down, I want to have loved it out loud at least once, in a uniform, on a team.'),
D(DUTCH, 'Giles, you understand people will be throwing things at you.'),
D(GILES, 'Dutch. People have been throwing things at me my whole life. At least in the pit it’ll finally be regulation.'),
D(VESS, 'That is either the saddest or the healthiest thing I’ve heard all week and I genuinely cannot tell which.'),
D(DUTCH, 'At the Sump those are the same thing. You’ll get used to it. Or you’ll leave through the window, and we’ll name a stool after you.'),
D(PIP, 'Do we — do we get uniforms? I don’t want a number that draws attention. Can I be a low number? A shy number?'),
D(DUTCH, 'Pip, you can be whatever number won’t make you faint. We’ll workshop it.'),
W(2),

// ═══ ACT V — THE MISFITS ══════════════════════════════════════════════════
O('THE TEAM', 'such as it is', 4),
N('A team needs six. The Sump has five and a half, if you count Giles as a whole person, which the Sump generously does.'),
N('The sixth arrives on his own. He always does. His name — he insists — is BARNACLE BASH.'),
D(BASH, 'Ahoy the pit! I heard there be a crew forming, and a crew be needing a man who fears no water!'),
D(LOTTIE, 'Bash. There’s no water. There’s never been water. It’s a bar.'),
D(BASH, 'That be exactly what the sea WANTS ye to think, Lottie.'),
D(DUTCH, 'Bash, are you actually a pirate?'),
D(BASH, 'I be as much a pirate as this be a ship, captain. Which is to say: completely, and only me.'),
D(PIP, 'I think he’s the most confident person I’ve ever met and I find it deeply calming.'),
D(BASH, 'The boy has SEA SENSE! Ye there, cabin boy — stick by ol’ Bash and ye’ll never drown on dry land, which be the most common way to drown in this city!'),
D(PIP, 'That’s — genuinely reassuring? I don’t know why. I feel safer. Is that wrong?'),
D(LOTTIE, 'It’s wrong, but it’s the good kind of wrong. Bash has never once been right and never once been scared. There’s a lesson in there if you don’t look at it directly.'),
D(BASH, 'Aye! Fear be a fog, and a good captain simply declines to sail through it! I declined years ago! Look at me now — landlocked, beloved, and TERRIFYING at slagball!'),
D(DUTCH, 'He’s not wrong about the terrifying part. I’ve seen him throw. Grown collectors have crossed the street.'),
D(DUTCH, 'He throws harder than anyone in the block. I stopped asking questions the day he called the ice machine a kraken and won.'),
N('Vess reviews the roster with the expression of a woman watching a bridge get built out of chairs.'),
D(VESS, 'A frightened boy. A silent mountain. A waitress with a grudge. A romantic with a concussion history. A pirate. And you.'),
D(DUTCH, 'And you.'),
D(VESS, 'I’m the LAWYER. I hold the clipboard. I do not enter the pit.'),
D(DUTCH, 'The rules say six players on the roster, minimum, or you’re disqualified. We have six. If one of us so much as sneezes, we forfeit.'),
D(VESS, 'So I’m the sneeze insurance.'),
D(DUTCH, 'You’re the seventh. The one who catches us when we fall. Legally. And, I’m hoping, a little bit in general.'),
D(VESS, 'Don’t. I have a clipboard and I’m not afraid to file it.'),
N('But she signs the roster. In the box marked RESERVE she writes her name, and underlines it, and pretends the underline was an accident.'),
D(BASH, 'A fine crew! But a crew needs a NAME, captain. Every vessel that ever sailed had a name to curse when she sank!'),
D(DUTCH, 'We’re the Sump.'),
D(BASH, 'That be a berth, not a name! We need somethin’ to strike fear! The Drowned Fists! The Kraken’s Regret!'),
D(LOTTIE, 'The Kraken’s Regret is what I call the men’s room after darts night.'),
D(PIP, 'What about — and this is dumb — what about "The Sump"? Because that’s what we are and nobody expects the thing that’s just true.'),
N('A silence. It is, everyone realizes, perfect. The most dangerous thing a Coldwater team can be is exactly what it says on the door.'),
D(DUTCH, 'The Sump it is. Pip named the team. Pip, you’ve done one confident thing and I’m very proud.'),
D(PIP, 'I’m already regretting it. Can we go back to the fear one?'),
D(MERV, 'No.'),
D(DUTCH, 'Merv likes it. That settles it. When Merv talks, the ceiling listens.'),
W(2),

// ═══ ACT VI — COACH RUSK ══════════════════════════════════════════════════
O('THE COACH', 'a legend, technically', 4),
M('before_the_light', 'A grizzled old-champion theme, mostly low brass, like a war movie about a man who lost.'),
N('You cannot win the Open without a coach. Every good coach in Coldwater is expensive. So the Sump finds a bad one who used to be great.'),
N('COACH RUSK. Once the finest slagger in the basin. Now a wreck on a busted hover-chair that lists permanently to port.'),
D(RUSK, 'Get out. I don’t coach. I retired. I sit here and I resent the ceiling. It’s a full schedule.'),
D(DUTCH, 'They say you never lost a match.'),
D(RUSK, 'They say a lot of things. They also say this chair is fixable, and look at me listing into the fern.'),
D(DUTCH, 'We need a coach. We’ve got thirty days, no skill, and a beam that’s given up.'),
D(RUSK, 'Then you don’t need a coach. You need a priest and a good lawyer.'),
D(VESS, 'She’s here. She’s expensive. Coach us and she stays free, which is the only free thing in this economy.'),
N('Rusk looks at the six of them. His eyes, ancient and mean, do a thing they have not done in years: they light up, out of pure contempt.'),
D(RUSK, 'You’re all terrible. I can see it from here. The big one’s got no killer instinct, the kid flinches at his own shadow, and the pirate’s a lawsuit.'),
D(BASH, 'A COMPLIMENT!'),
D(RUSK, 'It was not.'),
D(RUSK, 'But terrible I can work with. Terrible’s just great that hasn’t been screamed at yet. Champions I can’t fix. You? You’re all wet clay and low standards. Perfect.'),
D(DUTCH, 'Is that a yes?'),
D(RUSK, 'It’s a maybe with the volume of a yes. Wheel me to the pit. And somebody get me out of this fern, I’ve been in it since the spring.'),
N('They extract Coach Rusk from the fern. Bits of fern come with him. He does not remove them for the rest of the picture. It becomes, in time, a look.'),
D(PIP, 'Sir, is it true you once won a match with a broken arm?'),
D(RUSK, 'Both arms, boy. And a grudge. The grudge did most of it. Never underestimate a well-kept grudge; it’s the only thing in Coldwater that appreciates in value.'),
D(GILES, 'Coach, what happened? You were the greatest. What takes a legend down to a fern?'),
D(RUSK, 'Same thing that takes everybody down, romantic. I won everything, and then I had nothing left to be angry at, and a man who runs on anger can’t coast. So I sat down. In a fern, as it turns out.'),
D(DUTCH, 'So what changed today?'),
D(RUSK, 'You walked in with six of the worst players I’ve ever seen and asked me to save a bar. That’s the first thing worth being angry about in nine years. Thank you. I hate it. Let’s go.'),
D(BASH, 'A captain who runs on fury! I’ll follow ye into any storm, ye landlocked terror!'),
D(RUSK, 'The pirate’s going to be a problem and I’ve decided he’s my favorite. Wheel. Pit. Now.'),
W(2),

// ═══ ACT VII — TRAINING ═══════════════════════════════════════════════════
O('TRAINING', 'day one of thirty', 4),
M('before_the_light', 'A montage synth, aspirational and cheap, the sound of a man believing in himself against the advice of everyone.'),
N('Rusk’s methods are unorthodox. By which the survivors mean cruel. By which Rusk means effective.'),
D(RUSK, 'Rule one. In the pit, everything is trying to hit you. The slag. The crowd. Your own doubt. Your own mother, if she’s in the stands, and mine always was.'),
D(RUSK, 'So you learn to not be where the throw is going. That’s the whole game. Not being there. I built a career on not being there. Ask my kids.'),
N('He gestures. A battered repossession drone — UNIT 7, the one that took the stool — hovers in, reprogrammed and furious.'),
D(RUSK, 'This is Unit 7. It used to take furniture. Now it takes SLAGS, and it throws them at your soft little heads. Dodge, or learn.'),
D(PIP, 'That’s a repossession drone. That is a WEAPON.'),
D(RUSK, 'If you can dodge a repo-drone, boy, you can dodge a slag. And if you can’t dodge a repo-drone — you were going to lose your couch anyway.'),
N('Unit 7 opens fire. Pip is struck immediately, in the face, with great enthusiasm.'),
D(PIP, 'I felt that in my ancestors.'),
D(RUSK, 'Good. Pain’s just the drone teaching. Free lessons. In this economy you take the free ones. Again.'),
N('MERV steps up. Unit 7 fires. Merv does not dodge. Merv catches the slag one-handed and crushes it, and the drone, out of respect, backs up.'),
D(RUSK, 'Now HIM I don’t have to teach. Him I have to aim.'),
D(MERV, 'Okay.'),
N('LOTTIE takes the pit. She has spent twenty years dodging drunks, pinches, and thrown glasses. The drone stands no chance and seems to know it.'),
D(LOTTIE, 'Sweetheart, I’ve dodged worse than you on a slow Tuesday.'),
D(RUSK, 'The waitress is our best player and she started this morning. That’s not a good sign about the rest of you. That’s a GREAT sign about her.'),
N('GILES, meanwhile, is hit by a slag Unit 7 did not throw. It is unclear where it came from. It happens to Giles a lot.'),
D(GILES, 'Coach, I think the universe is a slag and I am the pit.'),
D(RUSK, 'Finally. The romantic gets it. That’s the only true thing anyone’s said in this dump all week.'),
N('Rusk introduces the second drill. He calls it "Trust." It involves standing very still while Merv throws a slag as hard as he can at a plank six inches from your head.'),
D(RUSK, 'The plank is the lesson, Pip. You flinch, you lose. You trust the drill, you learn where you end and the throw begins. That line’s the whole sport.'),
D(PIP, 'The plank has a hole in it shaped exactly like a slag.'),
D(RUSK, 'That’s Merv’s work. He’s never missed the plank. He’s also never hit the plank on purpose. He simply asks it to move and it declines. Watch.'),
N('Merv throws. The slag goes through the existing hole in the plank without touching the sides, and Pip does not flinch, because Pip has fainted, which Rusk marks down as progress.'),
D(RUSK, 'Fainting’s just flinching that committed. We can work with commitment. Wake him up and do it again.'),
D(BASH, 'COACH! Teach me to throw so hard the SEA apologizes!'),
D(RUSK, 'Bash, you already throw too hard. Your problem isn’t power, it’s that you announce every throw with a nautical war crime. The other team hears you coming from the docks.'),
D(BASH, 'The announcin’ is HALF the throw, coach!'),
D(RUSK, 'It’s a third of the throw and all of the lawsuit. Fine. Keep the shanty. We’ll weaponize the confusion. Nobody’s ever game-planned for a man who thinks the ice machine is a kraken.'),
W(2),
N('Days pass. Bruises bloom and fade. The six of them are, against all decency, getting less terrible.'),
D(RUSK, 'You’re still bad. But you’re bad on PURPOSE now. That’s technique. Bad on purpose is a plan. Bad by accident is just Tuesday.'),
D(DUTCH, 'Coach. Do you think we can actually win this thing?'),
D(RUSK, 'No.'),
D(DUTCH, 'Oh.'),
D(RUSK, 'But I didn’t think I’d get out of that fern either, and here I am, listing at you with hope. Wheel me closer, I’m being sincere and I hate it.'),
N('One last drill, the night before the Open. Rusk lines all six of them along the pit and turns off the neon, so they train the way champions die: in the dark.'),
D(RUSK, 'The eyes lie. In a real match the crowd, the lights, the money on the board — all of it’s screaming at your eyes. So we learn to play without them tonight.'),
D(PIP, 'How do we throw at something we can’t see?'),
D(RUSK, 'You listen for the thing that’s sure it can’t lose. Certainty’s loud, kid. Rich certainty is the loudest thing in any room. You aim at the smug and you rarely miss.'),
N('In the dark, Merv catches a slag he could not possibly have seen, out of pure enormous instinct, and hands it back into the black like a gift.'),
D(MERV, 'Easy.'),
D(RUSK, 'The mountain speaks and the lesson’s over. Everybody drink water. Not you, Bash, you’ll say something.'),
D(BASH, 'The sea is water and I AM the sea, coach!'),
D(RUSK, 'And there it is. Bed. All of you. Tomorrow we find out if terrible-on-purpose is a plan or an obituary.'),
N('Before they go, Rusk keeps Dutch back a moment in the dark pit.'),
D(RUSK, 'You know why I never lost, Dutch? Not talent. There were more talented sluggers than me. I never lost because I never once thought I deserved to win. Kept me hungry. Kept me watching.'),
D(DUTCH, 'That sounds miserable, Coach.'),
D(RUSK, 'It was. But your lot’s got the same disease and they don’t even know it. Not one of them thinks they deserve a thing. That’s why they might just take everything. The world never sees the undeserving coming.'),
D(DUTCH, 'And you? You think you deserve tomorrow?'),
D(RUSK, 'I think I deserve to yell one more time in a full arena before this chair finally lists all the way into the ground. That’s enough. That’s more than the fern was going to give me.'),
W(2),

// ═══ ACT VIII — QUALIFIERS ════════════════════════════════════════════════
O('THE COLDWATER OPEN', 'qualifying rounds', 4),
M('before_the_light', 'A crowd, a buzzer, and the specific roar of people who paid too little to expect much.'),
N('The Open. A neon arena. And, in a broadcast booth built for two and a budget for less, the voice of Sub-Channel 2½.'),
D(BLURT, 'Welcome, welcome, to the Coldwater Slagball Open, live on Sub-Channel Two and a Half, the ONLY channel that could afford us!'),
D(CASS, 'Blurt, I want to say, before the violence starts, that my contract is up for renewal and I have made peace with dying in this booth.'),
D(BLURT, 'That’s the spirit, Cass! First up — the plucky no-names from the Sump versus a team of sentient gym equipment!'),
N('Round one. The Sump versus APEX’s warm-up squad: six identical men who have never once been told no.'),
D(REF, 'Both teams to the line. Slags in the middle. On my whistle. And please — please — nobody dies. I have to write the report.'),
N('The whistle. Chaos. Bash bellows a sea-shanty and hurls a slag hard enough to change a man’s religion.'),
D(BASH, 'DOWN YE GO, LANDLUBBER, AND GIVE ME REGARDS TO THE DEEP!'),
D(CASS, 'He knocked one out cold and there’s no water anywhere near here. I’ve stopped asking. It’s healthier.'),
N('Pip, terrified, closes his eyes and throws blind. It hits the last APEX clone square between his optimized eyes.'),
D(PIP, 'Did I — did I do it? I can’t look. Is it good or is it the worst thing I’ve ever done?'),
D(RUSK, 'It’s good, kid. For once the two are the same thing. Open your eyes. We won a round.'),
D(BLURT, 'UPSET! The Sump takes round one! Somewhere an accountant is confused and a pirate is very, very happy!'),
D(CASS, 'Blurt, I have covered eleven sports on this channel and nine of them were illegal. I have never seen a team win by simply refusing to understand they should lose.'),
D(BLURT, 'It’s the Coldwater way, Cass! You don’t beat the odds, you just annoy them until they leave!'),
N('Round two. The Sump draws a team of retired debt collectors — men who throw for a living and enjoy it too much.'),
D(LOTTIE, 'Oh, I know these boys. They repossessed my mother’s teeth. This one’s personal and I’m going to enjoy it.'),
N('Lottie clears three of them before they set their feet. It is less a sporting performance than a settling of accounts.'),
D(BLURT, 'THE WAITRESS IS UNTOUCHABLE! She’s throwing like the rent’s due, Cass, and for her it always is!'),
D(CASS, 'I’m told she’s never received a tip commensurate with that arm and honestly that’s the real crime on display tonight.'),
N('Round three. Giles is eliminated in four seconds by a slag that ricochets off the ceiling, a wall, and his own teammate before finding him. Even the ref looks impressed.'),
D(GILES, 'It found me. It always finds me. I’ve made my peace. Tell Marisol. Or Deb. Tell the window.'),
D(REF, 'Kid, in twenty years of officiating I have never seen the game itself hold a grudge against one player. You should see someone. Or an astronomer.'),
N('The semifinal. The Sump versus a corporate development squad in matching APEX warmups, all named some variety of "Chad" for optimization purposes.'),
D(BLURT, 'And here come the APEX juniors, Cass — six young men bred in a lab to have excellent cores and no interior lives whatsoever!'),
D(CASS, 'They move as one, Blurt. It’s beautiful and it’s deeply upsetting, like a school of fish that files taxes.'),
N('Merv steps to the line alone against all six. He does not throw. He simply catches everything they send, and sends it back, and the juniors sit down in perfect synchronized disappointment.'),
D(BLURT, 'THE MOUNTAIN CATCHES EVERYTHING! Six optimized Chads, one silent man, and the man is winning, Cass!'),
D(MERV, 'Sit.'),
D(CASS, 'He said "sit" and they SAT. That’s not a throw, that’s a command. I’ve never respected anyone more and I’ve interviewed a warlord.'),
D(RUSK, 'THAT’S my mountain! Aim him at the final, Dutch, that’s all I ever have to do — point Merv at the problem and get out of the splash zone!'),
N('The Sump takes the semifinal. In the tunnel, the six of them stand together, filthy and bruised and one win from the impossible, and none of them say anything for a long moment.'),
D(DUTCH, 'One more. One more match and the Sump is ours forever.'),
D(PIP, 'I haven’t fainted in two whole rounds, Dutch. That’s a personal record. I’m calling my mom. She won’t believe it. I don’t believe it.'),
D(GILES, 'I got hit forty times today and I have never felt more alive. Is that the game, Dutch? Is that what everyone’s been getting?'),
D(LOTTIE, 'That’s it, Giles. That’s the whole thing. You get hit, you get up, you find out you’re still here. Some people pay a gym for that. We just open the doors.'),
D(MERV, 'Together.'),
N('Everyone turns. Merv has said a fourth word this year, and it is the right one, and nobody makes a joke, because some words you just let stand.'),
W(2),
N('Round after round, the Sump crawls up the bracket. They are not good. They are stubborn, which in Coldwater beats good more often than good would like.'),
N('High in a private box, MAXIM VIGO watches the scrappy little bar refuse to be flattened on schedule, and his optimized jaw begins, very slightly, to clench.'),
D(VIGO, 'Who ARE these people. Why won’t they lose. Losing is the natural state of the poor, it’s practically a service we provide.'),
D(VESS, 'They’re winning, sir. It happens. Occasionally. To people who aren’t you.'),
D(VIGO, 'Then buy their coach. Buy their bar. Buy their WATER — the pirate seems to need it.'),
D(VESS, 'There is no water, sir.'),
D(VIGO, 'Then buy that too. I want a monopoly on things that don’t exist. That’s called futures, Vess. That’s called vision.'),
N('Vigo descends to the arena floor to intimidate the Sump in person, which is a thing winners are never supposed to need to do.'),
D(VIGO, 'Enjoy the little rounds. My real team hasn’t played yet. APEX PRIME doesn’t enter until the final. We conserve. We optimize. We arrive.'),
D(DUTCH, 'Six warm-up squads and you haven’t won a single round against us yet.'),
D(VIGO, 'Those weren’t my A-squad. Or my B-squad. Frankly they weren’t squads, they were a tax write-off with legs.'),
D(RUSK, 'I know you. Vigo. You bought the league I used to play in and turned it into a gym with ads. You’re the reason a sport became a subscription.'),
D(VIGO, 'Rusk. They told me you died in a fern.'),
D(RUSK, 'I got better. Out of spite. It’s the only exercise you can’t sell, Vigo, and it’s the only one that ever mattered.'),
D(VIGO, 'Charming. Old anger in an old chair. When my Prime team flattens your bar of misfits, I’ll have you both mounted in the lobby. Tastefully. With a QR code.'),
D(RUSK, 'Wheel me at him, Dutch. Wheel me at him RIGHT now.'),
D(DUTCH, 'Coach, no. That’s exactly the round he’d win.'),
W(2),

// ═══ ACT IX — THE SETBACK ═════════════════════════════════════════════════
O('THE SEMIFINAL', 'and a dirty trick', 4),
M('before_the_light', 'The hopeful theme, but a wrong note enters it, and stays.'),
N('The night before the final, Unit 7 malfunctions in the pit during practice — reprogrammed AGAIN, this time by a very expensive hand.'),
N('It fires a live rivet instead of a slag. Rusk shoves Dutch clear, takes the hit himself, and his listing chair finally lists all the way over.'),
D(DUTCH, 'Coach! Coach — somebody get a medic — Rusk, stay with me —'),
D(RUSK, 'Relax. I’ve been hit by worse. I once got benched by a slag to the throat in the ’61 final and married the medic. Bad news is I can’t coach you tomorrow.'),
D(DUTCH, 'Then we don’t play. I’m not doing it without you.'),
D(RUSK, 'You ABSOLUTELY are, you enormous coward. You think I dragged myself out of that fern so you could quit the day before?'),
N('Vess storms in, clipboard shaking, holding a maintenance log with one very expensive fingerprint on it.'),
D(VESS, 'It was APEX. Vigo reprogrammed the drone. I have the log. I have the fingerprint. I have — I have a CONSCIENCE now, apparently, which was not in my contract.'),
D(DUTCH, 'You could lose your job for bringing me this.'),
D(VESS, 'I already quit. Loudly. In the elevator, to a hologram of him, which was oddly satisfying and slightly his fault.'),
N('Rusk, flat on his back and grinning like a wolf, waves them all in close.'),
D(RUSK, 'Listen. All of you. I can’t be in the pit tomorrow. So one of you has to be me. Mean. Certain. Impossible to hit and worse to face.'),
D(RUSK, 'It’s not about the slag. It was never about the slag. It’s about being the last one standing in a place that told you to sit down your whole life.'),
D(RUSK, 'Now the Sump plays tomorrow. With or without me, with or without the beam, with or without a single reason to believe it. Especially without the reason. That’s the good kind of winning.'),
D(DUTCH, 'Okay. Okay. We play. Vess — you’re on the roster now. We just lost our sneeze insurance.'),
D(VESS, 'I don’t play Slagball.'),
D(DUTCH, 'None of us do. That’s never once stopped us. Welcome to the Sump.'),
N('That night nobody sleeps. Rusk holds court from a cot in the back of the bar, wired with painkillers and opinions.'),
D(RUSK, 'Listen. Vigo thinks he broke us tonight. Good. Let him. A man who thinks he’s already won stops watching his own feet.'),
D(PIP, 'But we ARE broken, coach. Our coach is on a cot. Our lawyer’s our sixth player. I fainted during the semifinal and I was a spectator.'),
D(RUSK, 'Pip. Come here. What’s the one thing every single person in this bar has in common?'),
D(PIP, 'We’re all going to lose our home?'),
D(RUSK, 'Before that.'),
D(GILES, 'We were all left through a window?'),
D(RUSK, 'Before THAT. You’re all people this city already counted out. Nobody’s expecting anything from you. That’s not a weakness, you soft sad wonderful idiots. That’s CAMOUFLAGE.'),
D(LOTTIE, 'He’s got a point. Nobody watches the busboy. Nobody guards the waitress. Nobody game-plans the man who thinks the ice machine is a kraken.'),
D(BASH, 'It IS a kraken, Lottie, and tomorrow it fights beside us in spirit.'),
D(DUTCH, 'Get some rest. All of you. Tomorrow the whole city finds out what happens when the people it forgot about show up to collect.'),
W(2),

// ═══ ACT X — THE FINAL, PART ONE ═════════════════════════════════════════
O('THE FINAL', 'The Sump vs. APEX PRIME', 4),
M('before_the_light', 'Full arena. The cheap anthem, but louder, believing in itself harder than ever, which is the whole point of a cheap anthem.'),
N('The championship. On one side: APEX PRIME, six professionals so enhanced they no longer technically require sleep or empathy.'),
N('On the other: a bankrupt bar, a fainting boy, a pirate, a silent giant, a waitress, a heartbroken man, and a lawyer who forgot which side she was on and never went back.'),
D(BLURT, 'This is IT, Cass! The final! The corporate juggernaut versus the little pit that wouldn’t quit! I have goosebumps and one of them is on my eye!'),
D(CASS, 'Blurt, if we survive this broadcast, I want you to know you were the only good thing about Sub-Channel Two and a Half.'),
D(BLURT, 'Cass, that’s beautiful. We are contractually eleven minutes from the ad break. Hold that thought and your bladder.'),
N('MAXIM VIGO struts to center pit in a custom uniform that cost more than the Sump’s entire debt, which is a fact he has printed on the back of it.'),
D(VIGO, 'Dutch. Before we begin. I want you to know there is no version of this where you win. I bought the arena. I bought the slags. I may have bought the ref.'),
D(REF, 'You did not buy the ref. The ref makes forty credits a night and hates every one of you equally. It’s the only fair thing left in this city.'),
D(VIGO, 'A holdout. Charming. Flatten him after.'),
D(DUTCH, 'Vigo. You can buy the arena and the slags and the beam over our heads. You know the one thing about the Sump you could never afford?'),
D(VIGO, 'Please. I’m optimized. I can afford a feeling if I want one. I’ll have someone feel it for me.'),
D(DUTCH, 'You could never afford to NEED it. Everyone in this pit needs each other. That’s not for sale. That’s just the bill nobody sends you.'),
N('It is a good line. Even Vess writes it down. Even Vigo, for one flickering second, looks like a man who owns everything and none of it.'),
D(VIGO, 'That’s — very moving. Truly. I felt a thing. I’ll have it removed later. But I felt it.'),
D(DUTCH, 'That’s all I wanted, Vigo. One real thing before we beat you.'),
D(VIGO, 'You won’t beat me. You’ll lose beautifully and I’ll clip it for the annex opening. "Even the plucky lose." It tests well with subscribers.'),
D(RUSK, 'Keep talking, Vigo. My whole team plays better when someone rich is certain. It’s the loudest sound in the pit and my mountain throws at loud.'),
D(VIGO, 'Whistle.'),
W(2),
N('The whistle. APEX PRIME is everything the Sump is not: fast, precise, merciless, moisturized.'),
N('One by one the Sump goes down. Bash, hurling shanties, is caught mid-boast. Giles is hit by a slag from his own side, somehow, again.'),
D(GILES, 'Even now. Even in the final. The universe is a slag. I have made peace with being the pit.'),
D(CASS, 'The romantic is out and honestly he looks relieved. It’s the calmest anyone has been in this arena all night.'),
N('Pip faints from nerves. Merv is triple-teamed and buried under slags, going down like a demolished tower, slowly and with dignity.'),
D(BLURT, 'It’s falling apart, Cass! It’s five to two! Then five to — oh no — it’s APEX PRIME, all six, versus the Sump’s last two!'),
N('Two left for the Sump: DUTCH, who has never won anything, and VESS, who has never played anything, standing back to back in a pit at the end of the world.'),
D(VESS, 'Dutch. I want you to know, as your lawyer, that this is a catastrophically bad position.'),
D(DUTCH, 'I know.'),
D(VESS, 'And as your — as whatever the other thing is — I’ve never been happier to be in a catastrophically bad position with anyone.'),
D(DUTCH, 'Vess. Was that a feeling?'),
D(VESS, 'File it. We’ll deal with it if we live. Incoming.'),
N('APEX PRIME advances in formation, a wall of optimized men who have practiced this exact humiliation in a lab.'),
D(VIGO, 'End it. Slowly. I want the broadcast to have time for my sponsors.'),
N('From his cot at the rail, hooked to a monitor and running purely on grievance, Coach Rusk finds his voice for the last drill he has left.'),
D(RUSK, 'DUTCH! Two of you left! That’s not a loss, that’s a CORNER! Everybody wins from a corner or they were never going to win at all!'),
D(DUTCH, 'Coach, there are six of them and two of us!'),
D(RUSK, 'Then the math is finally simple enough for you to understand! Every throw you make has to count and every throw they make they’ll take for granted! Make them spend! Make them SPEND, Dutch!'),
N('Dutch catches a lazy, arrogant throw one-handed — a throw APEX PRIME made because they assumed the round was over — and the thrower sits down, stunned, optimized right out of the game.'),
D(BLURT, 'CAUGHT! Dutch catches one and it’s five on two — no — it’s FIVE ON TWO but the Sump has the momentum and the crowd and possibly a god!'),
D(CASS, 'The rich team just learned that "taking it for granted" is a move you can lose to. I’m going to cry again. Renew my contract.'),
N('Five on two becomes four on two becomes three on two. The Sump spends every throw like it’s the last credit in the till, because it is.'),
N('Bash, seated on the sideline and eliminated, coaches the only way he knows how.'),
D(BASH, 'STEADY, CAPTAIN! The bigger the ship, the slower she turns! Make ‘em turn! Make the whole fat galleon come about!'),
D(DUTCH, 'That’s — actually good advice, Bash?'),
D(BASH, 'I have been giving good advice for YEARS, captain, ye simply keep bein’ on land when I say it!'),
N('Vess, who has never thrown a slag in her life, catches one purely by refusing to move — an accident of stubbornness that eliminates an APEX Prime striker.'),
D(VESS, 'I didn’t mean to do that. I froze. I froze and it worked. Is that a technique? Is "legally paralyzed" a technique?'),
D(RUSK, 'In this sport, counselor? It’s a Hall of Fame technique. The plank never moves either. Be the plank. BE THE PLANK, VESS.'),
D(VESS, 'I went to law school to avoid being the plank and here I am, being the plank, and loving it. My mother was right about everything.'),
W(2),

// ═══ ACT XI — SUDDEN DARK ═════════════════════════════════════════════════
O('SUDDEN DARK', 'overtime', 4),
M('before_the_light', 'Everything drops out but a single held heartbeat of bass. The whole arena leans in.'),
N('The score locks. By ancient Slagball law, a deadlock at the final invokes SUDDEN DARK: the arena lights cut, and the last players throw by sound alone.'),
D(REF, 'Sudden Dark! House lights down! One throw each! Last team standing takes the Open! And may whatever’s left of your gods have mercy!'),
N('Blackout. The arena is a held breath. Somewhere in the dark, six optimized professionals and two amateurs, and only the sound of a city that has always thrown things at people like the Sump.'),
D(RUSK, 'Dutch! DUTCH! Don’t aim with your eyes, you never had the eyes! Aim with the part of you that’s been ducking this city your whole life! LISTEN for the ones who think they can’t lose — they breathe loud!'),
N('And in the dark, Dutch — who has lost at everything, who has ducked every collector, every landlord, every disappointment — closes his eyes he doesn’t need anyway, and listens.'),
N('He hears six professionals breathing the smug, even breath of men who have never once needed anything. And he throws at the smuggest breath in the room.'),
D(VIGO, 'This is absurd. Lights! Somebody turn the LIGHTS on! I paid for those lights! I own the photons!'),
D(REF, 'Sudden Dark is in the charter you signed, Mr. Vigo. Page forty. Nobody reads page forty. I read page forty. It’s the only power I have and tonight it is enormous.'),
D(VIGO, 'My men can’t optimize what they can’t SEE!'),
D(RUSK, 'No, Vigo. They can’t. That’s the whole point of the dark. It takes away every advantage a man can buy and leaves only the ones he had to earn. You never taught them to earn. You bought them finished.'),
N('In the black, an APEX striker throws at a sound and hits his own captain. A second throws at that sound and hits the first. Certainty, in the dark, eats itself.'),
D(BLURT, 'Cass, I genuinely cannot see the pit, I am describing this game entirely by the noises, and the noises are GLORIOUS.'),
D(CASS, 'It sounds like a filing cabinet falling down a stairwell forever, Blurt, and it is the finest thing I have ever called.'),
W(2),
N('A sound. Contact. A body sitting down hard in the dark. Then another. Then — impossibly — a chain of them, as APEX PRIME, unable to see, panics and catches its own friendly fire.'),
D(BLURT, 'I CAN’T SEE ANYTHING AND IT’S THE GREATEST MOMENT IN SPORTS HISTORY!'),
D(CASS, 'Blurt I’m crying in the dark and I don’t care who hears it, put it in my contract, I’m crying!'),
N('The lights slam back on.'),
N('APEX PRIME: all six, seated, blinking, betrayed by their own certainty. The Sump: Dutch, standing. And Vess, standing beside him, holding a slag she never had to throw.'),
D(REF, 'The Sump — the SUMP — wins the Coldwater Open!'),
N('The arena detonates. Pip wakes up from his faint directly into a championship and screams for joy and a little from confusion.'),
D(PIP, 'Did we — WE WON? I was ASLEEP. I won a tournament ASLEEP. This is the best and least earned day of my life!'),
D(BASH, 'THE SEA PROVIDES! I KNEW THERE WAS WATER SOMEWHERE, AND IT WAS INSIDE US ALL ALONG!'),
D(MERV, 'Yeah.'),
D(RUSK, 'That’s three words from Merv in one day. Somebody write it down. The boy’s a poet now.'),
N('The Sump’s bench floods the pit. Even Old Pemms, furniture no longer, is carried in on a tide of people who have not won anything in a very long time.'),
D(GILES, 'A slag missed me! For the first time in my life, a slag MISSED me! The universe blinked, Lottie! It blinked!'),
D(LOTTIE, 'That’s because you were unconscious under a pile of your own teammates, Giles. But we’ll call it grace.'),
D(GILES, 'I’ll take grace. I’ll take it in any form the pit will give it.'),
N('Coach Rusk, upright on his cot at the rail, watches his terrible, impossible team and does the second thing he has not done in nine years: he smiles, and lets someone see it.'),
D(RUSK, 'Don’t look at me. It’s the painkillers. I’m in agony and I’m thrilled and I refuse to explain which is which.'),
D(DUTCH, 'We did it, Coach. You got us here.'),
D(RUSK, 'No. You got you here. I just yelled at the fern until it turned into a team. Now stop hugging me, I have a reputation and half of it is fern.'),
W(2),

// ═══ ACT XII — THE PAYOUT ═════════════════════════════════════════════════
O('THE PAYOUT', 'and a small twist', 4),
M('before_the_light', 'The cheap triumphant anthem, at last fully earned, played like it means it because now it does.'),
N('Forty thousand credits. Exactly the debt. The Sump is saved by the width of a single slag thrown in the dark.'),
N('MAXIM VIGO, flattened, approaches the pit to gloat about the one thing he has left: the money doesn’t matter, because he still owns the block.'),
D(VIGO, 'Enjoy your little trophy. You won the prize, but I still hold the paper on this whole district. I’ll flatten the Sump next quarter and call it synergy.'),
D(VESS, 'About that. As Dutch’s lawyer — a title I gave myself this morning and am prepared to defend — I’d point you to clause nine of the Open’s charter.'),
D(VESS, 'The tournament’s title sponsor forfeits all district claims within the arena’s ward if they lose the final. You sponsored the Open, Vigo. Your name’s on the banner. You made me put it there.'),
D(VIGO, 'I — that’s — nobody reads clause nine.'),
D(VESS, 'I read clause nine. I read all the clauses. It’s the one thing I was ever good at, and tonight it’s the one thing that mattered.'),
D(VIGO, 'You worked for ME. I optimized your salary personally. I gave you a corner office with a view of a wall I owned!'),
D(VESS, 'You did. And every day I read the fine print for you, and every day I hated that the fine print was always on your side. Tonight it wasn’t. You have no idea how good it feels to be on the side of the small print for once.'),
D(VIGO, 'This is a betrayal.'),
D(VESS, 'This is a CONTRACT, Vigo. You worship them right up until one of them worships back at someone else. Clause nine. Signed, sponsored, and self-inflicted.'),
D(RUSK, 'She’s better than any slugger I ever coached and she plays a sport made entirely of paper. Remind me to never owe her money.'),
D(VESS, 'You already do, Coach. I’m billing the Sump for the semifinal fingerprint analysis. Family rate. But I’m billing it.'),
N('Vigo looks at his own name on the banner above the pit — the banner he demanded — and understands, for the first time in his optimized life, that he pre-lost.'),
D(DUTCH, 'Here’s the thing about the Sump, Vigo. You can’t flatten a place people keep coming back to. You can only join it. First round’s on the house. You look like you need to sit down somewhere that isn’t optimized.'),
D(VIGO, 'I don’t — I have never once had a beer in a building I didn’t own.'),
D(LOTTIE, 'Then you’re overdue, sweetheart. Sit. Mind the beam. She’s earned her rest and so, God help us, have we.'),
N('And here is the small twist the Sump never advertised. Weeks ago, when the odds against them were posted at forty to one, Dutch walked to a bookmaker and did the only reckless thing a careful man ever does.'),
D(DUTCH, 'I bet on us, Vess. Everything I had left. Forty credits, at forty to one.'),
D(VESS, 'Dutch. Forty at forty to one is — that’s sixteen hundred credits, not forty thousand. That doesn’t save the bar.'),
D(DUTCH, 'No. But it buys a round for everyone in this pit tonight, and it means the one person in Coldwater who believed we’d win — was me. First time in my life I put money on myself. Felt terrible. Felt incredible. Felt like the Sump.'),
D(VESS, 'You reckless, sentimental, structurally-optimistic man. Give me the betting slip. I’m going to frame it next to clause nine.'),
D(VIGO, 'You people bet on YOURSELVES? At forty to one? That’s — that’s financially insane. That’s not a strategy, that’s a feeling with a receipt.'),
D(DUTCH, 'Yeah, Vigo. That’s the Sump. A feeling with a receipt. Sit down. Lottie’s bringing you a beer you didn’t optimize and can’t return.'),
W(2),
N('And so the Sump kept its pit, its beam, its waitress, its pirate, its silent giant, its fainting champion, its heartbroken romantic — and gained a lawyer, a coach, and one deeply confused CEO.'),
D(RUSK, 'Don’t get sentimental. You’re all still terrible. You just won ONCE. That’s not a career. That’s an accident with witnesses.'),
D(DUTCH, 'Coach. Admit it. You believed in us.'),
D(RUSK, 'I believed in the fern more than I believed in you, and the fern never won an Open. So maybe. Wheel me to the bar. And Dutch — good game. Don’t tell anyone I said it. I have a reputation for being in a fern.'),
D(DUTCH, 'Vess. That feeling from the pit. Did we ever file it?'),
D(VESS, 'No. I lost the paperwork on purpose. First time in my life. Let’s leave it unfiled and see what it does.'),
N('Over at the bar, Vigo nurses his first-ever unowned beer with the wary suspicion of a man who has never trusted a thing he didn’t buy.'),
D(VIGO, 'This is — the beer is warm. The stool wobbles. The beam is making a sound I would have condemned this building for.'),
D(LOTTIE, 'That’s the Sump, sweetheart. Nothing works and nobody leaves.'),
D(VIGO, 'It’s horrible. I — I don’t hate it. That’s the horrible part. Why don’t I hate it?'),
D(RUSK, 'Because for the first time in your life nobody in this room wants anything from you, Vigo. No tier. No fee. Turns out that’s the one thing you couldn’t optimize: being left alone with a warm beer and no leverage. Enjoy it. It’s free. It’s the only thing here that is.'),
D(VIGO, 'I could buy this feeling.'),
D(DUTCH, 'You could. But you’d own it, and then it’d be work, and then it wouldn’t be this. Just drink the beer, Vigo. Mind the beam.'),
N('She takes his hand. Giles bursts into tears of joy at a love that is not his, which is, for Giles, the purest kind.'),
D(GILES, 'THIS is why you come back to the Sump. You come back for the day the pit finally throws something good at somebody.'),
D(NARR, 'The Sump never became famous. It never got optimized. The beam never got fixed — they named it, instead, and bought it a drink on anniversaries.'),
D(NARR, 'But every year, on the night of the Open, a wrecked old coach and a bar full of terrible, stubborn people crowd around a neon pit — and remember the year the last ones standing were the ones the whole city told to sit down.'),
D(NARR, 'That’s Slagball. You throw. You get hit. You catch what you can. And if you’re very lucky, and very stubborn, you get to come back.'),
M('before_the_light', 'The anthem resolves, cheap and glorious, into the sound of a bar that is not going anywhere.'),
W(3),

];

// ── The credits ──────────────────────────────────────────────────────────────
const credits = {
  type: 'credits',
  text: [
    'SLAGBALL',
    'A Coldwater Underdog Story',
    'A Sub-Channel 2½ Presentation',
    '',
    '— CAST —',
    'DUTCH ................ never won a thing until it counted',
    'VESS ................. read clause nine',
    'COACH RUSK ........... got out of the fern',
    'MAXIM VIGO ........... pre-lost',
    'PIP .................. won a tournament asleep',
    'BARNACLE BASH ........ found the water within',
    'MERV ................. "Yeah."',
    'LOTTIE .............. minded the beam',
    'GILES ............... the universe is a slag; he is the pit',
    'THE BEAM ............ as itself',
    '',
    'No slags were caught in the making of this picture.',
    'Several were thrown. That part is real.',
    '',
    'Filmed in a pit that is technically a fire hazard with a liquor license.',
    'Any resemblance to a gym you were pressured to join is entirely deserved.',
    '',
    'Sub-Channel 2½ — the only channel that could afford us.',
  ].join('\n'),
  duration: 45,
};

// nodeHoldMs — replicate the broadcast runner’s timing to report runtime.
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

// ── Assemble ─────────────────────────────────────────────────────────────────
const TARGET = 480;
const head = [{ type: 'start' }, { type: 'title_card', graphic_id: 'slagball_title' }];
const body = script.slice();

let pad = TARGET - (head.length + body.length + 1);
if (pad < 0) {
  console.error(`✗ Script is ${-pad} beats too long for ${TARGET} nodes. Trim the screenplay.`);
  process.exit(1);
}
const padNodes = Array.from({ length: pad }, () => W(1));
const ordered = [...head, ...body, ...padNodes, credits];
if (ordered.length !== TARGET) {
  console.error(`✗ Assembled ${ordered.length} nodes, expected ${TARGET}.`);
  process.exit(1);
}

const nodes = {};
ordered.forEach((node, i) => {
  const id = `mv_${i}`;
  const next = i < ordered.length - 1 ? `mv_${i + 1}` : undefined;
  node._vine = { x: 80 + (i % 12) * 220, y: 80 + Math.floor(i / 12) * 160 };
  if (next) node.next = next;
  nodes[id] = node;
});

const totalSec = Math.round(ordered.reduce((s, n) => s + holdMs(n), 0) / 1000);

// ── Broadcast wrapper (mirrors bc_last_call.json) ────────────────────────────
const broadcast = {
  broadcast_graph: { _start: 'mv_0', nodes },
  category: 'movie',
  channel_id: null,
  created_by: 'author',
  description: 'SLAGBALL — a Sub-Channel 2½ Saturday comedy. The Sump, a beloved dive with a pit in the back and forty thousand credits of debt, enters the Coldwater Slagball Open against MAXIM VIGO’s corporate juggernaut APEX PRIME. A washed-up coach, a pirate, a fainting boy, a silent giant, a lethal waitress, a doomed romantic, and a lawyer who forgot which side she was on — one bracket, one sudden-dark overtime, one clause nobody read. A true underdog story, thrown in the dark.',
  enabled: 1,
  fallback_messages: [],
  id: 'bc_slagball',
  loop: 1,
  message_interval: 7,
  messages: [],
  name: 'Slagball',
  news_pools: null,
  override_duration: totalSec + 30,
  playback_mode: 'scripted',
  sports_pools: null,
  tags: ['movie', 'scripted', 'feature', 'comedy'],
  talkshow_pools: null,
  updated_at: STAMP,
  weather_pools: null,
};

// ── Title graphic (mirrors lastcall_title.json shape) ────────────────────────
const titleSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" font-family="\'Courier New\',monospace">',
  '  <defs>',
  '    <radialGradient id="v" cx="50%" cy="44%" r="75%">',
  '      <stop offset="0%" stop-color="#1a1224"/>',
  '      <stop offset="100%" stop-color="#07040a"/>',
  '    </radialGradient>',
  '  </defs>',
  '  <rect width="640" height="360" fill="url(#v)"/>',
  // neon pit centre-line + a thrown slag streaking across
  '  <line x1="320" y1="20" x2="320" y2="340" stroke="#2a3340" stroke-width="2" stroke-dasharray="6 6"/>',
  '  <g stroke="#ff5a3c" stroke-width="3" opacity="0.9">',
  '    <line x1="120" y1="250" x2="300" y2="150"/>',
  '  </g>',
  '  <circle cx="300" cy="150" r="12" fill="#ff5a3c"/>',
  '  <circle cx="300" cy="150" r="20" fill="none" stroke="#ff5a3c" stroke-width="1" opacity="0.5"/>',
  '  <text x="320" y="118" text-anchor="middle" fill="#5ad1ff" font-size="16" letter-spacing="6">SUB-CHANNEL 2½ PRESENTS</text>',
  '  <text x="320" y="196" text-anchor="middle" fill="#ffd23f" font-size="66" letter-spacing="10" font-weight="bold">SLAGBALL</text>',
  '  <text x="320" y="250" text-anchor="middle" fill="#f2efe6" font-size="15" letter-spacing="4">A COLDWATER UNDERDOG STORY</text>',
  '  <text x="320" y="300" text-anchor="middle" fill="#59636f" font-size="12" letter-spacing="3">you throw · you get hit · you come back</text>',
  '</svg>',
].join('\n');

const graphic = {
  content: titleSvg,
  created_at: STAMP,
  description: 'Title card for the SLAGBALL feature.',
  id: 'slagball_title',
  name: 'slagball_title',
  tags: ['movie'],
  type: 'svg',
  updated_at: STAMP,
};

// ── Write ────────────────────────────────────────────────────────────────────
writeFileSync(join(ROOT, 'content/media_broadcasts/bc_slagball.json'), JSON.stringify(broadcast, null, 2) + '\n');
writeFileSync(join(ROOT, 'content/media_graphics/slagball_title.json'), JSON.stringify(graphic, null, 2) + '\n');

// ── Report ───────────────────────────────────────────────────────────────────
const counts = {};
for (const n of Object.values(nodes)) counts[n.type] = (counts[n.type] || 0) + 1;
console.log(`✓ SLAGBALL built.`);
console.log(`  nodes: ${Object.keys(nodes).length}  (target ${TARGET})`);
console.log(`  types: ${JSON.stringify(counts)}`);
console.log(`  padding fades added: ${pad}`);
console.log(`  runtime: ~${Math.floor(totalSec / 60)}m ${totalSec % 60}s   (override_duration=${broadcast.override_duration}s)`);
console.log(`  wrote content/media_broadcasts/bc_slagball.json`);
console.log(`  wrote content/media_graphics/slagball_title.json`);
