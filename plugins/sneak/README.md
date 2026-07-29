# sneak

**Purpose** — sneaking, and the one thing you can do from it: knocking somebody out.

Two engine substrates do the work; this plugin is the verbs and the reactions.

- [`engine/stealth.js`](../../server/engine/stealth.js) — *has this observer noticed you?*, per observer, built out of the senses, lighting, impairment and posture systems that already existed.
- [`engine/unconscious.js`](../../server/engine/unconscious.js) — being out cold, on players and NPCs alike.

## Commands
- `sneak` — toggle the sneaking posture. Everyone present rolls to notice; moving re-rolls, and so does the clock running out. While unnoticed your arrival and departure are never announced and you are absent from that viewer's `look`.
- `knockout <target>` — requires sneaking, blunt or unarmed, and a lot of stamina.

## Design notes

**Combat is untouched.** A fight is to the death. There is no random knockout mid-brawl — it would be invisible (auto-attack finishes an unconscious body a second later) and it would make every fight ambiguous. A knockout is always something somebody chose to attempt.

**Failure differs by target, because they are different things.** An enemy turns on you. An NPC ducks, sees who it was, and runs shouting — `ai.alarm`, the engine's existing "a plugin is driving this NPC" flag.

**A landed knockout is loud to everyone else.** No roll for the bystanders — dropping a body in front of people is loud by definition, and a dice-hidden one would make a full room no riskier than an empty one. Enemies lunge, NPCs scream, players are told plainly, and you are forced out of the sneak. The victim never knew; anyone already out cold or asleep saw nothing.

**Being seen sneaking is its own bad outcome**, separate from being seen swinging. A person who notices you creeping across a room is unsettled by it, which is what a person would actually be.
