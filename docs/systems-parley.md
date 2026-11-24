# Parley: talking to NPCs in your own words

Status: phases 1, 2 and 4 built (beats included, the parser, the dialogue panel's box, ORACLE voicing, generic answers for everybody by personality, and own lines for thirteen people: Lowry Cormack, Imogen Cardew and Orion Thale at the Embassy Lounge, Molly Darton, Father Jerome, Grady Okonkwo, Wilf Treharne, Claude Merrin, Tom Budge, Oracle-9, Delia Kell, and Ninian and Odile Sabbatini). Phase 3 is design.

You type what you like to somebody, and they answer what you meant. It works the way Façade (2005) did: no language model, only hand-written patterns that read a line as one of a couple of dozen acts, and hand-written answers chosen by who you are to them. It costs nothing per line and every answer is in the house voice.

## How you use it

- `say hey Lowry, rough night?` names him, so he answers.
- After `talk lowry`, or after one exchange, plain `say` lines go to him for 90 seconds without his name.
- In the dialogue panel (the 2D panel and the Room Stage alike) a **Say something** box sits under the options. A line typed there is sent as `parley <npcId> <text>`, and his answer replaces the speech in the panel. The options stay, so the tree is still there.
- The box has a 🎤 button wherever the browser can recognise speech (Chrome and Edge on desktop and Android, Safari on Mac and iPhone). Tap it and talk: the words fill the box as you speak and the line is sent when you stop. It needs no setting, because it listens only after a tap, and it sends what was heard as is, without the command repairs in `js/dictation.js`. The Voice Input setting's mic by the command box also works for `say` lines.
- Text and log display modes use `say`; the answer is an ordinary say line.

Every answer is voiced by ORACLE: in the panel through `voiceLine` (npc-bubbles.js), and in the room as a `.speech-line`, which npc-bubbles voices for everybody who hears it. The action half of a line (`*sets the glass down.*`) is shown, not spoken.

## How a line is read

`plugins/parley/parse.js`, pure and sync:

1. Normalise: lowercase, contractions spelled out, common typing shortcuts (`u`, `thx`, `sup`) expanded, the NPC's own name removed.
2. Score every act's patterns; the highest weight wins. "not bad" and "not great" are turned the right way round.
3. Match the NPC's topics. A topic in a question, or in a line with nothing clearer in it, makes the act `ask_about`.
4. Nothing matched: `gibberish` (too few vowels, or a key held down) or `unknown`.

Acts: `ask_name`, `ask_job`, `ask_origin`, `ask_news`, `ask_advice`, `greet`, `farewell`, `thank`, `praise`, `insult`, `flirt`, `apologise`, `joke`, `complain`, `ask_feeling`, `order_drink`, `agree`, `disagree`, `ask_about`, `gibberish`, `unknown`.

## Who answers

Anybody who isn't an animal, unless their `flags.parley` is `false`. Their own lines come first; for an act they have nothing written for, [generic.js](../plugins/parley/generic.js) has plain lines by personality archetype (`bartender`, `vendor`, `chatty`, `gruff`, `quiet`, `guard`, `dealer` and their kin) over a base set, so anyone gives their name, says hello back and takes a thank-you.

Somebody with no `flags.parley` answers a `say` only when the line was clearly read; anything else gets their stock chitchat, as before. In the dialogue box they always answer, with a deflect if nothing else. The engine asks through the sync `npc.heard` hook, which is how a plugin claims a named line from the chitchat.

## How they answer

`plugins/parley/react.js` looks up, in order: `insult_last` (the third insult in one conversation), `<act>:<topic>`, `ask_about:<topic>`, `<act>`, and finally `deflect`. A deflect is the NPC carrying on in character without having understood, which is what Façade got right: a confident dodge reads better than "I don't understand".

Each entry is a list of lines, or lists by relation tier (`stranger`, `known`, `familiar`, `close`, `wary`, `hostile`, `any`), falling toward neutral the same way `text_by_relation` does. A line isn't repeated in a conversation while there's a fresh one.

What it does to them, unless `effects.<act>` overrides it:

| Act | Effect |
|---|---|
| greet, ask_about | familiarity +1 |
| praise | warmth +2, happy |
| thank | warmth +1, happy |
| ask_feeling | warmth +1 |
| insult | warmth -6, angry (stronger each time) |
| complain | warmth -1, annoyed |
| flirt, joke | amused |
| apologise | warmth +3, only when they're cold to you |

A deflect changes nothing. A farewell or the third insult ends the conversation.

## Beats

A beat is a short story an NPC tells a piece at a time, the way Façade's characters let things slip. `flags.parley.beats` is a list of `{ id, topic, act?, tier?, steps: [line, …], warmth?, mood? }`.

- It opens when a line touches its `topic` (or is its `act`) and the player stands at `tier` or better with them. Below that tier, the topic's ordinary lines answer, so a hint there ("Ask me about the Embassy when we know each other better") tells the player there's more.
- Each touch tells the next step, ahead of anything else they'd say about the topic. "and then?", "go on" and the like (the `continue` act) carry on the story the conversation is in the middle of.
- Every step is +1 familiarity and +1 warmth; the last gives `warmth` (default 5).
- Progress is the player flag `parley_beat:<npcId>:<beatId>`, read sync off the hydrated flag cache and written once per step, so a story carries on across visits. After the last step the ordinary lines come back.

Every one of the thirteen has at least one beat; Lowry, Imogen, Molly and Father Jerome have a second that opens only at `familiar`.

## In company

In [company.js](../plugins/parley/company.js), the way Façade's couple both reacted to you:

- **Overhearing.** Name somebody else in the room while you talk and they chip in: `react.overheard_<act>` (`overheard_insult`, `overheard_praise`), then `react.overheard`, then a generic line. An overheard insult costs warmth with them too. Once a minute per person, and one of them per line.
- **Handing off.** `flags.parley.defer: { topic: npcId | [npcId, …] }`. A question on that topic, with that person in the room, gets `react.defer:<topic>` or `react.defer` ("Ask {other}."), and the other answers it. Your next unnamed line goes to them. Compliments and remarks are never handed off.
- **Gossip.** `flags.parley.circle: [npcId, …]`. Insult somebody, or hear the whole of one of their stories, and everyone whose circle includes them brings it up at the start of your next conversation: `react.gossip_rude` (warmth -3, annoyed) or `react.gossip_story` (warmth +3), with `{other}` for who told them. Each listener says it once. RAM only, kept a day; a restart forgets it.

The other people's lines go to the room about a second apart, so ORACLE queues their voices behind the first rather than cutting it off.

The Embassy three (Lowry, Imogen, Orion) are one circle and hand poker to Orion and drinks to the bar; the Sabbatinis and Keel are another, and hull questions go to Keel.

## Sport, people and politics

Three things anybody talks about, whatever their own lines cover. Each is a module beside react.js, and react.js asks them in this order, after any beat and before the ordinary lines, unless the line hit one of the NPC's own topics or is clearly something else (an insult, a goodbye, a flirt, a drinks order). An NPC's own `react.person:<npcId>`, `react.politics:<topic>`, `react.politics` or `react.sports` wins over the generic answer.

**Other people** ([people.js](../plugins/parley/people.js)). Name somebody ("do you know Molly?") and they say what that person is to them. A first name alone counts when it's capitalised or the line is asking about somebody. Who's what comes from, strongest first: `flags.parley.knows: { npcId: kind }` on either side (`lover`, `crush`, `ex`, `rival`, `friend`, `family`, `boss`), `flags.kin` or one home and one surname (family), one home (flatmate), the outings network (friend), one workplace (workmate), else a stranger. Lovers, crushes and exes get a guarded answer below `familiar`. If the person's in the room, a look at them comes first.

**Politics** ([politics.js](../plugins/parley/politics.js)). The Ascendants, the Long Watch, the Wildblood, the Null, the Exodus, the Architect, and "which side are you on". Order members speak for their order; `flags.politics: { side, strength, open }` sets anybody by hand; everybody else is a hash of their id: about half Ascendant, a fifth quietly Long Watch, the rest out of it, each at strength 1 to 3. Nobody admits the Long Watch below `familiar`, and not then with an open Ascendant in the room. About a third of Ascendants keep it private until `familiar`. The Wildblood and the Null come up as what they do to the city; most are against both, to different degrees. Admitting a side to you is warmth (more for the Watch). The friend network uses the same sides: a housemate or workmate across the Ascendant and Watch line counts 0.15 of a tie, so they rarely end up in each other's circles.

**Sport** ([sports.js](../plugins/parley/sports.js)). A Cluster Puck or Deadball club by name or nickname, the league, the Cup or Curtain Call, or "did you see the game". `flags.sports_interest` (`none`, `casual`, `fan`) or a hash sets how much they care: about a third don't, a quarter are fans. Their club is sports-banter's, the one they cheer when the game's on. A fan hearing their own club is pleased (warmth, happy); their rival gets a face. If another fan in the room backs a different club, they join in for two or three turns, likeliest and loudest for the rival's fan; when both clubs are in this month's final (sportsleague's `cupFinalists`), it's five turns.

