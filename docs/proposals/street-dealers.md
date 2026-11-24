# Street dealers and street cred

**Status:** phases 1 and 2 built (the 3D tells, street cred and Tibs Klimek, the first contact: [plugins/streetcred](../../plugins/streetcred/README.md)); phases 3 and 4 are design.

## The problem

There are covert dealers already: Gita Halvard (`npc_dealer_marsh`), Lenny Sorel and the Fixer, each opened by a spoken passphrase at night and selling a trust-tiered shelf ([plugins/dealer](../../plugins/dealer/README.md), `flags.trust_flag` in `server/engine/vendor.js`). But each one's trust is its own. Nothing connects them, nobody sends you from one to the next, and in the 3D view a dealer looks the same as everyone else, so there is nothing to spot and no reason to look.

Nor is there anything to earn with the black market as a whole. The only reputation is order rep ([systems-ideologies.md](../systems-ideologies.md)), and nothing a player does on the wrong side of the law pays it.

This doc adds two things:

- **Street dealers**, NPCs who sell drugs from a fixed spot, with tells that let a player pick one out of a crowd.
- **Street cred**, a hidden standing with the black market as a whole, earned by building trust with the people in it.

## Who runs the street

The Ascendants are the law. They serve the Architect, whether or not it cares, and they run the police, District 9 included, along with the heavily modified cyborgs and machines that keep order past what D9's officers can do.

The black market is everyone working against or around that. In the city its people are mostly Long Watch, some Null, the odd Wildblood, and more often no order at all: crooks for the love of the game. The Long Watch are an underground resistance, not a police force. They have their own idea of law and order, and they fund the fight against the Ascendants through the black market and money laundering, so a Long Watch fence is in it for the cause as much as the cut.

Street cred and order rep are separate. A Long Watch fence trusting you as a customer doesn't make you Long Watch, and joining the Long Watch doesn't make the street trust you.

## Street cred

### What it is

One hidden number per player, in `player_flags` (`street_cred`), with its own clock for decay. It's what the black market has heard about you. Each contact also keeps their own trust in you through relationship memory ([systems-relationships.md](../systems-relationships.md)): that's what one person knows from dealing with you. Cred opens doors to people you haven't met; personal trust is what you have with someone you have.

### It's never shown

No number, no tier, no line in `rep` or the CODEX. A player notices it only in how black-market people treat them: who talks to them, who sells, at what price, in what tone, and who sends them on to whom. Every reader of cred turns it into behaviour, never text about cred. A line like "word is you're good for it" is fine; "your street cred has risen" is not.

### How it grows

- **Trust with a contact.** Repeat business raises your relationship with that person. Cred rises when you cross a trust step with someone, not per purchase, so buying fifty joints doesn't farm it. A contact who's further up the ladder is worth more.
- **Vouches.** A contact who trusts you enough sends you to the next one. Being sent is a cred step of its own.
- **Doing right by them.** Paying in full, delivering what you said, holding a stash and giving it all back.

### How it drops

Kept deliberately loose until the reporting system exists:

- Cheating a contact: short-changing, not paying, selling them out.
- Working with the police. This is the big one, and it waits for crime reporting and the enforcer path (below).
- **Decay.** Cred drifts back toward zero when you stop showing up, slower than order rep's 30-day half-life, because people talk about you when you're not there. A starting figure of 60 days, to be tuned.

### What it opens

- More contacts, each further up: the weed dealer, then fences, then harder drugs, then guns.
- Better prices from fences and dealers.
- Jobs: running a package, holding a stash, later the heavier work.
- Warnings: a contact tells you SPECTER or D9 has been asking about you.

## Old Coldwater

The south-east slums ([old-coldwater.md](old-coldwater.md)) are where this starts and where it's hardest. People there don't like outsiders. Until they trust you, the black market there is anything from annoyed by you being around to furious about it.

What that means for a stranger:

- Dealers and fences there won't sell, and say so rudely.
- Push it, by hanging around, asking again or following someone, and annoyance turns to anger: they tell you to leave, they move off, and a lookout may start watching you. At worst it ends in a fight.
- Ordinary residents are cold too, but the black market is worst.

Each Old Coldwater contact has a high trust threshold before they're anything but annoyed, and treats an outsider's cred as worth less than a local vouch. Nothing there carries words, painted or lit, so the tells are all in people's behaviour.

### The way in: the weed dealer

One dealer at the edge of Old Coldwater sells only weed at first. He's the one person there who'll put up with an outsider, because weed is low-risk and cheap. He's the first rung:

1. He sells you weed, grudgingly, and remembers you.
2. Come back, pay, don't cause trouble, and he gets friendlier.
3. Once he trusts you, he sells more, and later sends you to someone else: a fence, or someone with harder stock.

He's in no order, just a local doing business. Name, look and lines go in his content file (`flags.parley`, `flags.street_dealer`).

## Spotting a dealer

### Rules

- **No single tell gives a dealer away.** Ordinary NPCs loiter, wear hoods and keep late hours too. A player spots a dealer from several tells together, and can still be wrong.
- **Every tell shows in 3D and in text.** A tell drawn only in ROOM or GLASS is lost on the text and log rungs ([systems-display-mode.md](../systems-display-mode.md)). Each has a `look`, `listen` or `smell` line.
- **A dealer is content, not code.** `flags.street_dealer` on an NPC file. Nothing special-cases a named dealer.
- **Their routine comes from the clock.** Where they stand and what they're doing is a pure function of the NPC id and the server clock, the same on server and client, as `cat-life.js` and the birds are. Only beats such as a handoff or a greeting are messages.
- **No new per-move queries.** Cred is hydrated onto the live player at login; stock and prices live on the NPC row and in RAM.

