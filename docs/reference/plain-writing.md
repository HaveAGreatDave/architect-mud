# Plain writing — the house rule against AI prose

**Applies to:** everything we write. Docs, comments, commit messages, READMEs,
player guides, dev-panel copy, chat replies. Player-facing *in-world* prose is
covered too, with the carve-outs in the last section.

This is the `claudish-to-english` spec
([programasweights/claudish](https://github.com/programasweights/claudish),
`specs/claudish-to-english.md`), adopted as a writing standard rather than run as
a service. The rules are theirs; the carve-outs at the bottom are ours.

Adopted 2026-08-24.

## The one-line version

Say the thing once, at the lowest level of abstraction that stays accurate, and
stop.

## What "Claudish" is

The prose style of Claude and Claude Code: polished, contrast-heavy,
metaphorical about structure, process-oriented, and prone to expressing one
simple idea through several abstractions, contrasts and restatements. It reads
well sentence by sentence and says a third of what its length implies.

## Compress

Claudish states the same idea several times in different frames. If clauses or
sentences restate a point, emphasise it without adding information, hang a
metaphor on it, dramatise it, contrast it with an invented alternative, or
summarise a conclusion already given — collapse them into one statement.

A five-sentence passage becoming one sentence is a success, not a loss. Do not
write one output sentence per input sentence. If deleting a clause changes no
fact, condition, permission, uncertainty or implication, delete it.

## Drop the abstraction level

Ordinary verbs and direct relationships beat rhetorical framing, nominalisations
and system metaphors.

| Write | Not |
|---|---|
| Only owners can merge. | Merge authority is restricted to the owner role. |
| Don't launch until the tests pass. | Passing tests is a mandatory launch requirement. |
| The timestamp shows the cache is stale. | The timestamp provides verified evidence of cache staleness. |
| Release requires approval. | Approval-gated release path. |
| The rewrite must preserve every fact. | The rewrite is a fact-preservation pass. |

## Delete the scaffolding

These get removed, not paraphrased, when they add no meaning. Don't swap them
for simpler filler — cut them.

- **Contrast frames** — "not X but Y", "X, not Y", "less X than Y", or a rejected
  framing followed by the preferred one.
- **Staged emphasis** — "the key distinction", "the deeper point", "the honest
  take", "the cleanest way to see this", "the load-bearing constraint", "the
  verdict here", "the smoking gun".
- **Redundant orientation** — "in one sentence", "put differently", "in other
  words", repeated summaries.
- **Aphoristic endings** — "that distinction matters", "that is the boundary",
  "that is the actual constraint", and any punchy closing fragment that restates
  the paragraph it sits under.
- **Validation and candour framing** — "you're absolutely right", "fair hit",
  "one honest caveat", "the honest answer" — unless the interpersonal meaning is
  the point.
- **Rhetorical restatement** — the same claim again in different vocabulary.

## Decode the metaphors

Replace the metaphor with the relationship it describes. Contextually, not
mechanically — this is not a find-and-replace table.

`X-gated` → X is required · `owner-gated` → only owners may · `hard gate` →
a strict requirement · `load-bearing` → essential · `surface` → the actual thing
· `path` → the action or option · `layer` → the component · `handoff` → transfer
· `spine` → main structure · `landed` → merged, shipped, finished · `surfaced` →
appeared, was found, was reported · `stale` → out of date · `canonical` →
authoritative · `blocker` → what's stopping it · `drift` → change over time

Same for noun stacks: `X-backed`, `X-side`, `X-level`, `X-first`, `X-safe`,
`X-matched`, `X-layer`, `X-surface`, `X-path`, `X-boundary`. Recover the actual
relationship and prefer a verb.

## Use contractions

Added 2026-09-04. Contractions are the default, everywhere — docs, comments,
READMEs, guides, dev-panel copy, and every line of in-world prose. "Don't",
"it's", "you're", "isn't", "won't", "can't", "there's", "that's". Writing them
out is what makes prose sound dictated rather than spoken, and sounding like a
person talking is the whole point of this spec.

Expand a contraction only when the uncontracted form IS the emphasis:

| Contracted | Expanded, for emphasis |
|---|---|
| It isn't a slogan, it's an inventory. | It is not a slogan. It is an inventory. |
| I'm not going. | I am **not** going. |
| That won't happen. | That will not happen. Ever. |

The test: read it aloud. If the stress lands on the negative or on the verb,
expand it. If it doesn't, contract it. A page of expanded forms means none of
them reads as emphatic any more.

Two exceptions. **Formal and archaic voices** — the Architect, Ascendant wire
copy, official notices — write out on purpose, and that's a voice tell in the
same way em dashes are. And **fixed strings** keep their exact wording: verb
names, parsed command output, error text, quotations.

## Simplify over-formal research language

frontier, horizon, floor, surface, exchange rate, regime, trajectory, slice,
cell, matched, frozen, headline, confirmatory, protocol, claim gate, lower
bound, clears, survives, implicates — plain English when they are rhetoric.
Leave them alone when they are the precise technical term.

## Keep the real terminology

None of the above words are banned. `provenance`, `calibration`, `routing`,
`gate`, `verified`, `canonical`, `drift` and the rest stay when they are the
clearest description of the thing. Cut them only when they are ornament.

## Never widen the claim

The most damaging failure of a rewrite is a scope change that reads fine.

- "Do X if Y" does **not** mean Y is the only time X may happen.
- "X requires Y" does **not** mean X is defined by Y.
- "Only owners may publish" says nothing about what non-owners may do.
- A prerequisite is not a cause. A trigger is not an exclusivity rule.
- "Has not started" is not "in progress". "Not tested" is not "incorrect".
  "Required" is not "sufficient".

When a metaphor is ambiguous, take the narrowest reading the surrounding text
supports.

Names, quotations, commands, code, verb names and fixed technical terms keep
their exact wording.

## In-world prose

Updated 2026-08-25. This section previously exempted the fiction. It no longer
does: NPC dialogue, room descriptions, item text, quest text, emotes, broadcast
copy and death messages follow this spec as well as
[docs/story.md](../story.md). Where the two disagree about voice, story.md wins.

The rule that decides most cases is already above: scaffolding goes **when it
adds no meaning**. In fiction that line falls between two things that look alike.

**A character rejecting an objection is doing work. Keep it.**

> "That is not nostalgia. That is engineering." (Halloran)
> "That is not a slogan. It is an inventory." (the Quartermaster)

Both answer something the listener was about to think. Cut the first half and
the line stops arguing with anybody.

**Narration explaining what the reader just saw is the tic. Cut it.**

| Cut | Keep |
|---|---|
| He waited while I finished a phone call, which is how you know it was routine. | He waited while I finished a phone call. |
| She does not look at the slate, which is what makes it work. | She does not look at the slate. |
| ...and becomes furniture, which is the entire skill. | ...and becomes furniture. |

The test: if the sentence tells the reader how to feel about the sentence before
it, it goes. If it adds a fact, a judgement the character is making, or
information the reader could not have had, it stays.

Applies hardest to narration and stage directions. Speech gets more room,
because people do repeat themselves and do speak in contrasts, but a monologue
that makes the same point three times still makes it once.

## What to do instead

Added 2026-08-25, from the nine public-domain books in the game's own library
([systems-library.md](../systems-library.md)). Everything above says what to
cut. These say what the cut makes room for. They are craft rules, not style
preferences, and they were all worked out by people writing about machines,
collapse and polite atrocity, which is the material we are working with.

**Trust the reader to supply it.** In *The Machine Stops*, Kuno describes
"four big stars that form an oblong" with three more hanging from them. Forster
never writes "Orion". The reader does, and the reader is moved by having done
it. Swift never once says he is joking. The moment either had explained
themselves, the effect would be gone. This is the failure mode we hit most:
a clause after the image telling the reader what the image meant.

**Let the arithmetic carry the feeling.** Swift's case is made of numbers, not
adjectives: a hundred and twenty thousand children, twelve pounds at birth,
twenty-eight at a year. No emotive word appears anywhere near them. Nine's
"eleven thousand and forty" works for the same reason, and would stop working
the moment somebody in the scene called it a tragedy.

**Objects carry the history.** London opens *The Scarlet Plague* on a rotten
rail thrust up at a slant, and one line of inference: it had been of the
mono-rail type. That is the whole fallen civilisation, delivered without a
paragraph of backstory. Then he hangs a freshly severed pig's tail over the
boy's ear, and you know exactly what kind of world raised him.

**A voice convicts itself.** Zamyatin's narrator praises a "sterile, faultless
sky" and calls dancing beautiful because it is *unfree*. He is arguing for it,
happily, and Zamyatin never steps in. Do not write a character who is wrong and
then signal that they are wrong. Write them persuasive and get out of the way.

**Withhold the description.** Wells will not tell you what is in the corner of
the hut. It is "a shapeless mass of darkness", then "the lump of mystery", then
"a deeper blackness in the black". Naming a thing sets its size. Refusing to
name it lets the reader make it worse.

**Put the joke in the connector.** Voltaire: the Baron's lady weighed three
hundred and fifty pounds "and was therefore a person of great consideration".
The whole joke is *therefore*. Not the setup, not a punchline, and never
explained afterwards. The castle has "not only a gate, but windows" and the
sentence moves straight on.

**Spend the authorial voice once.** Forster breaks frame exactly one time, on
the imponderable bloom of the grape and the artificial fruit, and it is the
thesis of the story. One intrusion in a whole book, placed where it counts. A
paragraph that steps outside the scene to comment is spending something scarce.

**Let the frame tell the reader what the narrator cannot know.** *The Iron
Heel* is Avis Everhard writing in hope, annotated seven centuries later by a
scholar who is calm about it. Her first page strains for the coming storm; the
footnote under it records her husband's secret execution and the failure of the
revolt. She never finds out. The reader knows from page one and keeps reading.
Hope against the odds is stronger built into the structure than argued for in a
speech, and this is the device to reach for when a character is about to be
right about everything except the outcome.

The frame does three more things worth stealing:

- **It answers questions the narrator dies asking.** Avis writes that they never
  found who threw the bomb that destroyed them, and that it must now "take its
  place among the mysteries of history." The footnote hands the reader the
  murderer's deathbed confession, discovered in the Vatican six hundred years
  after her death. She goes to her grave not knowing. We do.
- **It makes ordinary things strange by explaining them.** The scholar
  patiently glosses *watchman*, *insurance*, *bankruptcy* and *food* as quaint
  barbarisms of a savage age. Nothing indicts a world faster than a footnote
  explaining it kindly to someone who has never needed it.
- **It ends by stopping.** The manuscript breaks off in the middle of a
  sentence, because she was warned and had time to hide it and no time to
  finish. The last words are a subordinate clause. Nothing is resolved. An
  ending that is *interrupted* rather than concluded says more about the world
  that interrupted it than any death scene.

**Give the enemy a sincere ethic and never let them doubt it.** London is
explicit that the Iron Heel's strength is not its prisons or its wonder-cities
but "its satisfied conception of its own righteousness." The oligarchs raise
their children on the picture of the roaring abysmal beast, and believe
themselves the last thing standing between humanity and it. Their children play
at stamping on the proletariat in the parks during the massacre, and nobody in
the family finds that strange. Write the villain's faith as load-bearing and the
reader can never dismiss them as merely greedy.

**Name the new thing by what it is not, once.** Wells gives Graham a roadway
three hundred feet across and writes "it was not a roadway at all, as Graham
understood such things". A man from 1900 can only describe 2100 by the shape of
the hole it leaves in what he knows.

⚠ The same chapter is also the weakest prose of the nine, and it is worth
knowing why. Wells stacks Titanic, mighty, gigantic, huge, vast, and the scale
does not arrive. What makes the space enormous is one small figure in pale blue,
far overhead, working invisible strings, who swoops down a cable and is gone.
One human at the right distance beats six adjectives.

**A long sentence is fine when every clause adds a fact.** De Quincey runs
sixty words without strain because each turn carries new information. The rule
above is "say it once", not "write short". Length earned by content stays;
length made of restatement goes.

**Deflate without signalling it.** De Quincey builds a paragraph about a work of
profound understanding, then: it was advertised twice, he could not manage the
preface, the compositor was dismissed, and the manuscript "rested peacefully"
unpublished. No wink, no aside, no marker that a joke has occurred. He even
takes a shot at himself in a single passing clause, hoping the work is not
redolent of opium, "though, indeed, to most people the subject is a sufficient
opiate", and moves on without pausing for the laugh.

**Give the monster the good speech and no rebuttal.** Moreau explains
vivisection for six pages, reasonably, in the tone of a man supremely bored.
Prendick's objections are interruptions that get waved away: "these foul
creatures of yours—", "the thing is an abomination—". Wells never lets the
decent position win an argument, and the book is not on Moreau's side. Ives and
The First work the same way. Do not write a villain who is refuted; write one
who is answered by a bad feeling.

**Put the proof inside the argument.** Mid-sentence on pain being trivial,
Moreau takes out a penknife, picks a spot on his own thigh, drives the blade in,
withdraws it, and keeps talking. No line of commentary follows.

**Power answers questions flatly and does not explain itself.** Wells again, in
*The Sleeper Awakes*: "What Council?" "*The* Council." "Whose orders?" "Our
orders, Sire." How many police forces are there? "Several." Several? "About
fourteen." A regime is drawn by the shape of what its servants will not say, and
Graham's guide admits he does not understand the system himself. Nobody does.

**Let a body break before a mind does.** Zamyatin's narrator is still writing
hymns to the Tables when he notices his own hairy paws and cannot stop looking
at them, and his dissent arrives as an unnamed X he has no vocabulary for. He
describes it as a mathematical unknown because that is the only language he has.
A character loses an argument with themselves in their hands and their sleep
long before they lose it in their opinions.

**Bury the worst fact in a footnote or an aside.** Zamyatin footnotes the word
bread: it survives as a poetic form, and the chemical constitution of the
substance is unknown to them. London's future scholar glosses "watchman" and
"insurance" as quaint barbarisms while annotating a woman's account of her
husband's execution. Both put the horror where a reader has to stoop to pick it
up.

**Let the trapped explain themselves and be decent about it.** *The Iron Heel*
sends Avis from person to person over one man's severed arm. The lawyer keeps a
photograph of his wife and daughters in his watch case. The foreman perjured
himself and says why: "Because I've a good wife an' three of the sweetest
children ye ever laid eyes on, that's why." The other wanted to be a naturalist.
Not one of them is a villain and Jackson still gets nothing. A system reads as
inescapable when everybody inside it is sympathetic and it grinds on anyway.

**Give the wronged understatement, never rhetoric.** Jackson on losing his arm
to the machine: "The crunchin' of the bones wasn't nice." His whole case for
himself, said at the start and again as his last words, is that they might have
given him a job as watchman. Pity is generated by how little the character asks
for, not by how much the prose asks on their behalf.

**A confident voice arguing for something false is a pleasure to read.** De
Quincey demolishes three propositions about opium, sets himself up as the only
member of the true church on the subject, and is wrong at length and beautifully.
He even reports the surgeon who contradicts him, at length, courteously, and
declines to be moved. Persuasive and wrong beats obviously wrong, every time.

**Let somebody bored interrupt the important speech.** London's last page has
Granser reaching his summation on civilisation, fire, blood and the eternal
return, and a teenager cuts him off: the old geezer gets more long-winded every
day, let's pull for camp. The book then ends on wild horses on the beach and
sea-lions fighting and loving on the rocks. The thesis gets stated and the world
declines to care, which is a harder ending than agreement.

**Explain scale in the listener's materials, not yours.** Granser counts the
dead in teeth for millions, crab-shells for billions, grains of sand for
single people, because his grandsons have no numbers. Four million in San
Francisco is four teeth on a log. Reach for what the person being spoken to
already handles.

**The best line goes to the person you disagree with.** The Chauffeur was a
servant who beat a magnate's widow into carrying his firewood, and he gets the
sentence the book is organised around: you had your day before the plague, this
is my day, and a damned good day it is. Granser, the professor, is a snob who
mourns his lost caste alongside the eight billion dead and wonders why the
plague could not have taken one more man. Neither is endorsed.

**Decline that ruins is habit, not catastrophe.** Forster's Machine fails by
degrees: the music develops a defect, the fruit goes mouldy, the bath water
stinks, the poetry machine rhymes badly. Every one is bitterly complained of at
first, then acquiesced in and forgotten. When the Committee of the Mending
Apparatus confesses that the Mending Apparatus itself needs repair, the effect
of the frank confession is admirable and the applause is genuine. Write the
collapse as a series of things people got used to.

**Prove the change in the prose, not in a line of dialogue.** *We* is a diary,
and for thirty-nine records the narrator's style degrades as he does: his
mathematics stop working, he starts seeing an X he cannot name, he interrupts
himself, he refuses a heading. Then they cut out his imagination, and Record
Forty is flat, ordered and factual. He watches the woman he loved tortured under
a bell jar and observes that her teeth are very pretty. Zamyatin never says the
operation worked. He demonstrates it by removing the metaphors, and the loss is
the reader's as much as the narrator's.

This is the strongest device in the nine books and it is available to us: a
character whose voice changes across a questline says more than any amount of
prose about how they have changed. It also cuts the other way. A player who has
been chromed, quickened or operated on should be *written to* differently, and
nobody in the scene should remark on it.

**Bring the horror home rather than leaving it where it happened.** Prendick
gets off the island and cannot stop seeing the Beast Folk in ordinary Londoners:
prowling women, furtive men, blank faces on an omnibus, a preacher gibbering
Big Thinks. He ends in solitude with his books and his astronomy, and the last
words of his account are that he hopes, or he could not live. The island stopped
being the subject about forty pages before the end.

**Reversion is a language problem before it is a body problem.** Wells marks the
Beast Folk's decline by what happens to their speech: jabber multiplying while
meaning drains out, articulation coarsening, a growing disinclination to talk.
"Can you imagine language, once clear-cut and exact, softening and guttering,
losing shape and import, becoming mere lumps of sound again?" The bodies follow
afterwards. And the one thing that marks Prendick as human throughout is
sharper than any of it: an animal may be ferocious and cunning enough, but it
takes a real man to tell a lie.

**The register never flinches.** Voltaire narrates an army sacking a village —
women disembowelled after having satisfied the natural wants of some heroes,
brains scattered, arms and legs cut off — in exactly the sentence rhythm he uses
for a good dinner, and calls the whole thing done according to the laws of
public right. Pangloss survives his own hanging because it rained too hard to
burn him, so he was hanged because they could do no better. The horror is
manufactured entirely by the brightness of the prose refusing to change. A
sentence that slows down and goes solemn at the atrocity is telling the reader
how to feel about it, which is the one thing that lets them off.

**Then stop the joke once, and only once.** In thirty chapters of relentless
irony, one passage is plain: the man outside Surinam with no left leg and no
right hand, who explains that the mill takes the hand and running takes the leg,
and finishes with *this is the price at which you eat sugar in Europe*. No
reversal, no absurd escalation, no comic connector. It is the loudest thing in
the book because everything around it is funny. If everything in a piece of work
is delivered at the same wry angle, nothing in it can ever land — the flat
passage only works if you have earned it by being funny for a hundred pages
first.

**A man can keep saying a thing after he has stopped believing it.** Pangloss,
hanged, dissected, whipped and chained to an oar, "owned that he had always
suffered horribly, but as he had once asserted that everything went wonderfully
well, he asserted it still, though he no longer believed it." That is a complete
character in one sentence, and it is a far better account of how people hold
positions than any scene of a man being argued out of one. Nobody in this game
should be talked out of an ideology on screen. They go quiet about it, or they
go on saying it in a voice that has gone hollow.

**End the escalation by refusing to continue it.** Six dethroned kings introduce
themselves at supper, each reveal shorter and sadder than the last, down to
Theodore of Corsica who has seen himself on a throne and on straw in a London
jail. Then four more Serene Highnesses walk in — and the narrator will not even
record what they say, because Candide has stopped caring. The joke is closed by
being abandoned mid-run. A gag that plays out its full sequence is a gag the
author was enjoying; one that gets cut off belongs to the story.

**Put the perfect answer in the middle, where it can be walked out of.** El
Dorado has no prisons, no lawsuits, no priests who burn people, and gold lying
in the road for children to play with. It arrives at the exact midpoint, and
Candide leaves after a month, because Cunegonde is not there and because being
merely equal to everyone is unbearable. Voltaire does not argue against utopia;
he builds a flawless one and has his hero get bored. An ideal placed at the end
is a promise. An ideal placed in the middle is a test of the character, and they
will fail it in a way that tells you who they are.

**Answer the argument with an act.** The book ends with Pangloss delivering a
sixty-word chain of causation proving the whole catastrophe was necessary, and
Candide replying: "All that is very well, but let us cultivate our garden."
Earlier, the dervish shuts a door in the face of the same question. Earlier
still, Candide says "You are very hard of belief" and Martin answers, "I have
lived." Three words against a philosophy. The person who has stopped arguing
always wins the scene, and the winning line is always the shorter one.

**No one in the piece may sound like the author.** Voltaire smuggles his own
craft rules into a satire of a literary dinner party, where a scholar says a
tragedy must be new without being odd, often sublime and always natural, and
must be the work of a great poet "without allowing any person in the piece to
appear to be a poet". The joke is that the scholar delivering this has written
one tragedy, which was hissed. Take the rule anyway. A character who starts
producing the writer's own good sentences has stopped being a character.

**Deliver elapsed time as small talk.** *The Sleeper Awakes* covers twenty years
in a conversation between two men standing beside a sleeping body: a touch of
grey in the hair, an eldest son now leaving Harvard, and then — "And there's
been the War." "From beginning to end." "And these Martians." Wells drops an
alien invasion into a list of things that happened while you were out and moves
on. Nobody in the scene finds any of it remarkable, which is exactly what makes
the gap feel real. A paragraph summarising the intervening years would have
delivered the same facts and none of the weight.

**The unit of measurement is the tell.** Graham asks how long he has slept and
gets "some considerable time", then "very much more than that", then "more than
a gross of years" — and it is the *word*, not the number, that tells him the
world has moved: they count in twelves now, and have to convert for him. Later
an old man says he is "sevendy" and was "twaindy" when Ostrog was born. The
lettering has gone phonetic too, so the reader decodes "Thi Man huwdbi Kin" the
way Graham does. Change what people measure with, spell with and count in, and
you never have to announce that time has passed.

**Answers that evade tell the reader more than answers that explain.** Graham
asks whether the city still has a police force. "Several," he is told.
"Several?" "About fourteen." The answer is not that policing got bigger — it is
that there is no longer a state doing it. Fourteen forces means fourteen
employers, franchised out and competing, and the sovereign that used to run one
of them is gone. Howard supplies none of that and changes the subject. Every
guide in this book is under orders to say nothing, so every scrap they let slip
is worth more than a briefing.

⚠ **Two things this example gets wrong as a model, and both took a reader
pointing them out.** Wells's actual question is "Have you still a police?",
which is 1899 and reads as stilted now; quoting it makes the rule sound like a
period costume rather than a technique. And "About fourteen" only works if the
reader reconstructs the whole argument above from a number — which is a fine
thing for a novel to ask and a poor thing to copy, because an evasion that is
all mystery teaches nothing and reads as the *writer* withholding rather than
the character.

**The usable version of the rule: short, flat, no explanation — and the content
of the answer should locate the speaker.** The best one in Architect is Ives,
asked whether a broker belongs to Halcyon: *"He sells to four buyers. We are the
one that pays on time."* Nine words, no elaboration, and it places the
Ascendants exactly — they do not own the board and do not need to, because being
the reliable counterparty is a more total kind of power than ownership. Nobody
in the scene calls it power.

**Let a character hear their own legend, told wrong.** Graham meets an old man
in the dark who does not recognise him and proceeds to explain the Sleeper to
him: how the fortune was built, how the Council grew, that he was "set on a
playful woman, poor soul" — and, flatly, that the real Sleeper died years ago
and the one they have is a drugged substitute. Graham tries three times to say
who he is and is laughed at. His own life comes back to him as history, with the
divorce reduced to a footnote and himself declared dead. This is the best scene
in the book, and the device is available to any world where a player has done
something people talk about.

**Make the cost of a character's joy visible only to a bystander.** Graham,
delirious with his first taste of flight, throws the machine through loops over
London. Something taps past. He asks what it was. The aeronaut has to fight the
levers before he can answer: "That was a swan." Graham never saw it. Wells adds
one detail — "little drops upon his forehead" — and no comment at all. The
Master's delight, a life ended without his noticing, and one frightened man who
saw the whole thing. Never let the character who caused the damage be the one
who registers it.

**Explain the old thing's logic and the new thing needs no defence.** Before
describing a world with no villages at all, Wells explains why the old one had
them: a market town every eight miles, "simply because that eight mile marketing
journey, four there and back, was as much as was comfortable for the farmer."
Once the reader has that number, the disappearance of every village in England
reads as arithmetic rather than invention. If a change in the world feels
arbitrary, the fix is usually upstream — state the rule the old arrangement was
obeying, and the new one stops needing to be argued for.

**The euphemism is the atrocity.** The Labour Department has ended homelessness:
anyone with nowhere to go gets food, a bed and a blue uniform, in exchange for a
day's work, for ever. "We have abolished destitution. It is engraved upon the
Department's checks." The Surveyor-General of Schools is just as pleased with
himself: they have "completely conquered Cram", they teach the labourers'
children almost nothing because knowing things "only leads to trouble and
discontent", and his foremost duty is to fight popular discontent — "Why should
people be made unhappy?" Neither man is lying and neither is a villain in his
own account. Write the institution's own phrase for what it does, in the tone of
someone quite proud of it, and never supply the translation.

**Let the cynic state the mechanism out loud.** Ostrog wins, and then explains
exactly how: "We had to stir up their discontent, we had to revive the old
ideals of universal happiness — all men equal — all men happy — ideas that have
slumbered for two hundred years. We had to revive these ideals, impossible as
they are — in order to overthrow the Council." Graham answers that the crowd
outside is a voice, not voices. "We taught them that," says Ostrog. "Perhaps,"
says Graham. "Can you teach them to forget it?" Two lines, and the argument of
the entire book is on the table. A villain who conceals his reasoning has to be
exposed; one who explains it cheerfully has to be *beaten*, which is a better
story.

**The important speech should come out badly.** Graham finally gets his moment
in front of the cameras and Wells will not give him an oration. He stalls, asks
for a minute, doubts the whole revolt is anything but "the impulse of passionate
inadequacy against inevitable things", and then "floundered", "spoke gustily, in
broken incomplete sentences". The one clean line he manages he simply says
twice. A character who finds exactly the right words at the crisis is being
written by somebody who knew what was coming. The fumbling is the sincerity.

**Name the omission before you name what it was.** De Quincey lists the
precautions he took when parting from Ann — where to meet, what hour, every
night thereafter — and then: "This and other measures of precaution I took; one
only I forgot." The reader now knows something has already gone wrong and has to
keep reading to learn what. It was her surname. He never finds her again, and
spends the rest of his life looking into "many, many myriads of female faces".
Announcing the mistake before disclosing it turns a piece of information into a
dread that arrives ahead of it.

**What haunts a character is never the large thing.** A Malay knocks at the door
one afternoon, cannot make himself understood, lies on the floor for an hour and
leaves. De Quincey flags the episode as trivial while telling it — "This
incident I have digressed to mention, because" — and the man then presides over
years of nightmares, bringing worse Malays with him. Meanwhile the actual
horrors of his life, the starving winter and the lost girl, surface only once
and gently. Pick the haunting detail from the margin of the story, not from its
catastrophes.

**Let the mundane hand deal the catastrophe.** The most consequential moment of
his life is a dull druggist on a wet Sunday who hands over the laudanum and
gives him "what seemed to be real copper halfpence, taken out of a real wooden
drawer". The joke — that De Quincey insists ever after the man must have
"evanesced" — only works because everything about the transaction was so
ordinary. A world-ending purchase made across a counter by somebody having an
average day is worth more than any ominous seller.

**Carry the ending inside the beginning.** The Pleasures of Opium is genuinely
delighted — the opera, the Saturday-night markets, happiness "corked up in a
pint bottle" — and buried mid-paragraph is: "For all this, however, I paid a
heavy price in distant years, when the human face tyrannised over my dreams."
The reader enjoys the good years with the invoice already visible. Foreshadowing
that says *something bad is coming* is cheap; foreshadowing that names the exact
bill is not.

**Write an altered mind by what it does to space, time and memory — never by
adjectives.** De Quincey's four facts are the most useful page in the book for
us, and none of them is the word *strange*. What he pictured on the darkness
while awake arrived in his sleep, so he became afraid to imagine anything.
Buildings and landscapes appeared "in proportions so vast as the bodily eye is
not fitted to receive". He lived seventy or a hundred years in a night. And
forgotten things returned so complete that he could not be said to remember
them — he *recognised* them — from which he concludes "there is no such thing as
_forgetting_ possible to the mind", the inscriptions merely veiled, like stars
behind daylight. His architecture reproduces itself upward forever after
Piranesi's staircase, each flight ending at an abyss with a further flight
above it and Piranesi on that one too. Give a drugged or dreaming state a rule
about scale, duration or recall and let it operate; the reader supplies the
dread.

**Withdrawal is not a mood, and it is not a wanting.** This one is a correction,
not a refinement. De Quincey takes the received account apart directly: "there
is nothing like low spirits; on the contrary, the mere animal spirits are
uncommonly raised: the pulse is improved: the health is better. It is not there
that the suffering lies." What it actually is: sneezing for two hours at a
stretch, sweating through five baths a day, ninety hours of sleep so thin he
hears every sound in it — and his best single observation, which is medical, that
the pain was caused by *digestion itself*, a process "which should naturally go
on below the consciousness" and had become distinctly perceptible. A body with
the volume turned up on the parts nobody is supposed to hear. Write the specific
undignified event, never the appetite; "you would kill for one" is the line the
source text exists to disagree with. (This is now enforced for the game's own
withdrawal prose by a banned-phrase check in
[scripts/content/withdrawal-stages.mjs](../../scripts/content/withdrawal-stages.mjs).)

**End an account of a compulsion with the ledger.** After two hundred pages of
the most ornate prose in the language, the book closes on a table: 24 June, 130
drops. 27 June, 80. Then a week at 80, then a hiatus in the manuscript, then
73.5, then 240, then 350. Then: none, none, none, 200, none. He appends one
line of explanation — the relapses were "mere infirmity of purpose" — and stops.
The numbers do what no amount of the preceding rhetoric could, because they are
the only part of the book that cannot be argued with. When a character has spent
the whole work explaining themselves, let the last page be evidence.

**Know which one is the hero.** "Not the Opium-eater, but the opium, is the true
hero of the tale, and the legitimate centre on which the interest revolves. The
object was to display the marvellous agency of opium, whether for pleasure or
for pain: if that is done, the action of the piece has closed." He is right, and
it is why he can refuse to narrate his own cure. Worth asking of any quest: what
is this actually about, and does it end when *that* is finished, or am I still
writing because the character is still standing there?

**Foreign-as-nightmare belongs in a mouth, never in the narration.** De Quincey's
dream sequences run through a long passage of period racism — Asia as an object
of horror, "man is a weed in those regions", the Malay as a "tiger-cat". What is
wrong with it is not the device. It is that *he* believes it: the book has no
distance from the fear and offers the reader none either.

Put the identical move in a character and it stops being the author's opinion
and becomes evidence about the speaker. **An Ascendant or a Long Watch voice
regarding the Wildblood is exactly the right place for it**, and the game
already does it — the recruiter, asked to describe his rivals, says *"The
Wildblood want the ash to finish what it started on them."* He is delighted to
be asked. He has never been there. Nothing in the scene corrects him, and
nothing needs to, because the correction is a three-day walk south and the
player can take it.

That is what makes the Scarletwastes rule
([proposals/scarletwastes.md](../proposals/scarletwastes.md)) pay: **the terror
is on the approach, the inside is domestic, and nothing ever remarks on the
difference.** The trophy road is a performance the Wildblood *maintain* — bright
wire, replaced a bit at a time — and the gate masks are quilt-lined so they do
not chafe on a long shift. A player who only ever hears the orders talk about
them gets the nightmare. A player who walks in gets a town. Neither is
announced, and no NPC ever argues the point.

⚠ The two halves are not interchangeable. **Narration may never take the
speaker's side** — the moment the prose itself describes the Thornwarren as
horrifying rather than describing a frightened outsider, the device is doing
what the book does. And a quest may never reward the player for working it out
(that rule is in the Scarletwastes doc and it is the same rule as this one).

## Dialogue

Added 2026-08-25, after a review of the faction questlines in which the game's
own author read a finished scene and could not tell what the character wanted.
That is the failure these rules exist to prevent, and it outranks every other
consideration on this page.

**Information over texture. Texture only when it costs no clarity.**

A player who has never played should come out of a conversation knowing more
than they went into it with. If a line is doing atmosphere at the expense of
telling somebody what a thing is, the atmosphere goes. This is not a trade
against good writing — every cryptic draft in that review was replaced by a
plainer one that was also better. "Wet feet in the cold is how you lose toes"
beats anything the atmospheric version produced.

**The finished test.** Read the scene cold, in order, as somebody who has never
played. Then say in one sentence what the character wants and what the player
now knows. If you cannot, it is not done. Nothing else on this page matters if
that test fails.

### Read what the character HAS before writing what they say

A vendor's `vendor_inventory`, an NPC's `flags`, their `work_zone_id` and their
own description are a specification for what that person knows and what they
would need to find out. Writing the lines first produces a scene that performs
expertise instead of having any.

The Quartermaster was drafted asking "Which hand?" and "Close work or far?" —
a tailor fitting somebody for a weapon. Her shop is *Surplus of Sorrows* and her
stock is soap, water, earplugs, bandages, jerky, duct tape, work gloves, a
battery, a rad band, a jerry can, a flashlight, ear defenders and smoked lenses.
Not one weapon. She does not kit you to fight; she kits you to stand somewhere
unpleasant for a long time, which is what the Long Watch are. The answer was on
the shelf the whole time.

### Every question needs an antecedent

A question has to be answerable from what the scene has already established. The
same fitting opened on "How long are you out for?" — out where? The player had
walked into a shop and said fit me for something. Writing the interesting
question first and never supplying its setup produces dialogue that reads as if
a page is missing.

### Plain unless concealing, and the concealment needs a visible motive

People say what they mean. When they do not, there is a reason, and the reason
has to be one the player can identify.

Halloran refusing to name the three people who still make camera cores works,
because he is protecting them and you can see it. A surgeon selling you an
implant and calling it "the unit" twice, without ever saying what it is or does,
does not — he is selling, and vagueness costs him the sale. Vague-with-no-motive
is not a careful character, it is an author reaching for mood.

This is the pragmatics of it: speakers go direct — no hedging, no softening —
when there is urgency, familiarity, or little face at risk. Straight talk is a
relationship, not a vocabulary.

### A generalisation needs evidence, a consequence, or a judgement the speaker owns

> "Back up the road," she says. "People do."

There is nothing in that for the other person to answer. It asserts a fact about
all people, proves nothing, and closes the turn. It became:

> "Back up the road," she says, and marks something. "Fourth one this week."

Which is hers, says she is counting, and can be argued with. Compare "People do
get through. I've seen it twice" — the same construction, earning its keep.

### The five closing moves

All of these end an exchange with a tidy summary the speaker delivers and nobody
contests. They read as authored because a conversation is a joint action in which
neither party controls the shape and the two people want different things; these
are one writer doing both halves.

| Family | Looks like |
|---|---|
| Generalising coda | "People do." · "Everybody does." |
| Antithesis | "That is not X. It is Y." · "X is not the same as Y" |
| Aphoristic closer | "That is the whole of it" · "That is the cost of the place" |
| Explanatory simile | "the way a priest tends an altar" |
| Narration grading itself | "which is how you know it had landed" |

None is banned. The antithesis in particular is defended above, and seven of the
nine in the Long Watch survived review because a character was genuinely heading
off an objection. **The problem is density, not the move.** Five different Watch
characters reaching for the same construction is the house accent, not five
people.

**The line that sorts them: narration grading its own image goes, a character's
judgement stays.** An automated check cannot tell "which is the whole problem
with it" in a description from the same words in a mouth, so it reports both and
a person decides. Narration that scores the picture it has just painted is
saying the same thing twice and the second time is weaker; a character reaching
the same construction repeatedly is a verbal habit and is characterising. Soup
Molly had five, which read as an authorial tic until they were separated: three
are hers and stay, two were the narrator explaining her burns and her tone, and
the image had already done both. A second rule falls out of the same sort:
**never tell the player what they think, know, want or decide** — worst of all
in a room description, which is read cold, out of order, and often by somebody
walking in for the third time in a minute.
[scripts/content/prose-audit-pass.mjs](../../scripts/content/prose-audit-pass.mjs)
holds the twelve that went and the reasons the rest stayed.

### NPCs ask things

59 of the 140 NPCs with a real speaking part have never asked the player a
single question, and the list is led by the biggest parts in the game: Cyrelle
had 6,087 characters of dialogue and not one question mark.

A character who only makes statements is lecturing. Every question should be one
that person needs the answer to in order to do their job — not curiosity about
the player as a character. The Quartermaster's own description has always said
she fits gear with "a long look, **a short question**". She had the long look.

⚠ **A question that justifies itself is a statement with punctuation.** "Can you
carry somebody who has stopped walking? Answer that honestly, because I am going
to plan around it" became "Can you carry somebody who cannot walk?"

### Short turns are a symptom, never a target

Spoken turns measured across the nine public-domain books in `content/books`
(4,898 turns) against our own NPC trees (2,871):

| | median | ≤6 words | ≥40 words |
|---|---|---|---|
| The nine books | 6 | 56% | 8% |
| Architect NPC dialogue | 11 | 36% | 9% |

The long end is fine — 9% against 8%. The whole gap is at the short end: nobody
here says "How long?" or "Left." or "Where?" The fix is **more turns**, not
shorter speeches, and a dialogue tree already has the machinery, because the
player's options are their turns.

⚠ But do not chase the median. Six-word turns are what conversation looks like
when both people already share the context. A tradesperson explaining kit to a
newcomer is exactly where real speech gets longer, because the listener does not
know yet and the speaker can see that. Driving that scene toward the median is
what produced a clipped, expert-sounding fitting that told the player nothing.


### A comparison has to survive being read literally

Added 2026-08-25, after three of these shipped in one session.

Read the vehicle on its own, without the thing it is describing. If it collapses,
it was carrying tone rather than meaning, and it goes.

| Shipped | The problem |
|---|---|
| "They are kind to the people below them, in the way you are kind to weather." | Nobody is kind to weather. You dress for it. There is no moral relationship to invert. |
| "{who} walks back the way an errand walks back." | An errand does not walk. |
| "The top one is the unit the Boulevard would sell you." | Not a comparison, the same failure: a definite article pointing at nothing. |

The replacements are all plainer and all say more: *"They are kind to the people
below them and could not name one of them."* · *"{who} walks back without
hurrying and without stopping."*

The test is mechanical and takes a second, which is why it is worth doing on
every simile: cover the subject, read the rest, ask whether it is true of
anything.

### A place name has to resolve, and be established once

`scripts/docs/place-names.mjs` exists because "the wash" was used eleven times
across six files as if the reader had been down there. It turned out to name four
things — the Long Watch's approach channel, a laundrette on Ironside Street, an
Exodus wash house, and Ferric Wash, a redrock district in the Scarletwastes.

Two separate requirements, and passing the first does not give you the second:

- **It resolves.** Some zone actually has that name. The check will tell you when
  several do, and which families they are in.
- **The reader can resolve it.** Somebody with a reason to explain it has said
  what it is, once, before the prose starts using it as shorthand. Pike now does
  this for the Outfall in four sentences.

⚠ **Dry-run any rename sweep and read the misses.** The first pass at this one
would have replaced every instance of "the wash" with a street name, which would
have broken the Watch's own geography — their observation post exists to look
down that channel. The misses are where the assumption is wrong.

### Writing an order you disagree with

The Ascendants are authoritarian, contemptuous of freedom, corrupt and certain of
their own superiority, and no character in this game will ever say any of that.
The three rules that make it work are already on this page, from the library:
give the enemy a sincere ethic and never let them doubt it, let a voice convict
itself, and give the monster the good speech and no rebuttal.

In practice that means they never argue for authority. They assume it and move
on to something else, and the assumption is what the player is left holding.

> "Oh, nobody here decides anything difficult. Where you live, what you do, when
> you stop working, who looks after you when you cannot. All of it settled on the
> day your account opens." — Vess, delivering good news

Three moves that carry more than an argument would:

- **Praise the unfreedom directly**, as a kindness, and mean it. Zamyatin's
  narrator calls dancing beautiful *because* it is unfree.
- **Put the excess in a maintenance figure.** The Gallery draws more power than
  Meltwater Row, and the person saying so has stopped hearing it as a number.
- **Never let the vocabulary be the plain one.** Not sacked, *the account was
  closed*. Not surveillance, *service coverage* — so a district that loses it is
  *uncovered*, which is a thing that happens to people rather than a thing anyone
  does to them. The Watch are not criminals. They are *uninsured*.

⚠ Disagreement is never treason out loud. It is a referral: "You are unsettled.
That is very normal in the first fortnight… I will put you down for a session
with somebody kind." A regime that has to threaten you has already lost the
argument it thinks it is winning.

### The tools

Both are reporters, not gates, and neither is wired into `docs:lint` — every
pattern they look for has legitimate uses.

| | |
|---|---|
| `scripts/docs/dialogue-audit.mjs` | Scores all 140 speaking NPCs on the closing-move families, unnamed referents, hedging and whether they ever ask a question. Gives a reading order, not a verdict. `<npc_id>` for one NPC with its lines. |
| `scripts/docs/place-names.mjs` | Colliding names, shorthand a reader cannot resolve, and names nobody explains. Filters three classes of non-problem: generic interior labels, facade-plus-interior pairs, and multi-tile streets. |


## What the outside says

Added 2026-08-25 from published craft guidance rather than from the library.
**Every rule below was measured against the game's own text before it was written
down**, because a rule nobody is breaking is not worth the space and a rule
everybody is breaking is the most useful thing in this document. Three turned
out to be things we already do, and they are recorded as settled rather than
aspirational. Three are genuinely new.

### Tested against the game, then written down

**Filter words.** The standard advice is that sensory verbs put a pane of glass
between the reader and the scene: *she saw the cat dart under the table* holds
you further back than *the cat darted under the table*
([Scribophile](https://www.scribophile.com/academy/an-introduction-to-filtering),
[The Writer](https://www.writermag.com/improve-your-writing/writing-education/remove-filters-fiction-writing/)).
This matters far more in a MUD than in a novel, because everything is addressed
to "you" and the construction is always available. **Measured across every string
in zones, items, furniture and enemies: 10 distinct uses, 21 in total**, and each
one is doing a job the plain version could not. "You can see where it tops out"
is a sightline. "You can smell it from the gate" is a distance. "You can hear
your own pulse in here" is a room's acoustics, and "you can hear your own
swallowing" is the body becoming audible, which we do on purpose. "You feel bad
about it for approximately three seconds" is a joke about killing a dog, and it
needs the filter to land. Left alone; the rule is in the audit so the *number*
stays roughly where it is.

**Speech tags.** Elmore Leonard's third and fourth rules: use *said*, and never
hang an adverb off it ([fs.blog](https://fs.blog/elmore-leonard-10-rules-of-writing/)).
**Measured across 329k characters of dialogue: five adverbs and zero exotic
speech verbs** — nobody in this game barks, hisses, retorts or expostulates. Two
of the five describe how the *player* asked rather than tagging a line at all.
The other three survive on a distinction Leonard's rule does not make: *"says
flatly"* and *"says eventually"* report delivery and timing, which the words
themselves cannot carry, whereas the adverb he objects to supplies an emotion
instead of earning it. *"says pleasantly"* is the closest to the line and stays
because the pleasantness is at odds with what is being said, which is the point
of the sentence.

**Never tell the player their own mind.** Palahniuk's version is to ban thought
verbs outright — *thinks, knows, realises, wants, remembers* — and make the
reader do the knowing
([LitReactor](https://litreactor.com/essays/chuck-palahniuk/nuts-and-bolts-%E2%80%9Cthought%E2%80%9D-verbs/)).
For us it is sharper than a style preference, because the second person makes it
a claim about somebody who is sitting right there and may disagree. **Three real
violations, all of the same kind and all now fixed**: an armchair that said *"You
decide not to investigate"* about a lumpy cushion, a shop where *"You decide not
to look"* at a price tag, and five tiles of the Thornwarren trophy road where
*"Somebody has painted the rock. You decide not to work out what with."* Each one
takes a decision away from somebody who might have made the other one, and each
is stronger without it — the rock now reads *"Not with paint."*

⚠ **Two carve-outs, and the second is the interesting one.** `zone_the_lattice`
keeps *"You have never seen a holosign. You know, without being told, exactly how
to read it"* — that is the vat-born player's actual condition and the line is
about the wrongness of knowing. And **every dream is exempt**: nine of the first
twelve hits were `dream_templates`, and a dream is the one surface where the
narration legitimately owns the player's mind, because it *is* the player's mind.
"You remember every one being applied" is the mechanic, not an overreach.

### Genuinely new

**Psychic distance, and why ours cannot move.** Gardner's idea is a dial running
from the most exterior, impersonal report of events to the most interior
experience of them, and his practical advice is to change it one step at a time
so the reader is carried rather than jolted
([UNR](https://www.unr.edu/writing-speaking-center/writing-speaking-resources/psychic-distance-in-creative-writing),
[Stanford](https://teachingwriting.stanford.edu/psychic-distance)).

⚠ **The gradual-shift half of that advice does not transfer, and assuming it does
is the trap.** A novel controls the order you read paragraphs in. We do not: a
player walks into a room cold, may `look` twice, may not have been in the
previous room, and reads our surfaces in an order we never chose. There is no
run-up in which to close the distance.

So the Architect version is: **pick one distance per SURFACE and hold it.** They
are already stratified and it is worth naming what they are.

| Surface | Distance | Why |
|---|---|---|
| Room and item description | Far. Exterior report, no interiority at all | It is read by everyone, repeatedly, in any order, and must not presume a mood |
| Objective lines | Middle. What you are doing, stated plainly | A instruction that got poetic would stop being an instruction |
| Quest emotes | Close. Your hands, your four seconds of deciding | They fire once, in sequence, at a moment we chose |
| Dialogue | Closest. Somebody is talking to you and watching your face | The only surface with another person in it |

Second person and present tense are the house default and are the standard for
the form ([TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/Main/InteractiveFiction?from=Main.TextAdventure)),
which is also why the filter-word rule above bites harder here: the grammar is
already as close as it goes, so a filter verb is pure loss.

**Rhythm is the second job of a sentence, after being clear.** Le Guin puts
sentence *sound* on a level with sentence sense, and says the largest lever on it
is plain length — that varying sentence length is how the prose gets its pace,
and that flat, choppy or droning writing is a fault of sound before it is a fault
of meaning ([Steering the Craft](https://www.ursulakleguin.com/steering-the-craft)).
Worth having explicitly, because everything else in this document pushes toward
cutting, and a page of uniformly short declaratives is its own kind of bad. The
Watch's voice is the place to watch for it: no em dashes and no subordination
already, so nothing but length is left to vary.

**And the distance rule earned its place immediately.** It had never been tested
on anything, having been invented three paragraphs earlier. Run against 17,259
zone descriptions it found exactly one defect — the records office, where *"You
get the sense it has been waiting a very long time to be filled"* both filters
and mind-reads in four words, and is stronger asserting it outright. It also
flagged `zone_citadel_hall`, *"A hall built to make you feel small and largely
succeeding"*, which stays: that is a claim about what the architecture was for,
and "largely" declines to finish the claim about you.

**A rule tested against your own work is worth ten rules admired.** That is the
real content of this section. Measuring turned up four genuine defects in ~20,000
entries and stopped three other rules from being written as corrections when they
were already habits — and, twice, the measuring itself was wrong before the game
was. `player-mind` run unscoped produced 87 hits that were almost all NPCs
talking to you, and `claudish-vocabulary` flagged twelve correct uses of
"load-bearing" before it was cut back to the guides. **A rule that has not been
run is not knowledge about your own writing. It is a quotation.**

### A second pass, and one rule that could not be tested

Added later the same day. Three more sources, and the third is the useful one
precisely because it *failed* the test this section is built on.

**Chekhov's gun, and the exact form it takes here.** The principle is that a
detail the story draws attention to is a promise, and an unfired gun on the wall
is a lie about what mattered
([Britannica](https://www.britannica.com/topic/Chekhovs-gun),
[Scribophile](https://www.scribophile.com/academy/what-is-chekhovs-gun)).
In a novel that is about plot economy. **Here it is mechanical**, because bolding
a word in a room description is this game's convention for *this is a thing you
can type*. A bolded direction that is not an exit is a gun that cannot be fired:
the player types it, gets nothing, and learns to distrust the bold everywhere
else.

⚠ Zones carry **no scenery field** — the only examinable things in a room are
furniture, items, NPCs and exits — so the strict version of the rule would flag
every noun in every description and be useless. The version that is worth having
is the narrow one, and it is checkable: **every `<b>direction</b>` in a
description must appear in that zone's `exits`.** Measured across 17,259 zones:
28 bold a direction, **two were broken**, and both are now fixed. The street
outside Solenne Residences said "Step **in**" when the way into the lobby is
*north*; the lobby bolded **out**, which is not a command, while *south* — which
is — sat unbolded in the same clause. `scripts/content/prose-broken-directions.mjs`
re-sweeps the whole tree on every run.

**Subtext: nobody says the thing.** People talk around what they mean, especially
when it matters, which is why an entire Hemingway story about a decision never
names the decision
([Helping Writers](https://www.helpingwritersbecomeauthors.com/subtext-in-dialogue/),
[Medium](https://medium.com/swlh/writing-subtext-in-dialogue-448b1d3884f2)).
Not enforceable, but worth naming, because the best scene in either order ladder
is built entirely on it: **the Quartermaster's purse**. She hands you money and a
shopping list, mentions that the clinic on the same street will fit you anything
you like while you wait, and never once says *do not buy chrome*. She has never
said it to anybody, in twenty years of handing out that purse. The test is
invisible because the sentence that would have named it is missing.

**And one that resisted testing, which is the finding.** Vonnegut's third rule is
that every character should want something, even if it is only a glass of water
([Gotham Writers](https://www.writingclasses.com/toolbox/tips-masters/kurt-vonnegut-8-basics-of-creative-writing)).
Excellent rule. **Three attempts to measure it against 249 NPCs produced 84, then
26, then 15, and the third number is still wrong.** The count kept collapsing
because an NPC's voice can live in at least six places: `dialogue_tree`,
`banter`, `chitchat`, `flags` (Captain Nguyen's lines are in
`flags.wrangle_lines`, because he is a studio guest), broadcast scripts, and
quest scripts. The final list of fifteen still contained **Cathode**, who is a
cat, and several people whose entire performance is authored in `.bsm`.

⚠ **So this rule is held, not enforced, and the doc says so rather than shipping
a number.** That distinction is worth keeping as you add rules here: some can be
made into a check that fails loudly, and some can only be believed. A rule in the
second category written up as though it were in the first is worse than no rule,
because the next person will trust the count.

### Withhold the meaning, never the facts

Vonnegut's eighth rule is to give the reader as much information as possible as
soon as possible — he wants them to understand the scene so completely they could
finish it themselves. Read quickly, that is the opposite of half this document:
*trust the reader to supply it*, *withhold the description*, *answers that evade
tell the reader more*.

It is not the opposite, and the distinction matters enough to write down, because
a careless reading of the rules above produces coy, muddy prose that thinks it is
being restrained.

**What gets withheld is the meaning. What never gets withheld is the fact.**
Forster gives you four big stars in an oblong with three hanging beneath and
withholds only the word *Orion* — every fact is on the page and the reader
assembles it. Wells's guide withholds the explanation and hands over the number:
*fourteen*. Halloran will not give the names but says *three*. In each case the
reader ends up with more information than a plain telling would have given, not
less; what they are denied is the author's interpretation of it.

The failure mode this rule guards against is the scene that is mysterious because
the writer has not decided what happens in it. If a room is dark, say so, say how
dark, and say what that costs — and do not say how the player feels about it.

### A third pass: the genre's own rules

Added 2026-08-25. The three passes above are general fiction craft. This one is
**science fiction and dystopia specifically**, which turns out to matter, because
the SF workshop tradition names failure modes that general craft advice has no
word for — and a MUD in this setting is exposed to almost all of them. The main
source is the [Turkey City Lexicon](https://interglacial.com/pub/text/Turkey_City_Lexicon.html)
([SFWA's copy](https://sfwa.org/2009/06/18/turkey-city-lexicon-a-primer-for-sf-workshops/)),
Shiner and Sterling's workshop vocabulary.

Same discipline as before: measured first, and what the measuring said is written
down whether or not it flattered us. **Four came back settled, one came back with
real defects, and two are held rather than enforced.**

#### Settled — already how we write

**Call a rabbit a rabbit.** The lexicon's *Call a Rabbit a Smeerp* is renaming an
ordinary thing to make it sound exotic without changing what it is. A cyberpunk
setting is the natural home of this: it is very easy to write a bar as a
*hydration concession* and think something has happened.

Measured against the 38-drug roster. **Every drug that exists in the real world
keeps its real name** — ibogaine, toluene, ether, DMT, mescaline, psilocybin,
pseudoephedrine, nitrous, alcohol, cigarettes. Every coined name is attached to
something that has no real referent to borrow: Memhack, Glasshollow, Coldfire,
Redline, Static. The line the game already draws is the right one, so it is worth
stating as a rule: **a new word is earned by a new thing.** If the real word
would have been accurate, the real word is stronger, and it also means a player
who already knows what toluene does gets to know it.

**The door dilated.** Heinlein's technique is to state the strange thing flatly
and move on — no explanation, no wonder in the narrator's voice — which tells a
reader they are somewhere else more efficiently than a paragraph about it could
([TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/Main/DilatingDoor)).
Measured across zones, items, furniture and enemies for the explaining
constructions: *which is a*, *a kind of*, *so-called*, *essentially*, *a device
that*, *in other words*. **One hit in the whole tree, and it is a joke about
municipal honesty, not an explanation of a machine.** The game never stops to
tell you what its own hardware is. Settled, and it is why a lot of the prose
works.

**Used Furniture.** The lexicon's term for a background hired out of Central
Casting rather than invented. The cyberpunk stock cupboard is very well known and
very close to hand here. Measured: **mirrorshades 0, katana 0, samurai 0,
megacorp 0, cyberdeck 0, black ice 0, trenchcoat 0, rain-slick 0, jacked in 1,
noodle 3, neon 16.** `chrome` runs to 49 and is not a hit — it is this game's own
mechanical term for an augment, which is the opposite of borrowed furniture.
Coldwater is its own place. Nothing to fix; the numbers are here so the next
person can re-run them and notice if that stops being true.

**Say what the system does to a Tuesday, not what the system is.** The lexicon
calls it *The Edges of Ideas*: the way out of exposition is to write how the
background changes people's lives rather than how it works. The dystopia guidance
arrives at the same place from the other direction and calls it a day in the life
([MasterClass](https://www.masterclass.com/articles/tips-for-writing-a-dystopian-fiction-novel),
[Jericho Writers](https://jerichowriters.com/how-to-write-a-dystopian-story/)) —
a world reads as real when it is shown through an ordinary routine inside it
rather than explained from above. This is already the rule the Thornwarren was
built on (**the terror is on the approach, the inside is domestic, and nothing
ever remarks on the difference**), and the gate masks being quilt-lined so they
do not chafe on a long shift is the whole technique in one detail. Recorded here
so the reason survives outside the one doc it happens to be written in.

#### The one that found something

**White Room Syndrome.** The lexicon's name for a setting with no detail in it,
which it treats as a sign the author's imagination has not started yet. It is
worse in a MUD than in a novel, because a room description is not an opening
paragraph the reader passes through once — it is the entire object. A featureless
room is not a slow start; it is a room that does not exist.

Measured across 17,259 zones for descriptions that are both short and contain no
material noun at all. **54 hits, and every one is machine-generated.** Thirty-five
are `An empty place.` — the district-wasteland tiles, a known structural defect
rather than a prose one. The other nineteen are building-generator stubs:
`The face of The Cherry Pit.`, `The face of Precinct 9.`, `Basement of Embassy
Hotel & Bar, Lobby.` **Zero hand-written rooms failed.**

⚠ **So the finding is not that we write white rooms. It is that our generators
do, and a generated stub is indistinguishable from a finished room to the player
standing in it.** A facade is one of the most-read surfaces in the game — it is
what a player sees every time they walk down that street — and eighteen of them
currently say nothing at all.

The same sweep over items is worse: **154 of 709 items have no description
whatsoever**, including `basic pants`, `battery`, `canteen` and the whole
liquid-chrome evening-wear set. `examine` on those returns nothing. Neither
backlog is fixed here — they are content debt rather than rule violations — but
the rule that falls out of them is worth having, and it is checkable:

> **A surface a player can `look` at or `examine` must contain at least one
> physical fact.** Not a mood, not the name restated — a material, a temperature,
> a noise, a piece of wear. A generator that cannot supply one should not be
> emitting prose at all.

#### Held, not enforced

**Brand Name Fever.** The lexicon objects to a brand name used *alone*, standing
in for detail rather than carrying it — the name doing the work the described
object should be doing. The game leans hard on invented brands (Ferris Model 9,
Zenith Searmaster, Everstock Rattlecan, Cachet Vantage 900) and that is one of the
best things about its texture, so the only question is whether the names arrive
with anything attached.

Measured, and then the measurement was thrown out: 233 flagged, and reading them
showed the detector was wrong rather than the prose. *"A boxy polymer service
pistol with all the personality of a kettle"* and *"held together with spray-paint
and spite"* were both counted as bare names by a regex looking for the wrong
words. **One real class survives: six media cassettes described as `A media
cassette labeled "X"`,** which is the name and nothing else.

⚠ Recorded the way the Vonnegut rule above is recorded — **held, not counted.**
Whether a brand name is doing work or standing in for work is a judgement, and
shipping a number for it would be shipping a wrong number. The rule to carry is
the plain one: **a brand name is a detail's companion, never its replacement.**

**The regime's own euphemism.** Newspeak is the most-copied idea in the genre and
the copies are usually bad, because the invented vocabulary gets handed to the
narrator. The useful half is narrower: **institutions describe what they do in
language designed not to describe it**, and the reader does the arithmetic
([Britannica](https://www.britannica.com/art/newspeak),
[Wikipedia](https://en.wikipedia.org/wiki/Newspeak)).

Measured across the tree for institutional-euphemism vocabulary — *processing,
compliance, relocation, reassignment, non-compliant, decommission, reclamation,
pacification, containment, surplus population*. **88 occurrences across 44 files,
concentrated almost entirely in `media_broadcasts`.** That is the right answer and
it happened without a rule: the euphemism lives where an institution is speaking,
and the narration does not talk like that.

So this one is a boundary rather than an encouragement: **euphemism belongs to
voices, never to narration.** A broadcast, a police recording, a corporate sign
and an Ascendant may all say *reclamation*. A room description says what is
actually happening in the room. ⚠ It cannot be automated, because the check is not
whether the word appears but who is holding the microphone.

## Auditing the game's own prose

[scripts/docs/prose-audit.mjs](../../scripts/docs/prose-audit.mjs) scans every
player-facing surface — quests, items, zones, NPC dialogue, glossary, furniture,
enemies, drugs, recipes, dreams, the four HTML guides and the comic books — for
the tics named above, deduped by distinct phrasing so one shared line across 400
tiles reads as one job with a blast radius rather than 400 problems.

It is a **reporter, not a gate**, and is deliberately not wired into `docs:lint`.
Every pattern it looks for has legitimate uses, and the first run proved it:

- **`load-bearing` was flagged twelve times in the fiction and was right every
  time** — a collapsing building, a load-bearing *vest* (real webbing kit),
  "her smile is load-bearing", "the char is load-bearing now", a mutant's extra
  limb. The Claudish objection is to the word as a lazy abstraction in technical
  prose, not to a word meaning what it says. That rule and `widened-claim` are
  now scoped to the guides only.
- **`note that` matched "a sweetish chemical note that you stop noticing"** on
  fifteen tiles, and `surfaces the` matched "below the surface the light goes
  green" on four hundred. Both needed the word class pinned down.

**The distinction the fixer turns on: cut the clause when it RESTATES, keep it
when it ADDS.** "They smoulder rather than burn, which is the entire point of
them" is the image explaining itself and the clause goes. "The liners come out
to dry, which is the entire difference between a good boot and trench foot"
tells a player something the image does not, so it stays — but as its own
sentence, asserted rather than smuggled in as an explanation. Three kinds of hit
were left alone entirely: **jokes** (carve-out 2 below — a steam hood venting
onion smell into the street "which is the entire advertising budget"), **spoken
dialogue** (people talk in this construction constantly, and several NPCs are
characterised by it), and **clauses stating a cause** rather than a meaning.

**Widened 2026-09-04, and the gap was the interesting part.** The first version
read fifteen content surfaces. It never read mutations, augments, ambient
routines, global ambient events, banter threads, districts, regions, incidents,
orgs, crimes or MIS fit lines — and, far more importantly, it never read a line
of **code**. Hunger, thirst, cold, exhaustion, injury, drug and refusal messages
are string literals in `server/` and `plugins/`, not rows in `content/`, so the
prose a player sees most often was the prose nothing had ever audited. The
`code` surface strips comments, then takes literals over 24 characters that
start a sentence. It covers 371 files and it is noisy on purpose: the audit is
still a reporter.

Two scoping decisions came out of that run. `code` is a **narration** surface —
a hunger message is narration that happens to live in a `.js` file — but
`server/engine/npc-personality.js` and `plugins/gossip/templates.js` are full of
speech, so `player-mind` hits there are false positives and stay. And **a status
message reporting the player's own body is not a filter word.** "You feel
dangerously cold" is the whole content of the message; there is no scene for the
verb to stand between the reader and. The same goes for a mutation describing a
new sense ("You can see who is alive through a wall"), and for ambient sound
cues, where `You hear` is what marks the line as something heard rather than
seen. Those three families are the bulk of `filter-word` on the new surfaces and
none of them is a defect.

The first pass cut 44 distinct phrasings across 78 files and left 18 on purpose.
[scripts/content/prose-trim-asides.mjs](../../scripts/content/prose-trim-asides.mjs)
is the record of which was which, and is idempotent so it stays readable as one.

**Swept again 2026-09-04, and this time the clause was not the whole problem.**
`explaining-aside` only ever matched the tell written as a TRAILING CLAUSE — it
needs a comma and an "and"/"which" — so the identical move written as its own
sentence had never been read. "That is the whole argument for it." after a full
stop was invisible to the audit for as long as the audit existed. Three rules
closed that: `aphoristic-closer` (the sentence form), `stock-simile` ("the way
you look at a clock", "and it shows" — each fine once and a tic by the eleventh),
and `absence-list` ("No range, no hob, just a convection unit"). Four surfaces
were added at the same time and were where most of it lived: `media_broadcasts`,
`drug_transforms`, `drug_reactions` and `aircraft_types`, none of which had ever
been scanned.

The sweep found 134 strings across 96 files and rewrote all but five. **Two
earlier "left alone" decisions were reversed on instruction**: the steam-hood
joke ("which is the entire advertising budget") and the snow-boot liners now
read without the construction, because the standing rule is now that no two
pieces of prose should share a shape, jokes included. What stayed: Auggie
Prine's "That is the real reason" (a callback to the line before it, which is
the sentence doing work rather than explaining), Molly's "the only review I have
ever wanted", and two similes kept as the one permitted use each.

It also caught a template problem no per-file read could: **"The quiet is not the
absence of noise. It is the absence of anything that would make one." was on 1,900
ash tiles**, and "reads as exactly what it is" on 180. One authored line, one
find-and-replace, 2,080 files. A repeated sentence is one job with a blast radius,
and the corpus is the only place the repetition is visible.

## Architect carve-outs

The spec was written for technical prose. Three things here are voice, not
Claudish, and survive a rewrite:

1. **Em dashes stay an Ascendant tell.** The existing rule stands — em dashes
   mark Ascendant and Architect voices and appear in no other dialogue. Don't
   remove them from those voices for reading plainer, and don't add them
   elsewhere for rhythm.
2. **Flavour lines that are jokes, not summaries.** The guides end on lines like
   "take a coat". That is a closing joke, not an aphoristic restatement of the
   paragraph above it. Aphorisms that restate go; jokes that add stay.
3. **This repo's docs deliberately front-load rules with their reasons.** The
   "⚠ this exists because X broke" pattern in [CLAUDE.md](../../CLAUDE.md) and
   the `systems-*.md` docs carries real history. Compress the wording, keep the
   reason.

## A place name must mean one place

Every settlement builds a mess hall and a workshop, so four Long Tables and
three Benches across four regions is realistic — and unnavigable, because the
map and the GPS both print a name and expect it to resolve. `npm run` the
[place-name checker](../../scripts/docs/place-names.mjs) and it reports two
different things under one heading. Only one of them is a fault.

**A collision is two unrelated places with one name.** Fourteen of those were
fixed by keeping the name on whichever side it fits better and taking the new
name out of the losing tile's own description, so nothing has to be
re-established: eleven different tables really is what that room is made of, and
the tools at Terminus really are each on their own painted outline. A rename
runs over a name **and** an id prefix, never one id — a landform name covers a
block, and The Bare Mile alone was 327 tiles.

**A facade and its interior are one place and are not a collision.** The checker
filters that pair when exactly one grid tile claims the name as a building, so
anything deliberately built as `building_type` and nothing else — the
Thornwarren wall, for the reason in
[scarletwastes.md](../proposals/scarletwastes.md) — will keep showing up and
should be left alone.

**The softer finding is shorthand.** 72 phrases like "the yard" and "the lane"
sit in prose where several yards and lanes exist. Most are fine, because the
speaker is standing in the one they mean. It is worth reading when a name is
used somewhere the reader has not been.

## An exit must not swallow an answer

Eleven NPCs had a `bye` node with a real last line on it that no option anywhere
reached, so the line had never been read by anybody — the conversation ended by
the player closing the panel. Each wants one exit option, written in that
character's register and deliberately not stepping on the line it leads to:
Boedeker's joke about not making paperwork of yourself is his to make, so the
option that reaches it is flat.

⚠ **Do not save an option by repointing one that already does something.** Sloat
had "Nothing. Just looking.", and aiming that at `bye` looked tidier than giving
him a second leave. It moved the orphan instead of fixing it: that option was
the only way to reach the node where he tells you looking is free and has always
been free. Two exits are cheap. A lost answer is not.
