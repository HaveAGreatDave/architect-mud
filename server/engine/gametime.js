// server/engine/gametime.js
//
// Single source of truth for the game-speed knob (`timeScale`): how many game
// minutes elapse per real minute. 1 = the historical 1:1 clock; 3 = an 8-hour
// game day; etc. environment.js owns the value (loaded from world_clock and set
// via the dev panel) and calls setTimeScale(); every other system that needs to
// scale an in-world duration reads it through the helpers below.
//
// This module deliberately imports nothing so any engine/plugin file can pull
// the helpers without risking a circular import through environment.js.
//
// Two conversion patterns:
//   - Absolute deadline (stored `Date.now() + duration`): wrap the duration in
//     gameMsToReal() at write time so N game-ms of world-time becomes the right
//     number of real-ms to wait.
//   - Tick-driven decay (recomputed each tick): scale the elapsed span by the
//     current scale, e.g. realMsToGame(elapsed) or `* getTimeScale()`, so a
//     live slider change is honoured on the very next tick.

let scale = 1;

export function setTimeScale(s) {
  const n = Number(s);
  scale = Number.isFinite(n) && n > 0 ? n : 1;
  return scale;
}

export function getTimeScale() {
  return scale;
}

// A game-time duration (ms) → the real-time ms to actually wait for it.
export function gameMsToReal(ms) {
  return ms / scale;
}

// A span of real elapsed time (ms) → the game-time (ms) experienced over it.
export function realMsToGame(ms) {
  return ms * scale;
}
