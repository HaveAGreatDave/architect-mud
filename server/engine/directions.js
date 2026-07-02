// Shared direction constants. Single source of truth — previously copy-pasted
// across ai-behaviour.js, mapValidation.js, movement.js, and api/routes.js.

export const OPPOSITE = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up', in:'out', out:'in' };

// Grid offset per direction as [dx, dy, dz]. `in`/`out` are non-spatial (0,0,0).
export const DIR_OFFSET = { north:[0,-1,0], south:[0,1,0], east:[1,0,0], west:[-1,0,0], up:[0,0,1], down:[0,0,-1], in:[0,0,0], out:[0,0,0] };
