# One funnel for everything an NPC says

Status: phase 1 built (the funnel, tags and mood rules, `formatChitchat` and banter on it, the client reading the line's mood); phases 2 to 5 are design.

An NPC speaks through about forty separate code paths today. `formatChitchat` in `server/engine/ai-behaviour.js` formats chitchat, banter, home talk and a dozen plugins' lines. Parley, dialogue, remarks, battle cries, panic shouts, wake lines, vendor closing lines, burglary alarms and the bodily plugin's shouts each build their own `<span class="speech-line">` by hand, and some of them send a `zone_event` that isn't speech at all, so the client never voices it. The client's whole contract is a string pattern: `speech-line` and `Name says,`.

That was fine while a line was only text. A line now also has a voice, a mood, an effort and a face ([delivery.md](delivery.md)), and those have to be decided once, the same way, for every kind of line. So every NPC line goes through one function, and what kind of line it is becomes a label on it, not a separate path.

## The funnel

`server/engine/npc-speech.js`, engine code beside `npc-mood.js`:

```js
npcSay(npc, line, { kind, to, zoneId, verb })   // -> the message to send, or null
```

- `line` is the content string as authored, tags and all (below).
- `kind` says what sort of line it is: `chitchat`, `banter`, `home`, `remark`, `parley`, `dialogue`, `greeting`, `battle`, `alarm`, `wake`, `vendor`, `panic`, `routine`, `tv`. It goes on the message, so a plugin, the log or the client can tell them apart without parsing the words, and the speech rules can differ by kind (a battle cry is loud; a remark is to one person).
- `to` is the person spoken to, if any, for "says to you".
- `verb` is `says`, `yells`, `whispers`, `mutters`. It sets the effort, as npc-bubbles.js does from the text today.

It does, in order:

1. **Reads the line's tags** and strips them, so no player ever sees one.
2. **Decides the mood** it's said in (below), and sets it on the NPC with `setNpcMood` if it's new, so the face changes with the voice.
3. **Formats it** as one shape: `<span class="speech-line" data-kind="banter" data-mood="sad:0.5" data-effort="0">Name says, "..."</span>`. An action line (`*leans back.*` or a line that isn't one quoted span) stays an emote, as `formatChitchat` does now, with the speech part, if any, in its own span.
4. **Returns the message**; the caller still sends it with `broadcast`, `sendToZone` or `sendToPlayer`, so who hears it doesn't change.

`formatChitchat` becomes a one-line wrapper over it, so its callers move first and for free. The rest move one source at a time; nothing has to move at once, because the client reads the old shape as it does now and the new attributes only when they're there.

## Tags on a line

A line in any content (a banter turn, a parley reaction, a chitchat pool entry, a dialogue node, a JS table) can start with a mood tag:

```
"@sad \"I used to come here with my brother.\""
"@annoyed|tired *keeps pouring.* Make it quick."
```

- No tag: the line has no mood of its own. **That's most lines, on purpose.** Most of what people say in passing is relaxed and plain, and it stays that way.
- One mood: the line only makes sense in that mood.
- Several, `|` between them: any of these fits; the funnel picks one at run time.

Only the moods in `EXPRESSIONS` are valid, and `content:lint` fails a tag that isn't one, or a tag on a line the funnel doesn't read yet.

## Deciding the mood: consistency first

A sad person doesn't start talking happy because the next line in their pool was cheerful. The NPC's mood is the authority, and a line's tag is a suggestion. In order:

1. **They already have a mood** (`npcMoodOf`: a transient one, or their base `flags.mood`): the line is said in that mood, whatever its tag says. A happy line from a sad person comes out sad.
2. **They have none, and the line has a tag:** the line sets it. With several options, the pick is random, from the NPC's id and the hour, so the same person picks alike for a while and two people in the same scene don't all pick the same. It's set as a mild mood (0.5) for a few minutes, so their next lines, tagged or not, carry on in it.
3. **Neither:** plain and relaxed.

Changing a mood is a lever, never a side effect of the next line: being hit, `smile at`, being woken, `SET_MOOD` in a dialogue node or script, and any event that calls `setNpcMood` with `force`. A line can carry a lever on purpose with a second tag, `@!happy`, for the turn in a scene where somebody cheers up; the `!` means "this changes their mood", and it's rare.

A banter thread is one scene: the funnel treats a thread's speakers as each having their own mood, settled on their first tagged line, and holds it to the end of the thread.

## The kinds, kept apart

One funnel doesn't make them one system. Each kind keeps its own content, its own picker and its own pacing: banter threads stay threads, parley stays a parser over `flags.parley`, dialogue stays a tree. What they share is how a line becomes speech. The table of kinds in `npc-speech.js` holds only what differs in the saying:

| kind | default effort | spoken to | notes |
|---|---|---|---|
| chitchat, routine, home | 0 | the room | the relaxed majority |
| banter | 0 | the room | a thread holds each speaker's mood |
| remark, greeting | 0 | one person | "says to you" for them, "says to Name" for the room |
| parley, dialogue | 0 | one person | the line also goes in the dialogue frame, with its mood |
| vendor, wake | 0 | the room | wake sets annoyed or confused, as now |
| battle | 1 | the room | |
| alarm, panic | 2 | the room | today some go out as `zone_event` and aren't voiced |
| tv | 0 | the set | broadcast keeps its own channel; listed so the mood syntax is the same |

## The client

`npc-bubbles.js` reads `data-mood` and `data-effort` off the span when they're there and passes them to the voice as `delivery`; without them it falls back to the face's mood (`npc:place`) and the verb, as phase 1 of delivery.md does now. The Stage gets the same values on `npc:voice`, so the face and the voice agree on the line, not just on the NPC.

## Authoring

Tag a line only when its mood is clear from the words. When two or three moods would fit, list them. When none is clear, leave it. A first pass over the content tags the lines whose mood is obvious (a grieving banter thread, a parley `hostile` greeting, a wake line); the tagging is reviewed as content, file by file. The house voice gets one rule: most NPC lines are relaxed and carry no mood.

## Phases

1. `npc-speech.js` with tags, the mood rules and the one format; `formatChitchat` over it; the client reading the attributes. A regress check per rule: a mood wins over a tag, a tag sets a mood that sticks, a lever changes it, an untagged line from a moodless NPC is plain.

   *Built (2026-11-24).* [npc-speech.js](../../server/engine/npc-speech.js) is `npcSay`, `readTag` and `moodForLine`; a line's mood lasts 4 minutes at 0.5 (`LINE_MOOD`). `formatChitchat(name, line, { kind })` is a wrapper over it and takes the NPC itself or, as its older callers pass, a name, looked up among the NPCs (names are unique). Banter passes the NPC and `kind: 'banter'`; every other `formatChitchat` caller is `chitchat` until it says otherwise. [npc-bubbles.js](../../client/game/js/panels/npc-bubbles.js) takes `data-mood` and `data-effort` off the line before the face's mood and the line's wording; a verb (yells, whispers) still wins on effort. Regress layer 1i0 holds each rule. Nothing in content is tagged yet.
2. Move parley, dialogue and remarks onto it.
3. Move battle cries, panic, alarms, vendor and wake lines; the `zone_event` shouts become speech.
4. The tagging pass: banter threads (292 files), parley (26 NPCs), chitchat pools and the JS tables, clear cases only.
5. `content:lint` for tags, and a list of NPC lines still built outside the funnel, which should reach zero.

## Risks

- **A tag shown to a player.** Any path still outside the funnel would print `@sad`. Phase 5's lint fails a tag in content no funnel path reads; until then, only tag sources that have moved.
- **Moods that stick too well.** A mild mood from a line lasts minutes, not the day. Tuned by playing.
- **Forty call sites.** Moved one source at a time, each with its regress; the old shape keeps working throughout.
