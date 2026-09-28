# The house voice

How Architect's prose should feel, and how to get there sentence by sentence. [docs/story.md](../story.md) is the tone authority for what the world is; this doc is how it's written. [plain-writing.md](plain-writing.md) still governs every sentence, and it wins where the two disagree.

The model is Fallout, especially Fallout 1, 2 and New Vegas. We take its techniques, never its text, names, factions or catchphrases. Adopted 2026-09-27.

## The one-paragraph version

The city talks about horror in the voice of a service that is pleased to help. People who live here treat lethal things as weather and complain about the price of water. Documents tell the story by being the wrong kind of document for what happened. Tragedy is shown by what's left, and nobody explains it. Most text ends flat; the sting is rationed. The narrator trusts the player, never winks and never tells them what to feel. The grave, mythic register lives only at the edges (the cold open, CODEX openers, the end of an arc), which is what gives it weight.

## The default register

Most text in the game should be plain. This is measured, not a matter of taste. Fallout 2's examine texts (1,097 lines in its `pro_item.msg`, `pro_scen.msg` and `pro_crit.msg`, read from the [Restoration Project](https://github.com/BGforgeNet/Fallout2_Restoration_Project/tree/master/data/text/english/game)) are the closest thing in any game to MUD object text, and they break down like this:

| | Fallout 2 | Architect (sample of 400, 2026-09-27) |
|---|---|---|
| Median length | 11 words (scenery 9, items 16) | about 28 words |
| Purely literal: what it is plus one or two concrete properties | 82% | a minority |
| Any joke or tilt | about 1 in 5 | most |
| Setup then reversal | about 3% | the shape of many descriptions |
| "There is no / there's no" | 0.5% | 6.5% |

Fallout reads as Fallout with almost no twists because the world lives in the nouns: a brand and a calibre, a material, a flat condition ("rusting", "poorly parked"), a function stated without comment, one human trace nobody explains. When a line is funny, the joke is a word inside an ordinary sentence ("stains of dubious origin") or a short flat second sentence. It is almost never a construction.

**Rules**

1. **Default is literal.** What it is, then one or two concrete properties: material, condition, brand, a mark, what it does. Object text 10 to 25 words; a room is a short list of such facts.
2. **Budget the tilt.** About one line in five may be funny. Put it in a single word or noun, or a short second sentence stated as fact.
3. **Reversals are seasoning, about one in thirty.** Never the shape of a paragraph.
4. **Say what's there.** Don't define a thing by what it isn't. "There is no X" only when the absence is a physical fact somebody would check, like an empty socket.
5. **A "but" joins two facts.** It doesn't invert an expectation.
6. **End on a fact.** No closing clause that interprets.
7. **Let the specific noun carry the world.** Brand, model, material, a written name.
8. **Institutional irony goes in quoted copy.** The label, the placard, the ad speaks in its own voice; the narrator doesn't comment on it.

**Tics to cut** (the first five are what `docs:prose` counts as `constructed-irony`)

- Promise and deny: "The card says X. There is no X."
- Label literalism: "It promises TURKEY-STYLE. It doesn't promise turkey."
- The word reversal: "a square building that stops being square", "a thumb that isn't a thumb".
- The paradox simile: "the speed of a thing that isn't moving".
- "The only thing anyone here has ever..."
- "X rather than Y" as a flourish ("displayed rather than lit").
- The authorial closer: "...which the Halcyon is only too happy to meter."
- Negative definition: "people who are not waiting for anything".
- Stacked adjective pairs: "filtered, climate-perfect air".

**Rewritten in the default register**

| Before | After |
|---|---|
| A square lobby at the foot of a building that stops being square about four floors up. | A square lobby at the foot of a tower. Four floors up, the walls start to lean. |
| A card by the door says the room is reserved for passengers awaiting a scheduled service. There is no scheduled service. | A card by the door: RESERVED FOR PASSENGERS AWAITING SCHEDULED SERVICE. The departures board beside it is blank. |
| The label promises TURKEY-STYLE. It doesn't promise turkey. | A can of pressed meat, label reads TURKEY-STYLE. Grey, firm, salted. |
| It's moving at the speed of a thing that isn't moving. | It's moving, slowly. You have to watch it for a while to be sure. |
| ...two or three people in it who are not waiting for anything. | ...two or three people in it with their coats still on. |
| ...around the clock: a constant, billable draw the Halcyon is only too happy to meter. | ...around the clock. A Halcyon meter on the side counts the draw. |

