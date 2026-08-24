# workspace

`workspace` (alias `bench`) — a text HUD over whatever working area you're
standing in.

## What it is, and what it must never become

This plugin renders a working area. It does **not** simulate one. Every number,
name and state on the panel is a read of something another plugin already owns.

> **The rule:** the HUD holds no gameplay logic. Every action it offers resolves
> to a verb string a player could have typed.

That is not style. It is the thing that keeps a HUD from quietly becoming a
second, divergent implementation of cooking — which is what a crafting menu is.
A player who never opens the panel plays exactly the same game; a player who
lives in it types less and learns the verbs anyway, because the panel shows them.

**All six phases are built.** The panel renders the area, every component carries
the actions that apply to it, the Recipe Assistant scores what you know against
what's in the room, `prepare <recipe>` gathers one, player recipes live in the
cooking plugin, and there are **two providers** — see
[docs/proposals/preparation-workspace.md](../../docs/proposals/preparation-workspace.md)
for the build order and the reasoning behind each.

The rule has a regress case rather than a comment: every `command` in a payload
is checked against the live verb registries (builtins + plugin commands +
specialized actions). A HUD that grew a private code path fails the suite.

## Providers

The plugin knows nothing about kitchens. It asks the room:

```js
gatherHook('workspace.provider', player)
  → { key, label, priority, build(player) }   // or undefined
```

- `key` — `'kitchen'`, `'chembench'`, …
- `priority` — settles a room that is two workspaces at once. Highest wins; ties
  break on `key`, so the answer is at least stable. (This is the same ambiguity
  `cook` already has to settle in a room holding a stove and a chem lab.)
- `build(player)` — returns `{ storage, area, components, tools, status, assistant }`.

**A gather-hook, not an import.** Cooking contributes the `kitchen` provider from
[plugins/cooking/workspace.js](../cooking/workspace.js) without either plugin
importing the other — pull this plugin and cooking is untouched; pull cooking and
a kitchen simply has no provider. It's the same reasoning that has cooking reach
synthesis through an Action.

### Two providers, and what that proved

`chembench` ([plugins/synthesis/workspace.js](../synthesis/workspace.js)) is the
second, and it is the test of every claim above: **nothing in this plugin or in
`client/game/js/panels/workspace.js` changed to add it.** The vocabulary is
completely different — reagents, tiers, a station-quality bonus, a shared vault
instead of a pan, a rank gate instead of a discovery gate — and none of it leaked
upward. What the two share is the SHAPE.

The interesting divergence is the Assistant. The kitchen's hides the recipes you
haven't discovered, because discovery-by-experiment is its whole mechanic. The
bench's lists everything, because chemistry recipes are gated on **rank**, not on
discovery — there is nothing to spoil, and a chemist who can't see what the bench
does can't plan a buy. Same panel, opposite call, and the provider is where that
belongs.

**Priority.** A stove is 20, a chem lab 15, a kitchen with only a dish cabinet
10. So a room with a stove opens as a kitchen and a lab-only room opens as a
bench; either way the other is one `workspace <key>` away and the header shows a
chip for it. That is the honest answer to an ambiguity `cook` itself resolves
with a SIFT prompt.

Detection is expected to be **in-memory and free**. `workspace` is a verb people
will type in the street, and finding out the answer is "no" must not cost a
round trip.

## The payload

```js
{
  type: 'workspace_view', provider, title, providers: [{key,label}],
  storage:    [ { id, name, preserves, items: [Component], other } ],
  area:       [ { id, name, place, heat, hot, contents: [Component] } ],
  components: [ Component ],   // loose, on you
  tools:      [ Component ],
  status:     [ { label, value, state: 'ok'|'warn'|'off' } ],
  assistant:  { groups: [ { label, recipes: [Recipe] } ], unknown, note } | null,
  empty:      Boolean,
}
Recipe    = { key, name, vessel, band, pct, missing: [String], equipment: [String],
              ingredients: [String], method: [String], uses: [componentId], suggestion, actions }
Component = { id, name, qty, kind, state, notes: [String], live, actions: [Action] }
Action    = { label, command, hint }
```

`command` is **the literal verb string**, never an opaque id. That is the
enforcement mechanism for the rule above: you can read a payload and see that
the HUD can only do what a player could type, and the client needs no verb
knowledge at all — it renders labels and posts commands.

Two conventions the client depends on:

- **A trailing space means the command is a PREFIX.** `marinate steak in ` wants
  a second object the HUD can't choose, so clicking it fills the input line
  instead of firing. Those actions are labelled with a trailing `…`.
- **Clicking runs `sendCmd`, not `sendCmdSilent`** — the command echoes into the
  log exactly as though it were typed, and the tooltip shows it. The panel is
  meant to *teach* the verbs, which is why using it doesn't make them redundant.

