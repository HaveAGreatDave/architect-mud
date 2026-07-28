# sportsbet

**Purpose** — player-vs-player betting on the live broadcast game. `wager` proposes; the opponent takes the other side. Stakes are **escrowed**, and when the game's final airs the pot goes to whoever called the winner — with a called **exact score** trumping a plain winner call.

Both parties are notified with the winner, the final score and the bet details.

## Commands
- `wager <player> <amount> <team> [away-home]` — propose.
- `takewager` — take the other side.
- `cancelwager` — withdraw.

## Dependency of note
It bets on **whatever is airing** — so it is coupled to the broadcast schedule, not to a league API.
