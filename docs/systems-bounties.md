# Bounties — money on a head (as built)

> Status: **BUILT.** Lives in [`plugins/bounty/`](../plugins/bounty/index.js) with its own
> `regress.js`. `bounties` is in `SCHEMA_SQL`. Three WANTED boards ship as content.

A player pays their own credits to have another player killed. Somebody else has to
bring the head in to collect. Not to be confused with the **[Wanted system](systems-surveillance.md#wanted-system-phase-6)**,
which is the *law* — stars, police and jail. This has no legal standing whatsoever
and never touches a star.

---

## The four decisions

### 1. The head is a physical object, and that is the whole system

A bounty does not pay the killer. **It pays whoever walks up to a board holding the
head.** Killing someone with paper out mints an `item_bounty_head` into their corpse
— an ordinary inventory row, so it can be looted by a third party, taken off you in
a fight, dropped, traded, or lost with your own corpse when somebody kills you on
the way to cash it.

None of that needed code here. It is the inventory system, which is exactly the
argument for making the head an item rather than a flag on the kill. An auto-payout
on death would have been four lines and would have deleted every one of those
stories.

The head is minted **only when a contract is open**, because an object with no use
teaches players to ignore the object.

> **No corpse ⇒ the head goes to the killer directly.** A plugin taking custody of
> the body (jail confiscating your gear) must not silently void the contract —
> losing a bounty to a rule nobody could have known about is worse than the small
> inconsistency of a head that skipped the corpse.

### 2. Money is escrowed, never silently destroyed

The stake leaves the backer's pocket at posting and lives on the `bounties` row until
it is paid, refunded, or forfeited. A restart cannot lose it and cannot pay it twice.

| Moment | What happens to the money |
| --- | --- |
| Posting | You pay `amount`. `HOUSE_CUT` (10%) is taken and gone. The rest is escrow — **and escrow is the number printed on the sheet**, so the poster never advertises more than the hunter is paid. |
| Collected | Escrow → whoever handed the head in. |
| Expired (7 days) | Escrow → back to the backer, **whole**. The cut was spent printing the sheet; charging it twice would make posting a bounty a bet against the server's population. |
| Withdrawn early | Escrow minus `WITHDRAW_PENALTY` (25%). A threat you can wave around for free is not a threat. |

⚠ **A claim closes the row with a guarded `UPDATE ... WHERE status='open'` BEFORE a
single credit moves.** Two heads arriving at two boards in the same tick is the case
that pays the escrow twice if those two statements are ever reversed.

### 3. The sheet names nobody

Anonymity is the default because **a bounty you have to sign is a declaration of war,
and most people would simply never post one.**

The target can `bounty unmask` and pay `UNMASK_COST` (25% of the escrow) to learn who
funded it — which turns a bounty from a thing done to you into a thing you can answer,
and gives the money a second place to go. The reveal is persisted in `unmasked_by`,
not held in memory, so it survives a relog; and the backer is **never told they were
asked about.**

`buildPoster(row, { viewer })` decides only *whether the backer is named* and *whether
the sheet says "this is you"*. It never changes the reward, the deadline or the terms
— a poster two people read differently about the **money** is a poster nobody trusts.

### 4. It expires, and the refund is real

Seven days. A target who takes a week off is not a target the system should keep
punishing, and an escrow that sits forever is money removed from the economy. The
sweep is a **5-minute idle-gated pass over the in-memory Map**; only a row that
actually expires costs a round trip. An offline backer is refunded with a direct
`UPDATE players` — `adjustCredits` needs a live player object for its mirror and
there isn't one.

---

## Boards

Money changes hands at furniture flagged `flags.wanted_board` (and the leaderboard's
`bulletin` boards carry sheets too, because a world with two kinds of board is a world
where players stand at the wrong one). **Posting and redeeming both require a board** —
which is what makes a board a place people meet, and what stops the tablet app from
turning every board in the city into decoration.

Three ship as content: the Grind House, the Cherry Pit, and — the joke — a cork board
in Bishop's Blend, between a lost cat and a guitar for sale.

The board's `furniture.describe` hook says how much paper is on it before you read it,
so a player who never types `bounty` still finds out the system exists by walking past.

## Verbs

| Verb | |
| --- | --- |
| `bounty` | the board, plus anything out on you |
| `bounty <name> <amount> [why]` | post (at a board) |
| `bounty <name>` | read that sheet in full |
| `bounty cancel [name]` | pull your own sheet down |
| `bounty unmask` | pay to learn who paid |
| `redeem` | hand a head in at a board |
| `read <board>` | the same list, from the board |

`bounty <name> <amount>` and `bounty <name>` are told apart by **a numeral after the
first token** — nothing else in the grammar takes a number, so a lookup can never be
mistaken for a posting. `resolveTarget` is deliberately **not SIFT**: SIFT resolves
what is in the room, and the whole point of a bounty is that the target is elsewhere.
It also resolves an **offline** player, because "log off and the contract can't be
written" is a loophole the feature dies of.

## Accessibility

Every surface is **text first**, and the panel is a skin over the identical characters
— the *suppress* shape from [systems-display-mode.md](systems-display-mode.md#suppress-or-re-render).

- `posterLines()` builds the sheet as a monospace-framed character block. That block
  goes to the log **at every rung**, not only the bottom one. The client overlay
  redraws the same fields on paper; it does not re-word them, and it decides nothing.
- **Every line is padded to `WIDTH`**, so the frame stays vertical in a proportional
  typeface too — a player on the Accessibility page's `readable` font gets a slightly
  wobbly frame instead of a shredded one. Pinned by a regress case.
- **Reward size is a numeral AND a band word** (`₵12,000` · *life-changing*), never
  type size or colour. The "this one is you" marker is a glyph (`►`) as well as a hue.
- The overlay is `role="dialog"` with its decorative half `aria-hidden`; the close
  button stays reachable so the shared focus observer and Escape have something real
  to hold. **Not** `aria-hidden` on the overlay itself — that would leave a focusable
  control both reachable and unannounced.
- Every size in the panel CSS is `rem`, so the Font Size setting reaches the poster.
- `prefersReducedMotion()` kills the slam and the sway. The sheet still arrives.
- The server stamps `render: 'log'` at the `log` rung and no panel opens at all.
- The tablet app declares `verbs: ['bounty','bounties','redeem']`, so it appears in
  the log-rung `tablet` index as something you can type rather than a screen you can't.

## Cost

**No tick reads the database.** `openBounties` is a write-through in-memory mirror of
the open rows, loaded once at boot; the death path, the widget and the board's
describe hook all read the Map. This plugin is the table's **only runtime writer**,
which is the entire safety argument for the mirror (CLAUDE.md's write-funnel rule) —
if anything else starts writing `bounties`, the mirror has to go or grow an
invalidation.

Queries are confined to verbs a player typed, plus one on death (rare, and the correct
tier for it).

## Deliberately not built

- **No NPC bounties.** A contract needs a person with a grievance and a wallet, and an
  NPC-generated one would be a repeatable income stream wearing a revenge story.
- **No bounty on a knockout.** [Stealth](systems-stealth.md)'s rule is that a knockout
  is always something somebody *chose*; paying for one would make it something somebody
  was paid for, and the head is the point.
- **No stars.** Collecting a bounty is still murder as far as the law is concerned, and
  it is charged as such by the ordinary [wanted system](systems-surveillance.md). The
  board's indifference is the joke; the police's is not implied.
