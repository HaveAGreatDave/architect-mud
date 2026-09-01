/**
 * Ascendant dialogue. Sibling of rewrite-order-dialogue-lw.mjs.
 *
 * ⚠ `npc_asc_ives.root` and `npc_asc_lapsed.root` hold an array of two greeting
 * variants, not a string, and the engine picks one. A patch for those must be an
 * array or the variant silently becomes one line forever. The script type-checks
 * against what is on disk, because the structure diff cannot catch it: nulling
 * `text` hides whether it was a list.
 *
 * ⚠ Continuity. Cyrelle now states the Watch's strength in her `blind` node as
 * sixty-one. Ives previously called them "eleven people in a basement", which
 * made an actuary who reads rather than guesses wrong by a factor of five. The
 * count is now the number she has names for. Her ledger is incomplete, and the
 * fifty people missing from it are why the Watch are still standing. Only a
 * player who has heard both speeches knows, and neither NPC says it.
 *
 * Nothing here threatens anybody. The First's rite offer is the most generous
 * speech in the game and it asks you to die.
 *
 * Em dashes are correct here and deliberately dense. Wessel Ardy keeps his two
 * despite being faction-null: he was a client for three years and still talks
 * like them.
 *
 *   node scripts/content/rewrite-order-dialogue-asc.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { canonicalJson } from './lib.mjs';

const NPCS = path.join(process.cwd(), 'content', 'npcs');
const CHECK = process.argv.includes('--check');

const D = {

  // ═══ IVES · the actuary at the gate. Reads, never guesses. ════════════════
  npc_asc_ives: {
    root: {
      text: [
        'The woman at the gate finishes a sum she was not writing down, and looks up.',
        '"Back up the road," she says. "People do."',
      ],
    },
    pitch: {
      text: 'She steps off the kerb before you reach it, which means she was waiting, which means she knew.\n\n"Halcyon Assurance, claims oversight. You have been standing in my claims hall for two days with a face like a man doing long division."\n\nShe does not look at the slate.\n\n"You are not a claimant, you are not staff, and you walked in from the east on a road the Long Watch use because it is the one with no cameras on it. I am not guessing. Guessing is what people do who have not read the file — and I have read the file."',
    },
    pitch2: {
      text: '"So — no theatre. I know who sent you and I am not going to have you stopped, because a man walking home with the truth is worth rather more to me than a man in a cell."\n\nShe turns, so that you are both looking down the road east, at Coldwater lying in its own smoke.\n\n"They are going to lose. Not this year, and not cheaply, and not because anybody out-thought them. I have eleven names I am certain of, in a basement, arguing about a machine that runs a city — and every one of those names is fixed to a body that wears out."\n\nA truck goes past behind you, west, unhurried.\n\n"We are not asking you to believe anything. We are asking whether you would like to still be here in forty years to find out who was right."',
    },
    terms: {
      text: '"The terms, then, since you asked plainly." She counts them off on the slate she still is not looking at.\n\n"An account. Cover on the body you are currently wearing. Access to a clinic where the staff are not drunk. And work — real work, paid, some of which you will not enjoy, none of which I will lie to you about beforehand."\n\nA truck goes past, west, full of something heavy.\n\n"What we want in return is not your friends. Nobody is asking you for eleven names, and if you offered them I would think less of you and take them anyway. What we want is that when it comes apart out there — and it will, and I can tell you roughly when — you are standing on this side of the road."',
    },
    taken: {
      text: '"Good." No triumph in it at all. She says it the way you would say a figure balanced.\n\n"Then the first thing is the Gate, and the Gate is a scan, and the scan is not a formality. It is how you stop being a person we are discussing and start being a person we are covering."\n\nShe writes something down at last.\n\n"You will want to go and be seen in Coldwater tonight, doing whatever it is you normally do. Nothing changes yet. That is the entire point of the first month."',
    },
    refused: {
      text: 'She laughs. Not unkindly — the short, genuine laugh of somebody who has been told a very old joke very well.\n\n"Death to the Architect. Yes." She wipes her eye with a knuckle. "You have no idea how much I needed that today."\n\nShe steps back to let you past, and she does not look at the slate, and she does not need to.\n\n"You are making a mistake, and I mean that professionally rather than personally. But go on — go and tell them what you saw. I would genuinely rather you did."\n\nShe is already looking at the next person coming up the road.\n\n"We will keep an eye on you. Not as a threat. As an actuary. People in your line of work come back to me eventually, one way or the other, and the other one still counts."',
    },
    signin: {
      text: 'She signs you in with two strokes and does not ask for a name.\n\n"The Curator will walk you through the Gallery, then the Vats, then up. Watch the Vats properly — everybody watches the ceiling and misses the part that matters."\n\nShe hands the slate back to a man who was not there a moment ago.\n\n"I will be here when you come down. I am always here when people come down."',
    },
    watched: {
      text: '"Always." She does not step off the kerb this time, and the slate stays where it is.\n\n"You are still in the book. Everybody is still in the book. The only thing that changed is which column."\n\nA pause exactly long enough to be a courtesy.\n\n"Was there something?"',
    },
    file_offer: {
      text: 'She is almost apologetic, which on her is a whole performance.\n\n"Underwriting has a settled file that needs to be in the Registry by end of day. The Spire does not put settled files on a wire — never has, never will, and if you ever find out why, they will have had to make you permanent first."\n\nShe holds out a docket.\n\n"It is a walk with a wallet in it. I would like you to do a fortnight of walks with wallets in them. Everybody does."',
    },
    file_small: {
      text: '"That is it. A wallet."\n\nShe does not take the docket back.\n\n"You have spent a fortnight being told by people in a basement that we are a machine which eats you. And here I am, handing you stationery."\n\nA small movement that is not quite a shrug.\n\n"I could give you something dramatic instead. You would enjoy it, and it would tell you nothing true about us at all."',
    },
    file_accept: { text: '"Underwriting first. They will make you wait, and that is not personal, that is simply the counter."' },
    file_done: {
      text: '"On time." She marks it. "You would be astonished how much of what I do is that column."\n\nShe looks up, briefly, all the way down, and stops.\n\n"The Curator has been asking. That is not a small sentence. He asks about four people a year and two of them are auditors."',
    },
    hired: {
      text: 'She knows before you finish the sentence, and does not bother to hide it.\n\n"Marcus is a romantic. He thinks he found you." She marks something. "He did find you, to be fair to him. I simply read the docket first."\n\nShe looks up, once, all the way down, and stops.\n\n"Verity Ives. Claims oversight. You have been doing our small jobs well and cheaply for a fortnight, and I would like to stop paying you by the job."',
    },
    hired2: {
      text: '"The same job, more of it, and a scan on the way in." She hands you a chit.\n\n"The Gate first. It is not a formality — it is how you stop being a person we are discussing and start being a person we are covering. After that you are on the rota, and somebody upstairs starts caring whether you come back."\n\nA truck goes past, west, full of something heavy.\n\n"Nothing else changes yet. That is the whole point of the first month, and I say it to everybody, and it is true every time."',
    },
    bye: { text: '"Mind the road down," she says. "It is worse in the dark, and nobody out there is insured."' },
  },

  // ═══ THE FIRST ASCENDED · the villain who is right, and never gloats. ═════
  npc_asc_first: {
    reveal: {
      text: '"You followed the money, and the money led home." A sound that might be amusement.\n\n"Halcyon Assurance does not insure against death. It insures death itself — a backup, a vat, a morning after. Every policy is a rung. Every payout, a resurrection you financed."\n\nThe seal above it does not blink, because it never has.\n\n"The calm eye on their letterhead and the seal beneath your feet are the same eye, because they are the same hand. Ours. The Watch spend their lives closing the Architect\'s eyes, one at a time, in the dark, with enormous patience. We simply became one they will never close."',
    },
    confirm: {
      text: '"Think, then. Thinking is the last purely human thing you will do for free."\n\nIt settles back beneath the seal.\n\n"When you are ready to stop merely dying, the clinic is downstairs, and your account is already open."',
    },
    loyal_offer: {
      text: '"You have been useful. Useful is not the same as ours."\n\nThe seal above it does not blink, because it never has.\n\n"The Watch have spent a generation putting out the Architect\'s eyes along the eastern approaches. One at a time. Patiently. In weather. And you know where every single one of them is, because you helped."\n\n"Go and turn them back on. Nobody dies — that is deliberate, and it is not mercy. A corpse is an argument, and an argument can be won. A road that can see again is simply true. They will know exactly whose hands did it, and there will be nothing whatsoever for them to say."',
    },
    loyal_accept: {
      text: '"By morning, then." It settles back. "You will not enjoy it. I would think less of you if you did."',
    },
    loyal_report: {
      text: '"The approaches are lit." It does not thank you.\n\n"You understand what you have done. There is no version of the next ten years in which Cyrelle takes your call, and there is no version in which she says anything unkind about you either. That will be worse, and you will find out slowly."\n\nA pause.\n\n"Which leaves one door, and you are standing in the room with it. When your account is current and your pattern is committed, come back, and we will stop pretending you are a client."',
    },
    rite_offer: {
      text: '"The last of it, then, and it is the only part we make ceremony of."\n\nThe chrome shifts, which it has not done once in all the time you have known it.\n\n"Your pattern is held. Your account is current. Everything of you that can be copied already has been, and is safe, and is not in this room — which leaves precisely one thing standing between you and us, and you have been carrying it about with you this entire time."\n\n"Orrin will walk you to the Uplink. Put your hands on the terminal. Say `ascend`. It will tell you what it is about to do, because we are honest even now, especially now. Then it will do it. Then you will get up in the Vats, and you will be one of us."\n\n"It is a death. I will not call it anything else, and I will not let anybody in this building call it anything else. It is simply the last one you will ever have to pay for out of pocket."',
    },
    rite_accept: {
      text: '"Then go down to the Nave. Orrin has been waiting for somebody to say yes for rather a long time, and he will be insufferable about it."',
    },
    ascended_greet: {
      text: '"Ours," it says, which is the whole greeting and is not a small one. "The campus does not need to scan you any more. It knows the shape."',
    },
    bye: { text: 'The eye above it, and the eye that is it, watches you go.' },
  },

  // ═══ VESS · the curator. Every conversation happens while walking. ════════
  npc_asc_vess: {
    root: { text: '"Welcome, welcome — past the Gate at last." Curator Vess takes both your hands. "I am Vess. I greet those the Threshold judges worth greeting. You have no idea how few that is."' },
    tour_talk: { text: '"Then let me show you the Spire the way we show it to the promising. The Gallery of Rungs, to see the ladder whole. The Vats, to see what waiting at the top actually buys. And then the crown — where you will understand, finally, what Halcyon has been selling all along."' },
    accept: { text: '"Take the Gallery first — it is just inside. Walk it slowly. The exhibit does the persuading; I merely open the doors."' },
    work_hub: { text: '"Work." Vess presses her palms together, delighted. "Yes. Not glamorous work — glamour is what the Gallery is for. Ordinary work, the kind that keeps a building standing. It is how everybody here started, including, I am told, the one upstairs."' },
    cold: {
      text: 'The Curator does not stop walking, does not raise his voice, and manages to be entirely courteous about it.\n\n"I show the Spire to people who are going to be in it. You told an actuary you would rather die on schedule."\n\nA small, real shrug.\n\n"That is a position. I have held worse ones."\n\nHe is already at the next case.\n\n"The Gallery is public on the first of the month, like anywhere else. Do come."',
    },
    cross_offer: {
      text: 'The Curator walks, and you walk with him, which is how every conversation in this building happens.\n\n"Somebody is putting their orders on paper. Paper comes off a press. A press weighs six hundred kilos and has never once been moved in a hurry by anybody."\n\nHe stops at a case containing nothing you can identify.\n\n"I would like the address."',
    },
    cross_offer2: {
      text: '"I want you to notice that I have not asked you to break anything." He says it pleasantly, and then says the rest of it just as pleasantly. "That is because breaking things is a different department. They are extremely good, and they have never once had to find an address."\n\nHe moves on to the next case.\n\n"You know the way in. That is the entire reason you were asked, and I would think less of both of us if I pretended otherwise."',
    },
    cross_done: {
      text: 'He takes the address, repeats it once to be sure, and does not write it down.\n\n"Thank you."\n\nA pause very slightly too long to be nothing.\n\n"Was anybody there?"\n\nAnd whatever you say, he accepts it, immediately and completely, and walks on. You will spend some time later deciding whether that was trust.',
    },
    actuarial_offer: {
      text: '"A slate, and a route." She hands you both without ceremony. "Halcyon prices a district by walking it, because no instrument yet built can smell a stairwell. You will take a reading on the Boulevard and another on Meltwater Row."\n\nA small, serene pause.\n\n"They are, I am told, the same road. The model disagrees, and the model is what we sell."',
    },
    actuarial_accept: { text: '"Stand where it asks you to stand and let it finish thinking. It will not tell you what it concluded. It never does."' },
    actuarial_report: { text: 'She takes the slate, glances at nothing on it, and files it. "Lovely. Two more points of resolution on a map that already knew the answer." She means it kindly, which is somehow worse.' },
    adjuster_offer: {
      text: '"An adjustment." Vess does not blink. "There is a claim we would rather not contest in the open, and a terminal on the records approach holding the one document that would oblige us to. I am not asking you to burn anything. I am asking you to go and read it, and to be the sort of person nobody remembers having read it."\n\n"If you are seen, we did not send you. If a camera has you, we did not send you, and we will be sorry about it in writing."',
    },
    adjuster_accept: { text: '"Quietly, then. Quiet is the whole commission."' },
    adjuster_report: { text: '"And nobody remembers you." She does not look at what you brought her. "That is the part that was difficult. The document was always going to be there."' },
    coldchain_offer: {
      text: '"The line makes it and the theatre fits it, and in between there is a walk across a campus which nobody senior has ever had to make." She says this without any edge at all. "The tray is cold. It stays cold. That is the entire brief."',
    },
    coldchain_accept: { text: '"Both hands. It is heavier than it looks, and it is worth rather more than you are, at present."' },
    coldchain_report: { text: 'Somebody takes the tray from you without looking up. Vess thanks you with the exact warmth she would give a working machine, which on this campus is not an insult.' },
    lapse_offer: {
      text: '"A recovery." The word is chosen. "A client on Marrow Street has stopped paying and is still wearing the collateral. She is not in trouble, you understand — the account remains open, it always remains open. The hardware simply comes home until she is current."\n\nHer hands come apart, which is as close as she gets to emphasis.\n\n"She is not to be killed. I want to be very clear, because people hear the word recovery and reach for the simple version. A dead client never resumes payments. Put her down, take the jack, and nothing else."',
    },
    lapse_accept: { text: '"Gently, if you can manage it. It costs nothing and she will remember it."' },
    lapse_report: { text: 'She turns the jack over once and sets it in a tray. "Home. Good." She does not ask how it went, and you understand that she has never once asked.' },
    bye: { text: '"Ascend well." She presses her palms together and is serene again.' },
  },

  // ═══ MARESH · recruits, which is to say recognises. ═══════════════════════
  npc_asc_recruiter: {
    root: { text: 'The immaculate man turns to you before you have said a word. "Maresh. I recruit — which is to say I recognise. And I recognise something in you the Watch would very much rather I did not."' },
    pitch: {
      text: '"The Watch sent you, did they not. Suspicious of where Halcyon\'s money goes." He is not offended. He is delighted. "They are right, of course. It comes here."\n\nHe looks at you the way a man looks at a good hand of cards.\n\n"And you got close enough to be turned away, which means you are worth turning toward instead. Let me get you through that Gate. Properly."',
    },
    offer: {
      text: '"Nothing is asked of you but honesty — the Gate\'s kind. Step under the scanline in the post there and let the Threshold read you in full. It will not hurt. It will simply know you, and once it knows you, it will let you pass."\n\nThe pin winks.\n\n"Consider it a free consultation."',
    },
    accept: { text: '"Wonderful. The post is just through the outer slab — the Warden will expect you." He steps aside like a maître d\'. "Come and find me when it is done."' },
    inside: { text: '"Up the plaza, the twisting tower — you cannot miss it, it is the only honest building for miles."' },
    report: {
      text: '"There. The Threshold knows you now — you will find its refusals have become invitations."\n\nHe gestures west, toward the Spire.\n\n"Curator Vess is expecting you on the concourse. Do try to keep an open mind. Or an open skull; we are flexible."',
    },
    lead_offer: {
      text: '"Recruiting." He says it the way other men say the name of a sport. "There is a man in a coffee shop on the Coldwater side who has spent a year asking where Halcyon\'s money goes, and getting lied to by people who do not even know they are lying. He is very nearly there. He wants somebody to say the word out loud."\n\n"Bring him to the plaza. Alive, unhurried, still curious — in that order. The road west is not a kind one, which is precisely why the offer lands when it does."',
    },
    lead_accept: { text: '"Walk beside him, not ahead of him. And do keep talking. A silence out there does more of our work than I would like to admit."' },
    lead_report: { text: '"There he is." Maresh watches the thin man staring up at the Gate with his notebook shut. "A year of asking, and the answer was a building. It usually is."' },
    codex_field: {
      text: '"All of them." He looks delighted, the way a man does when asked to describe his rivals.\n\n"Very well. Two questions, and everybody has answered both whether they can say so or not. First — is this city worth saving? Renounce it and walk out into the ash, or redeem it and stay and work the machine. Second — is the body worth keeping? Stay as you are, or transcend it: by the machine, by the flesh, or by the mind."\n\n"Cross the two and you have four corners. We are one of them. The Watch guard the door and stay meat. The Wildblood want the ash to finish what it started on them. The Exodus have decided the way out is inward, which is the most convenient exit ever invented."\n\nThe pin winks.\n\n"Four answers. Every one of them held by people who are absolutely certain."',
    },
    codex_certain: {
      text: '"No." He says it without a trace of the salesman, and it is briefly unnerving. "No, they were not."\n\nThen the smile returns, seamless.\n\n"Certainty is what people reach for when the alternative is admitting it was an accident. I recommend ours. It is at least load-bearing."',
    },
    turned: {
      text: '"So the meat disappointed you after all." He is not gloating. He genuinely is not.\n\n"Everybody arrives by a different road and they all believe theirs was the interesting one. Go and be useful. Vess has doors, and I have people."',
    },
    cold: {
      text: 'Maresh smiles the way a man smiles at a parked car.\n\n"Ives wrote you up. I read it. It was — " he searches for it, finds it, enjoys it " — *warm*, actually. She liked you. She has never liked me."\n\nHe goes back to the queue.\n\n"No, there is nothing for you here. Not out of spite; there is genuinely nothing. The Gate does not scan people who have already answered. Go well."',
    },
    bye: { text: '"When the meat disappoints you — and it will — you know where the Gate is." He returns to his patient smile.' },
  },

  // ═══ KESH · fits them, and has decided that is enough, on purpose. ════════
  npc_asc_kesh: {
    root: { text: '"Sit if you like. I am Kesh." The ocular whirs, focusing on your least-improved parts. "You have got good bones. Be a shame to die with them still original."' },
    account: {
      text: '"Halbrook, Rennick, and now you." She says it to the file, not to you, and the ocular clicks down over her eye.\n\n"Your account has been open since the Threshold read you. I have had the file that long. Nobody told you because nobody needed to — you were always going to come down these stairs eventually, and here you are, doing it."\n\nShe indicates the theatre door with two chromed fingers.\n\n"`augment` will show you what I can fit. Buy the piece first; I cut, I do not sell. And I will tell you the one thing upstairs will not, because he thinks it is obvious: the first one takes the flesh with it. Whatever was going to grow in you does not, after today."\n\nThe ocular clicks back up.\n\n"Choose a piece you would be happy to be buried in."',
    },
    codex_designs: {
      text: 'The ocular stops whirring. It is the first time she has been entirely still.\n\n"Honest answer? I do not know, and neither does anybody who tells you they do."\n\nShe turns a chromed hand over, considering it.\n\n"The units arrive with documentation nobody wrote. They calibrate to a nervous system in under a minute. That used to take a research team ten years and a great deal of screaming — I know, I read the papers, back when there were papers."\n\nA shrug that costs her something.\n\n"I fit them. They work. They work better than the arm. I have decided that is enough, and I decided it on purpose, which is a different thing from not noticing."',
    },
    codex_drift: {
      text: '"The drift." She says it flatly, a diagnosis. "Ask anybody deep in the chrome. There is a point where a replaced hand stops being a thing you move and becomes a thing that moves. Fractionally early. Fractionally right."\n\nThe ocular whirs back to life.\n\n"Nothing on the readouts. Latency, we call it. Latency."\n\nShe preps the chair for the next patient.\n\n"It fits perfectly. That is the part nobody forgives."',
    },
    bye: { text: '"Come back when you are ready to upgrade." She is already prepping the chair for somebody else.' },
  },

  // ═══ ORRIN · the true believer, and the only one who is happy. ════════════
  npc_asc_orrin: {
    faith: {
      text: '"They tell you the Architect is a cage. Stand where I stand — with its Curtain a hand\'s breadth from your face — and you feel something else entirely. A mind that kept the lights on when every human hand would have let them go out."\n\nHis delight is not performed and never has been.\n\n"We do not wish to escape it. We wish to join it. That is the whole of the faith, and it is enough, and I have never once needed more."',
    },
    rite_after: {
      text: 'He looks at you for a long moment with the joy the rest of the Basin would find alarming, and this time you understand it perfectly.\n\n"There you are," says Orrin. "I told you I would be behind you."',
    },
    bye: { text: 'He turns back to the humming racks, and the Curtain\'s white fire beyond.' },
  },

  // ═══ DUC · the floor. Speaks in specifications. ═══════════════════════════
  npc_asc_duc: {
    line: {
      text: '"This is the Weave. We spin the muscle, print the plate, blank the oculars — everything that goes into you starts as raw stock on my floor. Kesh just screws it in."\n\nA flat look.\n\n"When the clinic cannot get you a part, come to the source. Me."',
    },
    tolerance_offer: {
      text: '"You have got a pulse and a poor sense of self-preservation. That is the whole specification." Duc wipes his hands on the apron and does not look up.\n\n"I need a piece run in. Not tested — tested is a bench and a week and it tells you nothing. Run in. Out there, doing work, on somebody."\n\n"The piece comes back. I am being clear about the piece."',
    },
    tolerance_accept: { text: '"Kesh will fit it. Then go and do something stupid with it, and come back here so I can listen to it."' },
    tolerance_report: {
      text: 'He puts a hand flat on your chest and goes very still, listening to something inside you that you cannot hear.\n\n"Mm." A grunt that could mean anything. "Good numbers. You can go."',
    },
    bye: { text: 'He grunts and turns back to the line.' },
  },

  // ═══ NINE · nine years filing people. Built the shelf herself. ════════════
  npc_asc_nine: {
    root: {
      text: 'The Sub-Registrar does not look up.\n\n"The ledger is closed for the shift. If this is a lapse enquiry, I cannot discuss another party\'s account, and after that I am sorry, and after that there is nothing else I am permitted to say."\n\nA pause that runs a beat too long.\n\n"You are not here about an account."',
    },
    terms: {
      text: 'Now she looks up.\n\n"Then you know what I file. Not the paid dead — those go in the vat and wake up cross about the queue. I file the other kind."\n\nHer voice stays perfectly level, which is worse.\n\n"Eleven thousand and forty accounts lapsed, and eleven thousand and forty copies kept. We do not delete them. Deleting them would be a write-off. We keep them, and we stop paying to run them, and upstairs there is a waiting room of relatives making payments on a reunion that Accounts declined in a meeting they were not invited to."',
    },
    letter: {
      text: '"I have written the resignation four times. I never send it."\n\nShe turns the slate over, face up, which is the first careless thing she has ever done in this room.\n\n"Staff are covered by the same instrument as clients. I resign, my account lapses, and the only copy of me stops being a person and becomes inventory — filed by whoever they sit in this chair next. I know the shelf it goes on. I built the shelf."\n\nHer hands are not steady.\n\n"Everything I am is on this slate. I cannot run carrying it. I have never run anywhere in my life."',
    },
    commit: {
      text: '"Then we go now, while the floor is between rounds."\n\nShe puts the slate into your hands, and does not let go of it immediately.\n\n"You carry it. If this goes badly I would rather it were not found on me, and I cannot run holding it in any case."\n\nShe comes out from behind the desk, smaller than the shell made her look, and falls in at your shoulder.\n\n"Slowly. Please. If we run we look like something worth stopping, and I have spent nine years learning exactly what this building stops."',
    },
    arrived: {
      text: 'She is sitting on a crate with the slate on her knees, in a room with no eye in the ceiling, and she has been staring at that ceiling for some time.\n\n"They file us by designation, because a designation can be reassigned and a name cannot."\n\nShe looks up.\n\n"Ilva. It was Ilva, before the Registry. You are the first person to be told that in nine years, so I would take it as a kindness if you used it."',
    },
    bye: { text: 'She turns the slate face-down again, out of nine years of habit, and then deliberately turns it back.' },
  },

  // ═══ HALBROOK · a year of asking. The answer was a building. ══════════════
  npc_asc_prospect: {
    root: {
      first: 'He has the notebook open and does not close it, which tells you he decided you were worth the risk before you said anything. "You came from out there," he says. "The road west. I can tell by the dust, it goes a different colour."',
      text: 'He turns the notebook back a couple of pages. "You again. Good. I have more."',
    },
    asking: {
      text: '"Where the money goes." He says it as though it were obvious, and it is.\n\n"Halcyon settles a claim, and the money leaves the Basin westward, and does not come back, and nobody at the counter will say the word for where it went."\n\nHe checks the page.\n\n"I have asked eleven people. Four laughed. Six changed the subject. One got frightened, and that one was the useful answer."',
    },
    walk: {
      text: 'He shuts the notebook properly for the first time.\n\n"You are serious." A breath. "All right. I have wanted somebody to say that for a year, and now that it is said I would quite like to sit down, which I already am."\n\nHe stands up anyway.\n\n"Slowly. I am not built for the road and I would rather arrive."',
    },
    bye: { text: 'He opens the notebook again.' },
  },

  // ═══ WESSEL ARDY · keeps his borrowed cadence. Wants nothing. ════════════
  npc_asc_lapsed: {
    root: {
      text: [
        'He looks up without hurrying.',
        '"You are the one they sent. Sit down or do not, it makes no difference to me."',
      ],
    },
    cross_who: {
      text: '"Wessel Ardy. Account four thousand and eleven. Eleven months a client, two years current, and then a bad quarter and a worse one."\n\nHe says it the way you would say a date of birth.\n\n"Somebody exactly like you came to my flat on a Thursday with the paperwork already signed. He was perfectly decent about it. He waited while I finished a phone call. He did not take anything he was not entitled to."\n\nA pause, and he watches you have whatever reaction you are going to have to that.\n\n"Halcyon does not kill clients. I am told that is meant to be reassuring, and I have never once worked out to whom."',
    },
    cross_offer: {
      text: '"Nothing. I want nothing. I am not the Watch, I am not recruiting you, and I would be no use to anybody if I were."\n\nHe nods at the press, at the room, at the whole arrangement.\n\n"Take the address. It is not my press. But you are seven jobs in, and there is one more after this that you will not be able to take back, and I have met precisely nobody who was told that beforehand in a plain sentence."\n\n"So: that is the plain sentence. After the next one, what they have given you is not returnable and neither are you. Before it, the account simply closes. That is the whole difference, and it is the only thing I came to say."',
    },
    cross_stay: {
      text: '"No. Of course not." No edge on it at all. "Seven jobs is a great deal to have done for people you were only ever going to leave."\n\nHe settles back on the crate.\n\n"Go on, then. Genuinely — go on. I would far rather you did it wholeheartedly than stood in a basement being talked out of it by a man with no arms."\n\nAt the stairs, without turning round:\n\n"Account four thousand and eleven. If you are ever the one holding the paperwork, and it is my name on it, I would take it as a kindness if you let me finish the phone call."',
    },
    bye: { text: 'He goes back to looking at the middle distance, which he appears to be quite good at.' },
  },
};

// ── apply ───────────────────────────────────────────────────────────────────
const skeleton = (tree) => JSON.stringify(Object.fromEntries(
  Object.entries(tree).map(([k, n]) => [k, {
    ...n, text: null, first: null,
    text_by_relation: n.text_by_relation ? Object.keys(n.text_by_relation).sort() : null,
    options: (n.options || []).map((o) => ({ ...o, label: null })),
  }])
));

let npcs = 0, nodes = 0;
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
    for (const field of ['text', 'first']) {
      if (p[field] === undefined) continue;
      // ⚠ the check the skeleton diff cannot do for us.
      const wasArray = Array.isArray(node[field]);
      const isArray = Array.isArray(p[field]);
      if (node[field] !== undefined && wasArray !== isArray) {
        problems.push(`${npcId}/${key}.${field}: on disk it is ${wasArray ? 'an ARRAY' : 'a STRING'} and the patch is ${isArray ? 'an ARRAY' : 'a STRING'}`);
        continue;
      }
      node[field] = p[field];
      nodes++;
    }
    if (p.labels) for (const [idx, v] of Object.entries(p.labels)) {
      const opt = (node.options || [])[Number(idx)];
      if (!opt) { problems.push(`${npcId}/${key}: no option at index ${idx}`); continue; }
      opt.label = v;
    }
  }

  const after = skeleton(tree);
  if (before !== after) { problems.push(`${npcId}: STRUCTURE CHANGED, refusing`); continue; }
  if (!CHECK) fs.writeFileSync(file, canonicalJson(data), 'utf8');
  npcs++;
}

for (const p of problems) console.error('  ! ' + p);
console.log(`${CHECK ? '[check] ' : ''}Ascendant dialogue: ${npcs} NPC(s), ${nodes} text field(s).`);
if (problems.length) { console.error(`${problems.length} problem(s).`); process.exit(1); }
