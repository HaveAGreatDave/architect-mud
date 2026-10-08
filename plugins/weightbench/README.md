# weightbench

**Purpose** — the gym. Posture-based workouts on furniture flagged with a station key. Three stations, one loop:

- `lift` a bench — **Brawn**
- `spar` a rebound wall — **Reflexes**
- `drill` a conditioning circuit — **Endurance**

## The two gates
Enough sets grant a point, with a **rising rep cost per level**. But the point is **paid straight out of Net XP** — so reps are the *time* gate and XP is the *real* one. You cannot grind a stat you have not earned; you can only choose to spend earned progress on it.

## Commands
- `lift` · `spar` · `drill`

## Where the stations are
- **Ring Fenced** (916,905, Lever Lane): the boxing gym, with all three. Its bags are `spar` in the `bag` style.
- **The Sump's back room**: the rebound wall (`spar`) and the circuit (`drill`).
- **Precinct 9's cells**: a bench (`lift`).

## Extension points
Stations are **data**, in `stations.js`. A fourth station is a table entry plus a furniture flag.

A piece of furniture can carry `flags.station_style`, naming an entry in its station's `styles`. A
style swaps the prose (the noun, the start and stop lines, the three fatigue tiers and the gain lines)
and nothing else, so a heavy bag and a rebound wall are the same `spar` at the same price. `stationFor`
resolves it, and the style rides on the workout so every set says the same thing.
