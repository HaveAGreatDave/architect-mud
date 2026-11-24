# bookie

**Purpose**: a house book on the sports broadcasts. A bookie NPC (`flags.bookie`) takes bets on whichever games are on the air, win or lose only, at odds the house sets. The first one is Sal Brennock at The Lucky Bastard.

The player-vs-player version is `sportsbet`; this one is you against the house.

## Commands
- `odds`: the board. Each airing game with both clubs' records and decimal odds on each side.
- `punt <amount> <team>`: back a side (₵5 to ₵2000). A ₵100 punt at 2.40 returns ₵240.
- `slips`: your open bets.

All three need a bookie in the room except `slips`.

## How the line is made
Each club's win rate is pulled toward .500 by four phantom games, the two are set against each other with log5, the home side gets +0.04, and the result is clamped to 0.10..0.90. The price is `1 / (p × 1.07)`, rounded down, so the house keeps about 7%.

## Why the book shuts
The broadcast decides the whole game when it starts airing (`sports.game` carries the result), so the book takes money only for the first four minutes of an airing. A game first seen in the 90 seconds after boot is one already under way, and its book never opens.

## Data
`bookie_bets`: one row per slip, with the result copied on at the time it's taken and `resolve_at` set to the game's end. The sweep closes the row before paying, so it can't pay twice. A tie refunds the stake.
