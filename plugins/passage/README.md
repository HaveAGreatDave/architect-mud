# passage

**Status: built.**

`use <piece>` on furniture flagged `flags.passage: "<dir>"` takes the room's exit in that
direction through `cmdMove`, so every move gate and lock applies. The exit must exist;
the furniture only names a direction. Optional `flags.passage_emote` (`{who}`) is told to
the room you left.

Used by the storm-drain grates over the Under (`down`) and the ladders under them (`up`).