### Where and when

| Tell | What it is | How it shows |
|---|---|---|
| Holds a spot | One corner, alley mouth or stairwell for hours, moving only a few steps | 3D: stands while the crowd walks. Text: in the room every time you pass |
| Night hours | Out after dark, near clubs, the casino and Old Coldwater | Routine keyed on the clock |
| Leaves when police come | Walks off when D9, an Ascendant unit or a SPECTER camera is near, and comes back later | Reads the surveillance plugin's patrol and camera state |

### How they move

| Tell | 3D | Text |
|---|---|---|
| Watching around them | A look over each shoulder every few seconds, turning further than a walker's | `look`: "keeps checking the street behind him" |
| Leaning | Shoulder to the wall, one foot up, hands in pockets | Room line: "leaning in the doorway" |
| Handoffs | Now and then a passer-by stops for two seconds, a hand-to-hand clip, both move on | Ambient line: "Somebody stops by the stairwell, then keeps walking." |
| Notices you | Turns their head toward you as you pass. A chin-up if they know you, a hard stare if they don't | "gives you a nod" or "watches you until you've gone past" |

Poses follow the natural-poses rule: weighted, asymmetric, never stiff.

### How they look

Kept small, so a dealer doesn't look like a costume: hood up or a cap pulled low whatever the weather, a bum bag or crossbody bag, a cheap phone they keep checking. Clothing layers through the usual `CLOTHING` table ([npc-clothing.md](../npc-clothing.md)); plenty of ordinary NPCs get the same pieces.

### Smell, sound and speech

- **Smell:** something faint and sweet or chemical through the senses hook ([systems-senses.md](../systems-senses.md)), only within the room.
- **Listen:** a low whistle or a muttered phone call at night.
- **Parley:** patterns in `flags.parley` ([systems-parley.md](../systems-parley.md)). What they say depends on trust: "Keep walking." to a stranger, "You lost?" once they've seen you about, "What do you need?" to a regular.
- **Face:** guarded, annoyed or angry for a stranger, relaxing for a regular, through the expression system ([systems-expressions.md](../systems-expressions.md)).

## Getting served

A dealer or fence decides from two things: their own trust in you, and your cred weighed by how much they care about outsiders (high in Old Coldwater). If you don't clear their bar, they brush you off, or worse in Old Coldwater. Asking again too soon makes them leave the spot.

The sale is the commerce plugin's panel with the dealer's own stock. No new buy verb.

## Data

On the dealer's NPC file:

```json
"flags": {
  "street_dealer": {
    "spot": "zone_district_926_917",
    "hours": [21, 4],
    "stock": [
      { "item": "drug_xxx", "price": 40, "qty": 5, "trust": 0 },
      { "item": "drug_yyy", "price": 120, "qty": 2, "trust": 40 }
    ],
    "wary": 0.8,
    "vouches_to": ["npc_xxx"]
  }
}
```

- `stock[].trust` is the trust a line needs before it's offered. The weed dealer's weed is 0; everything else is higher.
- `wary` is how hard the contact is on outsiders, 0 to 1: how little cred counts against their own trust. Old Coldwater contacts sit high.
- `vouches_to` is who they'll send you to.

Fences get a `street_contact` block with `wary` and `vouches_to`, and their buy prices scale with trust. `stock` restocks on a scheduler tick that runs only while `hasActivePlayers()` is true.

## Phases

1. **Spotting.** ✅ Built: a contact with `flags.street.post` holds one spot all night in GLASS, leaning on the wall where there is one. Up close they play `dealerLean` or `dealerStand` (actor3d.js), one 32-second loop of glances, a double-take, a bag pat, a scan, a phone check, a shrug, a sniff and a tapping heel; and they stare at a stranger the whole time you're near, or give a regular a chin-up (`npc.streetRegard`). Not built: leaving when the police come, and handoffs (phase 4).
2. **The weed dealer and street cred.** ✅ Built: `street_cred` with its decay, trust steps paying cred, new contacts seeded from cred, walk-in lines by standing, and Tibs Klimek (weed at trust 0, psilocybin at 40, opium at 75, a vouch to Sorel at 100). Built differently from the sketch above: a contact is any trust vendor with a `flags.street` block, so `wary`, `lines` and `vouches_to` live there rather than in a separate `street_dealer` block. Still to do: the fences reading trust and cred.
3. **The ladder.** Vouches, the next contacts up, harder stock and the first jobs.
4. **Handoffs.** Passer-by NPCs who stop and buy, the clip and the ambient line.

## Later

- **Crime reporting.** A way to give the police evidence of a crime. It's what will cost cred most, and how much it costs waits on it.
- **The enforcer path.** The opposite of street cred: working for the Ascendants as police or an enforcer. It'll be its own doc.
- **Undercover police and lookalikes.** Dealers who are D9 and loiterers who only look like dealers. Waits on crime reporting.

## Open questions

- Do dealers carry anything a player can loot, and what happens to a spot after a dealer is killed? In Old Coldwater, what does killing one do to everyone else's trust?
- Does a regular get a cheaper price, or only access?
- Does the Long Watch's share of the black market ever let order rep and cred touch, for example a Long Watch job that needs a fence's trust?