`workspace.view` fires with `{ view, provider, player }` before the payload
ships, so a plugin can decorate a workspace in place — the same seam
`container.view` gives the wardrobe.

## Gates are coarse on purpose

A provider decides which actions to *offer* using cheap structural gates —
profile family, raw/cooking/cooked, whether the tool is in reach. Those are **not
the verb's real preconditions and must never try to be**. `score` alone checks
scored, minced, on-the-heat and already-cooked; re-deriving that in the provider
would be a second implementation of the exact thing this layer exists not to
duplicate, and it would drift the first time somebody tuned the verb.

So the HUD proposes and the verb decides, the same as for a player who typed it.
The worst case is an offered action that answers *"it's already scored"* — a true
sentence, and a better teacher than a button that quietly wasn't there.

## The Assistant only ever shows recipes you know

That isn't the panel being coy, and it isn't a phase-3 shortcut. It's the
cookbook's rule, and breaking it here would break the cooking system somewhere
else.

Knowing a recipe never gates cooking it — any combination always cooks, and
**discovery is what writes one down**. The Cookbook app is deliberately blank
about the half you haven't found, *"because a checklist of exact ingredient
counts would turn discovery into data entry."* An Assistant listing all 47
templates with their exact shortfalls would be precisely that checklist,
delivered faster.

So it scores what you KNOW against what's in the room, and says only how many
others are out there — the same sentence the Cookbook app ends on. A regress case
asserts an undiscovered dish is never named.

Two smaller rules fall out of it:

- **The Assistant plans; it does not execute.** A pot in the cabinet counts
  toward equipment even though `stow x in y` can't reach into a cabinet, because
  "you own a pot, it's in the cupboard" is the answer somebody wants.
- **A finished dish is never an ingredient**, nor is anything already on the
  heat. Counting either would promise a stew you'd have to dismantle dinner to
  make.

Completion is scored against **the matcher's own lower bound**, tolerance
included, so the Assistant can never say *ready* about a pan the matcher would
reject — or the reverse.

## Reading a recipe

Click one and it opens: the ingredient list in real weights, the numbered
method, and — the part that makes the panel worth opening — **`uses` marks the
exact rows it would take, wherever they are**. The onion in the fridge, the pot
still in the cabinet, the cut already in your hand: all flagged in place with a
`▸`, so "what do I need to get out" is a glance instead of a comparison.

Selecting costs **no round trip**. The payload already carries `uses`; picking a
recipe is a way of looking at what you already have.

**The recipe gets its own section, below the Assistant** (client-side; the
payload is unchanged). What a dish *is* — ingredients, kit, method — is a card
you read, and unfolding it inside the list of everything you could cook pushed
the two things the Assistant is actually for, *what you're short of* and *what to
press next*, off the bottom behind a dozen lines of catalog. So: judgement stays
in **Recipe Assistant** (the bar, the shortfall, the step-by-step), and the
catalog moves to **Recipe — `<name>`**, one section per open recipe in the order
you opened them, numbered to match the `▸1`/`▸2` marks.

**Several at once.** Selection is a Set — planning a meal is more than one dish,
and "what do I need for all of this" is the question worth answering. The
highlight is the union, which slightly overstates when two recipes want the same
onion (each `uses` was computed independently), so it reads as *these rows are
involved* rather than as an exact allocation. Saying that plainly beats
pretending to an accuracy a union can't have.

**Take the marked** appears under Storage when any highlighted row is in a room
container: one button, one `pullid` per row, nothing you couldn't have clicked
individually.

**Short of something?** The action becomes `+ list` instead of `prepare` — it
adds the shortfall to your shopping list (`plugins/cooking/shoplist.js`), which
then marks matching stock when you walk into a shop.

## `walkthrough` — the dish, written as commands

An opened recipe carries `walkthrough: [{ text, command, hint }]` — the whole
dish end to end, one step per line: pull the pot out of the cabinet, chop what
arrives whole, fill the pan at the tap, stow each row in the recipe's own
ingredient order, `cook`, ride the burner through the profile's heat curve,
handle it the profile's own number of turns, drain, plate. Every step is a verb
string a player could have typed, composed against the rows `pickFor` just
picked, so the runbook and the highlight can never name different onions. The
same steps print at the log rung, each one a link.

**It carries no gameplay logic, and it is not `prepare`.** `prepare` executes
and therefore stops at a loaded vessel; the runbook goes all the way to `plate`
because it executes *nothing* — the player presses each step, which is the
difference between a recipe and an autocook. The heat and the moment to plate
stay theirs.

**The whole step is the button** (client). A chip on the end of a row is right
for an action hanging off a *thing* — Take, Stow — but a runbook is a column you
press your way down, and hunting a chip at the end of every sentence is not that.
So the step itself is the target and the command rides on the right of it, dim
until you're on the line: the panel still teaches the verb, it just doesn't make
you aim at it.