## Hints

Now and then an answer carries a hint at something else they'd talk about, never a line telling you what to type: a glance at the set, a name dropped, a pin straightened. Sources are `flags.parley.hints` (a list of lines), the `hint` on a beat they haven't finished and you're close enough to hear, then the generic tells for sport, close people and politics. 18% of answers, at most two a conversation, never after an insult. See [hints.js](../plugins/parley/hints.js).

## Writing one

Everything is `flags.parley` on the NPC's content file; no code. See Lowry's in [content/npcs/npc_embassy_barkeep.json](../content/npcs/npc_embassy_barkeep.json).

```json
"parley": {
  "topics": { "embassy": ["embassy", "hotel", "this place"] },
  "react": {
    "greet": { "stranger": ["*looks up.* Evening, valued guest."], "familiar": ["{name}. Your stool missed you."] },
    "ask_about:embassy": ["Used to be the best hotel north of the Basin."]
  },
  "deflect": ["*polishes the glass harder.* I'll pretend you said something nice."]
}
```

Lines are short and loose, written to [house-voice.md](reference/house-voice.md). No HTML: lines are escaped.

## Read tier

No reads from the database. A beat step is the one write: one `player_flags` row per step told. The relation comes off the live player, the mood off the cached NPC, the lines off the NPC row loaded at boot. Who you're talking to and which lines were used are RAM only and gone after 90 seconds quiet.

## Next

- Phase 3: a dev panel bench (type a line, see the act, topic and answer) and a RAM log of lines nobody could read, to grow the patterns from.
