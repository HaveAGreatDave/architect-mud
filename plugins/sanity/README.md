# sanity

**Purpose** — the slide into madness. Deliberately built to be **scarier than a drug trip**: not colourful, just wrong. Dread escalates as sanity falls, in three bands.

## The bands
- **25–49** — a creeping cold vignette, a dread bed under the audio, and misperception whispers.
- **below 25** — room-filling **phantom hallucinations**, through the shared phantom registry (the same one **trip** uses, so they compose rather than fight).
- **0** — an incapacitated **insane** state, which the engine's substrate gate reads to scramble your commands.

## Hooks
- `tick.minute`

## Commands
None — sanity is something that happens to you.

## The valve
Climax grants +10 sanity (see **mis**), which is the system's one genuine relief path.

## Voices — the symptom that lies to the interface

Every other hallucination announces its channel. A whisper arrives as `.msg-dread` (dim red,
italic, glowing); a phantom is a person who turns out not to be there. Both are legible as
unreal the moment you know the game — fine for dread, wrong for madness, because the whole
subjective fact about losing your mind is that it doesn't feel like losing your mind. It feels
like the room said something.

[voices.js](voices.js) emits through the **exact** wire format real speech uses:

| | real | forged |
|---|---|---|
| NPC | `formatChitchat` → `{type:'output', message:'<span style="color:var(--yellow)">NAME says: "TEXT"</span>'}` | identical |
| player | `cmdSay` → `{type:'say', message:'HANDLE says: "TEXT"'}` | identical |

Inline style attribute, **not** a class. Quotes inside the span. No speaker id, no data
attribute, nothing added. `sendToPlayer` is a unicast over the same `broadcast()` a room
message uses and carries no zone, so the payload is indistinguishable from one the whole room
got. Player speech renders via `appendMsg` (textContent — no markup could leak a tell) and NPC
speech via `appendHtml` into the same `msg-help` wrapper a real line lands in.

**The only tell is out of band**, and that's the mechanic: the named speaker may not be in the
room pane, and `who` will disagree with you. A player who suspects can check. A player who
doesn't finds out the hard way.

Two rules keep it fair rather than merely confusing:

- **It never invents a speaker.** Misattribution uses somebody genuinely standing there — the
  person is real, the sentence isn't, which is both the most unsettling version and the most
  checkable. Disembodied voices use a real NPC who is provably elsewhere.
- **The unverifiable version comes last.** See the ladder in
  [systems-survival.md](../../docs/systems-survival.md).

⚠ **If `formatChitchat` or `cmdSay` ever change shape, these must change in the same commit.**
`regress-voices.js` asserts the forgery against the real formatter's output for exactly this
reason — it is the only thing standing between an innocent tidy-up and a silent tell.

## Dissociative episodes — the bottom rung

Sanity below **7**: the voices failed you, then the people, then the room, and this is what's
left. The room stops being anywhere at all and you go somewhere your mind has made instead.

It reuses the **sleep** machinery deliberately, down to the `dream` templates, because a
dissociative episode and a dream are the same place — and building a second one would mean a
second set of wake paths to leak through. The mind/body split is identical: `current_zone`
becomes the dreamscape, but the player is **never removed from the real room's occupant set**,
so the body stands there vacant — visible, lootable, killable, exactly as a sleeper's is.

Rare and self-limiting on purpose: 6 %/min past the threshold, a 12-minute cooldown, and an
episode of 1–2½ real minutes. An episode you cannot act through is powerful exactly once per
stretch of play; a system that fires it every few minutes is one players learn to log out of
rather than to fear. **Never in combat** — a fight you can't act through is a death sentence
handed out by a dice roll, which is cruelty rather than horror. Never while asleep.

### The wake paths are the whole risk

A missed one strands a player in a zone that gets deleted under them, and the symptom is a
character who cannot move and cannot be found. **All five funnel through `endDissociation`**,
which is idempotent so death and logout can call it unconditionally:

| path | where |
|---|---|
| the episode's own clock | `tickDissociation`, sanity tick |
| sanity climbing back out | same |
| death | `on('player.death')` |
| logout | `on('player.logout')` — plus `_bodyZone`, so `persistableZone` writes the real room |
| `wake` | the command gate — being unable to leave is a bug however good the fiction is |

### The command gate is not optional

A dissociating player is standing in a room that will be deleted in ninety seconds, so they
take the **same `DREAM_VERBS` allowlist** a dreamer does. `drop` in a dream room files the item
under `_ground_<dream zone>` and orphans it in the DB forever; the allowlist is about the
transient room, not about sleep. Walk and look, and nothing else.