Each keeps at most one tilt, and it sits in a concrete noun or a flat second fact: the blank board, the coats still on, the meter.

## Length

Measured on 2026-09-27, rooms had a median of 47 words and ran to 331; NPC descriptions a median of 56, with 55% of them carrying a tic. Fallout 2's scenery text averages 9 words. A MUD room needs more than that, since it has to name what's in it and where you can go, but not six times more.

| Surface | Target | Hard maximum |
|---|---|---|
| Room | 45 words | 60 |
| Item | 30 words, 300 characters | 45 |
| Furniture | 35 words | 45 |
| NPC description | 55 words | 65 |
| Enemy | 40 words | 50 |

`docs:prose` counts the descriptions over the hard maximum in each content directory and fails if that number rises. Hero posters and betatape labels are exempt; the text is the object.

A room keeps what a player can use: the things it names that you can look at, take or sit on, the ways out, and who's there. It loses history lectures (who built it, what the planning consent said, what the rent is) unless one of those is its single tilt.

An NPC description is what you can see: build, clothes, one or two telling details, what they're doing now. Personality is for their dialogue to show.

The techniques below are for the one line in five. They are not the default.

## Why Fallout

Its writers were balancing "grim misery and hilarity", and they set that balance per place rather than once for the game: one add-on was pitched as survival horror, another as farce ([Sawyer and Avellone](https://fallout.fandom.com/wiki/User_blog:Ausir-fduser/Sawyer_and_Avellone_interview_at_Trzynasty_Schron)). The first game's dark humour was written to make its own developers laugh ([GamesRadar](https://www.gamesradar.com/games/fallout/most-of-the-original-fallouts-dark-humor-was-added-just-to-make-co-creator-tim-cain-laugh-we-made-this-game-for-each-other-when-it-shipped-we-were-like-well-i-hope-other-people-like-it/)). Fallout 3's lead writer cut half the profanity because it read as cheesy, avoided campy pop-culture references and told story through the environment rather than dialogue dumps ([Game Developer](https://www.gamedeveloper.com/design/revitalizing-a-heritage-the-writing-of-fallout-3)). Avellone describes the period flavour as a "slight aftertaste" on places taken from real life ([Lightspeed](https://www.lightspeedmagazine.com/nonfiction/feature-interview-chris-avellone-game-designer-fallout-new-vegas/)). That is the same brutal-and-funny register story.md already asks for, with a toolkit attached.

## Techniques

Each has a failure mode. Most of them fail the same way: the text starts knowing it's funny.

### 1. A pleased voice over something terrible

Positive verb, second person, a neutral noun doing the hiding: "a unique set of circumstances designed to test the occupants" is how Fallout's vault company described its experiments ([wiki](https://fallout.wiki/wiki/Vault-Tec_Corporation)). In Architect this is the city's own copy: advertising, parking enforcement, vat service literature, Halcyon Assurance.

- Works: "Your claim has been received. A claim isn't a complaint."
- Fails: the copy winks ("lol, radiation"). The voice must believe what it says.

### 2. The system replies, and the reply is the sting

The most famous vault log ends with an automated message congratulating the survivors on their commitment to human life, years after they started killing one resident a year to keep the machine happy ([wiki](https://fallout.wiki/wiki/Vault_11_terminal_entries)). The machine never breaks register. The gap between its words and what happened is the whole effect.

- Architect's version: a vat form, a municipal notice, a Halcyon adjuster, a door that thanks you.
- Fails: the system explains itself, or apologises. Story rule 2 applies: the city may be absurd or cruel, and it may never confirm the nudge.

### 3. The wrong kind of document

Tell a collapse through the paperwork it generated: an election guide, a postponement notice, a forty-word order, a deposition ([Vault 11](https://fallout.wiki/wiki/Vault_11_terminal_entries)). Put a noise complaint in the middle of a catastrophe ([Vault 22](https://fallout.wiki/wiki/Vault_22_terminal_entries)). The genre of the document carries the tone, and nobody narrates.

- Architect's surfaces: tablet logs, maintenance requests, rota sheets, quest notes, receipts, rent reminders, broadcast running orders.
- Fails: the last entry announces the twist ("they're at the door!"). The good ones end mid-routine.

### 4. Numbers in place of feelings

Seven sleepers with nominal vitals in identical fields, and one flagged ANOMALY DETECTED ([Vault 112](https://fallout.wiki/wiki/Vault_112_terminal_entries)). This is plain-writing's own rule ("let the arithmetic carry the feeling") pointed at fiction.

### 5. The sting is rationed

In the vault logs sampled, about one document per set ends on a turn, and it's the last one. Most entries end on routine: a plan, a request, a signature. Aim for roughly one sting per three texts in any one place, and put it at the end of a sequence. The rest stop when they're done.

### 6. People treat it as weather

Residents complain about the price, the queue and the neighbours, never the radiation. They're sincere; the player is the one who finds it funny. This is story.md's "mention it the way people mention traffic".

- Fails: NPCs as self-aware comedians, or quips from everyone. Most people in a room just want you out of the way.

### 7. What's left tells it

Fallout arranges skeletons and says nothing. Architect has the vat, so bodies come back, and the tableau is different: a room still booked in somebody's name, a second body nobody claimed, possessions and no reprint where a Null walked out, a stack of pressed shirts with the name crossed out and rewritten in another hand.

- Rule: describe objects and their positions. Never caption them.
- Fails: explaining the tableau, or making it cute. Leave one object that doesn't fit the joke.

### 8. The mythic register stays at the edges

Fallout's grave narration opens and closes the game; its ending slides are third person, past tense, 30 to 50 words each, good and bad mixed in one line ([Fallout 1](https://fallout.wiki/wiki/Fallout_endings), [New Vegas](https://fallout.wiki/wiki/Fallout:_New_Vegas_endings)). Everything between is small. In Architect the edges are the cold open, CODEX chapter openers and arc rank-ups. Never repeat a refrain inside the game.

### 9. The host is a local gossip, and warm

Fallout's radio hosts report the player's deeds as local news without naming them, are sincere or smooth, and never mock the world they live in ([Mr. New Vegas](https://fallout.wiki/wiki/Mr._New_Vegas), [Three Dog](https://fallout.wiki/wiki/Three_Dog)). Architect's broadcast hosts do the same, using bearings rather than names (the unrest rule).

### 10. Low Brains is warm, not cruel

Fallout's low-Intelligence dialogue gets pity, dismissal, gifts and occasionally more information than a clever character would ([Intelligence](https://fallout.wiki/wiki/Intelligence), [Torr](https://fallout.wiki/wiki/Torr)). If Architect gates lines on `stat_brains`, the dumb path is played for warmth and inversion, never contempt.

### 11. Tone is a dial per place

Set it for each district, building or quest line: horror in the Under, farce in a corp's HR floor, plain sadness in Old Coldwater. The same city can hold all three. Decide the dial before writing the room.

## Surfaces

Lengths are from the sampled Fallout text; ours are the targets.

| Surface | Target | Shape |
|---|---|---|
| Item description | ≤300 characters (the house cap) | What it is, one concrete detail, and at most sometimes a dry clause. A dead company's brand voice on a salvaged object is the strongest form. Most items are plain. |
| Tablet / terminal log | 40–150 words an entry | Header, date or number, short paragraphs. Entries get shorter or stranger. The set ends flat or on one turn. |
| Official notice | 40–70 words | Field labels and near-verbless fragments: "Hearing postponed pending review." |
| Audio / voice log | 60–180 words | Spoken: false starts, background noise in brackets, addressed to someone specific. The speaker doesn't know it's the last one. |
| Broadcast item | 30–60 words | Greeting, a news item told as gossip, a sign-off into the next thing. |
| Room description | 2–5 sentences | Objects and positions; what people left. No caption. |
| NPC greeting | 1–2 lines | Sincere, busy, about their own problem. |
| Arc rank-up / ending line | 1–3 sentences, past tense | Cause, then a consequence, good and bad in the same line, no verdict. |
| Death / vat message | 1–3 sentences | Bureaucratic, polite, and it bills you. |
| CODEX opener | 2–4 sentences, formal | A record rather than a speech. The Architect never addresses the player. |

## What we don't do

- Borrow Fallout's names, factions, brands, catchphrases or its 1950s kitsch. Our failed optimism is our own (below).
- Put a brand joke on every object. Most items are plain.
- End every text on a sting.
- Let a narrator or a system wink.
- Explain a tableau.
- Pop-culture reference soup. story.md's rotting pop culture is half-remembered decay, never memes.
- Pile on profanity. It reads as cheesy fast.
- Mock the player for a low stat.

## Architect's failed optimism

Fallout's retro-future is an argument about an optimism that failed: the atomic age. Ours is the frictionless platform. The words the city speaks in are the words of the nudge: seamless, personalised, for you, your continuity is our priority. The machine rebuilt the ads, the traffic and the quarterly reports to shareholders who are ash (story.md). So the brightest, most helpful voice in the game is always the one to be most afraid of, and it never says so.

Where the aesthetic sits on the map (from [building-styles.md](building-styles.md)): chrome and curtain glass in the Glasshouse and Halcyon Fields, pink neon on the Marquee, brick and cold blue downtown, amber-lit industry in the east, and Old Coldwater unlit on purpose. The nostalgia decade is open in story.md; the proposal is "early digital age": tablets, smart chimes, subscription prompts, supply chains with no origin.

## Voices of the orders

Each order's paperwork is its voice.

- **Ascendants**: formal wire copy and redemption literature. Uncontracted, measured, precise, faintly serene. No em dashes (nobody uses them now).
- **Long Watch**: duty rosters and laconic veterans.
- **Null**: exact field notes, a little paranoid.
- **Wildblood**: domestic and matter-of-fact about horror ([lore-wildblood.md](../lore-wildblood.md)).
- **Exodus**: austere; never names a mechanism.
- **The city itself** (Halcyon Assurance, parking, the vat): the pleased service voice of technique 1.

## Examples

Original, written for Architect. Names marked (proposal) are new and unchecked against content.

**Item.** Pellucid Slate (proposal). A tablet from a company that no longer has a building. It still updates overnight. Nobody knows who writes the patches, and every one of them is an improvement.

**Tablet log.**

> MAINTENANCE REQUEST 0412. Deck 4 Lounge (proposal). Drain in stall 2 is making noise again. Sounds like talking. Please send someone.
> MAINTENANCE REQUEST 0419. Deck 4 Lounge. Noise stopped. Stall 2 is locked from the inside. Please send someone with a key.
> MAINTENANCE REQUEST 0426. Deck 4 Lounge. Thank you for the new stall 2.

**Broadcast.** Morning, Coldwater. Light rads past the Curtain, heavy traffic on Kerbstone Row, and somebody down on Meltwater Row paid their parking in full yesterday, so the city's still full of surprises. Halcyon Assurance would like to remind you that a claim isn't a complaint. Here's a song about somebody else's heart.

**Room.** A launderette in the Shingles with no power and every machine door open. The folding counter has eleven shirts on it, pressed, in a stack with a ticket on top. The name on the ticket has been crossed out and written in again in a different hand.

**Death.** You die. Somewhere across town a vat drains and a body sits up. A form asks it to rate today's service. It gives four stars without reading the question.

**Long Watch greeting.** First meeting: "You're new. That's fine. Stand where I can see you and don't touch the rail." Known: "You again. Rail's still there."

**Quest log.** Mrs Oduya (proposal) wants her son's vat record corrected. He's been printed twice this month and she only ordered once. Continuity Services (proposal) says the second one is also her son, and that duplicates are refunded at cost.

**CODEX opener.** There is no record of the day it began. There are four records of the day it ended, and they do not agree about the weather. Every one of them was filed on time.
