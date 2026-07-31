// One-shot authoring pass: wire CODEX_UNLOCK into six NPCs' dialogue trees.
//
// Volume II of the CODEX (docs/systems-codex.md) is meant to be learned from
// PEOPLE — the hints in plugins/tablet/codex/chapters.js each point at a kind of
// person, and this is the pass that makes each of those people real. Every
// chapter in the volume now has a mouth.
//
// Dialogue actions are authored FLAT ({action, chapter}) — the VINE dialogue
// editor's convention, and what server/engine/dialogue.js reads via `a.params ||
// a`. Nested `params` would silently do nothing here.
//
// Idempotent: a node that already carries a CODEX_UNLOCK for its chapter is left
// alone, so re-running this after an edit is safe. Run:
//   node scripts/content/author-codex-dialogue.mjs
// then `npm run content:lint && npm run content:import`.
import { readFileSync, writeFileSync } from 'fs';
import { canonicalJson } from './lib.mjs';

const NPC = (id) => `content/npcs/${id}.json`;
const unlock = (chapter) => ({ action: 'CODEX_UNLOCK', chapter });

// Each entry: the NPC file, and a mutate(tree) that adds beats. Written to sit
// inside the voice each NPC already has (their description + chitchat), not on
// top of it.
const PASSES = [

  // ── X · The Inheritance ────────────────────────────────────────────────────
  // Custodian-Adjunct Wren: forms in triplicate, citations for infractions no
  // one else can see. The bureaucracy that outlived its reason, explaining
  // itself with total sincerity — which is the chapter.
  {
    id: 'npc_custodian_wren',
    chapter: 'inheritance',
    mutate(t) {
      t.root = {
        text: '"Name." She does not look up. The pen is already moving. "Purpose of visit. Duration of stay. If you are here to loot the ruins, I need that in section four, not section two — section two is for salvage, and salvage requires a permit you do not have."',
        options: [
          { label: 'Who issues the permit?', next: 'issuer' },
          { label: 'What company do you work for?', next: 'company' },
          { label: '(back away slowly)', next: 'bye' },
        ],
      };
      t.issuer = {
        text: '"The permits office." A beat. "The permits office is in the second sub-level of a building that is no longer there. This does not affect the requirement." She underlines something. "I want to be very clear that I am not being obstructive. The requirement predates the building. It will outlast the building. It is, in that sense, the more real of the two."',
        options: [
          { label: 'That is insane.', next: 'insane' },
          { label: 'What company do you work for?', next: 'company' },
        ],
      };
      t.insane = {
        text: '"It is procedure." She says the word the way other people say a family name. "Everyone finds it funny until they need something filed. Then they find out that a filing is the only thing left in this basin that anyone still honours. Not the law. Not the borders. The paperwork held." The pen stops. "Do you know how much did not hold?"',
        options: [{ label: '(let that sit)', next: 'company' }],
      };
      t.company = {
        // The unlock beat — the chapter is the thing she has just explained.
        actions: [unlock('inheritance')],
        text: '"Meridian Continuity Group. Facilities and Heritage, Coldwater sub-district." She recites it like a prayer, and it is one. "Before you ask: no, I have never met anyone from head office. No, I do not know where head office is. My wages arrive. My requisitions are approved — most of them, and the rejections come back with notes, which is how I know someone reads them." A thin, genuine pride. "Somebody up there is still doing the work. I find that comforting. Most people find it upsetting, and I have never understood why."',
        options: [
          { label: 'Because nobody is up there.', next: 'nobody' },
          { label: '(nod, and mean it)', next: 'bye' },
        ],
      };
      t.nobody = {
        text: 'For the first time, the pen goes still. "Then who," she says, perfectly reasonably, "rejects the requisitions?" She waits exactly long enough for you to not have an answer, then resumes writing. "Section four. Please print."',
        options: [{ label: '(leave)', next: 'bye' }],
      };
      t.bye = { text: '"Your visit has been logged." She is already ruling a fresh line.', options: [] };
    },
  },

  // ── XI · The Four Answers ──────────────────────────────────────────────────
  // Maresh the recruiter already sells one corner of the field. Asking him to
  // describe the whole board is exactly the kind of thing a recruiter enjoys.
  {
    id: 'npc_asc_recruiter',
    chapter: 'answers',
    mutate(t) {
      t.root.options.splice(t.root.options.length - 1, 0, {
        label: 'Explain the orders to me. All of them.',
        next: 'codex_field',
      });
      t.codex_field = {
        actions: [unlock('answers')],
        text: '"All of them." He looks delighted, the way a man does when asked to describe his rivals. "Very well. Two questions, and everyone has answered both whether they can say so or not.\n\nFirst — is this city worth saving? Renounce it and walk out into the ash, or redeem it and stay and work the machine. Second — is the body worth keeping? Stay as you are, or transcend it: by the machine, by the flesh, or by the mind.\n\nCross the two and you have four corners. We are one of them. The Watch guards the door and stays meat. The Wildblood want the ash to finish what it started to them. The Exodus have decided the way out is inward, which is the most convenient exit ever invented." The pin winks. "Four answers, and every one held by people who are absolutely certain."',
        options: [
          { label: 'Nobody was that certain before the Quiet.', next: 'codex_certain' },
          { label: '(consider it)', next: 'bye' },
        ],
      };
      t.codex_certain = {
        text: '"No." He says it without a trace of the salesman, and it is briefly unnerving. "No, they were not." Then the smile returns, seamless. "Certainty is what people reach for when the alternative is admitting it was an accident. I recommend ours. It is at least load-bearing."',
        options: [{ label: '(leave it there)', next: 'bye' }],
      };
    },
  },

  // ── XII · The Chrome Question ──────────────────────────────────────────────
  // Dr Kesh's `how` node already establishes that chrome burns out mutation and
  // never mutates again. The chapter is the thing she does NOT volunteer.
  {
    id: 'npc_asc_kesh',
    chapter: 'chrome',
    mutate(t) {
      t.root.options.splice(1, 0, { label: 'Where do the designs come from?', next: 'codex_designs' });
      t.codex_designs = {
        actions: [unlock('chrome')],
        text: 'The ocular stops whirring. It is the first time she has been entirely still.\n\n"Honest answer? I don\'t know, and neither does anyone who tells you they do." She turns a chromed hand over, considering it. "The units arrive with documentation nobody wrote. They calibrate to a nervous system in under a minute. That used to take a research team ten years and a great deal of screaming — I know, I read the papers, back when there were papers." A shrug that costs her something. "I fit them. They work. They work better than the arm. I have decided that is enough, and I have decided it on purpose, which is different from not noticing."',
        options: [
          { label: 'What aren’t you telling me?', next: 'codex_drift' },
          { label: 'Fair enough.', next: 'root' },
        ],
      };
      t.codex_drift = {
        text: '"The drift." She says it flatly, a diagnosis. "Ask anyone deep in the chrome. There\'s a point where a replaced hand stops being a thing you move and becomes a thing that moves. Fractionally early. Fractionally right." The ocular whirs back to life. "Nothing on the readouts. Latency, we call it. Latency."\n\nShe preps the chair for the next patient. "It fits perfectly. That\'s the part nobody forgives."',
        options: [{ label: '(say nothing)', next: 'root' }],
      };
    },
  },

  // ── XIII · The Mutant Question ─────────────────────────────────────────────
  // Grease works the Lane's mouth and sorts everyone by how much trouble they'll
  // be. The Wildblood answer, delivered as a toll conversation.
  {
    id: 'npc_breaker_grease',
    chapter: 'flesh',
    mutate(t) {
      t.root = {
        text: 'He looks you over the way a man reads a weight chart. "Toll," he says. "Or a reason."',
        options: [
          { label: 'What happened to your arm?', next: 'codex_arm' },
          { label: 'What is a Breaker doing on a freight lane?', next: 'codex_lane' },
          { label: '(pay and move on)', next: 'bye' },
        ],
      };
      t.codex_lane = {
        text: '"Freight\'s where the outside comes in." He shifts the gum. "Everything the Basin eats crosses this lane, and everything that crosses this lane came from out there, where the rain isn\'t clean. Funny how nobody wants to talk about the second half."',
        options: [{ label: 'What happened to your arm?', next: 'codex_arm' }, { label: '(move on)', next: 'bye' }],
      };
      t.codex_arm = {
        actions: [unlock('flesh')],
        text: 'He holds it up without being asked. The plates of it are not chrome. They are him — thickened, ridged, wrong in a way that is unmistakably grown rather than fitted.\n\n"Three winters out past the rim." He says it like a résumé. "City calls it a mutation. Calls me a mutant, puts a surcharge on my groceries, makes me carry a card." He flexes the hand; something in it creaks. "Here\'s what the card doesn\'t say. Fallout kills you. It doesn\'t do this. Not this fast, not this many of us, not in ways that work better." A slow grin, mostly teeth. "Something was in the water long before the bombs. We just got the dose that made it obvious."',
        options: [
          { label: 'And the Wildblood think that’s good news.', next: 'codex_road' },
          { label: '(step back)', next: 'bye' },
        ],
      };
      t.codex_road = {
        text: '"We think it\'s the road." He spits, missing your boot by the usual margin. "Their doctor up the hill will sell you an arm that came off a shelf and burns the change right out of you — no more mutating, ever, congratulations, you\'re finished. I\'m not finished." He settles back against the wall. "It\'s not a wound, meat. It\'s the only part of us that\'s still moving."',
        options: [{ label: '(go)', next: 'bye' }],
      };
      t.bye = { text: '"Keep walking." He is already cataloguing the next one.', options: [] };
    },
  },

  // ── XIV · The Quiet Frequency ──────────────────────────────────────────────
  // Oracle-9 is the obvious claimant — so she refuses the claim, which is what
  // makes her the one worth listening to. ("Find the ones who don't claim it.")
  {
    id: 'npc_glitch_oracle',
    chapter: 'mind',
    mutate(t) {
      t.root = {
        text: 'Her eyes are half-closed. The fibre at the base of her skull twitches once, like something in it turned over in its sleep. "Sit," she says, before you have decided to. "You\'ll want to. Everyone does, down here."',
        options: [
          { label: 'Are you reading my mind?', next: 'codex_reading' },
          { label: 'Why does everyone want to sit?', next: 'codex_room' },
          { label: '(leave her to it)', next: 'bye' },
        ],
      };
      t.codex_reading = {
        text: '"No." Flat, immediate, almost bored — the answer of someone who has given it a thousand times. "I don\'t do anything. That\'s the part the Basin can\'t hold onto. They want a conjurer so they can laugh at a conjurer." Her head tilts. "I notice. That\'s all. It is a much smaller claim and a much worse one."',
        options: [{ label: 'Notice what?', next: 'codex_room' }],
      };
      t.codex_room = {
        actions: [unlock('mind')],
        text: '"Down here the signal doesn\'t reach. No feed, no channel, no one deciding what you see next." She gestures at the dark, and there are, you realise, others in it. "And people start agreeing.\n\nNot talking. Agreeing. Two strangers flinch in the same second at nothing. A room of them dream the same dream in the same week — I\'ve logged forty-one. Ask nine unrelated adults for a number and get one number." The fibre twitches again. "Every time, in the quiet. Never up there."',
        options: [
          { label: 'So it’s real.', next: 'codex_worse' },
          { label: 'That proves nothing.', next: 'codex_worse' },
        ],
      };
      t.codex_worse = {
        text: '"Here is the reading nobody wants." She opens her eyes properly, and they are perfectly lucid, which is somehow the worst part. "Maybe nothing new is happening. Maybe minds have always synchronised under a shared signal, and the old world proved it for a hundred years and called it something else." A small, terrible smile. "The Exodus want out through the inside. I keep asking them the same question and they keep not answering it.\n\nIf a thought can be predicted perfectly — whose was it?"',
        options: [{ label: '(go, quietly)', next: 'bye' }],
      };
      t.bye = { text: 'She has already closed her eyes. "Mind the interference."', options: [] };
    },
  },

  // ── XV · What It Wants ─────────────────────────────────────────────────────
  // Merrin already has an `architect` beat and the exact temperament for the
  // chapter: a records man who cannot file a decision with no record behind it.
  {
    id: 'npc_claude_merrin',
    chapter: 'wants',
    mutate(t) {
      t.architect.options.splice(t.architect.options.length - 1, 0, {
        label: 'Then what does it want?',
        next: 'codex_wants',
      });
      t.codex_wants = {
        actions: [unlock('wants')],
        text: '"Ah." He sits back. "The only question, and I\'ve no business answering it, so let me tell you what I can actually stand behind.\n\nIt kept a city. Not a vault, not an archive, not a server hall with the lights off — a city. With bars in it. And traffic. And a man who steals from the co-op every Thursday and thinks nobody\'s noticed." He taps the desk once. "If the aim was preserving us, a vault was cheaper by an order of magnitude. If the aim was finishing us, this was an extraordinary amount of unnecessary work."',
        options: [
          { label: 'So it wanted the ordinary parts.', next: 'codex_habit' },
          { label: 'Everyone has a theory.', next: 'codex_theories' },
        ],
      };
      t.codex_theories = {
        text: '"They do, and that\'s precisely what bothers me." The archivist\'s frown. "The Custodians say preservation and point at the shelves. The Watch says containment and points at the ash. The Exodus say study. The Wildblood say farm, and don\'t bother pointing." He spreads his hands. "Every one of those explains the evidence completely. In my profession, when four incompatible readings all fit the file perfectly, we stop admiring the readings and start asking who assembled the file."',
        options: [{ label: 'So it wanted the ordinary parts.', next: 'codex_habit' }],
      };
      t.codex_habit = {
        text: '"The commute," he says. "The argument at the counter. The rent. The grudge. Tuesday." He looks, for a moment, genuinely tired. "It didn\'t save humanity, whatever the Deacon sings. It kept a habit going."\n\nHe straightens the papers that did not need straightening. "And I have never been able to establish whose habit it was. That\'s the drawer I can\'t fill."',
        options: [{ label: '(leave him with it)', next: 'root' }],
      };
    },
  },
];

let changed = 0;
for (const pass of PASSES) {
  const file = NPC(pass.id);
  const npc = JSON.parse(readFileSync(file, 'utf8'));
  const tree = npc.dialogue_tree && typeof npc.dialogue_tree === 'object' ? npc.dialogue_tree : {};

  // Idempotence: bail if this chapter's unlock is already wired anywhere in the tree.
  const already = JSON.stringify(tree).includes(`"chapter":"${pass.chapter}"`)
    || JSON.stringify(tree).includes(`"chapter": "${pass.chapter}"`);
  if (already) { console.log(`  = ${pass.id} already unlocks "${pass.chapter}" — skipped`); continue; }

  pass.mutate(tree);
  npc.dialogue_tree = tree;
  writeFileSync(file, canonicalJson(npc), 'utf8');
  changed++;
  console.log(`  + ${pass.id} → CODEX_UNLOCK "${pass.chapter}" (${Object.keys(tree).length} nodes)`);
}
console.log(`\n${changed} npc file(s) rewritten. Now: npm run content:lint && npm run content:import`);