**A step with no verb behind it is prose, not a button.** "Leave it alone —
turning this makes it worse" has no command and gets none; "off the heat before
the gin goes in" stays in the authored method above, because there is no `stove
off`. The runbook never invents a verb to look complete.

**Only a ready recipe carries one.** A runbook whose fourth line names an onion
you haven't got is a lie with line numbers, so it's empty whenever the recipe is
short — the shortfall rows are the useful answer there.

## Live refresh

The panel polls **only while something is cooking** — `sendCmdSilent('workspace')`
every 5s when the payload shows a hot vessel or a live component, and nothing at
all otherwise. An idle workspace is staring at a cold cabinet and has no reason
to say anything; a pan on the heat is the one thing here with a clock. That
gating is what makes it affordable, and it's why this is a client timer rather
than a server push: the server would have to decide who is watching.

**`uses` comes from the same picker `prepare` runs** (`pickFor` in the kitchen
provider). That sharing is load-bearing, and there's a regress case on it: two
implementations of "which onion" would show you one row and hand you another the
first time either was tuned.

## Three surfaces, one builder

`buildWorkspaceView` is asked once and the answer is rendered three ways, so no
two of them can disagree about what is on the bench:

| Rung | What you get |
| --- | --- |
| `visual` | the graphical HUD (`client/game/js/panels/workspace.js`) |
| `log` | the generic list dialog — grouped rows, one button per command, focus-trapped and named (`listdialog.js`) |
| any rung, on request | `workspace text` — the whole HUD as prose in `#output` |

Two rules hold that up.

**`text` is a MODIFIER, not a positional provider key.** It is lifted out of the
arguments rather than read from `args[0]`, which is what lets a caller name its
own provider and ask for prose in one command — `cook text` arrives here as
`['kitchen', 'text']`. Read positionally, a kitchen with a chem lab in the back
printed whichever provider won on priority, so a player could not read out the
bench they had just named.

⚠ **The dialog is the CONTROL; the log still gets the RECORD.** At the `log` rung
a one-line `msg-system` note goes to `#output` before the dialog payload — the
same rule `shop` follows (`plugins/commerce/index.js`). The dialog is announced
because focus moves into it, but a player scrolling back has to be able to see
that they opened the bench at all, and the rung's own contract is that a system's
record reaches `#output`. One line, not the whole HUD: that is what
`workspace text` is for.

## `prepare <recipe>` — a plan, never a claim

A provider may supply `plan(player, argStr)`, returning
`{ label, steps: [command], vessel }` or `{ error }`. The runner walks the steps
one at a time through the ordinary command pipeline.

**That is what makes reservation unnecessary.** Nothing in this game soft-locks
an inventory row: trade refuses escrow outright, crafting consumes at commit, a
storefront moves ownership instead. A reservation here would mean every path
that moves an item had to honour it — and one nobody checks is worse than none.
Because each step *is* a real command, the run re-validates continuously. If a
housemate took the onion between the plan and the run, that step fails with the
message the verb already produces:

```
Stew
  ✓ pullid 3f2a…
  ✓ stow broth in stockpot
  ✗ stow onion in stockpot — You don't have "onion".
Stopped after 2 of 4.
```

Two hard rules in the runner:

- **Stop on the first failure.** Ploughing on leaves half a recipe in a pan and a
  player who has to work out which half.
- **Never answer a prompt.** If a step raises a SIFT disambiguation, the run
  hands it back and stops. A runner that picked for you would be making the
  choices the game deliberately asks a human to make.

And one rule in the kitchen planner: **it stops at a loaded vessel and does not
cook.** Heat is where the skill is — which burner, when to turn it, when to
plate — and a HUD that pressed those buttons would be playing the interesting
half of the game for you.

## Cost

One build is **two queries**, both in the provider: what the player carries, and
what the room's boxes hold. Appliances, burner state, power and temperature are
in-memory world reads and cost nothing, and so is the cookbook — `cookbookState`
answers from the flag cache for any player whose flags are hydrated, which every
logged-in player's are.

There is **no server-side panel state**, no tick, and no write of its own — an
action's writes are whatever that verb already made. Closing the panel is a
client-side act; there is nothing to tell the server about. Refresh is the client
re-issuing `workspace` after an action, exactly as the container panel re-issues
`opencontainer` after a stow. Nothing is pushed unsolicited.

## Files

| File | Holds |
|---|---|
| `index.js` | the verbs, the provider gather, payload assembly, the plan runner |
| `regress.js` | the seam, the payload shape, and the derived-build invariant |

The kitchen provider lives with cooking, not here — a provider is content-shaped
knowledge about one domain, and this plugin's whole value is not having any.
